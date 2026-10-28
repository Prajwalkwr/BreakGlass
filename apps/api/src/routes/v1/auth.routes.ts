import { Router } from 'express';
import {
  emailIsConfigured,
  listSessions,
  loadEnv,
  loginUser,
  registerUser,
  requestPasswordReset,
  resendVerificationEmail,
  resetPassword,
  revokeAllSessions,
  revokeSessionById,
  changePassword,
  toSessionUser,
  updateAccount,
  verifyEmailToken,
  listUserWorkspaces,
  unauthorized,
  badRequest,
} from '@breakglass/core';

import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  updateAccountSchema,
} from '@breakglass/shared';
import { asyncHandler, ok } from '../../lib/http';
import {
  clearSessionCookie,
  logoutCurrentSession,
  requireAuth,
  sessionCookieName,
  setSessionCookie,
} from '../../middleware/auth';

export const authRouter = Router();

function clientMeta(req: { get: (name: string) => string | undefined; ip?: string }) {
  return { userAgent: req.get('user-agent') ?? null, ip: req.ip ?? null };
}

authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const input = registerSchema.parse(req.body);
    const { user, session, emailStatus, workspace } = await registerUser({
      ...input,
      ...clientMeta(req),
    });
    setSessionCookie(res, session.token, session.expiresAt);
    ok(
      res,
      {
        user: toSessionUser(user),
        workspaces: await listUserWorkspaces(String(user._id)),
        activeWorkspaceId: String(workspace._id),
        emailVerification: emailStatus,
        emailConfigured: emailIsConfigured(),
      },
      201,
    );
  }),
);

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const { user, session } = await loginUser({ ...input, ...clientMeta(req) });
    setSessionCookie(res, session.token, session.expiresAt);
    ok(res, {
      user: toSessionUser(user),
      workspaces: await listUserWorkspaces(String(user._id)),
    });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    await logoutCurrentSession(req);
    clearSessionCookie(res);
    ok(res, { ok: true });
  }),
);

authRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    if (!req.auth) {
      res.status(200).json({ user: null, workspaces: [] });
      return;
    }
    ok(res, {
      user: toSessionUser(req.auth.user),
      workspaces: await listUserWorkspaces(String(req.auth.user._id)),
      emailConfigured: emailIsConfigured(),
    });
  }),
);

authRouter.post(
  '/forgot-password',
  asyncHandler(async (req, res) => {
    const input = forgotPasswordSchema.parse(req.body);
    const result = await requestPasswordReset(input.email);
    ok(res, {
      ok: true,
      emailConfigured: result.configured,
      message: result.configured
        ? 'If an account exists for that address, a reset link is on its way.'
        : 'Password reset email is not configured on this deployment. Ask a workspace owner to reset your password or contact support.',
    });
  }),
);

authRouter.post(
  '/reset-password',
  asyncHandler(async (req, res) => {
    const input = resetPasswordSchema.parse(req.body);
    await resetPassword(input);
    ok(res, { ok: true, message: 'Your password was updated. Sign in with your new password.' });
  }),
);

authRouter.post(
  '/verify-email',
  asyncHandler(async (req, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    if (!token) throw badRequest('A verification token is required.');
    await verifyEmailToken(token);
    ok(res, { ok: true });
  }),
);

authRouter.post(
  '/resend-verification',
  requireAuth,
  asyncHandler(async (req, res) => {
    const status = await resendVerificationEmail(String(req.auth!.user._id));
    const messages: Record<string, string> = {
      sent: 'Verification email sent.',
      not_configured: 'Email delivery is not configured on this deployment, so no verification email could be sent.',
      failed: 'The verification email could not be sent. Try again later.',
      already_verified: 'This address is already verified.',
    };
    ok(res, { status, message: messages[status] ?? 'Unknown status.' });
  }),
);

authRouter.patch(
  '/account',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = updateAccountSchema.parse(req.body);
    const user = await updateAccount({ userId: String(req.auth!.user._id), ...input });
    ok(res, { user: toSessionUser(user) });
  }),
);

authRouter.post(
  '/change-password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = changePasswordSchema.parse(req.body);
    await changePassword({
      userId: String(req.auth!.user._id),
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
      keepSessionId: req.auth!.sessionId,
    });
    ok(res, { ok: true, message: 'Password updated. Other sessions have been signed out.' });
  }),
);

authRouter.get(
  '/sessions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const sessions = await listSessions(String(req.auth!.user._id));
    ok(res, {
      sessions: sessions.map((session) => ({
        ...session,
        current: session.id === req.auth!.sessionId,
      })),
    });
  }),
);

authRouter.delete(
  '/sessions/:sessionId',
  requireAuth,
  asyncHandler(async (req, res) => {
    await revokeSessionById(String(req.auth!.user._id), req.params.sessionId);
    ok(res, { ok: true });
  }),
);

authRouter.post(
  '/sessions/revoke-all',
  requireAuth,
  asyncHandler(async (req, res) => {
    await revokeAllSessions(String(req.auth!.user._id), req.auth!.sessionId);
    ok(res, { ok: true, message: 'All other sessions have been signed out.' });
  }),
);

export { sessionCookieName, setSessionCookie, clearSessionCookie, unauthorized };
