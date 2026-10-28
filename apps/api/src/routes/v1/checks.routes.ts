import { Router } from 'express';
import { Types } from 'mongoose';
import {
  Check,
  CheckRun,
  requireCheck,
  requireWorkspace,
  runCheckNow,
  toCheckSummary,
  updateCheck,
  conflict,
  notFound,
} from '@breakglass/core';
import {
  updateCheckSchema,
} from '@breakglass/shared';

import { asyncHandler, ok } from '../../lib/http';
import { requireAuth } from '../../middleware/auth';
import { heavyLimiter } from '../../middleware/rateLimits';

export const checksRouter = Router({ mergeParams: true });
checksRouter.use(requireAuth);

/** Workspace-scoped: the workspace id in the path is always verified. */
checksRouter.patch(
  '/:checkId',
  asyncHandler(async (req, res) => {
    const { workspace } = await requireWorkspace(String(req.auth!.user._id), req.params.workspaceId);
    const check = await requireCheck(String(workspace._id), req.params.checkId);
    const input = updateCheckSchema.parse(req.body);
    const updated = await updateCheck({
      check,
      workspaceId: String(workspace._id),
      updates: input as never,
    });
    ok(res, { check: toCheckSummary(updated) });
  }),
);

checksRouter.delete(
  '/:checkId',
  asyncHandler(async (req, res) => {
    const { workspace } = await requireWorkspace(String(req.auth!.user._id), req.params.workspaceId);
    const check = await requireCheck(String(workspace._id), req.params.checkId);
    const { deleteCheck } = await import('@breakglass/core');
    await deleteCheck(String(workspace._id), String(check._id));
    ok(res, { ok: true });
  }),
);

/**
 * Runs a saved check immediately. The run is stored with `triggeredBy:
 * manual` and deliberately does not change incident state — clicking "Run now"
 * during an investigation must not be able to fabricate or clear an incident.
 */
checksRouter.post(
  '/:checkId/run',
  heavyLimiter,
  asyncHandler(async (req, res) => {
    const { workspace } = await requireWorkspace(String(req.auth!.user._id), req.params.workspaceId);
    const check = await requireCheck(String(workspace._id), req.params.checkId);
    if (!check.enabled) {
      throw conflict('Enable this check before running it manually, or use the configuration test.');
    }
    const { result, runId } = await runCheckNow({ check, triggeredBy: 'manual' });
    ok(res, {
      runId,
      success: result?.success ?? false,
      failureCategory: result?.failureCategory ?? null,
      failureMessage: result?.failureMessage ?? null,
      durationMs: result?.durationMs ?? 0,
      httpStatus: result?.httpStatus ?? null,
      persisted: true,
    });
  }),
);

checksRouter.get(
  '/:checkId/runs',
  asyncHandler(async (req, res) => {
    const { workspace } = await requireWorkspace(String(req.auth!.user._id), req.params.workspaceId);
    const check = await requireCheck(String(workspace._id), req.params.checkId);

    const limit = Math.min(Number(req.query.limit) || 25, 100);
    const cursor =
      typeof req.query.cursor === 'string' && Types.ObjectId.isValid(req.query.cursor)
        ? new Types.ObjectId(req.query.cursor)
        : null;
    const filter: Record<string, unknown> = { checkId: check._id };
    if (cursor) filter._id = { $lt: cursor };

    const runs = await CheckRun.find(filter).sort({ _id: -1 }).limit(limit + 1).lean();
    const hasMore = runs.length > limit;
    const page = hasMore ? runs.slice(0, limit) : runs;

    ok(res, {
      runs: page.map((run) => ({
        id: String(run._id),
        runId: run.runId,
        checkId: String(run.checkId),
        projectId: String(run.projectId),
        checkName: run.checkName,
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
      nextCursor: hasMore ? String(page[page.length - 1]._id) : null,
    });
  }),
);

checksRouter.get(
  '/:checkId',
  asyncHandler(async (req, res) => {
    const { workspace } = await requireWorkspace(String(req.auth!.user._id), req.params.workspaceId);
    const check = await Check.findOne({ _id: req.params.checkId, workspaceId: workspace._id });
    if (!check) throw notFound('Check not found.');
    ok(res, { check: toCheckSummary(check) });
  }),
);
