import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Types } from 'mongoose';
import { loadEnv, emailIsConfigured } from '../config/env';
import { User, Session, Token, type UserDoc } from '../models/user';
import { Workspace, Membership } from '../models/workspace';
import { NotificationDestination } from '../models/notification';
import { generateToken, hashToken } from '../lib/crypto';
import { badRequest, conflict, unauthorized } from '../lib/errors';
import { logger } from '../lib/logger';
import { sendMail, } from './transport.service';
import { wrapEmail } from './notification.service';
import type { SessionUser } from '@breakglass/shared';

const BCRYPT_ROUNDS = () => (process.env.NODE_ENV === 'test' ? 8 : 12);
const MAX_FAILED_LOGINS = 10;
const LOCKOUT_MINUTES = 15;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function toSessionUser(user: UserDoc): SessionUser {
  return {
    id: String(user._id),
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerified,
    timezone: user.timezone,
    createdAt: user.createdAt.toISOString(),
  };
}

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS());
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

export interface CreatedSession {
  token: string;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  sessionId: string;
}

export async function createSession(params: {
  userId: Types.ObjectId | string;
  userAgent?: string | null;
  ip?: string | null;
}): Promise<CreatedSession> {
  const env = loadEnv();
  const token = generateToken(32);
  const ttlDays = env.SESSION_TTL_DAYS;
  const expiresAt = new Date(Date.now() + ttlDays * 86_400_000);
  const absoluteExpiresAt = new Date(Date.now() + Math.max(ttlDays, 30) * 86_400_000);

  const session = await Session.create({
    userId: params.userId,
    tokenHash: hashToken(token),
    expiresAt,
    absoluteExpiresAt,
    userAgent: params.userAgent?.slice(0, 300) ?? null,
    // Only a hash of the IP is kept, for debugging session origins.
    ipHash: params.ip ? crypto.createHash('sha256').update(params.ip).digest('hex').slice(0, 24) : null,
  });

  return { token, expiresAt, absoluteExpiresAt, sessionId: String(session._id) };
}

export interface ResolvedSession {
  user: UserDoc;
  sessionId: string;
  expiresAt: Date;
}

/** Validates a session cookie value and slides its expiry when it is used. */
export async function resolveSessionToken(token: string): Promise<ResolvedSession | null> {
  if (!token) return null;
  const session = await Session.findOne({ tokenHash: hashToken(token) });
  if (!session) return null;
  if (session.revokedAt) return null;

  const now = Date.now();
  if (session.expiresAt.getTime() <= now || session.absoluteExpiresAt.getTime() <= now) {
    await Session.updateOne({ _id: session._id }, { $set: { revokedAt: new Date(), revokeReason: 'expired' } });
    return null;
  }

  const user = await User.findById(session.userId);
  if (!user || user.status !== 'active') return null;

  const env = loadEnv();
  const halfLife = env.SESSION_TTL_DAYS * 86_400_000 * 0.5;
  if (session.expiresAt.getTime() - now < halfLife) {
    const nextExpiry = new Date(
      Math.min(now + env.SESSION_TTL_DAYS * 86_400_000, session.absoluteExpiresAt.getTime()),
    );
    await Session.updateOne({ _id: session._id }, { $set: { expiresAt: nextExpiry, lastSeenAt: new Date() } });
    session.expiresAt = nextExpiry;
  } else {
    await Session.updateOne({ _id: session._id }, { $set: { lastSeenAt: new Date() } });
  }

  return { user, sessionId: String(session._id), expiresAt: session.expiresAt };
}

export async function revokeSession(token: string, reason = 'logout'): Promise<void> {
  if (!token) return;
  await Session.updateOne({ tokenHash: hashToken(token) }, { $set: { revokedAt: new Date(), revokeReason: reason } });
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string): Promise<void> {
  const filter: Record<string, unknown> = { userId, revokedAt: null };
  if (exceptSessionId) filter._id = { $ne: exceptSessionId };
  await Session.updateMany(filter, { $set: { revokedAt: new Date(), revokeReason: 'revoked' } });
}

export async function revokeSessionById(userId: string, sessionId: string): Promise<void> {
  if (!Types.ObjectId.isValid(sessionId)) throw unauthorized('Session not found.');
  await Session.updateOne(
    { _id: sessionId, userId },
    { $set: { revokedAt: new Date(), revokeReason: 'revoked-by-user' } },
  );
}

export async function listSessions(userId: string) {
  const sessions = await Session.find({ userId, revokedAt: null, expiresAt: { $gt: new Date() } })
    .sort({ lastSeenAt: -1 })
    .limit(20);
  return sessions.map((session) => ({
    id: String(session._id),
    userAgent: session.userAgent,
    createdAt: session.createdAt.toISOString(),
    lastSeenAt: session.lastSeenAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
  }));
}

/* ------------------------------------------------------------------ */
/* Registration & login                                                */
/* ------------------------------------------------------------------ */

async function issueEmailToken(userId: Types.ObjectId, type: 'email_verify' | 'password_reset') {
  const token = generateToken(32);
  const ttl = type === 'email_verify' ? 24 * 3600_000 : 60 * 60_000;
  await Token.create({
    userId,
    type,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + ttl),
  });
  return token;
}

async function sendVerificationEmail(user: UserDoc): Promise<'sent' | 'not_configured' | 'failed'> {
  const env = loadEnv();
  if (!emailIsConfigured(env)) return 'not_configured';
  const token = await issueEmailToken(user._id, 'email_verify');
  const link = `${env.APP_ORIGIN.replace(/\/$/, '')}/verify-email?token=${token}`;
  const result = await sendMail({
    to: user.email,
    subject: 'Confirm your BreakGlass email address',
    text: `Confirm your email address to finish setting up BreakGlass:\n\n${link}\n\nThis link expires in 24 hours.`,
    html: wrapEmail({
      heading: 'Confirm your email address',
      body: `<p>Welcome to BreakGlass, ${user.name}.</p><p>Confirm your email address to finish setting up your account.</p><p><a href="${link}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:13px">Confirm email</a></p><p style="color:#77776f;font-size:12px">This link expires in 24 hours. If you did not create this account you can ignore this message.</p>`,
      footer: 'BreakGlass account security',
    }),
  });
  if (!result.ok) logger().warn({ error: result.error }, 'Verification email failed to send');
  return result.ok ? 'sent' : 'failed';
}

export async function registerUser(params: {
  name: string;
  email: string;
  password: string;
  workspaceName?: string;
  userAgent?: string | null;
  ip?: string | null;
}) {
  const normalizedEmail = normalizeEmail(params.email);
  const existing = await User.findOne({ normalizedEmail });
  if (existing) {
    throw conflict('An account with that email already exists. Try signing in instead.');
  }

  const passwordHash = await hashPassword(params.password);
  const user = await User.create({
    email: params.email.trim(),
    normalizedEmail,
    name: params.name.trim(),
    passwordHash,
    timezone: 'UTC',
    passwordUpdatedAt: new Date(),
  });

  const workspaceName = params.workspaceName?.trim() || `${params.name.trim().split(' ')[0]}'s workspace`;
  const workspace = await Workspace.create({
    name: workspaceName,
    ownerId: user._id,
    alertEmail: user.email,
    settings: { notifyOnOpen: true, notifyOnResolve: true, notifyOnRepeatFailures: false },
  });
  await Membership.create({
    workspaceId: workspace._id,
    userId: user._id,
    role: 'owner',
    status: 'active',
    joinedAt: new Date(),
  });

  // Every new workspace gets a default alert destination so monitoring is
  // useful immediately.
  await NotificationDestination.create({
    workspaceId: workspace._id,
    type: 'email',
    address: user.email,
    label: user.email,
    enabled: true,
    verified: true,
    verifiedAt: new Date(),
  });

  const emailStatus = await sendVerificationEmail(user).catch(() => 'failed' as const);
  const session = await createSession({ userId: user._id, userAgent: params.userAgent, ip: params.ip });

  return { user, workspace, session, emailStatus };
}

export async function loginUser(params: {
  email: string;
  password: string;
  userAgent?: string | null;
  ip?: string | null;
}) {
  const normalizedEmail = normalizeEmail(params.email);
  const user = await User.findOne({ normalizedEmail }).select('+passwordHash');

  // Constant-ish work whether or not the account exists.
  if (!user) {
    await bcrypt.compare(params.password, '$2a$12$0000000000000000000000000000000000000000000000000000');
    throw unauthorized('The email address or password is incorrect.');
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    throw unauthorized(`Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
  }

  if (user.status !== 'active') {
    throw unauthorized('This account has been suspended. Contact your workspace owner.');
  }

  const valid = await verifyPassword(params.password, user.passwordHash);
  if (!valid) {
    const failures = user.failedLoginCount + 1;
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          failedLoginCount: failures,
          lockedUntil: failures >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
        },
      },
    );
    throw unauthorized('The email address or password is incorrect.');
  }

  await User.updateOne(
    { _id: user._id },
    { $set: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } },
  );

  const session = await createSession({ userId: user._id, userAgent: params.userAgent, ip: params.ip });
  return { user, session };
}

/* ------------------------------------------------------------------ */
/* Password reset & email verification                                 */
/* ------------------------------------------------------------------ */

export async function requestPasswordReset(email: string): Promise<{ requested: true; configured: boolean }> {
  const env = loadEnv();
  const user = await User.findOne({ normalizedEmail: normalizeEmail(email) });

  // Always report success so the endpoint cannot be used to enumerate accounts.
  if (!user) return { requested: true, configured: emailIsConfigured(env) };
  if (!emailIsConfigured(env)) {
    logger().warn({ userId: String(user._id) }, 'Password reset requested but no email provider is configured');
    return { requested: true, configured: false };
  }

  const token = await issueEmailToken(user._id, 'password_reset');
  const link = `${env.APP_ORIGIN.replace(/\/$/, '')}/reset-password?token=${token}`;
  await sendMail({
    to: user.email,
    subject: 'Reset your BreakGlass password',
    text: `Reset your password using this link (valid for 60 minutes):\n\n${link}\n\nIf you did not request this, you can ignore this email.`,
    html: wrapEmail({
      heading: 'Reset your password',
      body: `<p>Use the button below to choose a new password. The link is valid for 60 minutes.</p><p><a href="${link}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:13px">Reset password</a></p><p style="color:#77776f;font-size:12px">If you did not request a reset, no action is needed.</p>`,
      footer: 'BreakGlass account security',
    }),
  });

  return { requested: true, configured: true };
}

export async function resetPassword(params: { token: string; password: string }): Promise<void> {
  const record = await Token.findOne({ tokenHash: hashToken(params.token), type: 'password_reset' });
  if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
    throw badRequest('This password reset link is invalid or has expired. Request a new one.');
  }

  const passwordHash = await hashPassword(params.password);
  await User.updateOne(
    { _id: record.userId },
    { $set: { passwordHash, passwordUpdatedAt: new Date(), failedLoginCount: 0, lockedUntil: null } },
  );
  await Token.updateOne({ _id: record._id }, { $set: { usedAt: new Date() } });
  await revokeAllSessions(String(record.userId));
}

export async function verifyEmailToken(token: string): Promise<void> {
  const record = await Token.findOne({ tokenHash: hashToken(token), type: 'email_verify' });
  if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
    throw badRequest('This verification link is invalid or has expired.');
  }
  await User.updateOne(
    { _id: record.userId },
    { $set: { emailVerified: true, emailVerifiedAt: new Date() } },
  );
  await Token.updateOne({ _id: record._id }, { $set: { usedAt: new Date() } });
}

export async function resendVerificationEmail(userId: string): Promise<'sent' | 'not_configured' | 'failed' | 'already_verified'> {
  const user = await User.findById(userId);
  if (!user) throw unauthorized();
  if (user.emailVerified) return 'already_verified';
  return sendVerificationEmail(user);
}

export async function changePassword(params: {
  userId: string;
  currentPassword: string;
  newPassword: string;
  keepSessionId?: string;
}): Promise<void> {
  const user = await User.findById(params.userId).select('+passwordHash');
  if (!user) throw unauthorized();
  const valid = await verifyPassword(params.currentPassword, user.passwordHash);
  if (!valid) throw badRequest('Your current password is incorrect.');

  const passwordHash = await hashPassword(params.newPassword);
  await User.updateOne(
    { _id: user._id },
    { $set: { passwordHash, passwordUpdatedAt: new Date() } },
  );
  await revokeAllSessions(params.userId, params.keepSessionId);
}

export async function updateAccount(params: {
  userId: string;
  name?: string;
  timezone?: string;
}): Promise<UserDoc> {
  const set: Record<string, unknown> = {};
  if (params.name !== undefined) set.name = params.name;
  if (params.timezone !== undefined) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: params.timezone });
    } catch {
      throw badRequest('That timezone is not recognised.');
    }
    set.timezone = params.timezone;
  }
  const user = await User.findByIdAndUpdate(params.userId, { $set: set }, { new: true });
  if (!user) throw unauthorized();
  return user;
}
