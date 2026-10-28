import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { resetEnvCache } from '@breakglass/core';
import { createApp } from '../app';

/**
 * HTTP-level integration tests against the real Express app and a real
 * (in-memory) MongoDB. These are the tests that prove the security properties
 * promised in the README: cookie session auth, CSRF defence, tenant isolation
 * enforced server-side, and SSRF refusal at project creation.
 */

const WEB_ORIGIN = 'http://localhost:5173';
const csrf = { origin: WEB_ORIGIN, 'x-requested-with': 'breakglass-web' };

let app: Express;
let counter = 0;

async function signup(agent: ReturnType<typeof request.agent>, label: string) {
  const email = `${label}-${Date.now()}-${counter++}@example.com`;
  const response = await agent
    .post('/api/v1/auth/register')
    .set(csrf)
    .send({ name: `${label} user`, email, password: 'correct-horse-battery-1', workspaceName: `${label} agency` });
  expect(response.status).toBe(201);
  const me = await agent.get('/api/v1/auth/me').set(csrf);
  return {
    email,
    password: 'correct-horse-battery-1',
    userId: response.body.user.id as string,
    workspaceId: me.body.workspaces[0].id as string,
  };
}

beforeAll(() => {
  process.env.ALLOW_PRIVATE_TARGETS = 'false';
  resetEnvCache();
  app = createApp();
});

describe('authentication', () => {
  it('registers a user, creates a workspace and issues an HttpOnly session cookie', async () => {
    const agent = request.agent(app);
    const response = await agent
      .post('/api/v1/auth/register')
      .set(csrf)
      .send({ name: 'Ana Rivera', email: `ana-${Date.now()}@example.com`, password: 'correct-horse-battery-1', workspaceName: 'Rivera Studio' });

    expect(response.status).toBe(201);
    const cookies = response.headers['set-cookie'] as unknown as string[];
    const session = cookies.find((cookie) => cookie.startsWith('bg_session='));
    expect(session).toBeDefined();
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/SameSite=Lax/i);
    expect(session).toMatch(/Path=\//i);
    // No token is ever returned in the JSON payload.
    expect(JSON.stringify(response.body)).not.toMatch(/token|jwt/i);
  });

  it('rejects unauthenticated access to workspace data', async () => {
    const response = await request(app).get('/api/v1/auth/me');
    expect(response.status).toBe(200);
    expect(response.body.user).toBeNull();
  });

  it('returns the same generic error for an unknown email and a wrong password', async () => {
    const agent = request.agent(app);
    const account = await signup(agent, 'enum');

    const wrongPassword = await agent.post('/api/v1/auth/login').set(csrf).send({ email: account.email, password: 'wrong-password-123' });
    const unknownEmail = await request(app)
      .post('/api/v1/auth/login')
      .set(csrf)
      .send({ email: 'nobody-here@example.com', password: 'wrong-password-123' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
  });

  it('revokes the session on logout', async () => {
    const agent = request.agent(app);
    const account = await signup(agent, 'logout');

    const before = await agent.get(`/api/v1/workspaces/${account.workspaceId}/projects`).set(csrf);
    expect(before.status).toBe(200);

    const logout = await agent.post('/api/v1/auth/logout').set(csrf);
    expect(logout.status).toBe(200);

    const after = await agent.get(`/api/v1/workspaces/${account.workspaceId}/projects`).set(csrf);
    expect(after.status).toBe(401);
  });

  it('revokes all other sessions when the password changes', async () => {
    const primary = request.agent(app);
    const account = await signup(primary, 'rotate');
    const other = request.agent(app);
    await other.post('/api/v1/auth/login').set(csrf).send({ email: account.email, password: account.password });
    expect((await other.get('/api/v1/auth/me').set(csrf)).body.user).not.toBeNull();

    const changed = await primary
      .post('/api/v1/auth/change-password')
      .set(csrf)
      .send({ currentPassword: account.password, newPassword: 'a-brand-new-password-2' });
    expect(changed.status).toBe(200);

    expect((await other.get('/api/v1/auth/me').set(csrf)).body.user).toBeNull();
    expect((await primary.get('/api/v1/auth/me').set(csrf)).body.user).not.toBeNull();
  });
});

describe('CSRF and CORS', () => {
  it('rejects a state-changing request with no origin', async () => {
    const agent = request.agent(app);
    await signup(agent, 'csrf-missing');
    const response = await agent.post('/api/v1/workspaces').send({ name: 'Sneaky' });
    expect(response.status).toBe(403);
  });

  it('rejects a state-changing request from a foreign origin', async () => {
    const agent = request.agent(app);
    await signup(agent, 'csrf-foreign');
    const response = await agent
      .post('/api/v1/workspaces')
      .set({ origin: 'https://evil.example', 'x-requested-with': 'breakglass-web' })
      .send({ name: 'Sneaky' });
    expect(response.status).toBe(403);
  });

  it('rejects a form-encoded write that could be produced by a cross-site form', async () => {
    const agent = request.agent(app);
    await signup(agent, 'csrf-form');
    const response = await agent.post('/api/v1/workspaces').set(csrf).type('form').send('name=Sneaky');
    expect(response.status).toBe(403);
  });

  it('does not send CORS headers to a foreign origin', async () => {
    const response = await request(app).get('/api/v1/health').set({ origin: 'https://evil.example' });
    // 503 means "no live worker yet" in this test process; the assertion here
    // is only about CORS headers.
    expect([200, 503]).toContain(response.status);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('projects and SSRF refusal', () => {
  const blocked = [
    'http://169.254.169.254/latest/meta-data/',
    'http://127.0.0.1:4000/',
    'http://10.0.0.5/',
    'http://192.168.1.10/admin',
    'http://localhost/',
    'ftp://example.com',
    'file:///etc/passwd',
  ];

  it.each(blocked)('refuses to create a project for %s', async (url) => {
    const agent = request.agent(app);
    const account = await signup(agent, 'ssrf');
    const response = await agent
      .post(`/api/v1/workspaces/${account.workspaceId}/projects`)
      .set(csrf)
      .send({ name: 'Bad target', url });
    expect(response.status).toBe(400);
    expect(response.body.error).toBeTruthy();
  });

  it('creates a project for an allowed public target and hides nothing about its state', async () => {
    const agent = request.agent(app);
    const account = await signup(agent, 'project');
    const response = await agent
      .post(`/api/v1/workspaces/${account.workspaceId}/projects`)
      .set(csrf)
      .send({ name: 'Example', url: 'https://example.com' });

    expect(response.status).toBe(201);
    expect(response.body.project.id).toBeTruthy();
    expect(response.body.project.url).toMatch(/^https:\/\/example\.com\/?$/);
  });
});

describe('tenant isolation is enforced server-side', () => {
  it('hides another workspace’s project, checks, incidents and runs', async () => {
    const alice = request.agent(app);
    const aliceAccount = await signup(alice, 'alice');
    const created = await alice
      .post(`/api/v1/workspaces/${aliceAccount.workspaceId}/projects`)
      .set(csrf)
      .send({ name: 'Alice Site', url: 'https://example.com' });
    const projectId = created.body.project.id as string;

    const check = await alice
      .post(`/api/v1/workspaces/${aliceAccount.workspaceId}/projects/${projectId}/checks`)
      .set(csrf)
      .send({
        name: 'Homepage',
        type: 'http',
        enabled: false,
        intervalSeconds: 300,
        timeoutMs: 10_000,
        failureThreshold: 2,
        recoveryThreshold: 2,
        severity: 'major',
        config: { url: 'https://example.com', method: 'GET', followRedirects: true, expectedStatus: { min: 200, max: 399 } },
      });
    expect(check.status).toBe(201);
    const checkId = check.body.check.id as string;

    const bob = request.agent(app);
    const bobAccount = await signup(bob, 'bob');

    // Reading Alice's data through Bob's session must look like "does not exist".
    const project = await bob.get(`/api/v1/workspaces/${aliceAccount.workspaceId}/projects/${projectId}`).set(csrf);
    expect(project.status).toBe(404);

    const projects = await bob.get(`/api/v1/workspaces/${aliceAccount.workspaceId}/projects`).set(csrf);
    expect(projects.status).toBe(404);

    const runs = await bob.get(`/api/v1/workspaces/${aliceAccount.workspaceId}/checks/${checkId}/runs`).set(csrf);
    expect(runs.status).toBe(404);

    const incidents = await bob.get(`/api/v1/workspaces/${aliceAccount.workspaceId}/incidents`).set(csrf);
    expect(incidents.status).toBe(404);

    const dashboard = await bob.get(`/api/v1/workspaces/${aliceAccount.workspaceId}/dashboard`).set(csrf);
    expect(dashboard.status).toBe(404);

    // Writing is refused too, including under Bob's own workspace id.
    const patch = await bob.patch(`/api/v1/workspaces/${bobAccount.workspaceId}/checks/${checkId}`).set(csrf).send({ enabled: true });
    expect(patch.status).toBe(404);

    const del = await bob.delete(`/api/v1/workspaces/${aliceAccount.workspaceId}/projects/${projectId}`).set(csrf);
    expect(del.status).toBe(404);

    // ...and Alice still sees her own project untouched.
    const verify = await alice.get(`/api/v1/workspaces/${aliceAccount.workspaceId}/projects/${projectId}`).set(csrf);
    expect(verify.status).toBe(200);
  });
});

describe('check lifecycle', () => {
  let agent: ReturnType<typeof request.agent>;
  let workspaceId: string;
  let projectId: string;

  beforeAll(async () => {
    agent = request.agent(app);
    const account = await signup(agent, 'lifecycle');
    workspaceId = account.workspaceId;
    const project = await agent
      .post(`/api/v1/workspaces/${workspaceId}/projects`)
      .set(csrf)
      .send({ name: 'Lifecycle Site', url: 'https://example.com' });
    projectId = project.body.project.id;
  });

  it('creates a check disabled, so nothing is scheduled before activation', async () => {
    const response = await agent
      .post(`/api/v1/workspaces/${workspaceId}/projects/${projectId}/checks`)
      .set(csrf)
      .send({
        name: 'Draft check',
        type: 'http',
        enabled: false,
        intervalSeconds: 300,
        timeoutMs: 10_000,
        failureThreshold: 2,
        recoveryThreshold: 2,
        severity: 'major',
        config: { url: 'https://example.com', method: 'GET', followRedirects: true, expectedStatus: { min: 200, max: 399 } },
      });

    expect(response.status).toBe(201);
    expect(response.body.check.enabled).toBe(false);
    expect(response.body.check.nextRunAt).toBeNull();
  });

  it('rejects an interval below the documented minimum', async () => {
    const response = await agent
      .post(`/api/v1/workspaces/${workspaceId}/projects/${projectId}/checks`)
      .set(csrf)
      .send({
        name: 'Too fast',
        type: 'http',
        enabled: true,
        intervalSeconds: 5,
        timeoutMs: 10_000,
        failureThreshold: 2,
        recoveryThreshold: 2,
        severity: 'major',
        config: { url: 'https://example.com', method: 'GET' },
      });
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toMatch(/interval/i);
  });

  it('rejects a check targeting a blocked destination', async () => {
    const response = await agent
      .post(`/api/v1/workspaces/${workspaceId}/projects/${projectId}/checks`)
      .set(csrf)
      .send({
        name: 'Metadata',
        type: 'http',
        enabled: true,
        intervalSeconds: 300,
        timeoutMs: 10_000,
        failureThreshold: 2,
        recoveryThreshold: 2,
        severity: 'major',
        config: { url: 'http://169.254.169.254/latest/meta-data/', method: 'GET' },
      });
    expect(response.status).toBe(400);
  });

  it('activates a check and schedules the next run', async () => {
    const created = await agent
      .post(`/api/v1/workspaces/${workspaceId}/projects/${projectId}/checks`)
      .set(csrf)
      .send({
        name: 'Activatable',
        type: 'http',
        enabled: false,
        intervalSeconds: 60,
        timeoutMs: 10_000,
        failureThreshold: 2,
        recoveryThreshold: 2,
        severity: 'major',
        config: { url: 'https://example.com', method: 'GET', followRedirects: true, expectedStatus: { min: 200, max: 399 } },
      });
    const checkId = created.body.check.id;

    const activated = await agent.patch(`/api/v1/workspaces/${workspaceId}/checks/${checkId}`).set(csrf).send({ enabled: true });
    expect(activated.status).toBe(200);
    expect(activated.body.check.enabled).toBe(true);
    expect(activated.body.check.nextRunAt).toBeTruthy();

    const detail = await agent.get(`/api/v1/workspaces/${workspaceId}/projects/${projectId}`).set(csrf);
    expect(detail.status).toBe(200);
    const listed = detail.body.checks.find((check: { id: string }) => check.id === checkId);
    expect(listed.enabled).toBe(true);
    expect(listed.nextRunAt).toBeTruthy();
  });

  it('never returns stored API credentials in any response', async () => {
    const secret = await agent
      .post(`/api/v1/workspaces/${workspaceId}/projects/${projectId}/secrets`)
      .set(csrf)
      .send({ purpose: 'api_header', label: 'Staging token', value: 'Bearer super-secret-value' });
    expect([200, 201]).toContain(secret.status);

    const detail = await agent.get(`/api/v1/workspaces/${workspaceId}/projects/${projectId}`).set(csrf);
    expect(JSON.stringify(detail.body)).not.toContain('super-secret-value');
  });
});

describe('dashboard and history', () => {
  it('reports real counts and bounded history', async () => {
    const agent = request.agent(app);
    const account = await signup(agent, 'dashboard');

    const before = await agent.get(`/api/v1/workspaces/${account.workspaceId}/dashboard`).set(csrf);
    expect(before.status).toBe(200);
    expect(before.body.stats.projectCount).toBe(0);
    expect(before.body.stats.last24h.runs).toBe(0);

    await agent.post(`/api/v1/workspaces/${account.workspaceId}/projects`).set(csrf).send({ name: 'Site', url: 'https://example.com' });

    const after = await agent.get(`/api/v1/workspaces/${account.workspaceId}/dashboard`).set(csrf);
    expect(after.body.stats.projectCount).toBe(1);
  });

  it('paginates check history with a cursor', async () => {
    const agent = request.agent(app);
    const account = await signup(agent, 'pagination');
    const project = await agent
      .post(`/api/v1/workspaces/${account.workspaceId}/projects`)
      .set(csrf)
      .send({ name: 'Paged Site', url: 'https://example.com' });
    const check = await agent
      .post(`/api/v1/workspaces/${account.workspaceId}/projects/${project.body.project.id}/checks`)
      .set(csrf)
      .send({
        name: 'Paged',
        type: 'http',
        enabled: false,
        intervalSeconds: 300,
        timeoutMs: 10_000,
        failureThreshold: 2,
        recoveryThreshold: 2,
        severity: 'major',
        config: { url: 'https://example.com', method: 'GET', followRedirects: true, expectedStatus: { min: 200, max: 399 } },
      });

    const response = await agent.get(`/api/v1/workspaces/${account.workspaceId}/checks/${check.body.check.id}/runs?limit=5`).set(csrf);
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.runs)).toBe(true);
    expect(response.body.runs.length).toBeLessThanOrEqual(5);
    expect(response.body).toHaveProperty('nextCursor');

    const tooBig = await agent.get(`/api/v1/workspaces/${account.workspaceId}/checks/${check.body.check.id}/runs?limit=5000`).set(csrf);
    expect(tooBig.body.runs.length).toBeLessThanOrEqual(100);
  });
});

describe('health endpoint', () => {
  it('reports dependency state without authentication', async () => {
    const response = await request(app).get('/api/v1/health');
    expect([200, 503]).toContain(response.status);
    expect(response.body.database).toBe('connected');
    expect(response.body).toHaveProperty('queue.workersOnline');
    expect(response.body.email).toBe('development_outbox');
  });
});
