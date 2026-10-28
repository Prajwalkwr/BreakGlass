import { Types } from 'mongoose';
import type { FailureCategory } from '@breakglass/shared';
import { Check, type CheckDoc } from '../models/check';
import { CheckRun } from '../models/checkRun';
import { Project } from '../models/project';
import { logger } from '../lib/logger';
import { executeCheck } from '../monitoring/executor';
import { saveArtifacts } from './artifacts.service';
import { applyRunToIncident, isNonOutageFailure, syncCheckRuntimeStatus } from './incident.service';
import { queueIncidentNotifications } from './notification.service';
import type { ExecutionResult } from '../monitoring/types';

export interface CheckRunJobPayload {
  checkId: string;
  triggeredBy: 'schedule' | 'manual' | 'test' | 'recovery';
  jobId?: string;
  attempt?: number;
}

const RUN_LOCK_MS = 90_000;

function nextRunAt(check: { intervalSeconds: number }, from = Date.now()): Date {
  return new Date(from + check.intervalSeconds * 1000);
}

/**
 * Claims a short-lived execution lock so the same check never runs twice at
 * once (e.g. a slow browser journey overlapping its next interval).
 */
async function acquireRunLock(checkId: Types.ObjectId): Promise<boolean> {
  const now = new Date();
  const result = await Check.updateOne(
    {
      _id: checkId,
      $or: [{ activeRunUntil: null }, { activeRunUntil: { $lt: now } }],
    },
    { $set: { activeRunUntil: new Date(now.getTime() + RUN_LOCK_MS) } },
  );
  return result.modifiedCount > 0;
}

async function releaseRunLock(checkId: Types.ObjectId): Promise<void> {
  await Check.updateOne({ _id: checkId }, { $set: { activeRunUntil: null } });
}

/**
 * Executes one check run and applies the result to the check, run history and
 * incident state machine. This is the single place where monitoring results
 * become durable application state.
 */
export async function processCheckRun(params: CheckRunJobPayload): Promise<{
  ran: boolean;
  reason?: string;
  runId?: string;
  success?: boolean;
}> {
  const log = logger();
  const check = await Check.findById(params.checkId);
  if (!check) return { ran: false, reason: 'check_missing' };

  const triggeredBy = params.triggeredBy;

  if (!check.enabled && triggeredBy === 'schedule') {
    return { ran: false, reason: 'check_disabled' };
  }

  const project = await Project.findById(check.projectId);
  if (!project) return { ran: false, reason: 'project_missing' };

  if (project.status !== 'active' && triggeredBy === 'schedule') {
    await Check.updateOne({ _id: check._id }, { $set: { nextRunAt: nextRunAt(check) } });
    return { ran: false, reason: 'project_paused' };
  }

  if (!(await acquireRunLock(check._id))) {
    log.warn({ checkId: String(check._id) }, 'Skipping check run: a previous run is still in flight');
    await Check.updateOne({ _id: check._id }, { $set: { nextRunAt: nextRunAt(check) } });
    return { ran: false, reason: 'run_in_progress' };
  }

  const startedAt = new Date();
  const runId = `${params.jobId ?? 'manual'}:${params.attempt ?? 1}:${check._id.toString().slice(-6)}`;
  let result: ExecutionResult;
  let artifacts: { artifactId: string; kind: 'screenshot' | 'trace' | 'html'; bytes: number }[] = [];

  let evidenceError: string | null = null;

  try {
    result = await executeCheck({
      checkId: String(check._id),
      workspaceId: String(check.workspaceId),
      projectId: String(check.projectId),
      checkName: check.name,
      type: check.type,
      config: check.config,
      timeoutMs: check.timeoutMs,
      logger: { info: (o, m) => log.info(o, m), warn: (o, m) => log.warn(o, m) },
    });
  } catch (error) {
    // Unexpected worker failure: record it honestly and let the queue retry.
    log.error({ err: (error as Error).message, checkId: String(check._id) }, 'Check execution threw');
    result = {
      success: false,
      failureCategory: 'internal_error',
      failureMessage: `The monitoring worker crashed while running this check: ${(error as Error).message}`,
      errorSummary: 'Monitoring worker error',
      httpStatus: null,
      durationMs: Date.now() - startedAt.getTime(),
      evidence: {},
      artifacts: [],
    };
    artifacts = [];
  }

  // Evidence capture is deliberately outside the execution try/catch: an
  // object-storage outage must never be reported as "the website failed".
  if (result.artifacts.length) {
    try {
      artifacts = await saveArtifacts({
        workspaceId: check.workspaceId,
        projectId: check.projectId,
        checkId: check._id,
        runId,
        artifacts: result.artifacts,
      });
    } catch (error) {
      log.error(
        { err: (error as Error).message, checkId: String(check._id), runId },
        'Evidence upload failed; recording the run without artifacts',
      );
      evidenceError = 'Evidence could not be stored (object storage unavailable).';
      artifacts = [];
    }
  }

  const finishedAt = new Date();
  const isTest = triggeredBy === 'test';

  const run = await CheckRun.findOneAndUpdate(
    { runId },
    {
      $setOnInsert: {
        runId,
        workspaceId: check.workspaceId,
        projectId: check.projectId,
        checkId: check._id,
        checkType: check.type,
        checkName: check.name,
        configVersion: check.configVersion,
        configSnapshot: sanitizeSnapshot(check.config),
        startedAt,
        finishedAt,
        durationMs: result.durationMs,
        success: result.success,
        failureCategory: result.failureCategory,
        failureMessage: result.failureMessage,
        errorSummary: result.errorSummary,
        attempt: params.attempt ?? 1,
        triggeredBy,
        jobId: params.jobId ?? null,
        evidence: evidenceError ? { ...result.evidence, storageError: evidenceError } : result.evidence,
        artifacts: artifacts.map((artifact) => ({
          artifactId: artifact.artifactId,
          kind: artifact.kind,
          bytes: artifact.bytes,
        })),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  try {
    if (!isTest) {
      await applyResultToCheck({ check, result, runId, startedAt, triggeredBy });
    }
  } finally {
    await Check.updateOne({ _id: check._id }, { $set: { activeRunUntil: null } });
    if (triggeredBy === 'schedule' && check.enabled) {
      const latest = await Check.findById(check._id);
      if (latest && latest.enabled) {
        await Check.updateOne(
          { _id: check._id },
          { $set: { nextRunAt: nextRunAt({ intervalSeconds: latest.intervalSeconds }) } },
        );
      }
    }
  }

  return { ran: true, runId, success: result.success, ...(run ? {} : {}) };
}

async function applyResultToCheck(params: {
  check: CheckDoc;
  result: ExecutionResult;
  runId: string;
  startedAt: Date;
  triggeredBy: string;
}) {
  const { check, result, runId, startedAt } = params;
  const category: FailureCategory | null = result.failureCategory;
  const nonOutage = isNonOutageFailure(category);
  const countsAsFailure = !result.success && !nonOutage;
  const countsAsSuccess = result.success;

  let consecutiveFailures = check.consecutiveFailures;
  let consecutiveSuccesses = check.consecutiveSuccesses;
  if (countsAsFailure) {
    consecutiveFailures += 1;
    consecutiveSuccesses = 0;
  } else if (countsAsSuccess) {
    consecutiveSuccesses += 1;
    consecutiveFailures = 0;
  }

  await Check.updateOne(
    { _id: check._id },
    {
      $set: {
        lastRunAt: startedAt,
        lastRunId: runId,
        consecutiveFailures,
        consecutiveSuccesses,
        lastResult: {
          success: result.success,
          at: startedAt,
          durationMs: result.durationMs,
          failureCategory: category,
          httpStatus: result.httpStatus,
          errorSummary: result.errorSummary,
          runId,
        },
      },
    },
  );

  const updatedCheck = (await Check.findById(check._id)) ?? check;
  const { transition, incident } = await applyRunToIncident({
    check: { ...updatedCheck.toObject(), consecutiveFailures, consecutiveSuccesses } as CheckDoc,
    result,
    runId,
    startedAt,
    failureCategory: category,
    errorSummary: result.errorSummary,
  });

  if (incident) {
    await CheckRun.updateOne(
      { runId },
      {
        $set: {
          incidentId: incident._id,
          countedTowardIncident: countsAsFailure || countsAsSuccess,
        },
      },
    );
  }

  await syncCheckRuntimeStatus(await Check.findById(check._id) as CheckDoc);

  if (transition === 'opened' && incident) {
    await queueIncidentNotifications({ incident, eventType: 'incident_opened' });
  } else if (transition === 'resolved' && incident) {
    await queueIncidentNotifications({ incident, eventType: 'incident_resolved' });
  } else if (transition === 'failure_recorded' && incident) {
    // Throttled: at most one "still failing" notification per hour per incident.
    await queueIncidentNotifications({ incident, eventType: 'incident_repeat' });
  }
}

/** Removes credentials from the stored configuration snapshot. */
function sanitizeSnapshot(config: Record<string, unknown>): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(config ?? {})) as Record<string, unknown>;
  if (Array.isArray(clone.headers)) {
    clone.headers = (clone.headers as { name: string; secretRef?: string }[]).map((header) => ({
      name: header.name,
      value: header.secretRef ? '[encrypted]' : undefined,
    }));
  }
  return clone;
}

/** Runs a check immediately for the configuration test / manual run buttons. */
export async function runCheckNow(params: {
  check: CheckDoc;
  triggeredBy: 'test' | 'manual';
  jobId?: string;
}): Promise<{ runId: string | null; result: ExecutionResult | null }> {
  const { check } = params;
  const startedAt = new Date();
  const runId = `${params.jobId ?? params.triggeredBy}:${Date.now()}:${String(check._id).slice(-6)}`;

  const result = await executeCheck({
    checkId: String(check._id),
    workspaceId: String(check.workspaceId),
    projectId: String(check.projectId),
    checkName: check.name,
    type: check.type,
    config: check.config,
    timeoutMs: check.timeoutMs,
  });

  const artifacts = await saveArtifacts({
    workspaceId: check.workspaceId,
    projectId: check.projectId,
    checkId: check._id,
    runId,
    artifacts: result.artifacts,
  });

  await CheckRun.create({
    runId,
    workspaceId: check.workspaceId,
    projectId: check.projectId,
    checkId: check._id,
    checkType: check.type,
    checkName: check.name,
    configVersion: check.configVersion,
    configSnapshot: sanitizeSnapshot(check.config),
    startedAt,
    finishedAt: new Date(),
    durationMs: result.durationMs,
    success: result.success,
    failureCategory: result.failureCategory,
    failureMessage: result.failureMessage,
    errorSummary: result.errorSummary,
    attempt: 1,
    triggeredBy: params.triggeredBy,
    evidence: result.evidence,
    artifacts: artifacts.map((artifact) => ({
      artifactId: artifact.artifactId,
      kind: artifact.kind,
      bytes: artifact.bytes,
    })),
  });

  return { runId, result };
}
