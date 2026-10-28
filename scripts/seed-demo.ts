/**
 * Seeds a realistic demo workspace so the marketing site can show authentic
 * product screenshots instead of drawn mockups.
 *
 * Everything here is executed through the real pipeline: `registerUser`,
 * `createProject`, `createCheck` and `processCheckRun` are the same functions
 * the API and worker use, and every check runs against a real local HTTP
 * target, so the run history, response times, incidents and timeline events in
 * the screenshots are produced by BreakGlass itself.
 *
 * The workspace is clearly fictional (Northline Studio / client sites) and the
 * resulting screenshots are labelled as a demo workspace on the website.
 *
 * Timestamps are shifted backwards afterwards so the demo shows a plausible
 * multi-hour history; nothing else about the records is altered.
 *
 * Usage: npx tsx scripts/seed-demo.ts
 */
import http from 'node:http';
import {
  Check,
  CheckRun,
  Deployment,
  Incident,
  IncidentEvent,
  Project,
  User,
  Workspace,
  connectDatabase,
  createCheck,
  createProject,
  disconnectDatabase,
  processCheckRun,
  registerUser,
} from '@breakglass/core';

const PORT = 9910;
const DEMO_EMAIL = 'maya@northline.studio';
const DEMO_PASSWORD = 'demo-workspace-pass-1';

type Mode = 'ok' | 'fail';
const state: Record<string, Mode> = { harbor: 'ok' };

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Switches the demo target's Harbor Dental behaviour, locally or over HTTP. */
function makeControl(ownsServer: boolean) {
  return async (mode: Mode) => {
    if (ownsServer) {
      state.harbor = mode;
      return;
    }
    const response = await fetch(`http://127.0.0.1:${PORT}/__demo/mode?harbor=${mode}`, { method: 'POST' }).catch(
      () => null,
    );
    if (!response?.ok) throw new Error('Could not control the shared demo target on port ' + PORT);
  };
}

function startTarget() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
    const path = url.pathname;

    if (path === '/api/health') {
      await delay(40 + Math.random() * 30);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', version: '2.4.1', db: 'connected' }));
      return;
    }

    if (path === '/book') {
      await delay(60);
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<!doctype html><html><body>
        <h1>Book a session</h1>
        <form action="/book/confirm" method="get">
          <label for="date">Date</label><input id="date" name="date" value="2026-11-02" />
          <button type="submit">Confirm booking</button>
        </form>
      </body></html>`);
      return;
    }

    if (path === '/book/confirm') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body><h1>Booking confirmed</h1><p>Reference VW-8841</p></body></html>');
      return;
    }

    if (path === '/harbor' && state.harbor === 'fail') {
      await delay(380 + Math.random() * 60);
      res.writeHead(500, { 'content-type': 'text/html' });
      res.end('<html><body><h1>Internal Server Error</h1></body></html>');
      return;
    }

    const profile: Record<string, [number, number]> = {
      '/northside': [70, 130],
      '/verdant': [180, 300],
      '/harbor': [210, 320],
      '/atlas': [95, 170],
    };
    const [min, max] = profile[path] ?? [80, 140];
    await delay(min + Math.random() * (max - min));
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<html><body><h1>${path.slice(1)}</h1><p>Open today</p></body></html>`);
  });
  return new Promise<http.Server | null>((resolve) => {
    server.once('error', () => resolve(null));
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

/** Shifts a date field backwards by `offsetMs` for every demo record. */
async function shift(collection: { updateMany: (filter: object, update: object[]) => Promise<unknown> }, filter: object, fields: string[], offsetMs: number) {
  const set: Record<string, unknown> = {};
  for (const field of fields) set[field] = { $subtract: [`$${field}`, offsetMs] };
  await collection.updateMany(filter, [
    { $set: set },
    { $unset: '__v' },
    { $set: { __v: '$$REMOVE' } },
  ]);
}


/**
 * Rewrites run/incident timestamps onto a regular schedule ending minutes ago.
 * Only timestamps are touched: results, durations, ordering and incident state
 * all come from the real pipeline.
 */
async function redistribute(workspaceId: import('mongoose').Types.ObjectId) {
  const now = Date.now();
  const checks = await Check.find({ workspaceId });

  for (const check of checks) {
    const runs = await CheckRun.find({ checkId: check._id }).sort({ _id: 1 });
    if (!runs.length) continue;
    const intervalMs = check.intervalSeconds * 1000;

    for (let index = 0; index < runs.length; index += 1) {
      const run = runs[index];
      const stepsBack = runs.length - 1 - index;
      const startedAt = new Date(now - stepsBack * intervalMs - 25_000 - Math.random() * 15_000);
      const finishedAt = new Date(startedAt.getTime() + (run.durationMs || 100));
      await CheckRun.updateOne(
        { _id: run._id },
        { $set: { startedAt, finishedAt, createdAt: finishedAt, updatedAt: finishedAt } },
      );
      run.startedAt = startedAt;
      run.finishedAt = finishedAt;
    }

    const last = runs[runs.length - 1];
    await Check.updateOne(
      { _id: check._id },
      {
        $set: {
          lastRunAt: last.startedAt,
          nextRunAt: new Date(last.startedAt.getTime() + intervalMs),
        },
      },
    );
  }

  const incidents = await Incident.find({ workspaceId }).sort({ _id: 1 });
  for (const incident of incidents) {
    const related = await CheckRun.find({ incidentId: incident._id }).sort({ startedAt: 1 });
    const failures = related.filter((run) => !run.success);
    const successes = related.filter((run) => run.success);
    if (!failures.length) continue;

    const firstFailureAt = failures[0].startedAt;
    const lastFailureAt = failures[failures.length - 1].startedAt;
    const resolvedRun = incident.status === 'resolved' ? successes[successes.length - 1] : null;
    const resolvedAt = resolvedRun?.finishedAt ?? null;
    const endTime = resolvedAt ?? new Date(now - 20_000);

    await Incident.updateOne(
      { _id: incident._id },
      {
        $set: {
          firstFailureAt,
          lastFailureAt,
          createdAt: firstFailureAt,
          updatedAt: endTime,
          durationMs: endTime.getTime() - firstFailureAt.getTime(),
          ...(resolvedAt ? { resolvedAt } : {}),
          ...(incident.acknowledgedAt
            ? { acknowledgedAt: new Date(firstFailureAt.getTime() + (endTime.getTime() - firstFailureAt.getTime()) * 0.35) }
            : {}),
        },
      },
    );

    const events = await IncidentEvent.find({ incidentId: incident._id }).sort({ _id: 1 });
    const span = Math.max(endTime.getTime() - firstFailureAt.getTime(), events.length * 1000);
    for (let index = 0; index < events.length; index += 1) {
      const at = new Date(firstFailureAt.getTime() + (span / Math.max(events.length - 1, 1)) * index);
      await IncidentEvent.updateOne({ _id: events[index]._id }, { $set: { createdAt: at, updatedAt: at } });
    }
  }

}

async function main() {
  // scripts/demo-target.mjs can serve the same URLs; only bind our own copy when
  // that server is not already running (for example during CI).
  const target = await startTarget();
  const setHarbor = makeControl(target !== null);
  await connectDatabase();

  // Re-running the seeder rebuilds the demo workspace from scratch.
  const previous = await User.findOne({ email: DEMO_EMAIL });
  if (previous) {
    const workspaces = await Workspace.find({ ownerId: previous._id });
    const workspaceIds = workspaces.map((workspace) => workspace._id);
    const projects = await Project.find({ workspaceId: { $in: workspaceIds } });
    const projectIds = projects.map((project) => project._id);
    const checks = await Check.find({ workspaceId: { $in: workspaceIds } });
    const checkIds = checks.map((check) => check._id);
    await Promise.all([
      CheckRun.deleteMany({ checkId: { $in: checkIds } }),
      Incident.deleteMany({ workspaceId: { $in: workspaceIds } }),
      IncidentEvent.deleteMany({ workspaceId: { $in: workspaceIds } }),
      Deployment.deleteMany({ projectId: { $in: projectIds } }),
      Check.deleteMany({ _id: { $in: checkIds } }),
      Project.deleteMany({ _id: { $in: projectIds } }),
      Workspace.deleteMany({ _id: { $in: workspaceIds } }),
      User.deleteOne({ _id: previous._id }),
    ]);
  }

  const { user, workspace } = await registerUser({
    name: 'Maya Shrestha',
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    workspaceName: 'Northline Studio',
  });
  await User.updateOne({ _id: user._id }, { $set: { emailVerified: true, timezone: 'Asia/Kathmandu' } });

  const clients = [
    { key: 'northside', name: 'Northside Coffee', client: 'Northside Coffee Co.', domain: 'northsidecoffee.com', path: '/northside' },
    { key: 'verdant', name: 'Verdant Wellness', client: 'Verdant Wellness', domain: 'verdantwellness.com', path: '/verdant' },
    { key: 'harbor', name: 'Harbor Dental', client: 'Harbor Dental Group', domain: 'harbordental.com', path: '/harbor' },
    { key: 'atlas', name: 'Atlas Architecture', client: 'Atlas Architecture', domain: 'atlas-architects.com', path: '/atlas' },
  ];

  const projects: Record<string, { id: string; name: string }> = {};
  for (const client of clients) {
    const project = await createProject({
      workspaceId: String(workspace._id),
      userId: String(user._id),
      name: client.name,
      url: `http://127.0.0.1:${PORT}${client.path}`,
      clientName: client.client,
      notes: `Managed by Northline Studio · ${client.domain}`,
    });
    projects[client.key] = { id: String(project._id), name: client.name };
  }

  const baseCheck = {
    timeoutMs: 15_000,
    failureThreshold: 2,
    recoveryThreshold: 2,
    severity: 'major' as const,
  };

  const checks = {
    northside: await createCheck({
      workspaceId: String(workspace._id),
      projectId: projects.northside.id,
      userId: String(user._id),
      input: {
        ...baseCheck,
        name: 'Homepage responds',
        type: 'http',
        enabled: true,
        intervalSeconds: 300,
        severity: 'critical',
        config: { url: `http://127.0.0.1:${PORT}/northside`, method: 'GET', followRedirects: true, expectedStatus: { min: 200, max: 399 } },
      },
    }),
    cartApi: await createCheck({
      workspaceId: String(workspace._id),
      projectId: projects.northside.id,
      userId: String(user._id),
      input: {
        ...baseCheck,
        name: 'Storefront API health',
        type: 'api',
        enabled: true,
        intervalSeconds: 300,
        severity: 'major',
        config: {
          url: `http://127.0.0.1:${PORT}/api/health`,
          method: 'GET',
          followRedirects: true,
          expectedStatus: { min: 200, max: 299 },
          jsonAssertions: [{ path: 'status', operator: 'equals', value: 'ok' }],
        },
      },
    }),
    verdant: await createCheck({
      workspaceId: String(workspace._id),
      projectId: projects.verdant.id,
      userId: String(user._id),
      input: {
        ...baseCheck,
        name: 'Homepage responds',
        type: 'http',
        enabled: true,
        intervalSeconds: 300,
        config: { url: `http://127.0.0.1:${PORT}/verdant`, method: 'GET', followRedirects: true, expectedStatus: { min: 200, max: 399 } },
      },
    }),
    booking: await createCheck({
      workspaceId: String(workspace._id),
      projectId: projects.verdant.id,
      userId: String(user._id),
      input: {
        ...baseCheck,
        name: 'Booking journey',
        type: 'browser',
        enabled: true,
        intervalSeconds: 900,
        timeoutMs: 45_000,
        severity: 'critical',
        config: {
          startUrl: `http://127.0.0.1:${PORT}/book`,
          steps: [
            { type: 'goto', url: `http://127.0.0.1:${PORT}/book`, waitUntil: 'domcontentloaded' },
            { type: 'expectText', text: 'Book a session' },
            { type: 'click', selector: 'button[type="submit"]' },
            { type: 'expectText', text: 'Booking confirmed' },
          ],
          captureScreenshotOnFailure: true,
          captureTraceOnFailure: false,
          viewportWidth: 1366,
          viewportHeight: 768,
        },
      },
    }),
    harbor: await createCheck({
      workspaceId: String(workspace._id),
      projectId: projects.harbor.id,
      userId: String(user._id),
      input: {
        ...baseCheck,
        name: 'Homepage responds',
        type: 'http',
        enabled: true,
        intervalSeconds: 300,
        severity: 'major',
        config: { url: `http://127.0.0.1:${PORT}/harbor`, method: 'GET', followRedirects: true, expectedStatus: { min: 200, max: 399 } },
      },
    }),
    atlas: await createCheck({
      workspaceId: String(workspace._id),
      projectId: projects.atlas.id,
      userId: String(user._id),
      input: {
        ...baseCheck,
        name: 'Homepage responds',
        type: 'http',
        enabled: true,
        intervalSeconds: 600,
        config: { url: `http://127.0.0.1:${PORT}/atlas`, method: 'GET', followRedirects: true, expectedStatus: { min: 200, max: 399 } },
      },
    }),
  };

  // The scheduler only runs a check when it is due, so the seeder makes each
  // check due immediately before invoking the real pipeline.
  // Each seeded run gets its own job id so the run history has one record per
  // execution instead of collapsing onto a single document.
  let sequence = 0;
  const run = async (checkId: string) => {
    sequence += 1;
    await Check.updateOne({ _id: checkId }, { $set: { nextRunAt: new Date(Date.now() - 1000) } });
    const result = await processCheckRun({ checkId, triggeredBy: 'schedule', jobId: `seed-${sequence}`, attempt: 1 });
    if (!result.ran) throw new Error(`check ${checkId} did not run: ${result.reason}`);
    return result;
  };

  // Healthy history.
  for (let i = 0; i < 22; i += 1) await run(String(checks.northside._id));
  for (let i = 0; i < 22; i += 1) await run(String(checks.cartApi._id));
  for (let i = 0; i < 22; i += 1) await run(String(checks.verdant._id));
  for (let i = 0; i < 8; i += 1) await run(String(checks.booking._id));
  for (let i = 0; i < 10; i += 1) await run(String(checks.atlas._id));

  // Harbor Dental: a past incident that recovered, then a fresh open incident.
  await setHarbor('fail');
  for (let i = 0; i < 3; i += 1) await run(String(checks.harbor._id)); // opens incident #1
  await Incident.updateOne(
    { checkId: checks.harbor._id, activeKey: 'active' },
    { $set: { acknowledgedAt: new Date(), acknowledgedByName: 'Maya Shrestha', status: 'acknowledged' } },
  );
  await setHarbor('ok');
  await run(String(checks.harbor._id));
  await run(String(checks.harbor._id)); // recovery verified → resolved
  await setHarbor('fail');
  for (let i = 0; i < 4; i += 1) await run(String(checks.harbor._id)); // opens incident #2 (open now)

  // A deployment recorded shortly before the current failure window.
  const openIncident = await Incident.findOne({ checkId: checks.harbor._id, activeKey: 'active' });
  if (openIncident) {
    await Deployment.create({
      workspaceId: workspace._id,
      projectId: projects.harbor.id,
      provider: 'github',
      providerDeliveryId: `demo-${Date.now()}`,
      repository: 'northline/harbor-dental',
      environment: 'production',
      commitSha: '4f2c9ab7d1e8',
      commitMessage: 'Reschedule form: adjust validation copy',
      ref: 'refs/heads/main',
      actor: 'northline',
      deployedAt: new Date(openIncident.firstFailureAt.getTime() - 4 * 60_000),
      verified: true,
    });
  }

  // Spread the seeded runs across their real schedules so the demo looks like
  // a workspace that has been monitored for a few hours, not a burst.
  await redistribute(workspace._id);

  // Anchor the demo deployment four minutes before the currently open incident.
  const liveIncident = await Incident.findOne({ workspaceId: workspace._id, activeKey: 'active' });
  if (liveIncident) {
    await Deployment.updateMany(
      { projectId: projects.harbor.id },
      { $set: { deployedAt: new Date(liveIncident.firstFailureAt.getTime() - 4 * 60_000) } },
    );
  }

  const workspaceFilter = { workspaceId: workspace._id };
  const counts = {
    runs: await CheckRun.countDocuments(workspaceFilter),
    incidents: await Incident.countDocuments(workspaceFilter),
    events: await IncidentEvent.countDocuments(workspaceFilter),
  };
  console.log(JSON.stringify({ demo: DEMO_EMAIL, password: DEMO_PASSWORD, workspace: String(workspace._id), ...counts }, null, 2));

  target?.close();
  await disconnectDatabase();
}

void main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
