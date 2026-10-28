/**
 * End-to-end smoke test.
 *
 * Exercises the real stack: HTTP API (with cookie sessions) → project + check
 * creation → configuration test → the worker's monitoring pipeline → incident
 * opening → email delivery (development outbox) → recovery → resolution.
 *
 * Requires the API, worker and MongoDB to be running, and
 * ALLOW_PRIVATE_TARGETS=true so the local target server (127.0.0.1) can be
 * monitored. Run with: npm run smoke
 */
import http from 'node:http';
import { connectDatabase, disconnectDatabase, loadEnv, logger } from '@breakglass/core';

const env = loadEnv();
const API = `http://127.0.0.1:${env.PORT}/api/v1`;
const ORIGIN = env.APP_ORIGIN;
const TARGET_PORT = 9899;
const stamp = Date.now();

let cookie = '';
const results: { name: string; ok: boolean; detail?: string }[] = [];

function record(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function api(path: string, options: { method?: string; body?: unknown } = {}) {
  const response = await fetch(`${API}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      origin: ORIGIN,
      ...(cookie ? { cookie } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await response.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: response.status, body: json };
}

/* ------------------------- target website ------------------------- */

let mode: 'ok' | 'fail' = 'ok';
const requestLog: string[] = [];

function startTarget() {
  const server = http.createServer((req, res) => {
    requestLog.push(`${req.method} ${req.url}`);
    if (mode === 'fail') {
      res.writeHead(500, { 'content-type': 'text/html' });
      res.end('<html><body><h1>Internal Server Error</h1></body></html>');
      return;
    }
    if (req.url === '/json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', version: '1.4.2', items: [{ id: 1 }] }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><body><h1>Example Agency Site</h1><p>Welcome</p></body></html>');
  });
  return new Promise<http.Server>((resolve) => server.listen(TARGET_PORT, '127.0.0.1', () => resolve(server)));
}

async function main() {
  console.log('\nBreakGlass end-to-end smoke test\n');
  await connectDatabase();
  const target = await startTarget();
  const baseUrl = `http://127.0.0.1:${TARGET_PORT}`;

  try {
    /* ---------------- 1. Account + session ---------------- */
    const email = `smoke-${stamp}@example.com`;
    const register = await api('/auth/register', {
      method: 'POST',
      body: { name: 'Smoke Tester', email, password: 'correct-horse-battery-1', workspaceName: 'Smoke Agency' },
    });
    record('register account + workspace', register.status === 201, `HTTP ${register.status}`);
    const workspaceId = register.body?.workspaces?.[0]?.id;
    record('session cookie issued', Boolean(cookie));
    record('no password hash in response', !JSON.stringify(register.body).includes('passwordHash'));

    const me = await api('/auth/me');
    record('GET /auth/me with cookie', me.status === 200 && me.body?.user?.email === email);

    const unauth = await fetch(`${API}/workspaces`, { headers: { origin: ORIGIN } });
    record('protected route rejects anonymous access', unauth.status === 401, `HTTP ${unauth.status}`);

    const badLogin = await api('/auth/login', { method: 'POST', body: { email, password: 'wrong-password-123' } });
    record('invalid credentials rejected', badLogin.status === 401, `HTTP ${badLogin.status}`);

    /* ---------------- 2. Project ---------------- */
    const project = await api(`/workspaces/${workspaceId}/projects`, {
      method: 'POST',
      body: { name: 'Smoke Client Site', url: baseUrl, clientName: 'Smoke Client' },
    });
    record('create project', project.status === 201, `HTTP ${project.status}`);
    const projectId = project.body?.project?.id;

    const blocked = await api(`/workspaces/${workspaceId}/projects`, {
      method: 'POST',
      body: { name: 'Metadata probe', url: 'http://169.254.169.254/latest/meta-data/' },
    });
    record(
      'SSRF: cloud metadata target rejected',
      blocked.status === 400 || blocked.status === 422,
      `HTTP ${blocked.status}`,
    );

    /* -------- 2b. Initial website test (client journey step 4) -------- */
    const initialTest = await api(`/workspaces/${workspaceId}/projects/${projectId}/test`, { method: 'POST' });
    record(
      'initial website test returns the real response',
      initialTest.status === 200 && initialTest.body?.success === true && initialTest.body?.httpStatus === 200,
      `HTTP ${initialTest.status} site=${initialTest.body?.httpStatus} ${initialTest.body?.durationMs}ms`,
    );
    record(
      'initial test never opens an incident',
      (await api(`/workspaces/${workspaceId}/incidents`)).body?.items?.length === 0,
    );

    mode = 'fail';
    const failingTest = await api(`/workspaces/${workspaceId}/projects/${projectId}/test`, { method: 'POST' });
    mode = 'ok';
    record(
      'initial test reports a failing site with a reason and a hint',
      failingTest.status === 200 &&
        failingTest.body?.success === false &&
        failingTest.body?.httpStatus === 500 &&
        Boolean(failingTest.body?.failureCategory) &&
        Boolean(failingTest.body?.hint),
      `category=${failingTest.body?.failureCategory}`,
    );

    /* ---------------- 3. Check configuration ---------------- */
    const checkPayload = {
      name: 'Homepage responds',
      type: 'http',
      intervalSeconds: 60,
      timeoutMs: 8000,
      failureThreshold: 2,
      recoveryThreshold: 2,
      severity: 'major',
      enabled: false,
      config: {
        url: baseUrl,
        method: 'GET',
        expectedStatus: { min: 200, max: 299 },
        followRedirects: true,
        maxRedirects: 5,
        expectedBodyContains: 'Example Agency Site',
        maxResponseBytes: 262144,
      },
    };

    const testRun = await api(`/workspaces/${workspaceId}/projects/${projectId}/checks/test`, {
      method: 'POST',
      body: checkPayload,
    });
    record(
      'configuration test runs against the real site',
      testRun.status === 200 && testRun.body?.success === true,
      `HTTP ${testRun.status} status=${testRun.body?.httpStatus}`,
    );

    const createCheck = await api(`/workspaces/${workspaceId}/projects/${projectId}/checks`, {
      method: 'POST',
      body: checkPayload,
    });
    record('create check', createCheck.status === 201, `HTTP ${createCheck.status}`);
    const checkId = createCheck.body?.check?.id;
    record('check starts disabled until activated', createCheck.body?.check?.enabled === false);

    const activate = await api(`/workspaces/${workspaceId}/checks/${checkId}`, {
      method: 'PATCH',
      body: { enabled: true },
    });
    record('activate monitoring', activate.status === 200 && activate.body?.check?.enabled === true);
    record(
      'activation schedules the next run',
      Boolean(activate.body?.check?.nextRunAt),
      activate.body?.check?.nextRunAt,
    );

    /* ---------------- 4. API check with JSON assertion ---------------- */
    const apiCheck = await api(`/workspaces/${workspaceId}/projects/${projectId}/checks`, {
      method: 'POST',
      body: {
        name: 'API health endpoint',
        type: 'api',
        intervalSeconds: 300,
        timeoutMs: 8000,
        failureThreshold: 2,
        recoveryThreshold: 2,
        severity: 'minor',
        enabled: false,
        config: {
          url: `${baseUrl}/json`,
          method: 'GET',
          headers: [{ name: 'Authorization', value: 'Bearer smoke-secret', sensitive: true }],
          bodyType: 'none',
          expectedStatus: { min: 200, max: 299 },
          jsonAssertions: [{ path: 'status', operator: 'equals', value: 'ok' }],
          followRedirects: true,
          maxRedirects: 5,
          maxResponseBytes: 262144,
        },
      },
    });
    record('create API check with encrypted header', apiCheck.status === 201, `HTTP ${apiCheck.status}`);
    record(
      'secret header value never returned',
      !JSON.stringify(apiCheck.body).includes('smoke-secret'),
    );

    const apiTest = await api(`/workspaces/${workspaceId}/projects/${projectId}/checks/test`, {
      method: 'POST',
      body: {
        ...checkPayload,
        name: 'API assertion test',
        type: 'api',
        config: {
          url: `${baseUrl}/json`,
          method: 'GET',
          headers: [],
          bodyType: 'none',
          expectedStatus: { min: 200, max: 299 },
          jsonAssertions: [{ path: 'status', operator: 'equals', value: 'ok' }],
          followRedirects: true,
          maxRedirects: 5,
          maxResponseBytes: 262144,
        },
      },
    });
    record('API JSON assertion succeeds', apiTest.body?.success === true, JSON.stringify(apiTest.body?.evidence?.json ?? {}).slice(0, 120));

    /* ---------------- 5. Worker pipeline: failure → incident ---------------- */
    const { processCheckRun, processDelivery, Incident, NotificationDelivery, CheckRun } = await import('@breakglass/core');

    const firstHealthy = await processCheckRun({ checkId, triggeredBy: 'schedule', jobId: 'smoke-seed', attempt: 1 });
    record('worker executes a real check run', firstHealthy.ran === true && firstHealthy.success === true, firstHealthy.runId);

    mode = 'fail';
    const fail1 = await processCheckRun({ checkId, triggeredBy: 'schedule', jobId: 'smoke-f1', attempt: 1 });
    const fail2 = await processCheckRun({ checkId, triggeredBy: 'schedule', jobId: 'smoke-f2', attempt: 1 });
    record('failure detected (HTTP 500)', fail1.success === false && fail2.success === false);

    const incident = await Incident.findOne({ checkId, activeKey: 'active' });
    record('incident opened after the failure threshold', Boolean(incident), incident?.status);
    record('incident records the observed failure', Boolean(incident?.summary?.includes('500')), incident?.summary?.slice(0, 90));

    const fail3 = await processCheckRun({ checkId, triggeredBy: 'schedule', jobId: 'smoke-f3', attempt: 1 });
    const incidentCount = await Incident.countDocuments({ checkId });
    record('continued failures do not duplicate the incident', incidentCount === 1, `count=${incidentCount}`);
    void fail3;

    const deliveries = await NotificationDelivery.find({ incidentId: incident?._id });
    record('incident notification queued', deliveries.length > 0, `${deliveries.length} delivery record(s)`);
    const openedDelivery = deliveries.find((delivery) => delivery.eventType === 'incident_opened');
    record('exactly one "incident opened" email per incident', deliveries.filter((d) => d.eventType === 'incident_opened').length === 1);

    if (openedDelivery) {
      const delivered = await processDelivery(String(openedDelivery._id));
      const refreshed = await NotificationDelivery.findById(openedDelivery._id);
      record(
        'notification processed by the delivery worker',
        delivered.ok && refreshed?.status === 'sent',
        `${refreshed?.provider}`,
      );
    }

    /* ---------------- 6. Recovery ---------------- */
    mode = 'ok';
    await processCheckRun({ checkId, triggeredBy: 'schedule', jobId: 'smoke-r1', attempt: 1 });
    const afterFirstRecovery = await Incident.findById(incident?._id);
    record('single success starts recovery verification, not resolution', afterFirstRecovery?.status === 'recovering', afterFirstRecovery?.status);

    await processCheckRun({ checkId, triggeredBy: 'schedule', jobId: 'smoke-r2', attempt: 1 });
    const resolved = await Incident.findById(incident?._id);
    record('incident resolved only after recovery threshold', resolved?.status === 'resolved' && Boolean(resolved?.resolvedAt));

    const resolveDelivery = await NotificationDelivery.findOne({ incidentId: incident?._id, eventType: 'incident_resolved' });
    record('resolution notification queued', Boolean(resolveDelivery), resolveDelivery?.status);

    /* ---------------- 7. Dashboard data from real records ---------------- */
    const dashboard = await api(`/workspaces/${workspaceId}/dashboard`);
    record(
      'dashboard reflects persisted monitoring data',
      dashboard.status === 200 && dashboard.body?.stats?.projectCount === 1 && dashboard.body?.stats?.last24h?.runs >= 5,
      `projects=${dashboard.body?.stats?.projectCount} runs24h=${dashboard.body?.stats?.last24h?.runs}`,
    );

    const runs = await CheckRun.countDocuments({ checkId });
    record('run history persisted', runs >= 6, `${runs} runs`);

    /* ---------------- 8. Tenant isolation ---------------- */
    const second = await api('/auth/register', {
      method: 'POST',
      body: { name: 'Other Tenant', email: `other-${stamp}@example.com`, password: 'another-strong-pass-1' },
    });
    const otherWorkspaceId = second.body?.workspaces?.[0]?.id;
    const steal = await api(`/workspaces/${workspaceId}/projects`, {
      method: 'GET',
      body: undefined,
    });
    void steal;
    const crossProject = await api(`/workspaces/${otherWorkspaceId}/projects/${projectId}`);
    record('cross-workspace project access denied', crossProject.status === 404, `HTTP ${crossProject.status}`);
    const crossIncident = await api(`/workspaces/${otherWorkspaceId}/incidents/${incident?._id}`);
    record('cross-workspace incident access denied', crossIncident.status === 404, `HTTP ${crossIncident.status}`);
    const crossCheck = await api(`/workspaces/${otherWorkspaceId}/checks/${checkId}`, { method: 'PATCH', body: { enabled: false } });
    record('cross-workspace check modification denied', crossCheck.status === 404, `HTTP ${crossCheck.status}`);

    /* ---------------- 9. CSRF ---------------- */
    const csrf = await fetch(`${API}/workspaces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: 'https://evil.example' },
      body: JSON.stringify({ name: 'Evil' }),
    });
    record('cross-origin state change rejected', csrf.status === 403, `HTTP ${csrf.status}`);
  } catch (error) {
    record('smoke run completed without exceptions', false, (error as Error).message);
    logger().error({ err: (error as Error).stack }, 'Smoke failure');
  } finally {
    target.close();
    await disconnectDatabase();
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed\n`);
  process.exit(failed.length === 0 ? 0 : 1);
}

void main();
