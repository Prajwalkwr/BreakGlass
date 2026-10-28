import { Router } from 'express';
import { Types } from 'mongoose';
import {
  Membership,
  NotificationDelivery,
  Workspace,
  createDestination,
  deleteDestination,
  emailStatusForUi,
  getDashboardStats,
  listDestinations,
  listUserWorkspaces,
  requireWorkspace,
  requireWorkspaceOwner,
  sendTestNotification,
  toDeliveryDto,
  updateDestination,
  badRequest,
  conflict,
  notFound,
  User,
} from '@breakglass/core';
import {
  createWorkspaceSchema,
  notificationDestinationSchema,
  updateWorkspaceSchema,
} from '@breakglass/shared';

import { asyncHandler, ok } from '../../lib/http';
import { requireAuth } from '../../middleware/auth';

export const workspacesRouter = Router();
workspacesRouter.use(requireAuth);

workspacesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    ok(res, { workspaces: await listUserWorkspaces(String(req.auth!.user._id)) });
  }),
);

workspacesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { name } = createWorkspaceSchema.parse(req.body);
    const workspace = await Workspace.create({
      name,
      ownerId: req.auth!.user._id,
      alertEmail: req.auth!.user.email,
    });
    await Membership.create({
      workspaceId: workspace._id,
      userId: req.auth!.user._id,
      role: 'owner',
      status: 'active',
      joinedAt: new Date(),
    });
    ok(res, { id: String(workspace._id), name: workspace.name }, 201);
  }),
);

workspacesRouter.get(
  '/:workspaceId',
  asyncHandler(async (req, res) => {
    const { workspace, role } = await requireWorkspace(String(req.auth!.user._id), req.params.workspaceId);
    const members = await Membership.find({ workspaceId: workspace._id }).sort({ createdAt: 1 });
    const users = await User.find({ _id: { $in: members.map((member) => member.userId) } }).select('name email');
    const userMap = new Map(users.map((user) => [String(user._id), user]));

    ok(res, {
      workspace: {
        id: String(workspace._id),
        name: workspace.name,
        role,
        ownerId: String(workspace.ownerId),
        alertEmail: workspace.alertEmail,
        settings: workspace.settings,
        createdAt: workspace.createdAt.toISOString(),
      },
      members: members.map((member) => {
        const user = userMap.get(String(member.userId));
        return {
          userId: String(member.userId),
          name: user?.name ?? member.invitedEmail ?? 'Invited member',
          email: user?.email ?? member.invitedEmail ?? '',
          role: member.role,
          status: member.status,
          joinedAt: member.joinedAt ? member.joinedAt.toISOString() : null,
        };
      }),
      email: emailStatusForUi(),
    });
  }),
);

workspacesRouter.patch(
  '/:workspaceId',
  asyncHandler(async (req, res) => {
    const { workspace } = await requireWorkspaceOwner(String(req.auth!.user._id), req.params.workspaceId);
    const input = updateWorkspaceSchema.parse(req.body);
    const set: Record<string, unknown> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.alertEmail !== undefined) set.alertEmail = input.alertEmail || null;
    if (input.notifyOnOpen !== undefined) set['settings.notifyOnOpen'] = input.notifyOnOpen;
    if (input.notifyOnResolve !== undefined) set['settings.notifyOnResolve'] = input.notifyOnResolve;
    if (input.notifyOnRepeatFailures !== undefined) set['settings.notifyOnRepeatFailures'] = input.notifyOnRepeatFailures;

    const updated = await Workspace.findByIdAndUpdate(workspace._id, { $set: set }, { new: true });
    ok(res, { workspace: { id: String(updated!._id), name: updated!.name, settings: updated!.settings } });
  }),
);

workspacesRouter.get(
  '/:workspaceId/members',
  asyncHandler(async (req, res) => {
    const { workspace } = await requireWorkspace(String(req.auth!.user._id), req.params.workspaceId);
    const members = await Membership.find({ workspaceId: workspace._id });
    const users = await User.find({ _id: { $in: members.map((member) => member.userId) } }).select('name email');
    const userMap = new Map(users.map((user) => [String(user._id), user]));
    ok(res, {
      members: members.map((member) => ({
        userId: String(member.userId),
        name: userMap.get(String(member.userId))?.name ?? 'Invited member',
        email: userMap.get(String(member.userId))?.email ?? member.invitedEmail ?? '',
        role: member.role,
        status: member.status,
        joinedAt: member.joinedAt ? member.joinedAt.toISOString() : null,
      })),
    });
  }),
);

workspacesRouter.post(
  '/:workspaceId/members',
  asyncHandler(async (req, res) => {
    const { workspace } = await requireWorkspaceOwner(String(req.auth!.user._id), req.params.workspaceId);
    const { inviteMemberSchema } = await import('@breakglass/shared');
    const input = inviteMemberSchema.parse(req.body);

    const user = await User.findOne({ normalizedEmail: input.email });
    if (!user) {
      throw badRequest(
        'That person does not have a BreakGlass account yet. Ask them to register first, then invite them by the same email address.',
      );
    }
    const existing = await Membership.findOne({ workspaceId: workspace._id, userId: user._id });
    if (existing) throw conflict('That person is already a member of this workspace.');

    await Membership.create({
      workspaceId: workspace._id,
      userId: user._id,
      role: input.role,
      status: 'active',
      joinedAt: new Date(),
    });
    ok(res, { ok: true }, 201);
  }),
);

workspacesRouter.delete(
  '/:workspaceId/members/:userId',
  asyncHandler(async (req, res) => {
    const { workspace, role } = await requireWorkspace(String(req.auth!.user._id), req.params.workspaceId);
    const targetUserId = req.params.userId;

    if (role !== 'owner' && targetUserId !== String(req.auth!.user._id)) {
      throw notFound('Member not found.');
    }
    if (targetUserId === String(workspace.ownerId)) {
      throw badRequest('The workspace owner cannot be removed.');
    }
    const result = await Membership.deleteOne({ workspaceId: workspace._id, userId: targetUserId });
    if (result.deletedCount === 0) throw notFound('Member not found.');
    ok(res, { ok: true });
  }),
);

workspacesRouter.get(
  '/:workspaceId/dashboard',
  asyncHandler(async (req, res) => {
    const { workspace } = await requireWorkspace(String(req.auth!.user._id), req.params.workspaceId);
    ok(res, { stats: await getDashboardStats(String(workspace._id)) });
  }),
);

/* ------------------------------------------------------------------ */
/* Notification destinations                                           */
/* ------------------------------------------------------------------ */

workspacesRouter.get(
  '/:workspaceId/notifications',
  asyncHandler(async (req, res) => {
    const { workspace } = await requireWorkspace(String(req.auth!.user._id), req.params.workspaceId);
    ok(res, { destinations: await listDestinations(String(workspace._id)), email: emailStatusForUi() });
  }),
);

workspacesRouter.post(
  '/:workspaceId/notifications',
  asyncHandler(async (req, res) => {
    const { workspace } = await requireWorkspace(String(req.auth!.user._id), req.params.workspaceId);
    const input = notificationDestinationSchema.parse(req.body);
    const destination = await createDestination({
      workspaceId: String(workspace._id),
      type: input.type,
      ...(input.type === 'email' ? { address: input.address } : { webhookUrl: input.webhookUrl }),
      label: input.label,
    });
    ok(res, { id: String(destination._id) }, 201);
  }),
);

workspacesRouter.patch(
  '/:workspaceId/notifications/:destinationId',
  asyncHandler(async (req, res) => {
    const { workspace } = await requireWorkspace(String(req.auth!.user._id), req.params.workspaceId);
    const enabled = Boolean(req.body?.enabled);
    await updateDestination({
      workspaceId: String(workspace._id),
      destinationId: req.params.destinationId,
      enabled,
    });
    ok(res, { ok: true });
  }),
);

workspacesRouter.delete(
  '/:workspaceId/notifications/:destinationId',
  asyncHandler(async (req, res) => {
    const { workspace } = await requireWorkspace(String(req.auth!.user._id), req.params.workspaceId);
    await deleteDestination(String(workspace._id), req.params.destinationId);
    ok(res, { ok: true });
  }),
);

workspacesRouter.post(
  '/:workspaceId/notifications/:destinationId/test',
  asyncHandler(async (req, res) => {
    const { workspace } = await requireWorkspace(String(req.auth!.user._id), req.params.workspaceId);
    const result = await sendTestNotification({
      workspaceId: String(workspace._id),
      destinationId: req.params.destinationId,
      actorName: req.auth!.user.name,
    });
    ok(res, result);
  }),
);

workspacesRouter.get(
  '/:workspaceId/deliveries',
  asyncHandler(async (req, res) => {
    const { workspace } = await requireWorkspace(String(req.auth!.user._id), req.params.workspaceId);
    const limit = Math.min(Number(req.query.limit) || 25, 100);
    const cursor = typeof req.query.cursor === 'string' && Types.ObjectId.isValid(req.query.cursor)
      ? new Types.ObjectId(req.query.cursor)
      : null;
    const filter: Record<string, unknown> = { workspaceId: workspace._id };
    if (cursor) filter._id = { $lt: cursor };

    const deliveries = await NotificationDelivery.find(filter).sort({ _id: -1 }).limit(limit + 1);
    const hasMore = deliveries.length > limit;
    const page = hasMore ? deliveries.slice(0, limit) : deliveries;
    ok(res, {
      deliveries: page.map(toDeliveryDto),
      nextCursor: hasMore ? String(page[page.length - 1]._id) : null,
      email: emailStatusForUi(),
    });
  }),
);
