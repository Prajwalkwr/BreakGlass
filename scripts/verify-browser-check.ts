/**
 * End-to-end verification of the browser-journey check type.
 *
 * Proves, against the running stack:
 *   • a Playwright journey really executes inside the worker process
 *   • a failing journey captures a screenshot artifact in private storage
 *   • the artifact is only reachable through a short-lived signed URL
 *   • stored login credentials are used but never returned by the API
 *
 * Usage: npx tsx scripts/verify-browser-check.ts  (API + worker running)
 */
import http from 'node:http';
import { API_URL, authedFetch, registerFreshUser, sleep } from './lib/e2e';

const PORT = 9899;
const results: { name: string; ok: boolean; detail?: string }[] = [];

function record(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
}

/* A tiny site with a login form, so the journey can use a real credential. */
function startSite() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);

    if (url.pathname === '/login' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const params = new URLSearchParams(body);
        if (params.get('user') === 'ana@agency.test' && params.get('pass') === 'journey-secret-123') {
          res.writeHead(302, { location: '/dashboard', 'set-cookie': 'session=abc; Path=/' });
          res.end();
        } else {
          res.writeHead(200, { 'content-type': 'text/html' });
          res.end('<html><body><h1 id="error">Invalid credentials</h1></body></html>');
        }
      });
      return;
    }

    if (url.pathname === '/dashboard') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body><h1>Welcome back, Ana</h1><p id="billing">Invoices: 3</p></body></html>');
      return;
    }

    if (url.pathname === '/broken') {
      res.writeHead(500, { 'content-type': 'text/html' });
      res.end('<html><body><h1>Server error</h1></body></html>');
      return;
    }

    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<html><body>
      <h1>Northside Coffee</h1>
      <form method="post" action="/login">
        <input name="user" aria-label="Email" />
        <input name="pass" type="password" aria-label="Password" />
        <button type="submit">Sign in</button>
      </form>
    </body></html>`);
  });
  return new Promise<http.Server>((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

async function main() {
  const site = await startSite();
  try {
    const auth = await registerFreshUser('Browser Check');
    const workspace = auth.workspaceId;

    const project = await authedFetch(auth, 'POST', `/workspaces/${workspace}/projects`, {
      name: 'Journey Site',
      url: `http://127.0.0.1:${PORT}`,
    });
    const projectId = project.body.project.id as string;

    const secret = await authedFetch(auth, 'POST', `/workspaces/${workspace}/projects/${projectId}/secrets`, {
      purpose: 'login_password',
      label: 'Site login password',
      value: 'journey-secret-123',
    });
    const secretId = secret.body.id ?? secret.body.secret?.id;
    record('login credential stored (encrypted)', Boolean(secretId), String(secretId ?? secret.status));

    const checkPayload = {
      name: 'Client login journey',
      type: 'browser',
      enabled: false,
      intervalSeconds: 300,
      timeoutMs: 45_000,
      failureThreshold: 1,
      recoveryThreshold: 1,
      severity: 'critical',
      config: {
        startUrl: `http://127.0.0.1:${PORT}/`,
        steps: [
          { type: 'goto', url: `http://127.0.0.1:${PORT}/`, waitUntil: 'domcontentloaded' },
          { type: 'fill', selector: 'input[name="user"]', value: 'ana@agency.test' },
          { type: 'fill', selector: 'input[name="pass"]', secretRef: String(secretId) },
          { type: 'click', selector: 'button[type="submit"]' },
          { type: 'expectUrl', contains: '/dashboard' },
          { type: 'expectText', text: 'Welcome back' },
        ],
        captureScreenshotOnFailure: true,
        captureTraceOnFailure: false,
        viewportWidth: 1280,
        viewportHeight: 800,
      },
    };

    // 1. Configuration test (does not persist anything).
    const test = await authedFetch(auth, 'POST', `/workspaces/${workspace}/projects/${projectId}/checks/test`, checkPayload);
    record(
      'browser journey passes against the real site',
      test.body.success === true,
      `${test.body.durationMs}ms, ${test.body.evidence?.steps?.length ?? 0} steps`,
    );
    record(
      'stored password is never returned by the API',
      !JSON.stringify(test.body).includes('journey-secret-123'),
    );

    // 2. Create + activate the check, then let the scheduler run it.
    const created = await authedFetch(auth, 'POST', `/workspaces/${workspace}/projects/${projectId}/checks`, checkPayload);
    const checkId = created.body.check.id as string;
    await authedFetch(auth, 'PATCH', `/workspaces/${workspace}/checks/${checkId}`, { enabled: true });

    let run: Record<string, unknown> | null = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await sleep(2000);
      const runs = await authedFetch(auth, 'GET', `/workspaces/${workspace}/checks/${checkId}/runs?limit=5`);
      const items = (runs.body.runs ?? []) as Record<string, unknown>[];
      const found = items.find((item) => item.triggeredBy === 'schedule');
      if (found) {
        run = found;
        break;
      }
    }
    record('scheduler ran the browser journey', Boolean(run), run ? `${run.durationMs}ms success=${run.success}` : 'no scheduled run');
    record('scheduled browser run succeeded', run?.success === true);

    // 3. Break the journey and capture evidence.
    await authedFetch(auth, 'PATCH', `/workspaces/${workspace}/checks/${checkId}`, {
      config: {
        ...checkPayload.config,
        steps: [
          { type: 'goto', url: `http://127.0.0.1:${PORT}/broken`, waitUntil: 'domcontentloaded' },
          { type: 'expectText', text: 'Welcome back' },
        ],
      },
    });
    await authedFetch(auth, 'PATCH', `/workspaces/${workspace}/checks/${checkId}`, { enabled: true });

    let failedRun: Record<string, unknown> | null = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await sleep(2000);
      const runs = await authedFetch(auth, 'GET', `/workspaces/${workspace}/checks/${checkId}/runs?limit=5`);
      const items = (runs.body.runs ?? []) as Record<string, unknown>[];
      const found = items.find((item) => item.success === false);
      if (found) {
        failedRun = found;
        break;
      }
    }
    record('failing journey is recorded', Boolean(failedRun), failedRun ? String(failedRun.failureCategory) : 'none');

    const artifacts = (failedRun?.artifacts ?? []) as { id: string; kind: string; bytes: number }[];
    record(
      'screenshot evidence captured on failure',
      artifacts.some((artifact) => artifact.kind === 'screenshot'),
      artifacts.map((artifact) => `${artifact.kind}:${artifact.bytes}b`).join(', ') || 'none',
    );

    // 4. Signed URL access, and refusal without a signature.
    const signed = await authedFetch(auth, 'GET', `/workspaces/${workspace}/artifacts?runId=${failedRun?.runId}`);
    const first = (signed.body.artifacts ?? [])[0] as { url: string; expiresAt: string } | undefined;
    record('signed artifact URL issued', Boolean(first?.url), first?.expiresAt ?? '');

    if (first) {
      const absolute = first.url.startsWith('http') ? first.url : `${API_URL}${first.url}`;
      const ok = await fetch(absolute, { headers: { cookie: auth.cookie } });
      record('signed URL returns the image', ok.ok, `${ok.status} ${ok.headers.get('content-type')}`);
      record('signed URL response is private and non-cacheable', /no-store/.test(ok.headers.get('cache-control') ?? ''), ok.headers.get('cache-control') ?? '');

      const tampered = absolute.replace(/sig=[^&]+/, 'sig=deadbeef');
      const bad = await fetch(tampered, { headers: { cookie: auth.cookie } });
      record('tampered signature is rejected', bad.status === 403 || bad.status === 401, String(bad.status));

      const anonymous = await fetch(absolute);
      record('signed URL still requires a session', anonymous.status === 401 || anonymous.status === 403, String(anonymous.status));
    }

    // 5. Evidence redaction: headers must not leak back to the client.
    const detail = await authedFetch(auth, 'GET', `/workspaces/${workspace}/projects/${projectId}`);
    record('project detail never echoes the stored secret', !JSON.stringify(detail.body).includes('journey-secret-123'));
  } finally {
    site.close();
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} browser-check assertions passed\n`);
  process.exit(failed.length === 0 ? 0 : 1);
}

void main();
