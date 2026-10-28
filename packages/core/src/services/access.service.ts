import { Types } from 'mongoose';
import { Membership, Workspace, type MembershipDoc, type WorkspaceDoc } from '../models/workspace';
import { Project } from '../models/project';
import { Check } from '../models/check';
import { forbidden, notFound } from '../lib/errors';

export interface WorkspaceAccess {
  workspace: WorkspaceDoc;
  membership: MembershipDoc;
  role: 'owner' | 'member';
}

/**
 * Resolves a workspace *and* the caller's membership in one step. Every
 * workspace-scoped query in the API goes through this so a guessed identifier
 * from another tenant returns 404 rather than data.
 */
export async function requireWorkspace(userId: string, workspaceId: string): Promise<WorkspaceAccess> {
  if (!Types.ObjectId.isValid(workspaceId)) throw notFound('Workspace not found.');

  const membership = await Membership.findOne({ workspaceId, userId, status: 'active' });
  if (!membership) throw notFound('Workspace not found.');

  const workspace = await Workspace.findById(workspaceId);
  if (!workspace) throw notFound('Workspace not found.');

  return { workspace, membership, role: membership.role };
}

export async function requireWorkspaceOwner(userId: string, workspaceId: string): Promise<WorkspaceAccess> {
  const access = await requireWorkspace(userId, workspaceId);
  if (access.role !== 'owner') {
    throw forbidden('Only the workspace owner can perform this action.');
  }
  return access;
}

export async function listUserWorkspaces(userId: string) {
  const memberships = await Membership.find({ userId, status: 'active' }).sort({ createdAt: 1 });
  const workspaceIds = memberships.map((m) => m.workspaceId);
  const workspaces = await Workspace.find({ _id: { $in: workspaceIds } });
  const byId = new Map(workspaces.map((workspace) => [String(workspace._id), workspace]));

  return memberships
    .map((membership) => {
      const workspace = byId.get(String(membership.workspaceId));
      if (!workspace) return null;
      return {
        id: String(workspace._id),
        name: workspace.name,
        role: membership.role,
        ownerId: String(workspace.ownerId),
        alertEmail: workspace.alertEmail,
        settings: {
          notifyOnOpen: workspace.settings.notifyOnOpen,
          notifyOnResolve: workspace.settings.notifyOnResolve,
          notifyOnRepeatFailures: workspace.settings.notifyOnRepeatFailures,
        },
        createdAt: workspace.createdAt.toISOString(),
      };
    })
    .filter((value): value is NonNullable<typeof value> => value !== null);
}

/** Project lookup scoped to a workspace the caller already proved membership of. */
export async function requireProject(workspaceId: string, projectId: string) {
  if (!Types.ObjectId.isValid(projectId)) throw notFound('Project not found.');
  const project = await Project.findOne({ _id: projectId, workspaceId });
  if (!project) throw notFound('Project not found.');
  return project;
}

export async function requireCheck(workspaceId: string, checkId: string) {
  if (!Types.ObjectId.isValid(checkId)) throw notFound('Check not found.');
  const check = await Check.findOne({ _id: checkId, workspaceId });
  if (!check) throw notFound('Check not found.');
  return check;
}
