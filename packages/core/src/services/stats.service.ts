import type { DashboardStats, CheckRunSummary } from '@breakglass/shared';
import { Check } from '../models/check';
import { CheckRun } from '../models/checkRun';
import { Incident } from '../models/incident';
import { Project } from '../models/project';
import { emailStatusForUi } from './notification.service';
import { toIncidentSummary } from './incidents.query';
import type { IncidentDoc } from '../models/incident';

/** Every number here is derived from persisted records — nothing is invented. */
export async function getDashboardStats(workspaceId: string): Promise<DashboardStats> {
  const since24h = new Date(Date.now() - 24 * 3600_000);
  const soon = new Date(Date.now() + 10 * 60_000);

  const [
    projectCount,
    enabledCheckCount,
    healthyCheckCount,
    failingCheckCount,
    pausedCheckCount,
    misconfiguredCheckCount,
    openIncidentCount,
    activeIncidentCount,
    checksDueSoon,
    runs24h,
    failures24h,
    recentIncidentDocs,
    recentRunDocs,
  ] = await Promise.all([
    Project.countDocuments({ workspaceId }),
    Check.countDocuments({ workspaceId, enabled: true }),
    Check.countDocuments({ workspaceId, enabled: true, runtimeStatus: 'healthy' }),
    Check.countDocuments({ workspaceId, runtimeStatus: { $in: ['failing', 'suspected'] } }),
    Check.countDocuments({ workspaceId, $or: [{ enabled: false }, { runtimeStatus: 'paused' }] }),
    Check.countDocuments({ workspaceId, runtimeStatus: { $in: ['misconfigured', 'auth_failure', 'worker_error'] } }),
    Incident.countDocuments({ workspaceId, status: 'open' }),
    Incident.countDocuments({ workspaceId, activeKey: 'active' }),
    Check.countDocuments({ workspaceId, enabled: true, nextRunAt: { $lte: soon } }),
    CheckRun.countDocuments({ workspaceId, startedAt: { $gte: since24h } }),
    CheckRun.countDocuments({ workspaceId, startedAt: { $gte: since24h }, success: false }),
    Incident.find({ workspaceId }).sort({ lastFailureAt: -1 }).limit(6).lean(),
    CheckRun.find({ workspaceId }).sort({ startedAt: -1 }).limit(12).lean(),
  ]);

  // Project names for the recent-incident feed, fetched in one query.
  const incidentProjectIds = [...new Set(recentIncidentDocs.map((incident) => String(incident.projectId)))];
  const incidentProjects = incidentProjectIds.length
    ? await Project.find({ _id: { $in: incidentProjectIds } }).select('name url').lean()
    : [];
  const incidentProjectMap = new Map(incidentProjects.map((project) => [String(project._id), project]));

  const recentIncidents = recentIncidentDocs.map((incident) => {
    const project = incidentProjectMap.get(String(incident.projectId));
    return toIncidentSummary(incident as unknown as IncidentDoc, project ?? null);
  });

  const email = emailStatusForUi();

  const recentRuns = recentRunDocs.map<CheckRunSummary & { checkName: string; projectName: string }>((run) => ({
    id: String(run._id),
    runId: run.runId,
    checkId: String(run.checkId),
    projectId: String(run.projectId),
    checkName: run.checkName,
    projectName: '',
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
  }));

  // Fill in project names for the activity feed in one query.
  const projectIds = [...new Set(recentRuns.map((run) => run.projectId))];
  if (projectIds.length) {
    const projects = await Project.find({ _id: { $in: projectIds } })
      .select('name')
      .lean();
    const nameById = new Map(projects.map((project) => [String(project._id), project.name]));
    for (const run of recentRuns) {
      run.projectName = nameById.get(run.projectId) ?? 'Project';
    }
  }

  return {
    projectCount,
    enabledCheckCount,
    healthyCheckCount,
    failingCheckCount,
    pausedCheckCount,
    misconfiguredCheckCount,
    activeIncidentCount,
    openIncidentCount,
    checksDueSoon,
    last24h: { runs: runs24h, failures: failures24h },
    recentIncidents,
    recentRuns,
    workspaceNotice: email.configured ? null : email.message,
    emailConfigured: email.configured,
  };
}
