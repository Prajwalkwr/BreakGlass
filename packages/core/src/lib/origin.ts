import type { Env } from '../config/env';
import { allowedOrigins, isProduction } from '../config/env';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0']);

/**
 * Decides whether a browser origin may perform a state-changing request.
 *
 * Accepted when:
 *  - it is explicitly configured (APP_ORIGIN, API_ORIGIN, ALLOWED_ORIGINS), or
 *  - it matches the Host header of the request itself (same-origin deployment
 *    behind a reverse proxy or a dev proxy — the browser's Origin is the public
 *    host, which the API also sees as Host), or
 *  - outside production, it is a loopback origin (any port).
 */
export function isAllowedOrigin(
  candidate: string | undefined | null,
  requestHost: string | undefined,
  env: Env,
): boolean {
  if (!candidate) return false;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

  const normalised = parsed.origin.replace(/\/$/, '');
  const configured = allowedOrigins(env).map((origin) => origin.replace(/\/$/, ''));
  if (configured.includes(normalised)) return true;

  if (requestHost && parsed.host.toLowerCase() === requestHost.toLowerCase()) return true;

  if (!isProduction(env) && LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) return true;

  return false;
}
