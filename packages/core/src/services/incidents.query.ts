import { Types } from 'mongoose';
import type { IncidentDetail, IncidentSummary } from '@breakglass/shared';
import { Incident, IncidentEvent, type IncidentDoc } from '../models/incident';
import { Project } from '../models/project';
import { Check } from '../models/check';
import { CheckRun } from '../models/checkRun';
import { Deployment, NotificationDelivery } from '../models/notification';
import { notFound } from '../lib/errors';
import { toDeliveryDto } from './notification.service';
import { sanitizeConfigForOutput } from './checks.service';

export function toIncidentSummary(
  incident: IncidentDoc,
  project?: { name: string; url: string } | null,
): IncidentSummary {
  const end = incident.resolvedAt ? incident.resolvedAt.getTime() : Date.now();
  return {
    id: String(incident._id),
    workspaceId: String(incident.workspaceId),
    projectId: String(incident.projectId),
    projectName: project?.name ?? 'Deleted project',
    projectUrl: project?.url ?? '',
    checkId: String(incident.checkId),
    checkName: incident.checkName,
    checkType: incident.checkType,
    status: incident.status,
    severity: incident.severity,
    title: incident.title,
    summary: incident.summary,
    firstFailureAt: incident.firstFailureAt.toISOString(),
    lastFailureAt: incident.lastFailureAt.toISOString(),
    resolvedAt: incident.resolvedAt ? incident.resolvedAt.toISOString() : null,
    acknowledgedAt: incident.acknowledgedAt ? incident.acknowledgedAt.toISOString() : null,
    acknowledgedBy: incident.acknowledgedByName,
    failureCount: incident.failureCount,
    durationMs: Math.max(0, end - incident.firstFailureAt.getTime()),
    recoveryVerifiedCount: incident.recoveryVerifiedCount,
    suggestedSteps: incident.suggestedSteps ?? [],
  };
}

export async function listIncidents(params: {
  workspaceId: string;
  status?: 'active' | 'open' | 'acknowledged' | 'recovering' | 'resolved' | 'all';
  projectId?: string;
  limit?: number;
  cursor?: string;
  checkId?: string;
}): Promise<{ items: IncidentSummary[]; nextCursor: string | null }> {
  const filter: Record<string, unknown> = { workspaceId: params.workspaceId };

  if (params.status && params.status !== 'all') {
    if (params.status === 'active') filter.activeKey = 'active';
    else filter.status = params.status;
  }
  if (params.projectId && Types.ObjectId.isValid(params.projectId)) filter.projectId = params.projectId;
  if (params.checkId && Types.ObjectId.isValid(params.checkId)) filter.checkId = params.checkId;
  if (params.cursor && Types.ObjectId.isValid(params.cursor)) {
    filter._id = { $lt: new Types.ObjectId(params.cursor) };
  }

  const limit = Math.min(params.limit ?? 20, 100);
  const incidents = await Incident.find(filter).sort({ _id: -1 }).limit(limit + 1);
  const hasMore = incidents.length > limit;
  const page = hasMore ? incidents.slice(0, limit) : incidents;

  const projectIds = [...new Set(page.map((incident) => String(incident.projectId)))];
  const projects = await Project.find({ _id: { $in: projectIds } }).select('name url').lean();
  const projectMap = new Map(projects.map((project) => [String(project._id), project]));

  return {
    items: page.map((incident) => toIncidentSummary(incident, projectMap.get(String(incident.projectId)))),
    nextCursor: hasMore ? String(page[page.length - 1]._id) : null,
  };
}

export async function getIncidentDetail(workspaceId: string, incidentId: string): Promise<IncidentDetail> {
  if (!Types.ObjectId.isValid(incidentId)) throw notFound('Incident not found.');
  const incident = await Incident.findOne({ _id: incidentId, workspaceId });
  if (!incident) throw notFound('Incident not found.');

  const [project, check, events, runs, deliveries, deployments] = await Promise.all([
    Project.findById(incident.projectId).lean(),
    Check.findById(incident.checkId).lean(),
    IncidentEvent.find({ incidentId: incident._id }).sort({ createdAt: 1 }).limit(200),
    CheckRun.find({ checkId: incident.checkId })
      .sort({ startedAt: -1 })
      .limit(30)
      .lean(),
    NotificationDelivery.find({ incidentId: incident._id }).sort({ createdAt: -1 }).limit(30),
    Deployment.find({
      projectId: incident.projectId,
      deployedAt: {
        $gte: new Date(incident.firstFailureAt.getTime() - 24 * 3600_000),
        $lte: new Date((incident.resolvedAt ?? new Date()).getTime() + 3600_000),
      },
    })
      .sort({ deployedAt: -1 })
      .limit(10),
  ]);

  const summary = toIncidentSummary(incident, project);

  return {
    ...summary,
    events: events.map((event) => ({
      id: String(event._id),
      type: event.type,
      message: event.message,
      actor: event.actor,
      source: event.source,
      createdAt: event.createdAt.toISOString(),
      details: event.details ?? null,
    })),
    recentRuns: runs.map((run) => ({
      id: String(run._id),
      runId: run.runId,
      checkId: String(run.checkId),
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
    notifications: deliveries.map(toDeliveryDto),
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
    checkConfig: check ? sanitizeConfigForOutput(check.type, check.config) : incident.checkConfigSnapshot,
    responseTimeSeries: runs
      .slice()
      .reverse()
      .map((run) => ({ at: new Date(run.startedAt).toISOString(), durationMs: run.durationMs, success: run.success })),
  };
}
