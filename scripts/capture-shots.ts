/**
 * Captures authentic screenshots of the BreakGlass application for the
 * marketing site. Uses the seeded demo workspace (scripts/seed-demo.ts) and the
 * real UI — nothing is mocked or redrawn.
 *
 * Run the worker stopped so the captured state stays frozen while shooting:
 *   kill "$(cat .data/worker.pid)"; npm run shots; ./scripts/restart-stack.sh
 *
 * Usage: npx tsx scripts/capture-shots.ts
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const WEB = process.env.WEB_ORIGIN ?? 'http://127.0.0.1:5173';
const OUT = path.resolve('apps/web/public/shots');
const DEMO_EMAIL = 'maya@northline.studio';
const DEMO_PASSWORD = 'demo-workspace-pass-1';

const headers = { origin: WEB, 'content-type': 'application/json', 'x-requested-with': 'breakglass-web' };

async function main() {
  await fs.mkdir(OUT, { recursive: true });

  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 2,
    colorScheme: 'light',
  });
  const page = await context.newPage();

  const login = await page.request.post(`${WEB}/api/v1/auth/login`, {
    headers,
    data: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
  });
  if (!login.ok()) throw new Error(`login failed: ${login.status()} ${await login.text()}`);

  const me = await (await page.request.get(`${WEB}/api/v1/auth/me`, { headers })).json();
  const workspaceId = me.workspaces[0].id as string;
  const projects = await (await page.request.get(`${WEB}/api/v1/workspaces/${workspaceId}/projects`, { headers })).json();
  const harbor = (projects.projects as { id: string; name: string }[]).find((project) => project.name === 'Harbor Dental');
  const incidents = await (await page.request.get(`${WEB}/api/v1/workspaces/${workspaceId}/incidents?status=all&limit=5`, { headers })).json();
  const items = incidents.items as { id: string; status: string }[];
  const openIncident = items.find((item) => item.status !== 'resolved');
  const resolvedIncident = items.find((item) => item.status === 'resolved');
  if (!harbor || !openIncident || !resolvedIncident) throw new Error('demo workspace is not seeded correctly');

  async function shoot(name: string, url: string, opts: { fullPage?: boolean; wait?: number } = {}) {
    await page.goto(`${WEB}${url}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(opts.wait ?? 1800);
    const file = path.join(OUT, `${name}.jpg`);
    await page.screenshot({ path: file, fullPage: opts.fullPage ?? false, type: 'jpeg', quality: 74 });
    const { size } = await fs.stat(file);
    console.log(`  ${name}.jpg  ${(size / 1024).toFixed(0)} KB`);
  }

  console.log('Capturing:');
  await shoot('overview', '/app', { wait: 2400 });
  await shoot('project', `/app/projects/${harbor.id}`, { wait: 2400 });
  await shoot('incident', `/app/incidents/${openIncident.id}`, { wait: 2400 });
  await shoot('incidents', '/app/incidents', { wait: 1800 });
  await shoot('resolved', `/app/incidents/${resolvedIncident.id}`, { wait: 2400 });

  await browser.close();
  console.log(`\nSaved to ${OUT}`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
