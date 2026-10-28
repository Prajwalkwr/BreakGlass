import type { ApiCheckConfig } from '@breakglass/shared';
import { loadEnv } from '../../config/env';
import { RequestFailure, safePreview, secureRequest } from '../runner';
import { UnsafeTargetError } from '../ssrf';
import { failureResult, successResult, type ExecutionContext, type ExecutionResult } from '../types';

/** Reads a dotted path (`data.items[0].status`) from parsed JSON. */
export function readJsonPath(source: unknown, path: string): { found: boolean; value: unknown } {
  const segments: string[] = [];
  for (const part of path.split('.')) {
    const matches = part.matchAll(/([^[\]]+)|\[(\d+)\]/g);
    for (const match of matches) {
      if (match[1] !== undefined) segments.push(match[1]);
      else if (match[2] !== undefined) segments.push(`[${match[2]}]`);
    }
  }

  let current: unknown = source;
  for (const segment of segments) {
    if (segment.startsWith('[')) {
      const index = Number(segment.slice(1, -1));
      if (!Array.isArray(current) || index >= current.length) return { found: false, value: undefined };
      current = current[index];
    } else {
      if (current === null || typeof current !== 'object') return { found: false, value: undefined };
      const record = current as Record<string, unknown>;
      if (!(segment in record)) return { found: false, value: undefined };
      current = record[segment];
    }
  }
  return { found: true, value: current };
}

function describe(value: unknown, max = 80): string {
  let text: string;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  if (text === undefined) return 'undefined';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export async function runApiCheck(config: ApiCheckConfig, ctx: ExecutionContext): Promise<ExecutionResult> {
  const env = loadEnv();
  const startedAt = Date.now();

  const headers: Record<string, string> = {};
  for (const header of config.headers) {
    let value = header.value ?? '';
    if (header.secretRef) {
      const resolved = await ctx.secretResolver(header.secretRef);
      if (resolved === null) {
        return failureResult(
          'config_error',
          `The encrypted value for header "${header.name}" is missing. Re-enter the credential and save the check again.`,
          0,
        );
      }
      value = resolved;
    }
    if (!value) continue;
    headers[header.name] = value;
  }

  const body = config.bodyType === 'none' ? undefined : config.body;

  try {
    const response = await secureRequest({
      url: config.url,
      method: config.method,
      headers,
      body,
      timeoutMs: ctx.timeoutMs,
      followRedirects: config.followRedirects,
      maxRedirects: config.maxRedirects,
      maxBytes: config.maxResponseBytes,
      userAgent: env.MONITOR_USER_AGENT,
    });

    const durationMs = Date.now() - startedAt;
    const evidence = {
      httpStatus: response.status,
      statusText: response.statusText || null,
      finalUrl: response.finalUrl,
      redirectChain: response.redirectChain,
      responseTimeMs: durationMs,
      contentType: response.headers['content-type'] ?? null,
      responseHeaders: response.headers,
      bodyBytes: response.bodyBytes,
      tls: response.tls,
    };

    if (response.status < config.expectedStatus.min || response.status > config.expectedStatus.max) {
      return failureResult(
        'http_status',
        `The endpoint returned HTTP ${response.status} ${response.statusText}, outside the expected range ${config.expectedStatus.min}–${config.expectedStatus.max}.`,
        durationMs,
        { ...evidence, bodyPreview: safePreview(response.body) },
        [],
        response.status,
      );
    }

    if (config.jsonAssertions.length === 0) {
      return successResult(durationMs, evidence, [], response.status);
    }

    let parsed: unknown;
    try {
      parsed = response.body ? JSON.parse(response.body) : null;
    } catch {
      return failureResult(
        'json_assertion_failed',
        'The endpoint responded successfully but the body was not valid JSON, so the configured assertions could not be evaluated.',
        durationMs,
        { ...evidence, bodyPreview: safePreview(response.body) },
        [],
        response.status,
      );
    }

    const results = config.jsonAssertions.map((assertion) => {
      const { found, value } = readJsonPath(parsed, assertion.path);
      let ok = false;
      let detail = '';

      switch (assertion.operator) {
        case 'exists':
          ok = found && value !== null && value !== undefined;
          detail = ok ? `Found ${describe(value)}` : 'Path was missing or null';
          break;
        case 'equals':
          ok = found && String(value) === String(assertion.value);
          detail = ok ? `Equals ${describe(assertion.value)}` : `Expected ${describe(assertion.value)}, got ${describe(value)}`;
          break;
        case 'not_equals':
          ok = !found || String(value) !== String(assertion.value);
          detail = ok ? 'Value differs as expected' : `Value still equals ${describe(assertion.value)}`;
          break;
        case 'contains':
          ok = found && String(value).toLowerCase().includes(String(assertion.value).toLowerCase());
          detail = ok ? 'Contains expected text' : `Value did not contain ${describe(assertion.value)}`;
          break;
        case 'matches':
          try {
            ok = found && new RegExp(String(assertion.value)).test(String(value));
          } catch {
            ok = false;
            detail = 'Invalid regular expression in assertion';
          }
          if (!detail) detail = ok ? 'Matched pattern' : `Value did not match ${describe(assertion.value)}`;
          break;
        default:
          ok = false;
          detail = 'Unsupported operator';
      }

      return { path: assertion.path, operator: assertion.operator, ok, detail };
    });

    const firstFailure = results.find((result) => !result.ok);
    if (firstFailure) {
      return failureResult(
        'json_assertion_failed',
        `JSON assertion on "${firstFailure.path}" failed: ${firstFailure.detail}.`,
        durationMs,
        { ...evidence, json: { assertions: results } },
        [],
        response.status,
      );
    }

    return successResult(durationMs, { ...evidence, json: { assertions: results } }, [], response.status);
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    if (error instanceof RequestFailure) {
      return failureResult(error.category, error.message, durationMs, {}, [], null);
    }
    if (error instanceof UnsafeTargetError) {
      return failureResult('blocked_destination', error.reason, durationMs, {}, [], null);
    }
    return failureResult(
      'internal_error',
      `The monitoring worker could not complete the API check: ${(error as Error).message}`,
      durationMs,
      {},
      [],
      null,
    );
  }
}
