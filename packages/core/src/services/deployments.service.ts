import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { Deployment } from '../models/notification';
import { Project } from '../models/project';
import { Secret } from '../models/infra';
import { Incident, IncidentEvent } from '../models/incident';
import { logger } from '../lib/logger';
import { badRequest, notFound } from '../lib/errors';
import { encryptSecret, timingSafeEqual, redactString } from '../lib/crypto';
import { loadEnv } from '../config/env';

export function verifyGithubSignature(rawBody: Buffer, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  try {
    return timingSafeEqual(expected, signatureHeader);
  } catch {
    return false;
  }
}

export async function setGithubIntegration(params: {
  workspaceId: string;
  projectId: string;
  repository?: string | null;
  secret?: string | null;
}) {
  const project = await Project.findOne({ _id: params.projectId, workspaceId: params.workspaceId });
  if (!project) throw notFound('Project not found.');

  if (params.secret !== undefined && params.secret !== null) {
    if (params.secret.length < 16) throw badRequest('Use a webhook secret of at least 16 characters.');
    const existing = await Secret.findOne({
      workspaceId: params.workspaceId,
      projectId: project._id,
      purpose: 'github_webhook',
    });
    const encrypted = encryptSecret(params.secret);
    if (existing) {
      await Secret.updateOne(
        { _id: existing._id },
        {
          $set: {
            ciphertext: encrypted.ciphertext,
            keyId: encrypted.keyId,
            fingerprint: encrypted.fingerprint,
            rotatedAt: new Date(),
          },
        },
      );
    } else {
      await Secret.create({
        workspaceId: params.workspaceId,
        projectId: project._id,
        purpose: 'github_webhook',
        label: 'GitHub webhook secret',
        ciphertext: encrypted.ciphertext,
        keyId: encrypted.keyId,
        fingerprint: encrypted.fingerprint,
      });
    }
    project.githubWebhookSecretSet = true;
  }

  if (params.repository !== undefined) project.githubRepository = params.repository || null;
  await project.save();

  const env = loadEnv();
  return {
    repository: project.githubRepository,
    webhookConfigured: project.githubWebhookSecretSet,
    webhookUrl: `${env.API_ORIGIN.replace(/\/$/, '')}/api/v1/webhooks/github/${String(project._id)}`,
  };
}

export interface GithubWebhookResult {
  accepted: boolean;
  status: number;
  message: string;
  deploymentId?: string;
}

/**
 * Ingests a verified GitHub webhook. Unknown signatures, unknown projects and
 * replayed deliveries are rejected before anything is written.
 */
export async function handleGithubWebhook(params: {
  projectId: string;
  rawBody: Buffer;
  signature: string | undefined;
  event: string | undefined;
  deliveryId: string | undefined;
}): Promise<GithubWebhookResult> {
  if (!Types.ObjectId.isValid(params.projectId)) {
    return { accepted: false, status: 404, message: 'Unknown webhook endpoint.' };
  }

  const project = await Project.findById(params.projectId);
  if (!project) return { accepted: false, status: 404, message: 'Unknown webhook endpoint.' };

  const secretDoc = await Secret.findOne({ projectId: project._id, purpose: 'github_webhook' }).select('+ciphertext');
  if (!secretDoc) {
    return { accepted: false, status: 409, message: 'No webhook secret is configured for this project.' };
  }

  let secret: string;
  try {
    const { decryptSecret } = await import('../lib/crypto');
    secret = decryptSecret(secretDoc.ciphertext);
  } catch {
    return { accepted: false, status: 500, message: 'The stored webhook secret could not be read.' };
  }

  if (!verifyGithubSignature(params.rawBody, params.signature, secret)) {
    logger().warn({ projectId: params.projectId }, 'Rejected GitHub webhook with invalid signature');
    return { accepted: false, status: 401, message: 'Invalid signature.' };
  }

  if (params.deliveryId) {
    const duplicate = await Deployment.findOne({ providerDeliveryId: params.deliveryId });
    if (duplicate) return { accepted: true, status: 200, message: 'Duplicate delivery ignored.' };
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(params.rawBody.toString('utf8')) as Record<string, unknown>;
  } catch {
    return { accepted: false, status: 400, message: 'Malformed JSON payload.' };
  }

  const event = params.event ?? 'push';
  let commitSha: string | null = null;
  let ref: string | null = null;
  let deployedAt = new Date();
  let environment = 'production';
  let url: string | null = null;
  let actor: string | null = null;
  let commitMessage: string | null = null;
  let save = false;

  if (event === 'push') {
    ref = typeof payload.ref === 'string' ? payload.ref : null;
    commitSha = typeof payload.after === 'string' ? payload.after : null;
    if (commitSha && /^0+$/.test(commitSha)) {
      return { accepted: true, status: 200, message: 'Branch deletion ignored.' };
    }
    const headCommit = payload.head_commit as { message?: string; timestamp?: string; author?: { name?: string } } | undefined;
    commitMessage = headCommit?.message ? redactString(headCommit.message, 300) : null;
    actor = payload.pusher ? redactString(String((payload.pusher as { name?: string }).name ?? ''), 120) : null;
    if (headCommit?.timestamp) deployedAt = new Date(headCommit.timestamp);
    save = Boolean(commitSha);
  } else if (event === 'deployment_status') {
    const status = (payload.deployment_status as { state?: string; environment_url?: string } | undefined) ?? {};
    const deployment = (payload.deployment as { sha?: string; ref?: string; environment?: string; creator?: { login?: string } } | undefined) ?? {};
    if (status.state !== 'success') {
      return { accepted: true, status: 200, message: `Deployment status "${status.state ?? 'unknown'}" recorded as no-op.` };
    }
    commitSha = deployment.sha ?? null;
    ref = deployment.ref ?? null;
    environment = deployment.environment ?? 'production';
    url = status.environment_url ?? null;
    actor = deployment.creator?.login ?? null;
    save = Boolean(commitSha);
  } else if (event === 'deployment') {
    const deployment = payload.deployment as { sha?: string; ref?: string; environment?: string; creator?: { login?: string } } | undefined;
    commitSha = deployment?.sha ?? null;
    ref = deployment?.ref ?? null;
    environment = deployment?.environment ?? 'production';
    actor = deployment?.creator?.login ?? null;
    save = Boolean(commitSha);
  } else {
    return { accepted: true, status: 200, message: `Event "${event}" is not used for deployment correlation.` };
  }

  if (!save || !commitSha) {
    return { accepted: true, status: 200, message: 'No deployment information in this payload.' };
  }

  try {
    const deployment = await Deployment.create({
      workspaceId: project.workspaceId,
      projectId: project._id,
      source: 'github',
      environment,
      commitSha: commitSha.slice(0, 64),
      commitMessage,
      actor,
      url: url ? redactString(url, 500) : null,
      ref: ref ? redactString(ref, 200) : null,
      repository: project.githubRepository,
      deployedAt,
      verified: true,
      providerDeliveryId: params.deliveryId ?? null,
      metadata: { event },
    });

    // Annotate any incident that was opened in the hour after this deployment.
    const related = await Incident.find({
      projectId: project._id,
      firstFailureAt: { $gte: deployedAt, $lte: new Date(deployedAt.getTime() + 3600_000) },
    }).limit(5);

    for (const incident of related) {
      const minutesAfter = Math.round((incident.firstFailureAt.getTime() - deployedAt.getTime()) / 60_000);
      await IncidentEvent.create({
        incidentId: incident._id,
        workspaceId: incident.workspaceId,
        type: 'deployment_correlation',
        message: `A deployment was recorded approximately ${minutesAfter} minute${minutesAfter === 1 ? '' : 's'} before the first observed failure. Timing correlation is not proof of cause.`,
        actor: 'BreakGlass',
        source: 'system',
        details: { deploymentId: String(deployment._id), commitSha, minutesBefore: minutesAfter },
      });
    }

    return { accepted: true, status: 200, message: 'Deployment recorded.', deploymentId: String(deployment._id) };
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      return { accepted: true, status: 200, message: 'Duplicate deployment ignored.' };
    }
    logger().error({ err: (error as Error).message }, 'Failed to record deployment');
    return { accepted: false, status: 500, message: 'Could not record the deployment.' };
  }
}

export async function listDeployments(workspaceId: string, projectId: string, limit = 20) {
  const deployments = await Deployment.find({ workspaceId, projectId })
    .sort({ deployedAt: -1 })
    .limit(Math.min(limit, 100));
  return deployments.map((deployment) => ({
    id: String(deployment._id),
    source: deployment.source,
    environment: deployment.environment,
    commitSha: deployment.commitSha,
    commitMessage: deployment.commitMessage,
    deployedAt: deployment.deployedAt.toISOString(),
    url: deployment.url,
    actor: deployment.actor,
    verified: deployment.verified,
  }));
}
