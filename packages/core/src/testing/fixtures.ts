import { Types } from 'mongoose';
import { Check, Incident, Project, User, Workspace } from '../index';

/**
 * Fixtures shared by the service tests.
 *
 * These create documents directly (no service layer) so a test can start from a
 * known state and assert on the behaviour under test only. Fields that a real
 * flow would generate — canonical URLs, normalized emails — are set here
 * because their absence would make the fixture unrealistic.
 */

let counter = 0;

function nextId() {
  counter += 1;
  return counter;
}

export async function makeWorkspace(
  overrides: {
    name?: string;
    notifyOnOpen?: boolean;
    notifyOnResolve?: boolean;
    notifyOnRepeatFailures?: boolean;
  } = {},
) {
  const sequence = nextId();
  const workspace = await Workspace.create({
    name: overrides.name ?? `Workspace ${sequence}`,
    ownerId: new Types.ObjectId(),
    alertEmail: `workspace${sequence}@example.com`,
    settings: {
      notifyOnOpen: overrides.notifyOnOpen ?? true,
      notifyOnResolve: overrides.notifyOnResolve ?? true,
      notifyOnRepeatFailures: overrides.notifyOnRepeatFailures ?? false,
    },
  });
  return workspace;
}

export async function makeUser(overrides: { email?: string; name?: string } = {}) {
  const sequence = nextId();
  const email = overrides.email ?? `user${sequence}@example.com`;
  return User.create({
    email,
    normalizedEmail: email.toLowerCase(),
    name: overrides.name ?? `User ${sequence}`,
    passwordHash: 'not-a-real-hash',
    timezone: 'UTC',
  });
}

export async function makeProject(
  workspaceId: string,
  overrides: { name?: string; url?: string; status?: 'active' | 'paused' } = {},
) {
  const sequence = nextId();
  const url = overrides.url ?? `https://client${sequence}.example.com`;
  const owner = await makeUser();
  return Project.create({
    workspaceId: new Types.ObjectId(workspaceId),
    createdBy: owner._id,
    name: overrides.name ?? `Client ${sequence}`,
    url,
    canonicalUrl: url.replace(/\/$/, ''),
    clientName: `Client ${sequence}`,
    status: overrides.status ?? 'active',
  });
}

export async function makeCheck(
  params: {
    workspaceId: string;
    projectId: string;
    name?: string;
    type?: 'http' | 'api' | 'browser';
    enabled?: boolean;
    intervalSeconds?: number;
    failureThreshold?: number;
    recoveryThreshold?: number;
    config?: Record<string, unknown>;
    consecutiveFailures?: number;
    consecutiveSuccesses?: number;
  },
) {
  const sequence = nextId();
  const type = params.type ?? 'http';
  const url = `https://check${sequence}.example.com`;
  const defaultConfig =
    type === 'browser'
      ? { startUrl: url, steps: [{ type: 'goto', url, waitUntil: 'domcontentloaded' }] }
      : type === 'api'
        ? { url, method: 'GET', expectedStatus: { min: 200, max: 299 } }
        : { url, method: 'GET', expectedStatus: { min: 200, max: 399 } };

  return Check.create({
    workspaceId: new Types.ObjectId(params.workspaceId),
    projectId: new Types.ObjectId(params.projectId),
    name: params.name ?? `Check ${sequence}`,
    type,
    enabled: params.enabled ?? true,
    intervalSeconds: params.intervalSeconds ?? 300,
    timeoutMs: 15_000,
    failureThreshold: params.failureThreshold ?? 2,
    recoveryThreshold: params.recoveryThreshold ?? 2,
    severity: 'major',
    configVersion: 1,
    config: params.config ?? defaultConfig,
    consecutiveFailures: params.consecutiveFailures ?? 0,
    consecutiveSuccesses: params.consecutiveSuccesses ?? 0,
    runtimeStatus: params.enabled === false ? 'paused' : 'healthy',
    nextRunAt: params.enabled === false ? null : new Date(Date.now() + 300_000),
  });
}

export async function makeIncident(params: {
  workspaceId: string;
  projectId: string;
  checkId?: string;
  status?: 'open' | 'acknowledged' | 'recovering' | 'resolved';
  title?: string;
}) {
  const sequence = nextId();
  const now = Date.now();
  const status = params.status ?? 'open';
  return Incident.create({
    workspaceId: new Types.ObjectId(params.workspaceId),
    projectId: new Types.ObjectId(params.projectId),
    checkId: params.checkId ? new Types.ObjectId(params.checkId) : new Types.ObjectId(),
    checkName: 'Homepage responds',
    checkType: 'http',
    status,
    severity: 'major',
    title: params.title ?? `Homepage responds is failing (${sequence})`,
    summary: 'The site returned HTTP 500, outside the configured expected range.',
    firstFailureAt: new Date(now - 600_000),
    lastFailureAt: new Date(now - 60_000),
    resolvedAt: status === 'resolved' ? new Date(now - 30_000) : null,
    failureCount: 4,
    lastFailureCategory: 'http_status',
    lastErrorSummary: 'HTTP 500',
    activeKey: status === 'resolved' ? null : 'active',
    suggestedSteps: ['Open the affected URL in a browser.'],
  });
}
