import { Types } from 'mongoose';
import {
  PLAN_LIMITS,
  checkConfigSchema,
  type ApiCheckConfig,
  type CheckSummary,
  type CheckType,
  type HttpCheckConfig,
} from '@breakglass/shared';
import { Check, type CheckDoc } from '../models/check';
import { Project } from '../models/project';
import { CheckRun } from '../models/checkRun';
import { badRequest, conflict, notFound } from '../lib/errors';
import { createSecret, deleteSecretsForCheck } from './secrets.service';
import { assertUrlStructure, resolveAndValidate, UnsafeTargetError } from '../monitoring/ssrf';
import type { createCheckSchema } from '@breakglass/shared';
import type { z } from 'zod';

type CreateCheckInput = z.infer<typeof createCheckSchema>;

/**
 * Moves inline secrets out of a check configuration and into encrypted
 * storage, leaving only an opaque reference behind.
 */
/**
 * A check target is validated at write time, not only at run time: refusing a
 * private or metadata address here gives the user an actionable error instead
 * of a check that fails forever with `blocked_destination`.
 */
async function validateCheckTarget(rawUrl: string): Promise<void> {
  assertUrlStructure(rawUrl);
  try {
    await resolveAndValidate(rawUrl);
  } catch (error) {
    if (error instanceof UnsafeTargetError) throw badRequest(error.reason);
    throw error;
  }
}

export async function prepareConfigForWrite(params: {
  workspaceId: string;
  projectId: string;
  checkId?: string | null;
  type: CheckType;
  rawConfig: unknown;
}): Promise<{ config: Record<string, unknown>; createdSecretIds: string[] }> {
  const createdSecretIds: string[] = [];
  const parsed = checkConfigSchema.parse({ type: params.type, config: params.rawConfig });
  const config = JSON.parse(JSON.stringify(parsed.config)) as Record<string, unknown>;

  if (params.type === 'api') {
    const apiConfig = config as unknown as ApiCheckConfig;
    await validateCheckTarget(apiConfig.url);
    const headers: ApiCheckConfig['headers'] = [];
    for (const header of apiConfig.headers ?? []) {
      if (header.value && (header.sensitive || !header.secretRef)) {
        const secretId = await createSecret({
          workspaceId: params.workspaceId,
          projectId: params.projectId,
          checkId: params.checkId ?? null,
          purpose: 'api_header',
          label: `Header ${header.name}`,
          value: header.value,
        });
        createdSecretIds.push(secretId);
        headers.push({ name: header.name, sensitive: true, secretRef: secretId });
      } else {
        headers.push({
          name: header.name,
          sensitive: Boolean(header.sensitive),
          ...(header.secretRef ? { secretRef: header.secretRef } : {}),
        });
      }
    }
    apiConfig.headers = headers;

    if (apiConfig.method === 'GET' || apiConfig.method === 'HEAD') {
      apiConfig.bodyType = 'none';
      apiConfig.body = undefined;
    }
    return { config: apiConfig as unknown as Record<string, unknown>, createdSecretIds };
  }

  if (params.type === 'http') {
    const httpConfig = config as unknown as HttpCheckConfig;
    await validateCheckTarget(httpConfig.url);
    return { config: httpConfig as unknown as Record<string, unknown>, createdSecretIds };
  }

  await validateCheckTarget(String((config as { startUrl?: string }).startUrl ?? ''));
  return { config, createdSecretIds };
}

/** Removes anything that must never leave the server. */
export function sanitizeConfigForOutput(type: CheckType, config: Record<string, unknown>) {
  const clone = JSON.parse(JSON.stringify(config ?? {})) as Record<string, unknown>;
  if (type === 'api') {
    const headers = (clone.headers ?? []) as { name: string; value?: string; sensitive?: boolean; secretRef?: string }[];
    clone.headers = headers.map((header) => ({
      name: header.name,
      sensitive: Boolean(header.sensitive || header.secretRef),
      // The stored value is never present, but strip defensively.
      ...(header.secretRef ? { secretRef: header.secretRef } : {}),
    }));
  }
  delete clone.password;
  delete clone.token;
  return clone;
}

export function toCheckSummary(check: CheckDoc): CheckSummary {
  return {
    id: String(check._id),
    workspaceId: String(check.workspaceId),
    projectId: String(check.projectId),
    name: check.name,
    type: check.type,
    enabled: check.enabled,
    runtimeStatus: check.runtimeStatus,
    intervalSeconds: check.intervalSeconds,
    timeoutMs: check.timeoutMs,
    failureThreshold: check.failureThreshold,
    recoveryThreshold: check.recoveryThreshold,
    severity: check.severity,
    consecutiveFailures: check.consecutiveFailures,
    consecutiveSuccesses: check.consecutiveSuccesses,
    configVersion: check.configVersion,
    lastRunAt: check.lastRunAt ? check.lastRunAt.toISOString() : null,
    nextRunAt: check.nextRunAt ? check.nextRunAt.toISOString() : null,
    lastResult: check.lastResult
      ? {
          success: check.lastResult.success,
          at: check.lastResult.at.toISOString(),
          durationMs: check.lastResult.durationMs,
          failureCategory: check.lastResult.failureCategory,
          httpStatus: check.lastResult.httpStatus,
          errorSummary: check.lastResult.errorSummary,
        }
      : null,
    config: sanitizeConfigForOutput(check.type, check.config),
    createdAt: check.createdAt.toISOString(),
    updatedAt: check.updatedAt.toISOString(),
  };
}

export async function assertCheckAllowance(workspaceId: string, type: CheckType): Promise<void> {
  const [activeCount, browserCount] = await Promise.all([
    Check.countDocuments({ workspaceId, enabled: true }),
    Check.countDocuments({ workspaceId, enabled: true, type: 'browser' }),
  ]);
  if (activeCount >= PLAN_LIMITS.maxActiveChecks) {
    throw conflict(
      `This workspace has reached its limit of ${PLAN_LIMITS.maxActiveChecks} active checks. Pause a check before adding another.`,
    );
  }
  if (type === 'browser' && browserCount >= PLAN_LIMITS.maxBrowserChecks) {
    throw conflict(
      `This workspace has reached its limit of ${PLAN_LIMITS.maxBrowserChecks} active browser journeys. Pause one before adding another.`,
    );
  }
}

export async function createCheck(params: {
  workspaceId: string;
  projectId: string;
  userId: string;
  input: CreateCheckInput;
}): Promise<CheckDoc> {
  const project = await Project.findOne({ _id: params.projectId, workspaceId: params.workspaceId });
  if (!project) throw notFound('Project not found.');

  const existing = await Check.countDocuments({ projectId: params.projectId });
  if (existing >= PLAN_LIMITS.maxChecksPerProject) {
    throw conflict(
      `A project can have at most ${PLAN_LIMITS.maxChecksPerProject} checks. Remove one before adding another.`,
    );
  }

  const type = params.input.type as CheckType;
  if (params.input.enabled) await assertCheckAllowance(params.workspaceId, type);

  const { config, createdSecretIds } = await prepareConfigForWrite({
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    type,
    rawConfig: params.input.config,
  });

  const enabled = params.input.enabled && project.status === 'active';
  const now = Date.now();

  const check = await Check.create({
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    name: params.input.name,
    type,
    config,
    configVersion: 1,
    enabled,
    intervalSeconds: params.input.intervalSeconds,
    timeoutMs: params.input.timeoutMs,
    failureThreshold: params.input.failureThreshold,
    recoveryThreshold: params.input.recoveryThreshold,
    severity: params.input.severity,
    runtimeStatus: enabled ? 'pending' : 'pending',
    createdBy: params.userId,
    nextRunAt: enabled ? new Date(now) : null,
  });

  // Attach the secrets created for this configuration to the persisted check.
  if (createdSecretIds.length) {
    const { Secret } = await import('../models/infra');
    await Secret.updateMany(
      { _id: { $in: createdSecretIds }, workspaceId: params.workspaceId },
      { $set: { checkId: check._id } },
    );
  }

  return check;
}

export async function updateCheck(params: {
  check: CheckDoc;
  workspaceId: string;
  updates: {
    name?: string;
    intervalSeconds?: number;
    timeoutMs?: number;
    failureThreshold?: number;
    recoveryThreshold?: number;
    enabled?: boolean;
    severity?: 'critical' | 'major' | 'minor';
    config?: unknown;
  };
}): Promise<CheckDoc> {
  const { check, updates, workspaceId } = params;
  const set: Record<string, unknown> = {};
  const now = Date.now();

  if (updates.name !== undefined) set.name = updates.name;
  if (updates.timeoutMs !== undefined) set.timeoutMs = updates.timeoutMs;
  if (updates.failureThreshold !== undefined) set.failureThreshold = updates.failureThreshold;
  if (updates.recoveryThreshold !== undefined) set.recoveryThreshold = updates.recoveryThreshold;
  if (updates.severity !== undefined) set.severity = updates.severity;

  if (updates.intervalSeconds !== undefined && updates.intervalSeconds !== check.intervalSeconds) {
    set.intervalSeconds = updates.intervalSeconds;
    // Re-anchor the next run so a shorter interval takes effect immediately.
    if (check.enabled) {
      const dueAt = new Date(Math.min(check.nextRunAt?.getTime() ?? now, now + updates.intervalSeconds * 1000));
      set.nextRunAt = dueAt;
    }
  }

  if (updates.config !== undefined) {
    const prepared = await prepareConfigForWrite({
      workspaceId,
      projectId: String(check.projectId),
      checkId: String(check._id),
      type: check.type,
      rawConfig: updates.config,
    });
    set.config = prepared.config;
    set.configVersion = check.configVersion + 1;
    // A configuration change invalidates the previous verdict.
    set.runtimeStatus = 'pending';
    set.consecutiveFailures = 0;
    set.consecutiveSuccesses = 0;
    if (check.enabled) set.nextRunAt = new Date(now);
  }

  if (updates.enabled !== undefined && updates.enabled !== check.enabled) {
    if (updates.enabled) {
      const project = await Project.findById(check.projectId);
      if (!project || project.status !== 'active') {
        throw conflict('Activate the project before enabling its checks.');
      }
      await assertCheckAllowance(workspaceId, check.type);
      set.enabled = true;
      set.nextRunAt = new Date(now);
      set.pausedReason = null;
      set.consecutiveFailures = 0;
      set.consecutiveSuccesses = 0;
      set.runtimeStatus = 'pending';
    } else {
      set.enabled = false;
      set.nextRunAt = null;
      set.runtimeStatus = 'paused';
      set.pausedReason = 'Paused by a workspace member';
    }
  }

  const updated = await Check.findOneAndUpdate(
    { _id: check._id, workspaceId },
    { $set: set },
    { new: true },
  );
  if (!updated) throw notFound('Check not found.');
  return updated;
}

export async function deleteCheck(workspaceId: string, checkId: string): Promise<void> {
  const check = await Check.findOne({ _id: checkId, workspaceId });
  if (!check) throw notFound('Check not found.');
  await deleteSecretsForCheck(workspaceId, checkId);
  await Check.deleteOne({ _id: check._id });
  await CheckRun.deleteMany({ checkId: check._id });
}

export async function projectCheckStats(projectIds: string[]) {
  if (!projectIds.length) return new Map<string, { total: number; enabled: number; lastCheckAt: Date | null; nextCheckAt: Date | null }>();

  const rows = await Check.aggregate<{
    _id: Types.ObjectId;
    total: number;
    enabled: number;
    lastCheckAt: Date | null;
    nextCheckAt: Date | null;
  }>([
    { $match: { projectId: { $in: projectIds.map((id) => new Types.ObjectId(id)) } } },
    {
      $group: {
        _id: '$projectId',
        total: { $sum: 1 },
        enabled: { $sum: { $cond: ['$enabled', 1, 0] } },
        lastCheckAt: { $max: '$lastRunAt' },
        nextCheckAt: { $min: { $cond: ['$enabled', '$nextRunAt', null] } },
      },
    },
  ]);

  const map = new Map<string, { total: number; enabled: number; lastCheckAt: Date | null; nextCheckAt: Date | null }>();
  for (const row of rows) {
    map.set(String(row._id), {
      total: row.total,
      enabled: row.enabled,
      lastCheckAt: row.lastCheckAt,
      nextCheckAt: row.nextCheckAt,
    });
  }
  return map;
}

export function nextRunFor(check: { intervalSeconds: number }, from = Date.now()): Date {
  return new Date(from + check.intervalSeconds * 1000);
}

export { badRequest };
