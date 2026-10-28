import { checkConfigSchema, type CheckType } from '@breakglass/shared';
import { executeCheck } from '../monitoring/executor';
import type { ExecutionResult } from '../monitoring/types';
import { badRequest } from '../lib/errors';

/**
 * Runs a check configuration *without* persisting it, so the add-website flow
 * can show a real result before the user activates monitoring.
 *
 * Sensitive values typed into the form are held in memory only and are never
 * written to the database by this path.
 */
export async function executeAdHocCheck(params: {
  workspaceId: string;
  projectId: string;
  checkName: string;
  type: CheckType;
  config: unknown;
  timeoutMs: number;
}): Promise<{ result: ExecutionResult; sanitizedConfig: Record<string, unknown> }> {
  const parsed = checkConfigSchema.parse({ type: params.type, config: params.config });
  const config = JSON.parse(JSON.stringify(parsed.config)) as Record<string, unknown>;
  const inlineSecrets = new Map<string, string>();

  if (params.type === 'api') {
    const headers = (config.headers ?? []) as { name: string; value?: string; sensitive?: boolean; secretRef?: string }[];
    config.headers = headers.map((header, index) => {
      if (header.value && !header.secretRef) {
        const ref = `inline:${index}`;
        inlineSecrets.set(ref, header.value);
        return { name: header.name, sensitive: true, secretRef: ref };
      }
      return { name: header.name, sensitive: Boolean(header.sensitive), ...(header.secretRef ? { secretRef: header.secretRef } : {}) };
    });
  }

  if (params.type === 'browser') {
    const steps = (config.steps ?? []) as { type: string; value?: string; secretRef?: string }[];
    config.steps = steps.map((step, index) => {
      if (step.type === 'fill' && step.value && !step.secretRef) {
        const ref = `inline:step-${index}`;
        inlineSecrets.set(ref, step.value);
        return { ...step, value: undefined, secretRef: ref };
      }
      return step;
    });
  }

  const result = await executeCheck({
    checkId: 'adhoc',
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    checkName: params.checkName,
    type: params.type,
    config,
    timeoutMs: params.timeoutMs,
    inlineSecrets,
  });

  return { result, sanitizedConfig: config };
}

export function assertTimeout(timeoutMs: number | undefined, fallback: number): number {
  if (timeoutMs === undefined) return fallback;
  if (timeoutMs < 3000 || timeoutMs > 60000) throw badRequest('Timeout must be between 3000 and 60000 ms.');
  return timeoutMs;
}

export interface ProjectProbeResult {
  /** True only when the site answered inside the configured expectation. */
  success: boolean;
  httpStatus: number | null;
  durationMs: number;
  failureCategory: string | null;
  /** One sentence a non-technical client can act on. */
  summary: string;
  /** What the user should change, when the failure is something they control. */
  hint: string | null;
}

/**
 * Initial test performed when a client connects a website.
 *
 * This is deliberately *not* a saved check and never opens an incident: it
 * answers "can BreakGlass reach this site right now, and what did it actually
 * get back?" so the user sees a real result before configuring monitoring.
 * A project is never marked healthy on the strength of being created.
 */
export async function probeProjectWebsite(params: {
  workspaceId: string;
  projectId: string;
  url: string;
  timeoutMs?: number;
}): Promise<ProjectProbeResult> {
  const timeoutMs = assertTimeout(params.timeoutMs, 15_000);

  const { result } = await executeAdHocCheck({
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    checkName: 'Initial website test',
    type: 'http',
    timeoutMs,
    config: {
      url: params.url,
      method: 'GET',
      // A reachability probe accepts any non-error response: a 404 on a
      // specific path is a real answer, a 5xx or a connection failure is not.
      expectedStatus: { min: 200, max: 399 },
      followRedirects: true,
      maxRedirects: 5,
      maxResponseBytes: 128_000,
    },
  });

  if (result.success) {
    return {
      success: true,
      httpStatus: result.httpStatus,
      durationMs: result.durationMs,
      failureCategory: null,
      summary: `The site responded with HTTP ${result.httpStatus} in ${result.durationMs} ms.`,
      hint: null,
    };
  }

  return {
    success: false,
    httpStatus: result.httpStatus,
    durationMs: result.durationMs,
    failureCategory: result.failureCategory,
    summary: result.failureMessage ?? 'The site could not be reached.',
    hint: hintForCategory(result.failureCategory),
  };
}

function hintForCategory(category: string | null | undefined): string | null {
  switch (category) {
    case 'http_status':
      return 'The server answered, but with an error status. Check the URL path and whether the site requires a login or a different hostname.';
    case 'dns_failure':
      return 'The hostname did not resolve. Check the domain spelling and that DNS is pointing at a live server.';
    case 'connection_refused':
      return 'Something answered for the domain but refused the connection. The web server may be down or listening on another port.';
    case 'connection_timeout':
    case 'navigation_timeout':
      return 'The request timed out. The site may be very slow or blocked from outside networks — try again, then check the server.';
    case 'tls_error':
      return 'The TLS certificate could not be validated. An expired or misconfigured certificate will also break the site for visitors.';
    case 'redirect_error':
      return 'The redirect chain failed. Check for a redirect loop or a redirect to an insecure or unreachable address.';
    case 'blocked_destination':
      return 'This address is blocked by the monitoring security policy (private, loopback or cloud-metadata addresses cannot be monitored).';
    case 'response_too_large':
      return 'The response was larger than the configured limit. Point the check at a page or endpoint rather than a large download.';
    case 'config_error':
      return 'The URL or configuration is not valid. It must be a full public http:// or https:// address.';
    case 'internal_error':
    case 'browser_runtime_error':
      return 'BreakGlass could not complete the test because of an internal problem, not because your site is down. Try again in a moment.';
    default:
      return null;
  }
}
