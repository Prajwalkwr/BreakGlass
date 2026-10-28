import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { BrowserCheckConfig, JourneyStep, ObservedApiCall, PageFeatureInventory } from '@breakglass/shared';
import type { Browser, BrowserContext, Page, Response } from 'playwright';
import { assertUrlStructure, resolveAndValidate, UnsafeTargetError } from '../ssrf';
import { failureResult, successResult, type ArtifactPayload, type ExecutionContext, type ExecutionResult } from '../types';

const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;
const MAX_TRACE_BYTES = 8 * 1024 * 1024;
const MAX_OBSERVED_API_CALLS = 30;
const MAX_CONCURRENT_FEATURE_PAGES = 5;

export class BrowserPageDiscoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserPageDiscoveryError';
  }
}

async function createSameOriginDiscoveryContext(browser: Browser, origin: string): Promise<BrowserContext> {
  const context = await browser.newContext({
    ignoreHTTPSErrors: false,
    serviceWorkers: 'block',
    permissions: [],
  });
  const hostCache = new Map<string, boolean>();
  await context.route('**/*', async (route) => {
    const requestUrl = route.request().url();
    try {
      if (/^(data|blob|about):/i.test(requestUrl)) {
        await route.continue();
        return;
      }
      const parsed = assertUrlStructure(requestUrl);
      if (parsed.origin !== origin) {
        await route.abort('blockedbyclient');
        return;
      }
      const hostname = parsed.hostname.toLowerCase();
      if (!hostCache.has(hostname)) {
        try {
          await resolveAndValidate(parsed.toString());
          hostCache.set(hostname, true);
        } catch {
          hostCache.set(hostname, false);
        }
      }
      if (!hostCache.get(hostname)) {
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue();
    } catch {
      await route.abort('blockedbyclient');
    }
  });
  return context;
}

interface StepRecord {
  index: number;
  type: string;
  ok: boolean;
  durationMs: number;
  detail?: string;
}

class StepFailure extends Error {
  stepIndex: number;
  stepType: string;
  kind: 'element_not_found' | 'text_not_found' | 'navigation_timeout' | 'journey_step_failed';
  constructor(kind: StepFailure['kind'], stepIndex: number, stepType: string, message: string) {
    super(message);
    this.kind = kind;
    this.stepIndex = stepIndex;
    this.stepType = stepType;
  }
}

async function launchBrowser(timeout = 30_000): Promise<Browser> {
  const { chromium } = await import('playwright');
  return chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
      '--no-first-run',
      '--disable-features=Translate,BackForwardCache,OptimizationHints',
    ],
    timeout,
  });
}

export async function collectRenderedSameOriginLinks(params: {
  url: string;
  origin: string;
}): Promise<string[]> {
  let browser: Browser;
  try {
    browser = await launchBrowser(10_000);
  } catch (error) {
    throw new BrowserPageDiscoveryError(`Rendered page discovery could not start: ${(error as Error).message}`);
  }

  try {
    const context = await createSameOriginDiscoveryContext(browser, params.origin);
    const page = await context.newPage();
    await page.goto(params.url, { waitUntil: 'domcontentloaded', timeout: 10_000 });
    await page.waitForTimeout(750);
    const hrefs = await page.locator('a[href]').evaluateAll((anchors) =>
      anchors.map((anchor) => anchor.getAttribute('href')).filter((href): href is string => Boolean(href)),
    );
    await context.close();
    return hrefs;
  } catch (error) {
    throw new BrowserPageDiscoveryError(`Rendered page discovery failed: ${(error as Error).message}`);
  } finally {
    await browser.close();
  }
}

export function normalizeObservedApiPath(rawUrl: string, origin: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol)) return null;
    return url.pathname
      .replace(/\/[0-9a-f]{24}(?=\/|$)/gi, '/:id')
      .replace(/\/[0-9a-f-]{36}(?=\/|$)/gi, '/:id')
      .replace(/\/[A-Za-z0-9_-]{32,}(?=\/|$)/g, '/:id')
      .replace(/\/[^/]*(?:@|%40)[^/]*(?=\/|$)/gi, '/:id')
      .replace(/\/\d{4,}(?=\/|$)/g, '/:id')
      .slice(0, 180);
  } catch {
    return null;
  }
}

export interface RenderedPageFeatureResult {
  url: string;
  features: PageFeatureInventory | null;
  warning: string | null;
}

export async function collectRenderedPageFeatures(params: {
  urls: string[];
  origin: string;
}): Promise<RenderedPageFeatureResult[]> {
  let browser: Browser;
  try {
    browser = await launchBrowser(10_000);
  } catch (error) {
    throw new BrowserPageDiscoveryError(`Page feature discovery could not start: ${(error as Error).message}`);
  }

  try {
    const context = await createSameOriginDiscoveryContext(browser, params.origin);

    const inspectPage = async (url: string): Promise<RenderedPageFeatureResult> => {
      const page = await context.newPage();
      const apiCalls = new Map<string, ObservedApiCall>();
      let runtimeErrorCount = 0;
      const recordApiCall = (method: string, rawUrl: string, status: number | null) => {
        const path = normalizeObservedApiPath(rawUrl, params.origin);
        if (!path) return;
        const normalizedMethod = method.toUpperCase().slice(0, 12);
        const key = `${normalizedMethod} ${path}`;
        const existing = apiCalls.get(key);
        if (existing) {
          if (status !== null && (existing.status === null || status >= 400 || existing.status < 400)) {
            existing.status = status;
          }
          return;
        }
        if (apiCalls.size < MAX_OBSERVED_API_CALLS) {
          apiCalls.set(key, { method: normalizedMethod, path, status });
        }
      };
      page.on('pageerror', () => {
        runtimeErrorCount += 1;
      });
      page.on('response', (response) => {
        const request = response.request();
        if (['fetch', 'xhr'].includes(request.resourceType())) {
          recordApiCall(request.method(), response.url(), response.status());
        }
      });
      page.on('requestfailed', (request) => {
        if (['fetch', 'xhr'].includes(request.resourceType())) {
          recordApiCall(request.method(), request.url(), null);
        }
      });

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 5_000 });
        await page.waitForTimeout(750);
        const [formCount, fieldCount, passwordFieldCount, buttonCount, linkCount] = await Promise.all([
          page.locator('form:visible').count(),
          page.locator('input:visible, select:visible, textarea:visible').count(),
          page.locator('input[type="password"]:visible').count(),
          page.locator(
            'button:visible, input[type="button"]:visible, input[type="submit"]:visible, input[type="reset"]:visible',
          ).count(),
          page.locator('a[href]:visible').count(),
        ]);
        return {
          url,
          features: {
            formCount,
            fieldCount,
            passwordFieldCount,
            buttonCount,
            linkCount,
            runtimeErrorCount,
            apiCalls: [...apiCalls.values()],
          },
          warning: null,
        };
      } catch (error) {
        return {
          url,
          features: null,
          warning: `Could not inspect page controls and API calls at ${new URL(url).pathname}: ${(error as Error).message.split('\n')[0].slice(0, 180)}`,
        };
      } finally {
        await page.close();
      }
    };

    const results: RenderedPageFeatureResult[] = [];
    for (let cursor = 0; cursor < params.urls.length; cursor += MAX_CONCURRENT_FEATURE_PAGES) {
      const batch = params.urls.slice(cursor, cursor + MAX_CONCURRENT_FEATURE_PAGES);
      results.push(...await Promise.all(batch.map(inspectPage)));
    }

    await context.close();
    return results;
  } catch (error) {
    if (error instanceof BrowserPageDiscoveryError) throw error;
    throw new BrowserPageDiscoveryError(`Page feature discovery failed: ${(error as Error).message}`);
  } finally {
    await browser.close();
  }
}

function stepDescription(step: JourneyStep): string {
  switch (step.type) {
    case 'goto':
      return `Open ${step.url ?? 'the configured start page'}`;
    case 'fill':
      return `Fill ${step.selector}`;
    case 'click':
      return `Click ${step.selector}`;
    case 'press':
      return `Press ${step.key} in ${step.selector}`;
    case 'expectVisible':
      return `Expect ${step.selector} to be visible`;
    case 'expectText':
      return `Expect text "${step.text}"`;
    case 'expectUrl':
      return `Expect URL to contain ${step.contains}`;
    case 'waitForResponse':
      return `Expect a response matching ${step.urlContains}`;
    default:
      return 'Journey step';
  }
}

function firstLine(message: string): string {
  return message.split('\n')[0].replace(/\s+/g, ' ').slice(0, 240);
}

async function runStep(
  page: Page,
  step: JourneyStep,
  index: number,
  timeoutMs: number,
  ctx: ExecutionContext,
): Promise<StepRecord> {
  const started = Date.now();
  const record = (detail?: string): StepRecord => ({
    index,
    type: step.type,
    ok: true,
    durationMs: Date.now() - started,
    ...(detail ? { detail } : {}),
  });

  switch (step.type) {
    case 'goto': {
      const target = step.url ?? page.url();
      assertUrlStructure(target);
      try {
        await page.goto(target, { waitUntil: step.waitUntil, timeout: timeoutMs });
      } catch (error) {
        const message = (error as Error).message;
        throw new StepFailure(
          /timeout/i.test(message) ? 'navigation_timeout' : 'journey_step_failed',
          index,
          step.type,
          `Navigation to ${target} failed: ${firstLine(message)}`,
        );
      }
      return record(target);
    }
    case 'fill': {
      let value = step.value ?? '';
      if (step.secretRef) {
        const secret = await ctx.secretResolver(step.secretRef);
        if (secret === null) {
          throw new StepFailure(
            'journey_step_failed',
            index,
            step.type,
            'The encrypted credential for this step is missing. Re-enter it and save the check.',
          );
        }
        value = secret;
      }
      try {
        await page.locator(step.selector).first().fill(value, { timeout: timeoutMs });
      } catch (error) {
        throw new StepFailure(
          'element_not_found',
          index,
          step.type,
          `Could not fill ${step.selector}: ${firstLine((error as Error).message)}`,
        );
      }
      // The filled value is deliberately never echoed into evidence.
      return record(step.secretRef ? 'Filled with encrypted credential' : undefined);
    }
    case 'click': {
      try {
        await page.locator(step.selector).first().click({ timeout: timeoutMs });
      } catch (error) {
        throw new StepFailure(
          'element_not_found',
          index,
          step.type,
          `Could not click ${step.selector}: ${firstLine((error as Error).message)}`,
        );
      }
      return record();
    }
    case 'press': {
      try {
        await page.locator(step.selector).first().press(step.key, { timeout: timeoutMs });
      } catch (error) {
        throw new StepFailure(
          'element_not_found',
          index,
          step.type,
          `Could not press ${step.key} in ${step.selector}: ${firstLine((error as Error).message)}`,
        );
      }
      return record();
    }
    case 'expectVisible': {
      try {
        await page.locator(step.selector).first().waitFor({ state: 'visible', timeout: timeoutMs });
      } catch {
        throw new StepFailure(
          'element_not_found',
          index,
          step.type,
          `The element ${step.selector} was not visible within ${Math.round(timeoutMs / 1000)}s.`,
        );
      }
      return record();
    }
    case 'expectText': {
      const scope = step.selector ? page.locator(step.selector).first() : page.locator('body');
      const deadline = Date.now() + timeoutMs;
      const needle = step.text.toLowerCase();
      while (Date.now() < deadline) {
        try {
          const text = (await scope.innerText({ timeout: 2000 })) ?? '';
          if (text.toLowerCase().includes(needle)) return record();
        } catch {
          // Element not attached yet — keep polling until the deadline.
        }
        await page.waitForTimeout(250);
      }
      throw new StepFailure(
        'text_not_found',
        index,
        step.type,
        `The text "${step.text}" did not appear within ${Math.round(timeoutMs / 1000)}s.`,
      );
    }
    case 'expectUrl': {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (page.url().includes(step.contains)) return record(page.url());
        await page.waitForTimeout(250);
      }
      throw new StepFailure(
        'journey_step_failed',
        index,
        step.type,
        `Expected the URL to contain "${step.contains}" but the page stayed on ${page.url()}.`,
      );
    }
    case 'waitForResponse': {
      try {
        const response = await page.waitForResponse(
          (candidate: Response) =>
            candidate.url().includes(step.urlContains) &&
            candidate.status() >= step.statusRange.min &&
            candidate.status() <= step.statusRange.max,
          { timeout: timeoutMs },
        );
        return record(`${response.status()} ${response.url().slice(0, 120)}`);
      } catch {
        throw new StepFailure(
          'journey_step_failed',
          index,
          step.type,
          `No response matching "${step.urlContains}" with status ${step.statusRange.min}–${step.statusRange.max} arrived within ${Math.round(timeoutMs / 1000)}s.`,
        );
      }
    }
    default:
      return record();
  }
}

export async function runBrowserCheck(config: BrowserCheckConfig, ctx: ExecutionContext): Promise<ExecutionResult> {
  const startedAt = Date.now();
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  const artifacts: ArtifactPayload[] = [];
  const steps: StepRecord[] = [];
  const consoleErrors: string[] = [];
  const authResponses: number[] = [];
  let page: Page | null = null;
  let blockedRequest: string | null = null;

  try {
    // Validate the start URL before a browser is even launched.
    assertUrlStructure(config.startUrl);
    browser = await launchBrowser();
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    if (error instanceof UnsafeTargetError) {
      return failureResult('blocked_destination', error.reason, durationMs);
    }
    return failureResult(
      'browser_runtime_error',
      `The browser runtime could not start: ${firstLine((error as Error).message)}. On a self-hosted worker run "npx playwright install --with-deps chromium".`,
      durationMs,
    );
  }

  try {
    context = await browser.newContext({
      viewport: { width: config.viewportWidth, height: config.viewportHeight },
      ignoreHTTPSErrors: false,
      userAgent: 'BreakGlass-Journey/1.0 (+https://breakglass.app/bot)',
      serviceWorkers: 'block',
      permissions: [],
    });

    // DNS results are cached per hostname for the lifetime of this journey so
    // every document request is checked against the private-address policy
    // without paying for a fresh lookup each time.
    const hostCache = new Map<string, boolean>();

    await context.route('**/*', async (route) => {
      const requestUrl = route.request().url();
      try {
        if (/^(data|blob|about):/i.test(requestUrl)) {
          await route.continue();
          return;
        }
        const parsed = assertUrlStructure(requestUrl);
        const hostname = parsed.hostname.toLowerCase();
        if (!hostCache.has(hostname)) {
          try {
            await resolveAndValidate(parsed.toString());
            hostCache.set(hostname, true);
          } catch {
            hostCache.set(hostname, false);
          }
        }
        if (!hostCache.get(hostname)) {
          blockedRequest = hostname;
          await route.abort('blockedbyclient');
          return;
        }
        await route.continue();
      } catch {
        blockedRequest = requestUrl.slice(0, 120);
        await route.abort('blockedbyclient');
      }
    });

    page = await context.newPage();
    page.setDefaultTimeout(ctx.timeoutMs);
    page.on('console', (message) => {
      if (message.type() === 'error' && consoleErrors.length < 20) {
        consoleErrors.push(firstLine(message.text()));
      }
    });
    page.on('response', (response) => {
      if ([401, 403].includes(response.status()) && authResponses.length < 10) {
        authResponses.push(response.status());
      }
    });
    page.on('dialog', (dialog) => {
      void dialog.dismiss().catch(() => undefined);
    });

    const tracePath = path.join(os.tmpdir(), `bg-trace-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`);
    if (config.captureTraceOnFailure) {
      await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    }

    const stepStart = Date.now();
    try {
      await page.goto(config.startUrl, { waitUntil: 'domcontentloaded', timeout: ctx.timeoutMs });
      steps.push({
        index: 0,
        type: 'goto',
        ok: true,
        durationMs: Date.now() - stepStart,
        detail: config.startUrl,
      });
    } catch (error) {
      const message = (error as Error).message;
      throw new StepFailure(
        /timeout/i.test(message) ? 'navigation_timeout' : 'journey_step_failed',
        0,
        'goto',
        blockedRequest
          ? `The start page could not be loaded because a request to "${blockedRequest}" was blocked by the outbound security policy.`
          : `Could not open ${config.startUrl}: ${firstLine(message)}`,
      );
    }

    for (let index = 0; index < config.steps.length; index += 1) {
      const step = config.steps[index];
      steps.push(await runStep(page, step, index + 1, ctx.timeoutMs, ctx));
    }

    const durationMs = Date.now() - startedAt;
    if (config.captureTraceOnFailure) {
      // Traces are only retained for failures; discard on success.
      await context.tracing.stop().catch(() => undefined);
    }

    return successResult(durationMs, { steps, finalUrl: page.url(), consoleErrors }, [], null);
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const stepFailure = error instanceof StepFailure ? error : null;

    let category: ExecutionResult['failureCategory'] = stepFailure?.kind ?? 'journey_step_failed';
    let message = stepFailure?.message ?? `The browser journey failed: ${firstLine((error as Error).message)}`;

    if (
      blockedRequest &&
      stepFailure &&
      ['element_not_found', 'journey_step_failed', 'text_not_found', 'navigation_timeout'].includes(stepFailure.kind)
    ) {
      category = 'blocked_destination';
      message = `A request to "${blockedRequest}" was blocked by the outbound security policy, so the journey could not be completed. ${stepFailure.message}`;
    } else if (
      stepFailure &&
      authResponses.length > 0 &&
      ['element_not_found', 'journey_step_failed', 'text_not_found'].includes(stepFailure.kind)
    ) {
      // A rejected test login is a credential problem, not proof of an outage.
      category = 'auth_failure';
      message = `The configured test account appears to have been rejected (HTTP ${authResponses[0]}). This points at the test credentials or account state rather than a confirmed website outage. ${stepFailure.message}`;
    }

    if (page && config.captureScreenshotOnFailure) {
      try {
        const buffer = await page.screenshot({ fullPage: false, type: 'jpeg', quality: 60, timeout: 5000 });
        if (buffer.length <= MAX_SCREENSHOT_BYTES) {
          artifacts.push({ kind: 'screenshot', contentType: 'image/jpeg', data: buffer });
        }
      } catch {
        // Screenshot capture is best-effort evidence.
      }
    }

    if (context && config.captureTraceOnFailure) {
      const tempPath = path.join(os.tmpdir(), `bg-trace-${Date.now()}.zip`);
      try {
        await context.tracing.stop({ path: tempPath });
        const stat = await fs.stat(tempPath);
        if (stat.size <= MAX_TRACE_BYTES) {
          const data = await fs.readFile(tempPath);
          artifacts.push({ kind: 'trace', contentType: 'application/zip', data });
        }
      } catch {
        // Trace capture is best-effort evidence.
      } finally {
        await fs.unlink(tempPath).catch(() => undefined);
      }
    }

    return failureResult(
      category,
      message,
      durationMs,
      {
        steps,
        failedStepIndex: stepFailure ? stepFailure.stepIndex : null,
        finalUrl: page ? page.url() : null,
        consoleErrors,
        authResponses,
        blockedRequest,
      },
      artifacts,
      null,
    );
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

export { stepDescription, MAX_TRACE_BYTES, MAX_SCREENSHOT_BYTES };
