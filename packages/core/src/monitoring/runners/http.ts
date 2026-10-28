import type { HttpCheckConfig } from '@breakglass/shared';
import { loadEnv } from '../../config/env';
import { RequestFailure, safePreview, secureRequest } from '../runner';
import { UnsafeTargetError } from '../ssrf';
import { failureResult, successResult, type ExecutionContext, type ExecutionResult } from '../types';

export async function runHttpCheck(config: HttpCheckConfig, ctx: ExecutionContext): Promise<ExecutionResult> {
  const env = loadEnv();
  const startedAt = Date.now();

  try {
    const response = await secureRequest({
      url: config.url,
      method: config.method,
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
      bodyTruncated: response.truncated,
      tls: response.tls,
      certificateDaysRemaining: response.tls?.daysUntilExpiry ?? null,
      remoteAddress: response.remoteAddress ? 'redacted' : null,
    };

    const inRange = response.status >= config.expectedStatus.min && response.status <= config.expectedStatus.max;

    if (!inRange) {
      return failureResult(
        'http_status',
        `The website returned HTTP ${response.status} ${response.statusText}, which is outside the expected range ${config.expectedStatus.min}–${config.expectedStatus.max}.`,
        durationMs,
        { ...evidence, bodyPreview: safePreview(response.body) },
        [],
        response.status,
      );
    }

    const haystack = response.body.toLowerCase();

    if (config.expectedBodyContains) {
      const needle = config.expectedBodyContains.toLowerCase();
      if (!haystack.includes(needle)) {
        if (response.truncated) {
          return failureResult(
            'response_too_large',
            `The response was larger than the ${Math.round(config.maxResponseBytes / 1024)} KB inspection limit, so the expected content "${config.expectedBodyContains}" could not be verified. Raise the response size limit if the page is legitimately large.`,
            durationMs,
            { ...evidence, bodyPreview: safePreview(response.body) },
            [],
            response.status,
          );
        }
        return failureResult(
          'content_mismatch',
          `The page loaded with HTTP ${response.status} but the expected text "${config.expectedBodyContains}" was not found in the response.`,
          durationMs,
          { ...evidence, bodyPreview: safePreview(response.body) },
          [],
          response.status,
        );
      }
    }

    if (config.expectedBodyNotContains) {
      const needle = config.expectedBodyNotContains.toLowerCase();
      if (haystack.includes(needle)) {
        return failureResult(
          'content_mismatch',
          `The page contained the text "${config.expectedBodyNotContains}", which should not be present.`,
          durationMs,
          { ...evidence, bodyPreview: safePreview(response.body) },
          [],
          response.status,
        );
      }
    }

    const day = response.tls?.daysUntilExpiry;
    const evidenceWithExpiry =
      day !== undefined && day !== null && day >= 0 && day <= 14
        ? { ...evidence, certificateExpiryWarning: `TLS certificate expires in ${day} day(s).` }
        : evidence;

    return successResult(durationMs, { ...evidenceWithExpiry, matchedAssertion: null }, [], response.status);
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    if (error instanceof RequestFailure) {
      return failureResult(
        error.category,
        error.message,
        durationMs,
        { redirectChain: (error.detail?.redirectChain as string[]) ?? [] },
        [],
        null,
      );
    }
    if (error instanceof UnsafeTargetError) {
      return failureResult('blocked_destination', error.reason, durationMs, {}, [], null);
    }
    return failureResult(
      'internal_error',
      `The monitoring worker could not complete the request: ${(error as Error).message}`,
      durationMs,
      {},
      [],
      null,
    );
  }
}
