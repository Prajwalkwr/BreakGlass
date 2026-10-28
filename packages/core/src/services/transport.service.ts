import fs from 'node:fs/promises';
import path from 'node:path';
import { emailIsConfigured, loadEnv } from '../config/env';
import { logger } from '../lib/logger';
import { resolveDataPath } from '../lib/paths';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
}

export interface TransportResult {
  ok: boolean;
  /** 'accepted' means the provider accepted the message — not that it was delivered. */
  status: 'accepted' | 'failed';
  provider: 'resend' | 'smtp' | 'development_outbox' | 'none';
  providerRef: string | null;
  error: string | null;
  permanent: boolean;
}

let smtpTransport: import('nodemailer').Transporter | null = null;

async function getSmtpTransport() {
  if (smtpTransport) return smtpTransport;
  const env = loadEnv();
  const nodemailer = await import('nodemailer');
  smtpTransport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return smtpTransport;
}

async function writeToDevelopmentOutbox(message: MailMessage): Promise<string> {
  const dir = resolveDataPath(path.join('.data', 'outbox'));
  await fs.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `${stamp}-${message.to.replace(/[^a-z0-9]/gi, '_')}.html`);
  const document = `<!-- BreakGlass development outbox — this message was NOT sent to a real mailbox -->\n<!-- to: ${message.to} | subject: ${message.subject} -->\n${message.html}`;
  await fs.writeFile(file, document, 'utf8');
  return path.relative(process.cwd(), file);
}

/**
 * Sends mail through the configured provider. In development (or when no
 * provider is configured) messages are written to a local outbox and clearly
 * reported as not delivered — we never claim an email reached a mailbox when
 * only a local write happened.
 */
export async function sendMail(message: MailMessage): Promise<TransportResult> {
  const env = loadEnv();

  if (!emailIsConfigured(env)) {
    if (env.NODE_ENV === 'production') {
      return {
        ok: false,
        status: 'failed',
        provider: 'none',
        providerRef: null,
        error: 'No email provider is configured (EMAIL_PROVIDER). Alerts cannot be sent until it is set.',
        permanent: true,
      };
    }
    try {
      const file = await writeToDevelopmentOutbox(message);
      logger().info({ to: message.to, subject: message.subject, file }, 'Email written to development outbox');
      return {
        ok: true,
        status: 'accepted',
        provider: 'development_outbox',
        providerRef: file,
        error: null,
        permanent: false,
      };
    } catch (error) {
      return {
        ok: false,
        status: 'failed',
        provider: 'none',
        providerRef: null,
        error: (error as Error).message,
        permanent: false,
      };
    }
  }

  if (env.EMAIL_PROVIDER === 'resend') {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.RESEND_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: env.EMAIL_FROM,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
          ...(message.replyTo ? { reply_to: message.replyTo } : {}),
        }),
        signal: AbortSignal.timeout(15_000),
      });

      const payload = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!response.ok) {
        return {
          ok: false,
          status: 'failed',
          provider: 'resend',
          providerRef: null,
          error: `Resend rejected the message (HTTP ${response.status}): ${payload.message ?? 'unknown error'}`.slice(0, 400),
          permanent: response.status >= 400 && response.status < 500 && response.status !== 429,
        };
      }
      return {
        ok: true,
        status: 'accepted',
        provider: 'resend',
        providerRef: payload.id ?? null,
        error: null,
        permanent: false,
      };
    } catch (error) {
      return {
        ok: false,
        status: 'failed',
        provider: 'resend',
        providerRef: null,
        error: `Network error contacting the email provider: ${(error as Error).message}`.slice(0, 400),
        permanent: false,
      };
    }
  }

  // SMTP
  try {
    const transport = await getSmtpTransport();
    const info = await transport.sendMail({
      from: env.EMAIL_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    });
    return {
      ok: true,
      status: 'accepted',
      provider: 'smtp',
      providerRef: info.messageId ?? null,
      error: null,
      permanent: false,
    };
  } catch (error) {
    const responseCode = (error as { responseCode?: number }).responseCode ?? 0;
    return {
      ok: false,
      status: 'failed',
      provider: 'smtp',
      providerRef: null,
      error: `SMTP delivery failed: ${(error as Error).message}`.slice(0, 400),
      // 5xx SMTP replies are permanent failures.
      permanent: responseCode >= 500 && responseCode < 600,
    };
  }
}

export interface WebhookResult {
  ok: boolean;
  status: number;
  error: string | null;
  permanent: boolean;
}

export async function postWebhook(url: string, payload: unknown): Promise<WebhookResult> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: `The webhook endpoint responded with HTTP ${response.status}.`,
        permanent: response.status >= 400 && response.status < 500 && response.status !== 429,
      };
    }
    return { ok: true, status: response.status, error: null, permanent: false };
  } catch (error) {
    return { ok: false, status: 0, error: `Could not reach the webhook: ${(error as Error).message}`.slice(0, 300), permanent: false };
  }
}
