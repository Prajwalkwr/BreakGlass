import { Router } from 'express';
import {
  Artifact,
  Membership,
  emailStatusForUi,
  databaseState,
  getQueue,
  findOverdueChecks,
  requireWorkspace,
  readArtifact,
  signArtifactUrl,
  verifyArtifactSignature,
  checkArtifactStorage,
  WorkerHeartbeat,
  notFound,
  forbidden,
} from '@breakglass/core';

import { asyncHandler, ok } from '../../lib/http';
import { requireAuth } from '../../middleware/auth';
import { Types } from 'mongoose';

export const artifactsRouter = Router();
artifactsRouter.use(requireAuth);

/**
 * Evidence access requires all three: a valid session, membership of the
 * artifact's workspace, and a short-lived signature. Artifacts are never
 * served from a public path.
 */
artifactsRouter.get(
  '/:artifactId',
  asyncHandler(async (req, res) => {
    const artifactId = req.params.artifactId;
    const exp = String(req.query.exp ?? '');
    const sig = String(req.query.sig ?? '');

    if (!Types.ObjectId.isValid(artifactId)) throw notFound('Evidence not found.');
    if (!verifyArtifactSignature(artifactId, exp, sig)) {
      throw forbidden('This evidence link has expired. Reload the run to generate a new link.');
    }

    const artifact = await Artifact.findById(artifactId).lean();
    if (!artifact) throw notFound('Evidence not found.');

    const membership = await Membership.findOne({
      workspaceId: artifact.workspaceId,
      userId: req.auth!.user._id,
      status: 'active',
    });
    if (!membership) throw notFound('Evidence not found.');

    const { artifact: record, data } = await readArtifact(artifactId, String(artifact.workspaceId));

    res.setHeader('content-type', record.contentType);
    res.setHeader('cache-control', 'private, no-store');
    res.setHeader('content-disposition', `inline; filename="${record.kind}-${artifactId}.${record.kind === 'screenshot' ? 'jpg' : 'zip'}"`);
    res.send(data);
  }),
);

/** Issues short-lived signed URLs for a run's artifacts (called by the UI). */
export const runArtifactsRouter = Router({ mergeParams: true });
runArtifactsRouter.use(requireAuth);

runArtifactsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { workspace } = await requireWorkspace(String(req.auth!.user._id), req.params.workspaceId);
    const runId = String(req.query.runId ?? '');
    if (!runId) {
      ok(res, { artifacts: [] });
      return;
    }
    const artifacts = await Artifact.find({ workspaceId: workspace._id, runId }).limit(10);
    ok(res, {
      artifacts: artifacts.map((artifact) => {
        const signed = signArtifactUrl(String(artifact._id));
        return {
          id: String(artifact._id),
          kind: artifact.kind,
          bytes: artifact.bytes,
          contentType: artifact.contentType,
          url: signed.url,
          expiresAt: signed.expiresAt,
        };
      }),
    });
  }),
);

/* ------------------------------- Health -------------------------------- */

export const healthRouter = Router();

async function healthPayload() {
  const dbState = databaseState();
  let queue: { driver: 'mongo' | 'redis'; workersOnline: number; pendingJobs: number; deadJobs: number } = {
    driver: 'mongo',
    workersOnline: 0,
    pendingJobs: 0,
    deadJobs: 0,
  };
  let overdue: Awaited<ReturnType<typeof findOverdueChecks>> = [];
  let storage: { driver: string; ok: boolean; detail: string } = {
    driver: 'unknown',
    ok: false,
    detail: 'not checked',
  };

  try {
    const stats = await getQueue().stats();
    const workersOnline = await WorkerHeartbeat.countDocuments({
      lastSeenAt: { $gte: new Date(Date.now() - 45_000) },
    });
    queue = {
      driver: getQueue().kind,
      workersOnline,
      pendingJobs: stats.waiting + stats.active + stats.delayed,
      deadJobs: stats.dead,
    };
    overdue = await findOverdueChecks();
  } catch {
    // Queue inspection failing is itself a degraded signal.
  }

  try {
    storage = await checkArtifactStorage();
  } catch (error) {
    storage = {
      driver: 'unknown',
      ok: false,
      detail: error instanceof Error ? error.message : 'unavailable',
    };
  }

  const email = emailStatusForUi();
  // Evidence storage being unreachable degrades the deployment but does not by
  // itself stop monitoring, so it is reported separately from `status`.
  const status = dbState === 'connected' && queue.workersOnline > 0 ? 'ok' : 'degraded';

  return {
    status,
    version: process.env.npm_package_version ?? '1.0.0',
    uptimeSeconds: Math.round(process.uptime()),
    database: dbState,
    queue,
    storage,
    email: email.configured ? ('configured' as const) : ('development_outbox' as const),
    overdueChecks: overdue.length,
    timestamp: new Date().toISOString(),
  };
}

healthRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const payload = await healthPayload();
    res.status(payload.status === 'ok' ? 200 : 503).json(payload);
  }),
);

/** Liveness: the process is up. Deliberately does not touch dependencies. */
healthRouter.get('/live', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

/** Readiness: dependencies are usable. */
healthRouter.get(
  '/ready',
  asyncHandler(async (_req, res) => {
    const payload = await healthPayload();
    res.status(payload.database === 'connected' ? 200 : 503).json({
      status: payload.database === 'connected' ? 'ok' : 'degraded',
      database: payload.database,
      queue: payload.queue,
    });
  }),
);
