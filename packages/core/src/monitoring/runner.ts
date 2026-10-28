import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import type { FailureCategory } from '@breakglass/shared';
import {
  UnsafeTargetError,
  assertConnectedSocketAllowed,
  pinnedLookup,
  resolveAndValidate,
  type ValidatedTarget,
} from './ssrf';
import { redactString, isSensitiveHeader } from '../lib/crypto';

export interface SecureRequestOptions {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
  followRedirects: boolean;
  maxRedirects: number;
  maxBytes: number;
  userAgent: string;
}

export interface TlsInfo {
  subject: string | null;
  issuer: string | null;
  validFrom: string | null;
  validTo: string | null;
  daysUntilExpiry: number | null;
}

export interface SecureResponse {
  status: number;
  statusText: string;
  finalUrl: string;
  redirectChain: string[];
  headers: Record<string, string>;
  body: string;
  bodyBytes: number;
  truncated: boolean;
  durationMs: number;
  remoteAddress: string | null;
  tls: TlsInfo | null;
  bodyIsBinary: boolean;
}

export class RequestFailure extends Error {
  category: FailureCategory;
  detail?: Record<string, unknown>;
  constructor(category: FailureCategory, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = 'RequestFailure';
    this.category = category;
    this.detail = detail;
  }
}

const REDACTED_HEADER_ALLOWLIST = new Set([
  'content-type',
  'content-length',
  'cache-control',
  'server',
  'date',
  'x-cache',
  'x-request-id',
  'cf-ray',
  'location',
  'vary',
  'strict-transport-security',
  'content-encoding',
  'x-frame-options',
]);

function sanitizeHeaders(raw: http.IncomingHttpHeaders): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    const lower = name.toLowerCase();
    if (isSensitiveHeader(lower)) continue;
    if (!REDACTED_HEADER_ALLOWLIST.has(lower) && !lower.startsWith('x-')) continue;
    if (value === undefined) continue;
    output[lower] = redactString(Array.isArray(value) ? value.join(', ') : String(value), 200);
  }
  return output;
}

function mapNetworkError(error: NodeJS.ErrnoException): RequestFailure {
  const code = error.code ?? '';
  const message = error.message ?? 'Request failed';

  if (error instanceof UnsafeTargetError) {
    return new RequestFailure('blocked_destination', error.reason);
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'EAI_FAIL') {
    return new RequestFailure('dns_failure', `DNS lookup failed for the host (${code}).`);
  }
  if (code === 'ECONNREFUSED') {
    return new RequestFailure('connection_refused', 'The server refused the connection.');
  }
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
    return new RequestFailure('connection_refused', 'The host or network is unreachable.');
  }
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || code === 'ABORT_ERR') {
    return new RequestFailure('connection_timeout', 'The request timed out before the server responded.');
  }
  if (
    code.startsWith('CERT_') ||
    code.startsWith('ERR_TLS') ||
    code.startsWith('ERR_SSL') ||
    [
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'DEPTH_ZERO_SELF_SIGNED_CERT',
      'SELF_SIGNED_CERT_IN_CHAIN',
      'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
      'ERR_TLS_CERT_ALTNAME_INVALID',
      'HOSTNAME_MISMATCH',
    ].includes(code)
  ) {
    return new RequestFailure('tls_error', `TLS certificate validation failed (${code}).`);
  }
  if (code === 'EACCES') {
    return new RequestFailure('blocked_destination', 'The connection was blocked by the outbound security policy.');
  }
  if (code === 'ECONNRESET') {
    return new RequestFailure('unknown', 'The connection was reset by the remote server.');
  }
  return new RequestFailure('unknown', redactString(message, 300));
}

function requestOnce(
  target: ValidatedTarget,
  options: SecureRequestOptions,
  headers: Record<string, string>,
): Promise<{ response: SecureResponse; raw: http.IncomingMessage }> {
  return new Promise((resolve, reject) => {
    const isHttps = target.url.protocol === 'https:';
    const transport = isHttps ? https : http;
    const startedAt = process.hrtime.bigint();
    let settled = false;

    const requestOptions: https.RequestOptions = {
      protocol: target.url.protocol,
      hostname: target.hostname,
      port: target.port,
      path: `${target.url.pathname}${target.url.search}`,
      method: options.method,
      headers,
      lookup: pinnedLookup(target) as unknown as https.RequestOptions['lookup'],
      servername: isHttps && !target.hostname.includes(':') ? target.hostname : undefined,
      agent: false,
    };

    const req = transport.request(requestOptions, (res) => {
      try {
        assertConnectedSocketAllowed(res.socket);
      } catch (error) {
        settled = true;
        req.destroy();
        reject(mapNetworkError(error as NodeJS.ErrnoException));
        return;
      }

      const socket = res.socket;
      let tlsInfo: TlsInfo | null = null;
      if (isHttps && socket instanceof tls.TLSSocket) {
        try {
          const cert = socket.getPeerCertificate();
          if (cert && Object.keys(cert).length > 0) {
            const validTo = cert.valid_to ? new Date(cert.valid_to) : null;
            tlsInfo = {
              subject: cert.subject?.CN ? String(cert.subject.CN) : null,
              issuer: cert.issuer?.O ? String(cert.issuer.O) : cert.issuer?.CN ? String(cert.issuer.CN) : null,
              validFrom: cert.valid_from ? new Date(cert.valid_from).toISOString() : null,
              validTo: validTo ? validTo.toISOString() : null,
              daysUntilExpiry: validTo ? Math.round((validTo.getTime() - Date.now()) / 86_400_000) : null,
            };
          }
        } catch {
          tlsInfo = null;
        }
      }

      const chunks: Buffer[] = [];
      let bytes = 0;
      let truncated = false;

      res.on('data', (chunk: Buffer) => {
        if (truncated) return;
        bytes += chunk.length;
        if (bytes > options.maxBytes) {
          truncated = true;
          chunks.push(chunk.subarray(0, Math.max(0, chunk.length - (bytes - options.maxBytes))));
          res.destroy();
          return;
        }
        chunks.push(chunk);
      });

      const finish = () => {
        if (settled) return;
        settled = true;
        const buffer = Buffer.concat(chunks);
        const contentType = String(res.headers['content-type'] ?? '');
        const isText =
          contentType === '' ||
          /text\/|json|xml|javascript|x-www-form-urlencoded/i.test(contentType);
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

        resolve({
          response: {
            status: res.statusCode ?? 0,
            statusText: res.statusMessage ?? '',
            finalUrl: target.url.toString(),
            redirectChain: [],
            headers: sanitizeHeaders(res.headers),
            body: isText ? buffer.toString('utf8') : '',
            bodyBytes: buffer.length,
            bodyIsBinary: !isText,
            truncated,
            durationMs: Math.round(durationMs),
            remoteAddress: res.socket?.remoteAddress ?? null,
            tls: tlsInfo,
          },
          raw: res,
        });
      };

      res.on('end', finish);
      res.on('close', finish);
      res.on('error', (error) => {
        if (settled) return;
        settled = true;
        reject(mapNetworkError(error as NodeJS.ErrnoException));
      });
    });

    req.setTimeout(options.timeoutMs, () => {
      if (settled) return;
      settled = true;
      req.destroy();
      reject(new RequestFailure('connection_timeout', `The request timed out after ${options.timeoutMs} ms.`));
    });

    req.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(mapNetworkError(error as NodeJS.ErrnoException));
    });

    if (options.body) req.write(options.body);
    req.end();
  });
}

/**
 * Performs an outbound request with SSRF protections, manual redirect
 * handling and a hard response-size cap.
 */
export async function secureRequest(options: SecureRequestOptions): Promise<SecureResponse> {
  const redirectChain: string[] = [];
  let currentUrl = options.url;
  let method = options.method;
  let body = options.body;
  const overallDeadline = Date.now() + options.timeoutMs;

  for (let hop = 0; hop <= (options.followRedirects ? options.maxRedirects : 0); hop += 1) {
    let target: ValidatedTarget;
    try {
      target = await resolveAndValidate(currentUrl);
    } catch (error) {
      if (error instanceof UnsafeTargetError) {
        throw new RequestFailure(
          'blocked_destination',
          hop === 0
            ? error.reason
            : `Redirect to ${redactString(currentUrl, 120)} was blocked: ${error.reason}`,
          { redirectChain },
        );
      }
      throw error;
    }

    const remaining = overallDeadline - Date.now();
    if (remaining <= 250) {
      throw new RequestFailure('connection_timeout', `The request timed out after ${options.timeoutMs} ms.`);
    }

    const headers: Record<string, string> = {
      host: target.url.host,
      'user-agent': options.userAgent,
      accept: '*/*',
      'accept-encoding': 'identity',
      connection: 'close',
      ...(options.headers ?? {}),
    };
    if (body && !headers['content-type']) headers['content-type'] = 'application/json';

    const { response } = await requestOnce(
      target,
      { ...options, url: currentUrl, method, body, timeoutMs: remaining },
      headers,
    );

    response.redirectChain = [...redirectChain];
    response.finalUrl = currentUrl;

    const isRedirect = [301, 302, 303, 307, 308].includes(response.status);
    const location = response.headers['location'];
    if (isRedirect && location && options.followRedirects) {
      const nextUrl = new URL(location, currentUrl).toString();
      redirectChain.push(nextUrl);
      currentUrl = nextUrl;
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
        method = 'GET';
        body = undefined;
      }
      continue;
    }

    return response;
  }

  throw new RequestFailure('redirect_error', `The request exceeded the maximum of ${options.maxRedirects} redirects.`, {
    redirectChain,
  });
}

export function safePreview(text: string, maxLength = 800): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return redactString(collapsed, maxLength);
}
