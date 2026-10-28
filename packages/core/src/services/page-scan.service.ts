import { PLAN_LIMITS, type PageScanReport, type ScannedPageResult } from '@breakglass/shared';
import { loadEnv } from '../config/env';
import { AppError, conflict, notFound } from '../lib/errors';
import { Check } from '../models/check';
import { Project } from '../models/project';
import { RequestFailure, secureRequest } from '../monitoring/runner';
import {
  BrowserPageDiscoveryError,
  collectRenderedPageFeatures,
  collectRenderedSameOriginLinks,
} from '../monitoring/runners/browser';
import { createCheck, updateCheck } from './checks.service';

const MAX_PAGES = 50;
const MAX_CONCURRENT_REQUESTS = 5;
const PAGE_TIMEOUT_MS = 4_000;
const MAX_RESPONSE_BYTES = 256_000;
const MONITOR_INTERVAL_SECONDS = 1_800;
const FIRST_RUN_DELAY_MS = 60_000;
const STATIC_FILE = /\.(?:avif|bmp|css|csv|docx?|eot|gif|ico|jpe?g|js|json|map|mp[34]|pdf|png|svg|txt|webm|woff2?|xlsx?|xml|zip)$/i;

function normalizePageUrl(rawUrl: string, origin: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    if (STATIC_FILE.test(url.pathname)) return null;
    url.hash = '';
    url.search = '';
    if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString();
  } catch {
    return null;
  }
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

export function extractSameOriginPageLinks(html: string, pageUrl: string, origin: string): string[] {
  const links = new Set<string>();
  const anchorPattern = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;

  for (const match of html.matchAll(anchorPattern)) {
    const rawHref = match[1] ?? match[2] ?? match[3] ?? '';
    const href = decodeHtmlAttribute(rawHref).trim();
    if (!href || href.startsWith('#')) continue;
    let resolved: string;
    try {
      resolved = new URL(href, pageUrl).toString();
    } catch {
      continue;
    }
    const normalized = normalizePageUrl(resolved, origin);
    if (normalized) links.add(normalized);
  }

  return [...links];
}

async function scanPage(url: string, origin: string): Promise<{ result: ScannedPageResult; links: string[] }> {
  const startedAt = Date.now();
  try {
    const response = await secureRequest({
      url,
      method: 'GET',
      timeoutMs: PAGE_TIMEOUT_MS,
      followRedirects: false,
      maxRedirects: 0,
      maxBytes: MAX_RESPONSE_BYTES,
      userAgent: loadEnv().MONITOR_USER_AGENT,
    });
    const success = response.status >= 200 && response.status <= 399;
    const isHtml = (response.headers['content-type'] ?? '').toLowerCase().includes('text/html');
    const result: ScannedPageResult = {
      url,
      success,
      httpStatus: response.status,
      durationMs: response.durationMs,
      failureCategory: success ? null : 'http_status',
      summary: success
        ? `Responded with HTTP ${response.status} in ${response.durationMs} ms.`
        : `Returned HTTP ${response.status}; expected a status from 200 to 399.`,
      checkId: null,
      checkName: null,
      features: null,
    };
    return {
      result,
      links: success && isHtml && !response.truncated ? extractSameOriginPageLinks(response.body, url, origin) : [],
    };
  } catch (error) {
    if (!(error instanceof RequestFailure)) throw error;
    const durationMs = Date.now() - startedAt;
    return {
      result: {
        url,
        success: false,
        httpStatus: null,
        durationMs,
        failureCategory: error.category,
        summary: error.message,
        checkId: null,
        checkName: null,
        features: null,
      },
      links: [],
    };
  }
}

function checkNameForUrl(url: string): string {
  const path = new URL(url).pathname;
  if (path === '/') return 'Homepage responds';
  const readablePath = decodeURIComponent(path)
    .split('/')
    .filter(Boolean)
    .join(' / ')
    .replace(/[-_]+/g, ' ')
    .slice(0, 60);
  return `Page: ${readablePath}`.slice(0, 80);
}

export function planPageCheckSchedule(params: {
  pages: readonly Pick<ScannedPageResult, 'url'>[];
  existingByUrl: ReadonlyMap<string, { enabled: boolean }>;
  existingCheckCount: number;
  activeCheckCount: number;
  projectCheckLimit: number;
  activeCheckLimit: number;
}): {
  createUrls: string[];
  activateUrls: string[];
  alreadyMonitoredUrls: string[];
  unscheduledUrls: string[];
  projectLimitExceeded: number;
  workspaceLimitExceeded: number;
} {
  const missingPages = params.pages.filter((page) => !params.existingByUrl.has(page.url));
  const disabledPages = params.pages.filter((page) => {
    const existing = params.existingByUrl.get(page.url);
    return existing && !existing.enabled;
  });
  const projectSlots = Math.max(0, params.projectCheckLimit - params.existingCheckCount);
  const pagesWithinProjectLimit = missingPages.slice(0, projectSlots);
  const schedulableUrls = new Set([
    ...disabledPages.map((page) => page.url),
    ...pagesWithinProjectLimit.map((page) => page.url),
  ]);
  const candidates = params.pages.filter((page) => schedulableUrls.has(page.url));
  const activeSlots = Math.max(0, params.activeCheckLimit - params.activeCheckCount);
  const scheduledUrls = new Set(candidates.slice(0, activeSlots).map((page) => page.url));
  const alreadyMonitoredUrls = params.pages
    .filter((page) => params.existingByUrl.get(page.url)?.enabled)
    .map((page) => page.url);

  return {
    createUrls: pagesWithinProjectLimit
      .filter((page) => scheduledUrls.has(page.url))
      .map((page) => page.url),
    activateUrls: disabledPages
      .filter((page) => scheduledUrls.has(page.url))
      .map((page) => page.url),
    alreadyMonitoredUrls,
    unscheduledUrls: params.pages
      .filter((page) => !params.existingByUrl.get(page.url)?.enabled && !scheduledUrls.has(page.url))
      .map((page) => page.url),
    projectLimitExceeded: missingPages.length - pagesWithinProjectLimit.length,
    workspaceLimitExceeded: Math.max(0, candidates.length - scheduledUrls.size),
  };
}

/**
 * Crawls a small, same-origin set of public HTML pages and creates scheduled
 * HTTP checks for each page. Requests are bounded, SSRF-validated and staggered.
 */
export async function scanAndMonitorProjectPages(params: {
  workspaceId: string;
  projectId: string;
  userId: string;
}): Promise<PageScanReport> {
  const project = await Project.findOne({ _id: params.projectId, workspaceId: params.workspaceId });
  if (!project) throw notFound('Project not found.');
  if (project.status !== 'active') throw conflict('Resume this project before scanning and monitoring its pages.');

  const origin = new URL(project.url).origin;
  const rootUrl = normalizePageUrl(project.url, origin);
  if (!rootUrl) throw conflict('The project URL cannot be used as a public page.');

  const discovered = [rootUrl];
  const discoveredSet = new Set(discovered);
  const scanned: ScannedPageResult[] = [];
  const warnings: string[] = [];
  let truncated = false;

  try {
    const renderedLinks = await collectRenderedSameOriginLinks({ url: rootUrl, origin });
    for (const href of renderedLinks) {
      let absoluteUrl: string;
      try {
        absoluteUrl = new URL(href, rootUrl).toString();
      } catch {
        continue;
      }
      const link = normalizePageUrl(absoluteUrl, origin);
      if (!link || discoveredSet.has(link)) continue;
      if (discovered.length >= MAX_PAGES) {
        truncated = true;
        break;
      }
      discoveredSet.add(link);
      discovered.push(link);
    }
  } catch (error) {
    if (!(error instanceof BrowserPageDiscoveryError)) throw error;
    warnings.push(error.message);
  }

  for (let cursor = 0; cursor < discovered.length && cursor < MAX_PAGES; cursor += MAX_CONCURRENT_REQUESTS) {
    const batch = discovered.slice(cursor, cursor + MAX_CONCURRENT_REQUESTS);
    const batchResults = await Promise.all(batch.map((url) => scanPage(url, origin)));
    for (const page of batchResults) {
      scanned.push(page.result);
      for (const link of page.links) {
        if (discoveredSet.has(link)) continue;
        if (discovered.length >= MAX_PAGES) {
          truncated = true;
          break;
        }
        discoveredSet.add(link);
        discovered.push(link);
      }
    }
  }

  try {
    const featureResults = await collectRenderedPageFeatures({
      urls: scanned.map((page) => page.url),
      origin,
    });
    const pageByUrl = new Map(scanned.map((page) => [page.url, page]));
    for (const featureResult of featureResults) {
      const page = pageByUrl.get(featureResult.url);
      if (page) page.features = featureResult.features;
      if (featureResult.warning) warnings.push(featureResult.warning);
    }
  } catch (error) {
    if (!(error instanceof BrowserPageDiscoveryError)) throw error;
    warnings.push(error.message);
  }

  const existingChecks = await Check.find({ projectId: project._id }).select('_id name type config enabled');
  const existingByUrl = new Map<string, (typeof existingChecks)[number]>();
  for (const check of existingChecks) {
    const checkUrl = (check.config as { url?: string }).url;
    if (check.type === 'http' && checkUrl) {
      const normalized = normalizePageUrl(checkUrl, origin);
      if (normalized) existingByUrl.set(normalized, check);
    }
  }

  const activeCount = await Check.countDocuments({ workspaceId: params.workspaceId, enabled: true });
  const schedule = planPageCheckSchedule({
    pages: scanned,
    existingByUrl,
    existingCheckCount: existingChecks.length,
    activeCheckCount: activeCount,
    projectCheckLimit: PLAN_LIMITS.maxChecksPerProject,
    activeCheckLimit: PLAN_LIMITS.maxActiveChecks,
  });
  if (schedule.projectLimitExceeded > 0) {
    warnings.push(
      `${schedule.projectLimitExceeded} discovered page(s) were scanned but not monitored because this project allows at most ${PLAN_LIMITS.maxChecksPerProject} checks.`,
    );
  }
  if (schedule.workspaceLimitExceeded > 0) {
    warnings.push(
      `${schedule.workspaceLimitExceeded} discovered page(s) were scanned but not monitored because the workspace has reached its active-check limit.`,
    );
  }

  const firstRunAt = Date.now() + FIRST_RUN_DELAY_MS;
  const pagesToSchedule = scanned.filter((page) =>
    schedule.createUrls.includes(page.url) || schedule.activateUrls.includes(page.url),
  );
  const createdUrls: string[] = [];
  const activatedUrls: string[] = [];
  const unscheduledUrls = new Set(schedule.unscheduledUrls);
  const capacityWarnings = new Set<string>();
  for (const [index, page] of pagesToSchedule.entries()) {
    const existing = existingByUrl.get(page.url);
    try {
      const check = existing
        ? await updateCheck({
            check: existing,
            workspaceId: params.workspaceId,
            updates: { enabled: true, intervalSeconds: MONITOR_INTERVAL_SECONDS },
          })
        : await createCheck({
            workspaceId: params.workspaceId,
            projectId: params.projectId,
            userId: params.userId,
            input: {
              name: checkNameForUrl(page.url),
              type: 'http',
              enabled: true,
              intervalSeconds: MONITOR_INTERVAL_SECONDS,
              timeoutMs: 10_000,
              failureThreshold: 2,
              recoveryThreshold: 2,
              severity: 'major',
              config: {
                url: page.url,
                method: 'GET',
                expectedStatus: { min: 200, max: 399 },
                followRedirects: false,
                maxRedirects: 0,
                maxResponseBytes: MAX_RESPONSE_BYTES,
              },
            },
          });
      const staggerMs = pagesToSchedule.length > 1
        ? Math.floor((index * MONITOR_INTERVAL_SECONDS * 1000) / pagesToSchedule.length)
        : 0;
      await Check.updateOne({ _id: check._id }, { $set: { nextRunAt: new Date(firstRunAt + staggerMs) } });
      page.checkId = String(check._id);
      page.checkName = check.name;
      if (existing) activatedUrls.push(page.url);
      else createdUrls.push(page.url);
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== 'conflict') throw error;
      unscheduledUrls.add(page.url);
      capacityWarnings.add(error.message);
    }
  }

  if (capacityWarnings.size) {
    warnings.push(
      `${capacityWarnings.size} page check(s) could not be scheduled because project or workspace capacity changed during the scan: ${[...capacityWarnings].join(' ')}`,
    );
  }

  for (const page of scanned) {
    const existing = existingByUrl.get(page.url);
    if (existing?.enabled && !page.checkId) {
      page.checkId = String(existing._id);
      page.checkName = existing.name;
    }
  }

  const report: PageScanReport = {
    pages: scanned,
    truncated,
    warnings,
    createdChecks: createdUrls.length,
    activatedChecks: activatedUrls.length,
    alreadyMonitored: schedule.alreadyMonitoredUrls.length,
    unscheduledPages: unscheduledUrls.size,
    intervalSeconds: MONITOR_INTERVAL_SECONDS,
  };
  await Project.updateOne(
    { _id: project._id, workspaceId: params.workspaceId },
    { $set: { lastPageScan: { scannedAt: new Date().toISOString(), report } } },
  );
  return report;
}
