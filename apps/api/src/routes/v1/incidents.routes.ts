import { Router } from 'express';
import {
  acknowledgeIncident,
  getIncidentDetail,
  listIncidents,
  requireWorkspace,
  resolveIncidentManually,
  badRequest,
  notFound,
} from '@breakglass/core';

import { asyncHandler, ok } from '../../lib/http';
import { requireAuth } from '../../middleware/auth';
import { z } from 'zod';

export const incidentsRouter = Router({ mergeParams: true });
incidentsRouter.use(requireAuth);

incidentsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { workspace } = await requireWorkspace(String(req.auth!.user._id), req.params.workspaceId);
    const status = typeof req.query.status === 'string' ? req.query.status : 'all';
    const result = await listIncidents({
      workspaceId: String(workspace._id),
      status: status as never,
      projectId: typeof req.query.projectId === 'string' ? req.query.projectId : undefined,
      limit: Math.min(Number(req.query.limit) || 20, 100),
      cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
    });
    ok(res, result);
  }),
);

incidentsRouter.get(
  '/:incidentId',
  asyncHandler(async (req, res) => {
    const { workspace } = await requireWorkspace(String(req.auth!.user._id), req.params.workspaceId);
    ok(res, { incident: await getIncidentDetail(String(workspace._id), req.params.incidentId) });
  }),
);

incidentsRouter.post(
  '/:incidentId/acknowledge',
  asyncHandler(async (req, res) => {
    const { workspace } = await requireWorkspace(String(req.auth!.user._id), req.params.workspaceId);
    const incident = await acknowledgeIncident({
      workspaceId: String(workspace._id),
      incidentId: req.params.incidentId,
      userId: String(req.auth!.user._id),
      userName: req.auth!.user.name,
    }).catch((error: Error) => {
      if (error.message === 'not_found') throw notFound('Incident not found.');
      if (error.message === 'resolved') throw badRequest('This incident is already resolved.');
      throw error;
    });
    ok(res, { ok: true, status: incident.status });
  }),
);

const resolveSchema = z.object({ note: z.string().trim().max(500).optional() });

incidentsRouter.post(
  '/:incidentId/resolve',
  asyncHandler(async (req, res) => {
    const { workspace } = await requireWorkspace(String(req.auth!.user._id), req.params.workspaceId);
    const input = resolveSchema.parse(req.body ?? {});
    const incident = await resolveIncidentManually({
      workspaceId: String(workspace._id),
      incidentId: req.params.incidentId,
      userId: String(req.auth!.user._id),
      userName: req.auth!.user.name,
      note: input.note,
    }).catch((error: Error) => {
      if (error.message === 'not_found') throw notFound('Incident not found.');
      if (error.message === 'resolved') throw badRequest('This incident is already resolved.');
      throw error;
    });
    ok(res, { ok: true, status: incident.status });
  }),
);

incidentsRouter.post(
  '/:incidentId/note',
  asyncHandler(async (req, res) => {
    const { workspace } = await requireWorkspace(String(req.auth!.user._id), req.params.workspaceId);
    const input = z.object({ message: z.string().trim().min(1).max(1000) }).parse(req.body);
    const { Incident, IncidentEvent } = await import('@breakglass/core');
    const incident = await Incident.findOne({ _id: req.params.incidentId, workspaceId: workspace._id });
    if (!incident) throw notFound('Incident not found.');
    await IncidentEvent.create({
      incidentId: incident._id,
      workspaceId: incident.workspaceId,
      type: 'note',
      message: input.message,
      actor: req.auth!.user.name,
      source: 'user',
    });
    ok(res, { ok: true });
  }),
);
