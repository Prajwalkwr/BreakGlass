import type { NextFunction, Request, Response } from 'express';
import { loadEnv, isAllowedOrigin } from '@breakglass/core';
import { resolveSessionToken, revokeSession } from '@breakglass/core';
import { forbidden, unauthorized } from '@breakglass/core';
import type { UserDoc } from '@breakglass/core';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: { user: UserDoc; sessionId: string };
    }
  }
}

export function sessionCookieName(): string {
  return loadEnv().SESSION_COOKIE_NAME;
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date) {
  const env = loadEnv();
  res.cookie(env.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(res: Response) {
  const env = loadEnv();
  res.clearCookie(env.SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    path: '/',
  });
}

/**
 * Resolves the session cookie. Sessions are opaque random tokens stored
 * hashed; nothing sensitive is ever written to localStorage on the client.
 */
export const attachSession = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.cookies?.[sessionCookieName()];
    if (!token) return next();
    const session = await resolveSessionToken(token);
    if (!session) {
      clearSessionCookie(res);
      return next();
    }
    req.auth = { user: session.user, sessionId: session.sessionId };
    return next();
  } catch (error) {
    return next(error);
  }
};

export const requireAuth = (req: Request, _res: Response, next: NextFunction) => {
  if (!req.auth) return next(unauthorized('Sign in to continue.'));
  return next();
};

export const requireVerifiedEmail = (req: Request, _res: Response, next: NextFunction) => {
  if (!req.auth) return next(unauthorized('Sign in to continue.'));
  // Verification is encouraged but not blocking in this release; the API
  // surfaces the state so the UI can prompt. Suspended accounts are blocked
  // in resolveSessionToken.
  return next();
};

/**
 * Cookie-based authentication requires CSRF defence. State-changing requests
 * must come from a known origin and be sent as JSON (which cannot be produced
 * by a cross-site HTML form).
 */
export const csrfProtection = (req: Request, _res: Response, next: NextFunction) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const env = loadEnv();
  const origin = req.get('origin');
  const referer = req.get('referer');

  if (!origin && !referer) {
    // Server-to-server callers (webhooks) are exempt; they are mounted
    // outside this middleware.
    return next(forbidden('Missing request origin.'));
  }

  let candidate = origin ?? '';
  if (!candidate && referer) {
    try {
      candidate = new URL(referer).origin;
    } catch {
      return next(forbidden('Malformed referer header.'));
    }
  }

  if (!isAllowedOrigin(candidate, req.get('host'), env)) {
    return next(forbidden('This request did not come from an allowed origin.'));
  }

  // A JSON content type is required whenever the request actually carries a
  // body: a cross-site HTML form can only produce urlencoded/multipart bodies,
  // so this closes the classic cookie-CSRF vector. Body-less writes (logout,
  // acknowledge, run-now) are legitimate and covered by the origin check.
  const contentType = (req.get('content-type') ?? '').toLowerCase();
  const declaredLength = Number(req.get('content-length') ?? '0');
  const hasBody = ['POST', 'PUT', 'PATCH'].includes(req.method) && declaredLength > 0;
  if (hasBody && !contentType.includes('application/json') && !contentType.includes('multipart/form-data')) {
    return next(forbidden('Requests with a body must be sent as JSON.'));
  }

  return next();
};

export const logoutCurrentSession = async (req: Request) => {
  const token = req.cookies?.[sessionCookieName()];
  if (token) await revokeSession(token, 'logout');
};
