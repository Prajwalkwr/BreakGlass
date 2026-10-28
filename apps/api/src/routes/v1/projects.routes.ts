import { Router } from 'express';
import { Types } from 'mongoose';
import {
  CheckRun,
  createCheck,
  createProject,
  createSecret,
  deleteProject,
  deleteSecret,
  executeAdHocCheck,
  getProjectDetail,
  listDeployments,
  listProjects,
  listSecrets,
  requireProject,
  requireWorkspace,
  rotateSecret,
  sanitizeConfigForOutput,
  setGithubIntegration,
  probeProjectWebsite,
  scanAndMonitorProjectPages,
  toCheckSummary,
  updateProject,
  badRequest,
  notFound,
} from '@breakglass/core';
import {
  createProjectSchema,
  updateProjectSchema,
  createCheckSchema,
  rotateSecretSchema,
} from '@breakglass/shared';

import { asyncHandler, ok } from '../../lib/http';
import { requireAuth } from '../../middleware/auth';
import { heavyLimiter } from '../../middleware/rateLimits';
import { z } from 'zod';

export const projectsRouter = Router({ mergeParams: true });
projectsRouter.use(requireAuth);

const secretCreateSchema = z.object({
  purpose: z.enum(['login_username', 'login_password', 'basic_auth', 'api_header']),
  label: z.string().trim().min(1).max(120),
  value: z.string().min(1).max(4000),
});

function requireMembershipParam(req: { auth?: { user: { _id: unknown } }; params: { workspaceId?: string } }) {
  return requireWorkspace(String(req.auth!.user._id), req.params.workspaceId ?? '');
}

/* ------------------------------- Projects ------------------------------- */

projectsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { workspace } = await requireMembershipParam(req);
    ok(res, { projects: await listProjects(String(workspace._id)) });
  }),
);

projectsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { workspace } = await requireMembershipParam(req);
    const input = createProjectSchema.parse(req.body);
    const project = await createProject({
      workspaceId: String(workspace._id),
      userId: String(req.auth!.user._id),
      ...input,
    });
    ok(
      res,
      {
        project: {
          id: String(project._id),
          name: project.name,
          url: project.url,
          status: project.status,
          clientName: project.clientName,
        },
      },
      201,
    );
  }),
);

projectsRouter.get(
  '/:projectId',
  asyncHandler(async (req, res) => {
    const { workspace } = await requireMembershipParam(req);
    ok(res, await getProjectDetail(String(workspace._id), req.params.projectId));
  }),
);

projectsRouter.post(
  '/:projectId/scan',
  heavyLimiter,
  asyncHandler(async (req, res) => {
    const { workspace } = await requireMembershipParam(req);
    const project = await requireProject(String(workspace._id), req.params.projectId);
    const report = await scanAndMonitorProjectPages({
      workspaceId: String(workspace._id),
      projectId: String(project._id),
      userId: String(req.auth!.user._id),
    });
    ok(res, report);
  }),
);

projectsRouter.patch(
  '/:projectId',
  asyncHandler(async (req, res) => {
    const { workspace } = await requireMembershipParam(req);
    const input = updateProjectSchema.parse(req.body);
    const project = await updateProject({
      workspaceId: String(workspace._id),
      projectId: req.params.projectId,
      updates: input,
    });
    ok(res, { ok: true, status: project.status, name: project.name });
  }),
);

projectsRouter.delete(
  '/:projectId',
  asyncHandler(async (req, res) => {
    const { workspace, role } = await requireMembershipParam(req);
    if (role !== 'owner') throw badRequest('Only the workspace owner can delete a project.');
    await deleteProject(String(workspace._id), req.params.projectId);
    ok(res, { ok: true });
  }),
);

/* -------------------------------- Runs --------------------------------- */

projectsRouter.get(
  '/:projectId/runs',
  asyncHandler(async (req, res) => {
    const { workspace } = await requireMembershipParam(req);
    const project = await requireProject(String(workspace._id), req.params.projectId);

    const limit = Math.min(Number(req.query.limit) || 25, 100);
    const cursor = typeof req.query.cursor === 'string' && Types.ObjectId.isValid(req.query.cursor)
      ? new Types.ObjectId(req.query.cursor)
      : null;
    const checkId = typeof req.query.checkId === 'string' && Types.ObjectId.isValid(req.query.checkId)
      ? new Types.ObjectId(req.query.checkId)
      : null;
    const outcome = typeof req.query.outcome === 'string' ? req.query.outcome : 'all';

    const filter: Record<string, unknown> = { projectId: project._id };
    if (cursor) filter._id = { $lt: cursor };
    if (checkId) filter.checkId = checkId;
    if (outcome === 'success') filter.success = true;
    if (outcome === 'failure') filter.success = false;

    const runs = await CheckRun.find(filter).sort({ _id: -1 }).limit(limit + 1).lean();
    const hasMore = runs.length > limit;
    const page = hasMore ? runs.slice(0, limit) : runs;

    ok(res, {
      runs: page.map((run) => ({
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
      nextCursor: hasMore ? String(page[page.length - 1]._id) : null,
    });
  }),
);

projectsRouter.get(
  '/:projectId/deployments',
  asyncHandler(async (req, res) => {
    const { workspace } = await requireMembershipParam(req);
    const project = await requireProject(String(workspace._id), req.params.projectId);
    ok(res, { deployments: await listDeployments(String(workspace._id), String(project._id)) });
  }),
);

/* ------------------------------ GitHub --------------------------------- */

const githubSchema = z.object({
  repository: z.string().trim().max(200).optional(),
  secret: z.string().min(16).max(200).optional(),
});

projectsRouter.put(
  '/:projectId/github',
  asyncHandler(async (req, res) => {
    const { workspace } = await requireMembershipParam(req);
    const project = await requireProject(String(workspace._id), req.params.projectId);
    const input = githubSchema.parse(req.body);
    const result = await setGithubIntegration({
      workspaceId: String(workspace._id),
      projectId: String(project._id),
      repository: input.repository,
      secret: input.secret,
    });
    ok(res, result);
  }),
);

/* ------------------------------ Secrets -------------------------------- */

projectsRouter.get(
  '/:projectId/secrets',
  asyncHandler(async (req, res) => {
    const { workspace } = await requireMembershipParam(req);
    const project = await requireProject(String(workspace._id), req.params.projectId);
    ok(res, { secrets: await listSecrets(String(workspace._id), String(project._id)) });
  }),
);

projectsRouter.post(
  '/:projectId/secrets',
  asyncHandler(async (req, res) => {
    const { workspace } = await requireMembershipParam(req);
    const project = await requireProject(String(workspace._id), req.params.projectId);
    const input = secretCreateSchema.parse(req.body);
    const id = await createSecret({
      workspaceId: String(workspace._id),
      projectId: String(project._id),
      purpose: input.purpose,
      label: input.label,
      value: input.value,
    });
    ok(res, { id }, 201);
  }),
);

projectsRouter.post(
  '/:projectId/secrets/:secretId/rotate',
  asyncHandler(async (req, res) => {
    const { workspace } = await requireMembershipParam(req);
    const { value } = rotateSecretSchema.parse(req.body);
    await rotateSecret({
      workspaceId: String(workspace._id),
      secretId: req.params.secretId,
      value,
    });
    ok(res, { ok: true });
  }),
);

projectsRouter.delete(
  '/:projectId/secrets/:secretId',
  asyncHandler(async (req, res) => {
    const { workspace } = await requireMembershipParam(req);
    await deleteSecret(String(workspace._id), req.params.secretId);
    ok(res, { ok: true });
  }),
);

/**
 * Initial website test for a freshly connected site (and the "Test website"
 * action later on). Runs a real request and returns what actually happened;
 * nothing is persisted and no incident can be opened by it.
 */
projectsRouter.post(
  '/:projectId/test',
  heavyLimiter,
  asyncHandler(async (req, res) => {
    const { workspace } = await requireMembershipParam(req);
    const project = await requireProject(String(workspace._id), req.params.projectId);
    const result = await probeProjectWebsite({
      workspaceId: String(workspace._id),
      projectId: String(project._id),
      url: project.url,
    });
    ok(res, result);
  }),
);

/* ------------------------------- Checks -------------------------------- */

projectsRouter.post(
  '/:projectId/checks',
  asyncHandler(async (req, res) => {
    const { workspace } = await requireMembershipParam(req);
    const project = await requireProject(String(workspace._id), req.params.projectId);
    const input = createCheckSchema.parse(req.body);
    const check = await createCheck({
      workspaceId: String(workspace._id),
      projectId: String(project._id),
      userId: String(req.auth!.user._id),
      input,
    });
    ok(res, { check: toCheckSummary(check) }, 201);
  }),
);

/**
 * Runs a configuration test without persisting anything. A failed test never
 * creates an incident.
 */
projectsRouter.post(
  '/:projectId/checks/test',
  heavyLimiter,
  asyncHandler(async (req, res) => {
    const { workspace } = await requireMembershipParam(req);
    const project = await requireProject(String(workspace._id), req.params.projectId);
    const input = createCheckSchema.parse(req.body);

    const { result } = await executeAdHocCheck({
      workspaceId: String(workspace._id),
      projectId: String(project._id),
      checkName: input.name,
      type: input.type,
      config: input.config,
      timeoutMs: input.timeoutMs,
    });

    ok(res, {
      success: result.success,
      failureCategory: result.failureCategory,
      failureMessage: result.failureMessage,
      durationMs: result.durationMs,
      httpStatus: result.httpStatus,
      evidence: sanitizeEvidence(result.evidence),
      persisted: false,
    });
  }),
);

function sanitizeEvidence(evidence: object) {
  const clone = { ...(evidence as Record<string, unknown>) };
  // Console errors and headers are already sanitized upstream; drop anything
  // that could carry page content beyond the short preview.
  delete clone.responseHeaders;
  return clone;
}
