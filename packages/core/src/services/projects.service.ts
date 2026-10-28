import { Types } from 'mongoose';
import { PLAN_LIMITS, type ProjectSummary } from '@breakglass/shared';
import { Project, type ProjectDoc } from '../models/project';
import { Check } from '../models/check';
import { Incident } from '../models/incident';
import { CheckRun } from '../models/checkRun';
import { Deployment } from '../models/notification';
import { badRequest, conflict, notFound } from '../lib/errors';
import { resolveAndValidate, UnsafeTargetError } from '../monitoring/ssrf';
import { toCheckSummary } from './checks.service';
import { toIncidentSummary } from './incidents.query';

export function canonicalize(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.hash = '';
  const path = url.pathname.replace(/\/+$/, '') || '/';
  return `${url.protocol}//${url.host.toLowerCase()}${path}${url.search}`;
}

/**
 * Validating at creation time gives the user immediate, actionable feedback
 * ("this resolves to a private address") instead of a mystery failure later.
 */
export async function validateProjectUrl(url: string): Promise<void> {
  try {
    await resolveAndValidate(url);
  } catch (error) {
    if (error instanceof UnsafeTargetError) throw badRequest(error.reason);
    throw error;
  }
}

export async function createProject(params: {
  workspaceId: string;
  userId: string;
  name: string;
  url: string;
  clientName?: string;
  notes?: string;
}): Promise<ProjectDoc> {
  const count = await Project.countDocuments({ workspaceId: params.workspaceId });
  if (count >= PLAN_LIMITS.maxProjects) {
    throw conflict(
      `This workspace has reached its limit of ${PLAN_LIMITS.maxProjects} projects. Remove a project before adding another.`,
    );
  }

  await validateProjectUrl(params.url);
  const canonicalUrl = canonicalize(params.url);

  const duplicate = await Project.findOne({ workspaceId: params.workspaceId, canonicalUrl });
  if (duplicate) throw conflict(`"${duplicate.name}" already monitors this exact URL.`);

  return Project.create({
    workspaceId: params.workspaceId,
    name: params.name,
    url: params.url,
    canonicalUrl,
    clientName: params.clientName ?? null,
    notes: params.notes ?? null,
    status: 'active',
    createdBy: params.userId,
  });
}

export interface ProjectHealthInput {
  projectStatus: 'active' | 'paused';
  enabledChecks: number;
  openIncidents: number;
  failingChecks: number;
  suspectedChecks: number;
  misconfiguredChecks: number;
}

export function computeProjectHealth(input: ProjectHealthInput): ProjectSummary['health'] {
  if (input.projectStatus === 'paused') return 'paused';
  if (input.openIncidents > 0) return 'down';
  if (input.failingChecks > 0) return 'degraded';
  if (input.suspectedChecks > 0 || input.misconfiguredChecks > 0) return 'degraded';
  if (input.enabledChecks === 0) return 'unknown';
  return 'healthy';
}

export async function listProjects(workspaceId: string): Promise<ProjectSummary[]> {
  const projects = await Project.find({ workspaceId }).sort({ createdAt: -1 }).limit(200);
  if (!projects.length) return [];
  const projectIds = projects.map((project) => project._id);

  const [checkAgg, incidentAgg] = await Promise.all([
    Check.aggregate<{
      _id: Types.ObjectId;
      total: number;
      enabled: number;
      failing: number;
      suspected: number;
      misconfigured: number;
      lastCheckAt: Date | null;
      nextCheckAt: Date | null;
    }>([
      { $match: { projectId: { $in: projectIds } } },
      {
        $group: {
          _id: '$projectId',
          total: { $sum: 1 },
          enabled: { $sum: { $cond: ['$enabled', 1, 0] } },
          failing: { $sum: { $cond: [{ $eq: ['$runtimeStatus', 'failing'] }, 1, 0] } },
          suspected: { $sum: { $cond: [{ $eq: ['$runtimeStatus', 'suspected'] }, 1, 0] } },
          misconfigured: {
            $sum: {
              $cond: [{ $in: ['$runtimeStatus', ['misconfigured', 'auth_failure', 'worker_error']] }, 1, 0],
            },
          },
          lastCheckAt: { $max: '$lastRunAt' },
          nextCheckAt: { $min: { $cond: ['$enabled', '$nextRunAt', null] } },
        },
      },
    ]),
    Incident.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { projectId: { $in: projectIds }, activeKey: 'active' } },
      { $group: { _id: '$projectId', count: { $sum: 1 } } },
    ]),
  ]);

  const checkMap = new Map(checkAgg.map((row) => [String(row._id), row]));
  const incidentMap = new Map(incidentAgg.map((row) => [String(row._id), row.count]));

  return projects.map((project) => {
    const stats = checkMap.get(String(project._id));
    const openIncidents = incidentMap.get(String(project._id)) ?? 0;
    const enabledChecks = stats?.enabled ?? 0;

    return {
      id: String(project._id),
      workspaceId: String(project.workspaceId),
      name: project.name,
      url: project.url,
      clientName: project.clientName,
      status: project.status,
      createdAt: project.createdAt.toISOString(),
      checkCount: stats?.total ?? 0,
      enabledCheckCount: enabledChecks,
      activeIncidentCount: openIncidents,
      health: computeProjectHealth({
        projectStatus: project.status,
        enabledChecks,
        openIncidents,
        failingChecks: stats?.failing ?? 0,
        suspectedChecks: stats?.suspected ?? 0,
        misconfiguredChecks: stats?.misconfigured ?? 0,
      }),
      lastCheckAt: stats?.lastCheckAt ? new Date(stats.lastCheckAt).toISOString() : null,
      nextCheckAt: stats?.nextCheckAt ? new Date(stats.nextCheckAt).toISOString() : null,
    };
  });
}

export async function getProjectDetail(workspaceId: string, projectId: string) {
  if (!Types.ObjectId.isValid(projectId)) throw notFound('Project not found.');
  const project = await Project.findOne({ _id: projectId, workspaceId });
  if (!project) throw notFound('Project not found.');

  const [checks, incidents, deployments, recentRuns] = await Promise.all([
    Check.find({ projectId }).sort({ createdAt: 1 }),
    Incident.find({ projectId }).sort({ firstFailureAt: -1 }).limit(20),
    Deployment.find({ projectId }).sort({ deployedAt: -1 }).limit(10),
    CheckRun.find({ projectId }).sort({ startedAt: -1 }).limit(40).lean(),
  ]);

  const responseTimeSeries = recentRuns
    .filter((run) => run.success && typeof run.durationMs === 'number')
    .slice(0, 60)
    .reverse()
    .map((run) => ({
      at: new Date(run.startedAt).toISOString(),
      durationMs: run.durationMs,
      checkId: String(run.checkId),
      checkName: run.checkName,
    }));

  const openIncidentCount = incidents.filter((incident) => incident.activeKey === 'active').length;

  return {
    project: {
      id: String(project._id),
      workspaceId: String(project.workspaceId),
      name: project.name,
      url: project.url,
      clientName: project.clientName,
      notes: project.notes,
      status: project.status,
      createdAt: project.createdAt.toISOString(),
      githubRepository: project.githubRepository,
      lastPageScan: project.lastPageScan ?? null,
      health: computeProjectHealth({
        projectStatus: project.status,
        enabledChecks: checks.filter((check) => check.enabled).length,
        openIncidents: openIncidentCount,
        failingChecks: checks.filter((check) => check.runtimeStatus === 'failing').length,
        suspectedChecks: checks.filter((check) => check.runtimeStatus === 'suspected').length,
        misconfiguredChecks: checks.filter((check) =>
          ['misconfigured', 'auth_failure', 'worker_error'].includes(check.runtimeStatus),
        ).length,
      }),
    },
    checks: checks.map(toCheckSummary),
    incidents: incidents.map((incident) => toIncidentSummary(incident)),
    deployments: deployments.map((deployment) => ({
      id: String(deployment._id),
      source: deployment.source,
      environment: deployment.environment,
      commitSha: deployment.commitSha,
      commitMessage: deployment.commitMessage,
      deployedAt: deployment.deployedAt.toISOString(),
      url: deployment.url,
      actor: deployment.actor,
      verified: deployment.verified,
    })),
    recentRuns: recentRuns.map((run) => ({
      id: String(run._id),
      runId: run.runId,
      checkId: String(run.checkId),
      checkName: run.checkName,
      projectId: String(run.projectId),
      startedAt: new Date(run.startedAt).toISOString(),
      finishedAt: run.finishedAt ? new Date(run.finishedAt).toISOString() : null,
      durationMs: run.durationMs,
      success: run.success,
      failureCategory: run.failureCategory,
      httpStatus: run.httpStatus,
      errorSummary: run.errorSummary,
      attempt: run.attempt,
      triggeredBy: run.triggeredBy,
      incidentId: run.incidentId ? String(run.incidentId) : null,
      artifacts: run.artifacts.map((artifact) => ({
        id: artifact.artifactId,
        kind: artifact.kind,
        bytes: artifact.bytes,
        createdAt: new Date(run.startedAt).toISOString(),
      })),
    })),
    responseTimeSeries,
  };
}

export async function updateProject(params: {
  workspaceId: string;
  projectId: string;
  updates: {
    name?: string;
    url?: string;
    clientName?: string;
    notes?: string;
    status?: 'active' | 'paused';
  };
}) {
  const project = await Project.findOne({ _id: params.projectId, workspaceId: params.workspaceId });
  if (!project) throw notFound('Project not found.');

  const set: Record<string, unknown> = {};
  if (params.updates.name !== undefined) set.name = params.updates.name;
  if (params.updates.clientName !== undefined) set.clientName = params.updates.clientName;
  if (params.updates.notes !== undefined) set.notes = params.updates.notes;

  if (params.updates.url !== undefined && params.updates.url !== project.url) {
    await validateProjectUrl(params.updates.url);
    set.url = params.updates.url;
    set.canonicalUrl = canonicalize(params.updates.url);
  }

  if (params.updates.status !== undefined && params.updates.status !== project.status) {
    set.status = params.updates.status;
    if (params.updates.status === 'paused') {
      // Pausing a project pauses its scheduling but never deletes history.
      await Check.updateMany({ projectId: project._id }, { $set: { nextRunAt: null } });
      await Check.updateMany({ projectId: project._id, enabled: true }, { $set: { runtimeStatus: 'paused' } });
    } else {
      const now = new Date();
      const checks = await Check.find({ projectId: project._id, enabled: true });
      for (const check of checks) {
        await Check.updateOne(
          { _id: check._id },
          { $set: { nextRunAt: now, runtimeStatus: 'pending' } },
        );
      }
    }
  }

  const updated = await Project.findOneAndUpdate(
    { _id: project._id, workspaceId: params.workspaceId },
    { $set: set },
    { new: true },
  );
  return updated ?? project;
}

export async function deleteProject(workspaceId: string, projectId: string): Promise<void> {
  const project = await Project.findOne({ _id: projectId, workspaceId });
  if (!project) throw notFound('Project not found.');
  const checks = await Check.find({ projectId: project._id }).select('_id');
  const { deleteSecretsForCheck } = await import('./secrets.service');
  for (const check of checks) {
    await deleteSecretsForCheck(workspaceId, String(check._id));
  }
  await Check.deleteMany({ projectId: project._id });
  await Project.deleteOne({ _id: project._id });
  // Incident history is retained; it is linked to the project by id.
}

export { notFound };
