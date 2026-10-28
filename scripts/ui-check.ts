/**
 * UI verification pass.
 *
 * Drives the real application in Chromium: marketing page → signup → add a
 * website → scan public pages → configure an additional check → activate →
 * wait for the scheduler → force a failure → verify the incident UI. Captures screenshots and fails on
 * console errors, unhandled rejections, layout overflow or missing content.
 *
 * Usage: npx tsx scripts/ui-check.ts   (API + web dev server must be running)
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { chromium, type ConsoleMessage, type Page } from 'playwright';

const WEB = process.env.WEB_ORIGIN ?? 'http://127.0.0.1:5173';
const TARGET_PORT = 9898;
const OUT = path.resolve('.data/screens');
const stamp = Date.now();
const results: { name: string; ok: boolean; detail?: string }[] = [];

function record(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
}

let mode: 'ok' | 'fail' = 'ok';
function startTarget() {
  const server = http.createServer((req, res) => {
    if (mode === 'fail') {
      res.writeHead(500, { 'content-type': 'text/html' });
      res.end('<html><body><h1>Internal Server Error</h1></body></html>');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><body><h1>Northside Coffee</h1><p>Open today</p></body></html>');
  });
  return new Promise<http.Server>((resolve) => server.listen(TARGET_PORT, '127.0.0.1', () => resolve(server)));
}

async function shot(page: Page, name: string, fullPage = true) {
  await fs.mkdir(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const target = await startTarget();
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

  try {
    /* ------------------------- Marketing ------------------------- */
    await page.goto(WEB, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    const hero = (await page.locator('h1').first().innerText()).replace(/\s+/g, ' ');
    record('landing hero renders', /KNOW WHEN YOUR CLIENTS/i.test(hero), hero.slice(0, 60));
    await shot(page, '01-landing');

    record('marketing nav visible', await page.locator('header').first().isVisible());

    await page.evaluate(() => window.scrollTo(0, window.innerHeight * 1.1));
    await page.waitForTimeout(900);
    await shot(page, '02-landing-sections');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(900);
    await shot(page, '03-landing-footer');

    /* -------------------------- Signup --------------------------- */
    await page.goto(`${WEB}/signup`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await shot(page, '04-signup');

    const email = `ui-${stamp}@example.com`;
    await page.getByLabel('Your name').fill('UI Tester');
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Agency or workspace name').fill('UI Agency');
    await page.locator('input#password').fill('supreme-test-password-1');
    await page.locator('input#confirmPassword').fill('supreme-test-password-1');
    await page.getByRole('button', { name: /create account/i }).click();

    await page.waitForURL('**/app', { timeout: 25_000 });
    record('signup lands on the dashboard', true);
    await page.waitForTimeout(1500);
    await shot(page, '05-dashboard-empty');
    record('new workspace shows an honest empty state', await page.getByText(/add your first client website/i).first().isVisible());

    /* ------------------------ Add website ------------------------ */
    await page.goto(`${WEB}/app/projects/new`, { waitUntil: 'networkidle' });
    await page.getByLabel('Website name').fill('Northside Coffee');
    await page.getByLabel('Website URL').fill(`http://127.0.0.1:${TARGET_PORT}`);
    await page.getByLabel('Client name (optional)').fill('Northside Coffee Co.');
    await shot(page, '06-add-website');
    await page.getByRole('main').getByRole('button', { name: /^add website$/i }).click();
    await page.getByText('Public page scan — Northside Coffee').waitFor({ state: 'visible', timeout: 45_000 });
    await page.getByText(/1 page responded/).waitFor({ state: 'visible', timeout: 15_000 });
    await page.getByRole('button', { name: /add a custom check/i }).click();

    await page.waitForSelector('text=First check for Northside Coffee', { timeout: 20_000 });
    record('project created, pages scanned, custom check step shown', true);

    /* ----------------------- Configure check --------------------- */
    await page.getByLabel('Check name').fill('Homepage responds');
    await page.getByLabel('Page must contain (optional)').fill('Northside Coffee');
    await page.getByRole('button', { name: /run test/i }).click();
    await page.waitForSelector('text=Configuration test passed', { timeout: 40_000 });
    record('configuration test passes in the browser', true);
    await shot(page, '07-check-test');

    await page.getByRole('button', { name: /activate monitoring/i }).click();
    await page.waitForSelector('text=Monitoring is active', { timeout: 20_000 });
    record('monitoring activated from the UI', true);
    await shot(page, '08-activated');

    /* --------------------- Fetch ids via API --------------------- */
    const workspaceId = await page.evaluate(() => localStorage.getItem('breakglass.activeWorkspace'));
    record('active workspace persisted', Boolean(workspaceId), workspaceId ?? '');
    const apiHeaders = { origin: WEB, 'x-requested-with': 'breakglass-web' };
    const projectsResponse = await page.request.get(`${WEB}/api/v1/workspaces/${workspaceId}/projects`, { headers: apiHeaders });
    const projectsBody = (await projectsResponse.json()) as { projects: { id: string; name: string }[] };
    const projectId = projectsBody.projects[0]?.id;
    record('projects API reachable through the browser proxy', Boolean(projectId), projectId ?? '');
    const projectResponse = await page.request.get(`${WEB}/api/v1/workspaces/${workspaceId}/projects/${projectId}`, { headers: apiHeaders });
    const projectBody = (await projectResponse.json()) as { checks: { id: string; name: string }[] };
    const checkId = projectBody.checks[0]?.id;

    // Speed up the demo loop: 60s interval, incident on the first failed run.
    const patch = await page.request.patch(`${WEB}/api/v1/workspaces/${workspaceId}/checks/${checkId}`, {
      headers: apiHeaders,
      data: { intervalSeconds: 60, failureThreshold: 1, recoveryThreshold: 2 },
    });
    record('check interval/threshold updated', patch.ok(), `status=${patch.status()}`);

    /* -------------------- Project detail + run ------------------- */
    await page.goto(`${WEB}/app/projects/${projectId}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    record('project detail lists the check', await page.getByText('Homepage responds').first().isVisible());

    let sawRun = false;
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const body = await page.locator('body').innerText();
      if (/last (run|check)/i.test(body) && !/never run/i.test(body)) {
        sawRun = true;
        break;
      }
      await page.waitForTimeout(2000);
      await page.reload({ waitUntil: 'networkidle' });
    }
    record('scheduler executed the check on its own', sawRun);
    await shot(page, '09-project-detail');

    /* ------------------------- Incident ------------------------- */
    mode = 'fail';
    let incidentHref: string | null = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await page.waitForTimeout(3000);
      const list = await page.request.get(`${WEB}/api/v1/workspaces/${workspaceId}/incidents?status=all&limit=5`, { headers: apiHeaders });
      const listBody = (await list.json()) as { items: { id: string }[] };
      if (listBody.items?.length) {
        incidentHref = `/app/incidents/${listBody.items[0].id}`;
        break;
      }
    }
    record('scheduler opened an incident after a real failure', Boolean(incidentHref), incidentHref ?? 'never opened');

    if (incidentHref) {
      await page.goto(`${WEB}/app/incidents`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1200);
      await shot(page, '10-incidents-list');

      await page.goto(`${WEB}${incidentHref}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
      record('incident detail renders evidence', await page.getByText(/evidence and recent runs/i).isVisible());
      await shot(page, '11-incident-detail');

      await page.getByRole('button', { name: /^acknowledge$/i }).click();
      await page.waitForTimeout(1500);
      const afterAck = await page.locator('body').innerText();
      record('acknowledgement recorded separately from resolution', /acknowledged/i.test(afterAck) && /open|recovering/i.test(afterAck));
      await shot(page, '12-incident-acknowledged');
    }

    /* ------------------------- Settings -------------------------- */
    await page.goto(`${WEB}/app/settings`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    record('settings page renders', await page.getByText(/workspace and account/i).isVisible());
    await shot(page, '13-settings');

    await page.getByRole('tab', { name: 'Alerts' }).click();
    await page.waitForTimeout(1200);
    record('alert destinations tab renders', await page.getByText(/alert destinations/i).isVisible());
    await shot(page, '14-settings-alerts');

    await page.getByRole('tab', { name: 'Account' }).click();
    await page.waitForTimeout(800);
    record('account tab renders', await page.getByText(/active sessions/i).isVisible());
    await shot(page, '15-settings-account');

    /* --------------------- Responsive checks --------------------- */
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${WEB}/app`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    record('no horizontal overflow on mobile dashboard', overflow <= 2, `overflow=${overflow}px`);
    await shot(page, '16-mobile-dashboard');

    await page.goto(WEB, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const landingOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    record('no horizontal overflow on mobile landing', landingOverflow <= 2, `overflow=${landingOverflow}px`);
    await shot(page, '17-mobile-landing');

    /* --------------------- Reduced motion ------------------------ */
    const reduced = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const reducedPage = await reduced.newPage();
    await reducedPage.goto(WEB, { waitUntil: 'networkidle' });
    await reducedPage.waitForTimeout(500);
    const opacity = await reducedPage.locator('h2').first().evaluate((node) => getComputedStyle(node).opacity);
    record('reduced motion keeps content visible', Number(opacity) > 0.9, `opacity=${opacity}`);
    await reduced.close();

    /* --------------------------- Errors --------------------------- */
    const meaningful = consoleErrors.filter(
      (error) => !/favicon|React DevTools|status of 40[134]/i.test(error),
    );
    record('no console errors during the flow', meaningful.length === 0, meaningful.slice(0, 3).join(' | '));
  } catch (error) {
    record('UI flow completed without exceptions', false, (error as Error).message);
    await shot(page, '99-failure').catch(() => undefined);
  } finally {
    await browser.close();
    target.close();
  }

  console.log(`\nScreenshots: ${OUT}`);
  const failed = results.filter((result) => !result.ok);
  console.log(`${results.length - failed.length}/${results.length} UI checks passed\n`);
  process.exit(failed.length === 0 ? 0 : 1);
}

void main();
