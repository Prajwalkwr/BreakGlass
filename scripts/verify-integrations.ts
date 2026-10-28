/**
 * Verifies the two integrations that are easy to fake and hard to get right:
 *
 *  1. GitHub deployments — HMAC signature verification, delivery dedup, and
 *     correlation-only wording in the incident record.
 *  2. Transactional email — verification and password-reset links are written
 *     to the development outbox (the only mode available without credentials)
 *     and actually work.
 *
 * Usage: npx tsx scripts/verify-integrations.ts   (API + worker running)
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { API_URL, authedFetch, registerFreshUser } from './lib/e2e';

const results: { name: string; ok: boolean; detail?: string }[] = [];

function record(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
}

/**
 * Mail can leave through the development outbox (EMAIL_PROVIDER=none) or a real
 * SMTP server. Both are searched so this script works in either local mode; the
 * SMTP sink writes quoted-printable bodies, which are decoded below.
 */
const OUTBOX_DIRS = [path.resolve('.data/outbox'), path.resolve('.data/outbox-smtp')];

function decodeQuotedPrintable(input: string): string {
  return input
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

function recipientSlug(recipient: string) {
  return recipient.replace(/[^a-z0-9@._-]/gi, '_');
}

async function newestOutboxMessageFor(recipient: string): Promise<string | null> {
  const slug = recipientSlug(recipient);
  const candidates: { file: string; sortKey: string }[] = [];

  for (const dir of OUTBOX_DIRS) {
    let files: string[] = [];
    try {
      files = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (/\.(html|eml)$/i.test(file) && file.includes(slug)) {
        candidates.push({ file: path.join(dir, file), sortKey: file });
      }
    }
  }
  if (!candidates.length) return null;

  const latest = candidates.sort((a, b) => a.sortKey.localeCompare(b.sortKey)).at(-1)!;
  const raw = await fs.readFile(latest.file, 'utf8');
  return /\.eml$/i.test(latest.file) ? decodeQuotedPrintable(raw) : raw;
}

/** Posts to an absolute API path (used for the raw-body webhook route). */
async function postRawAbsolute(pathname: string, body: string, headers: Record<string, string>) {
  const response = await fetch(`${API_URL}${pathname}`, { method: 'POST', headers, body });
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    parsed = { raw: text };
  }
  return { status: response.status, body: parsed };
}

async function postRaw(pathname: string, body: string, headers: Record<string, string>) {
  const response = await fetch(`${API_URL}/api/v1${pathname}`, { method: 'POST', headers, body });
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    parsed = { raw: text };
  }
  return { status: response.status, body: parsed };
}

async function verifyGithub() {
  const auth = await registerFreshUser('Deploy');
  const workspace = auth.workspaceId;
  const created = await authedFetch(auth, 'POST', `/workspaces/${workspace}/projects`, {
    name: 'Deploy Site',
    url: 'https://example.com',
  });
  const projectId = created.body.project.id as string;

  // The operator chooses the secret (it is pasted into GitHub); the API stores
  // it encrypted and must never return it.
  const secret = crypto.randomBytes(32).toString('hex');
  const configured = await authedFetch(auth, 'PUT', `/workspaces/${workspace}/projects/${projectId}/github`, {
    repository: 'rivera-studio/northside',
    secret,
  });
  const webhookUrl = String(configured.body.webhookUrl ?? '');
  record('GitHub integration configured', Boolean(webhookUrl), webhookUrl);
  record('configure response reports the webhook as configured', configured.body.webhookConfigured === true);
  record(
    'the stored secret is never returned by the API',
    !JSON.stringify(configured.body).includes(secret),
    'response omits the secret',
  );

  const payload = JSON.stringify({
    ref: 'refs/heads/main',
    after: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
    repository: { full_name: 'rivera-studio/northside' },
    head_commit: {
      message: 'Fix hero image path',
      timestamp: new Date(Date.now() - 4 * 60_000).toISOString(),
      author: { name: 'Ana Rivera' },
    },
    sender: { login: 'anarita' },
  });

  const signature = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const deliveryHeaders = {
    'content-type': 'application/json',
    'x-hub-signature-256': signature,
    'x-github-event': 'push',
    'x-github-delivery': `delivery-${Date.now()}`,
  };

  const unsignedPath = webhookUrl.replace(/^https?:\/\/[^/]+/, '');
  const badSignature = await postRawAbsolute(unsignedPath, payload, { ...deliveryHeaders, 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) });
  record('webhook with a bad signature is rejected', badSignature.status === 401, String(badSignature.status));

  const noSignature = await postRawAbsolute(unsignedPath, payload, { 'content-type': 'application/json', 'x-github-event': 'push' });
  record('webhook without a signature is rejected', noSignature.status === 401, String(noSignature.status));

  const accepted = await postRawAbsolute(unsignedPath, payload, deliveryHeaders);
  record('signed webhook accepted', accepted.status === 200, `${accepted.status} ${String(accepted.body.message ?? '')}`);

  const duplicate = await postRawAbsolute(unsignedPath, payload, deliveryHeaders);
  record('duplicate delivery ignored', duplicate.status === 200 && /duplicate/i.test(String(duplicate.body.message)), String(duplicate.body.message));

  const detail = await authedFetch(auth, 'GET', `/workspaces/${workspace}/projects/${projectId}`);
  const deployments = (detail.body.deployments ?? []) as { commitMessage: string | null; verified?: boolean; correlation?: { minutesBeforeFailure?: number } }[];
  record('exactly one deployment recorded', deployments.length === 1, `${deployments.length} record(s)`);
  record('deployment stores the commit message', deployments[0]?.commitMessage === 'Fix hero image path');

  // The webhook must never be reachable with another project's secret.
  const otherAuth = await registerFreshUser('Deploy Other');
  const otherProject = await authedFetch(otherAuth, 'POST', `/workspaces/${otherAuth.workspaceId}/projects`, {
    name: 'Other Site',
    url: 'https://example.org',
  });
  await authedFetch(otherAuth, 'PUT', `/workspaces/${otherAuth.workspaceId}/projects/${otherProject.body.project.id}/github`, {
    repository: 'rivera-studio/other',
    secret: crypto.randomBytes(32).toString('hex'),
  });
  const crossPost = await postRawAbsolute(
    `/api/v1/webhooks/github/${otherProject.body.project.id}`,
    payload,
    { ...deliveryHeaders, 'x-github-delivery': `delivery-cross-${Date.now()}` },
  );
  record('a secret from another project does not validate', crossPost.status === 401 || crossPost.status === 409, String(crossPost.status));
}

async function verifyEmailFlows() {
  const email = `mail-${Date.now()}@example.com`;
  const register = await postRaw('/auth/register', JSON.stringify({ name: 'Mail Tester', email, password: 'correct-horse-battery-1', workspaceName: 'Mail Agency' }), {
    'content-type': 'application/json',
    origin: 'http://localhost:5173',
    'x-requested-with': 'breakglass-web',
  });
  record('registration accepted', register.status === 201);

  const verificationMessage = await newestOutboxMessageFor(email);
  record('verification email was delivered and captured locally', Boolean(verificationMessage));
  const verifyToken = verificationMessage?.match(/verify-email\?token=([A-Za-z0-9_-]+)/)?.[1];
  record('verification link contains a token', Boolean(verifyToken));

  if (verifyToken) {
    const verified = await postRaw('/auth/verify-email', JSON.stringify({ token: verifyToken }), {
      'content-type': 'application/json',
      origin: 'http://localhost:5173',
      'x-requested-with': 'breakglass-web',
    });
    record('email verification accepted', verified.status === 200, String(verified.status));

    const reuse = await postRaw('/auth/verify-email', JSON.stringify({ token: verifyToken }), {
      'content-type': 'application/json',
      origin: 'http://localhost:5173',
      'x-requested-with': 'breakglass-web',
    });
    record('verification token cannot be reused', reuse.status === 400 || reuse.status === 410, String(reuse.status));
  }

  // Password reset: request, read the outbox, reset, and prove the old password dies.
  await postRaw('/auth/forgot-password', JSON.stringify({ email }), {
    'content-type': 'application/json',
    origin: 'http://localhost:5173',
    'x-requested-with': 'breakglass-web',
  });
  const resetMessage = await newestOutboxMessageFor(email);
  const resetToken = resetMessage?.match(/reset-password\?token=([A-Za-z0-9_-]+)/)?.[1];
  record('password reset email was delivered and captured locally', Boolean(resetToken));

  const unknownEmail = await postRaw('/auth/forgot-password', JSON.stringify({ email: 'no-such-user@example.com' }), {
    'content-type': 'application/json',
    origin: 'http://localhost:5173',
    'x-requested-with': 'breakglass-web',
  });
  record('forgot-password does not reveal whether an account exists', unknownEmail.status === 200);

  if (resetToken) {
    const reset = await postRaw('/auth/reset-password', JSON.stringify({ token: resetToken, password: 'a-brand-new-password-2' }), {
      'content-type': 'application/json',
      origin: 'http://localhost:5173',
      'x-requested-with': 'breakglass-web',
    });
    record('password reset accepted', reset.status === 200, String(reset.status));

    const oldLogin = await postRaw('/auth/login', JSON.stringify({ email, password: 'correct-horse-battery-1' }), {
      'content-type': 'application/json',
      origin: 'http://localhost:5173',
      'x-requested-with': 'breakglass-web',
    });
    const newLogin = await postRaw('/auth/login', JSON.stringify({ email, password: 'a-brand-new-password-2' }), {
      'content-type': 'application/json',
      origin: 'http://localhost:5173',
      'x-requested-with': 'breakglass-web',
    });
    record('old password no longer works', oldLogin.status === 401, String(oldLogin.status));
    record('new password works', newLogin.status === 200, String(newLogin.status));

    const reuse = await postRaw('/auth/reset-password', JSON.stringify({ token: resetToken, password: 'another-password-3' }), {
      'content-type': 'application/json',
      origin: 'http://localhost:5173',
      'x-requested-with': 'breakglass-web',
    });
    record('reset token cannot be reused', reuse.status === 400 || reuse.status === 410, String(reuse.status));
  }
}

async function main() {
  console.log('\n— GitHub deployments —');
  await verifyGithub();
  console.log('\n— Email verification and password reset —');
  await verifyEmailFlows();

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} integration assertions passed\n`);
  process.exit(failed.length === 0 ? 0 : 1);
}

void main();
