import { Types } from 'mongoose';
import { emailIsConfigured, loadEnv } from '../config/env';
import { logger } from '../lib/logger';
import { decryptSecret } from '../lib/crypto';
import {
  NotificationDelivery,
  NotificationDestination,
  type NotificationDeliveryDoc,
  type NotificationDestinationDoc,
} from '../models/notification';
import { Incident, IncidentEvent, type IncidentDoc } from '../models/incident';
import { Project } from '../models/project';
import { Workspace } from '../models/workspace';
import { User } from '../models/user';
import { getQueue } from '../queue';
import { postWebhook, sendMail } from './transport.service';
import { formatDurationMs } from './incident.service';
import { badRequest, notFound } from '../lib/errors';
import { encryptSecret } from '../lib/crypto';
import type { NotificationDeliveryDto } from '@breakglass/shared';

const REPEAT_THROTTLE_MINUTES = 60;

export function toDeliveryDto(delivery: NotificationDeliveryDoc): NotificationDeliveryDto {
  return {
    id: String(delivery._id),
    channel: delivery.channel,
    destinationLabel: delivery.destinationLabel || (delivery.channel === 'email' ? 'Email' : 'Slack'),
    eventType: delivery.eventType,
    status: delivery.status,
    attempts: delivery.attempts,
    provider: delivery.provider,
    error: delivery.error,
    createdAt: delivery.createdAt.toISOString(),
    updatedAt: delivery.updatedAt.toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Destinations                                                        */
/* ------------------------------------------------------------------ */

export async function listDestinations(workspaceId: string) {
  const destinations = await NotificationDestination.find({ workspaceId }).sort({ createdAt: 1 });
  return destinations.map((destination) => ({
    id: String(destination._id),
    type: destination.type,
    address: destination.address,
    label: destination.label || (destination.type === 'email' ? destination.address ?? 'Email' : 'Slack webhook'),
    maskedWebhook: destination.webhookCiphertext ? '•••••• configured' : null,
    enabled: destination.enabled,
    verified: destination.verified,
    lastError: destination.lastError,
    createdAt: destination.createdAt.toISOString(),
  }));
}

export async function createDestination(params: {
  workspaceId: string;
  type: 'email' | 'slack';
  address?: string;
  webhookUrl?: string;
  label?: string;
}): Promise<NotificationDestinationDoc> {
  const count = await NotificationDestination.countDocuments({ workspaceId: params.workspaceId });
  if (count >= 10) throw badRequest('A workspace can have at most 10 notification destinations.');

  const existing = await NotificationDestination.findOne({
    workspaceId: params.workspaceId,
    ...(params.type === 'email' ? { address: params.address } : { type: 'slack' }),
  });
  if (existing && params.type === 'email') throw badRequest('That email address is already configured.');

  if (params.type === 'slack') {
    const url = params.webhookUrl ?? '';
    if (!/^https:\/\/hooks\.slack\.com\//.test(url) && !/^https:\/\//.test(url)) {
      throw badRequest('Enter the full https:// webhook URL from Slack.');
    }
    const encrypted = encryptSecret(url);
    return NotificationDestination.create({
      workspaceId: params.workspaceId,
      type: 'slack',
      address: null,
      webhookCiphertext: encrypted.ciphertext,
      label: params.label ?? 'Slack',
      enabled: true,
      verified: false,
    });
  }

  return NotificationDestination.create({
    workspaceId: params.workspaceId,
    type: 'email',
    address: params.address,
    label: params.label ?? params.address,
    enabled: true,
    verified: false,
  });
}

export async function updateDestination(params: {
  workspaceId: string;
  destinationId: string;
  enabled?: boolean;
}) {
  if (!Types.ObjectId.isValid(params.destinationId)) throw notFound('Destination not found.');
  const destination = await NotificationDestination.findOneAndUpdate(
    { _id: params.destinationId, workspaceId: params.workspaceId },
    { $set: { ...(params.enabled !== undefined ? { enabled: params.enabled } : {}) } },
    { new: true },
  );
  if (!destination) throw notFound('Destination not found.');
  return destination;
}

export async function deleteDestination(workspaceId: string, destinationId: string) {
  if (!Types.ObjectId.isValid(destinationId)) throw notFound('Destination not found.');
  const result = await NotificationDestination.deleteOne({ _id: destinationId, workspaceId });
  if (result.deletedCount === 0) throw notFound('Destination not found.');
}

/**
 * Sends a one-off test message so users can confirm a destination works
 * before relying on it for real alerts.
 */
export async function sendTestNotification(params: { workspaceId: string; destinationId: string; actorName: string }) {
  const destination = await NotificationDestination.findOne({
    _id: params.destinationId,
    workspaceId: params.workspaceId,
  }).select('+webhookCiphertext');
  if (!destination) throw notFound('Destination not found.');

  const env = loadEnv();
  const text = `This is a test notification from BreakGlass, requested by ${params.actorName}. If you can read this, the destination is reachable. Real alerts are only sent when a monitored check opens or resolves an incident.`;

  if (destination.type === 'email') {
    const html = wrapEmail({
      heading: 'Test notification',
      body: `<p>${escapeHtml(text)}</p>`,
      footer: 'Sent because a workspace member clicked “Send test”.',
    });
    const result = await sendMail({ to: destination.address ?? '', subject: 'BreakGlass test notification', text, html });
    const delivery = await NotificationDelivery.create({
      workspaceId: params.workspaceId,
      incidentId: null,
      destinationId: destination._id,
      channel: 'email',
      destinationLabel: destination.address ?? 'Email',
      eventType: 'test',
      status: result.ok ? 'sent' : 'failed',
      attempts: 1,
      maxAttempts: 1,
      provider: result.provider,
      providerRef: result.providerRef,
      error: result.error,
    });
    await NotificationDestination.updateOne(
      { _id: destination._id },
      { $set: { verified: result.ok, verifiedAt: result.ok ? new Date() : null, lastError: result.error } },
    );
    return { ok: result.ok, provider: result.provider, error: result.error, deliveryId: String(delivery._id) };
  }

  let webhookUrl: string | null = null;
  try {
    webhookUrl = destination.webhookCiphertext ? decryptSecret(destination.webhookCiphertext) : null;
  } catch {
    webhookUrl = null;
  }
  if (!webhookUrl) return { ok: false, provider: 'slack', error: 'The stored webhook could not be read.', deliveryId: null };

  const result = await postWebhook(webhookUrl, { text });
  const delivery = await NotificationDelivery.create({
    workspaceId: params.workspaceId,
    incidentId: null,
    destinationId: destination._id,
    channel: 'slack',
    destinationLabel: destination.label || 'Slack',
    eventType: 'test',
    status: result.ok ? 'sent' : 'failed',
    attempts: 1,
    maxAttempts: 1,
    provider: 'slack',
    error: result.error,
  });
  await NotificationDestination.updateOne(
    { _id: destination._id },
    { $set: { verified: result.ok, verifiedAt: result.ok ? new Date() : null, lastError: result.error } },
  );
  void env;
  return { ok: result.ok, provider: 'slack', error: result.error, deliveryId: String(delivery._id) };
}

/* ------------------------------------------------------------------ */
/* Queueing incident notifications                                     */
/* ------------------------------------------------------------------ */

export async function queueIncidentNotifications(params: {
  incident: IncidentDoc;
  eventType: 'incident_opened' | 'incident_resolved' | 'incident_repeat';
}): Promise<number> {
  const { incident, eventType } = params;
  const workspace = await Workspace.findById(incident.workspaceId).lean();
  if (!workspace) return 0;

  if (eventType === 'incident_opened' && !workspace.settings.notifyOnOpen) return 0;
  if (eventType === 'incident_resolved' && !workspace.settings.notifyOnResolve) return 0;
  if (eventType === 'incident_repeat' && !workspace.settings.notifyOnRepeatFailures) return 0;

  const destinations = await NotificationDestination.find({
    workspaceId: incident.workspaceId,
    enabled: true,
  });
  if (!destinations.length) return 0;

  // Notifications must never repeat for the same ongoing incident.
  const bucket = Math.floor(Date.now() / (REPEAT_THROTTLE_MINUTES * 60_000));
  let queued = 0;

  for (const destination of destinations) {
    const dedupeKey =
      eventType === 'incident_repeat'
        ? `repeat:${String(incident._id)}:${String(destination._id)}:${bucket}`
        : `${eventType}:${String(incident._id)}:${String(destination._id)}`;

    try {
      const delivery = await NotificationDelivery.create({
        workspaceId: incident.workspaceId,
        incidentId: incident._id,
        projectId: incident.projectId,
        destinationId: destination._id,
        channel: destination.type,
        destinationLabel: destination.address ?? destination.label ?? destination.type,
        eventType,
        status: 'queued',
        dedupeKey,
        maxAttempts: 4,
      });

      await getQueue().enqueue('notify', {
        name: 'deliver-notification',
        payload: { deliveryId: String(delivery._id) },
        dedupeKey: `notify:${String(delivery._id)}`,
        maxAttempts: 4,
      });
      queued += 1;
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) {
        logger().error({ err: (error as Error).message }, 'Failed to queue notification');
      }
    }
  }

  if (queued > 0) {
    await IncidentEvent.create({
      incidentId: incident._id,
      workspaceId: incident.workspaceId,
      type: 'notification_queued',
      message: `Queued ${queued} ${eventType.replace('incident_', '')} notification${queued === 1 ? '' : 's'}.`,
      actor: 'BreakGlass',
      source: 'system',
    });
  }

  return queued;
}

/* ------------------------------------------------------------------ */
/* Delivery processing                                                 */
/* ------------------------------------------------------------------ */

export async function processDelivery(deliveryId: string): Promise<{ ok: boolean; error?: string }> {
  const delivery = await NotificationDelivery.findById(deliveryId);
  if (!delivery) return { ok: true };
  if (['sent', 'delivered', 'failed', 'skipped'].includes(delivery.status)) {
    return { ok: true }; // already finalised — idempotent
  }

  const destination = await NotificationDestination.findById(delivery.destinationId).select('+webhookCiphertext');
  if (!destination) {
    await NotificationDelivery.updateOne(
      { _id: delivery._id },
      { $set: { status: 'failed', error: 'The destination no longer exists.' } },
    );
    return { ok: false, error: 'destination_missing' };
  }
  if (!destination.enabled) {
    await NotificationDelivery.updateOne(
      { _id: delivery._id },
      { $set: { status: 'skipped', error: 'The destination is disabled.' } },
    );
    return { ok: true };
  }

  const incident = delivery.incidentId ? await Incident.findById(delivery.incidentId) : null;
  const project = incident ? await Project.findById(incident.projectId).lean() : null;
  const workspace = await Workspace.findById(delivery.workspaceId).lean();
  const owner = workspace ? await User.findById(workspace.ownerId).lean() : null;

  const content = buildIncidentMessage({
    eventType: delivery.eventType,
    incident,
    projectName: project?.name ?? 'Project',
    projectUrl: project?.url ?? '',
    workspaceName: workspace?.name ?? 'Workspace',
    timezone: owner?.timezone ?? 'UTC',
  });

  let ok = false;
  let error: string | null = null;
  let provider: string = delivery.channel;
  let providerRef: string | null = null;
  let permanent = false;

  if (delivery.channel === 'email') {
    if (!destination.address) {
      error = 'The email destination has no address.';
      permanent = true;
    } else {
      const result = await sendMail({
        to: destination.address,
        subject: content.subject,
        text: content.text,
        html: content.html,
      });
      ok = result.ok;
      error = result.error;
      provider = result.provider;
      providerRef = result.providerRef;
      permanent = result.permanent;
    }
  } else {
    let webhookUrl: string | null = null;
    try {
      webhookUrl = destination.webhookCiphertext ? decryptSecret(destination.webhookCiphertext) : null;
    } catch {
      webhookUrl = null;
    }
    if (!webhookUrl) {
      error = 'The stored Slack webhook could not be decrypted. Re-add the destination.';
      permanent = true;
    } else {
      const message = `<${content.link}|${content.subject}>`;
      const result = await postWebhook(webhookUrl, {
        text: `${message}\n\n${content.text}`,
        blocks: [
          { type: 'section', text: { type: 'mrkdwn', text: `*${escapeSlack(content.subject)}*\n${escapeSlack(content.text)}` } },
          { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open in BreakGlass' }, url: content.absoluteLink }] },
        ],
      });
      ok = result.ok;
      error = result.error;
      provider = 'slack';
      permanent = result.permanent;
    }
  }

  const attempts = delivery.attempts + 1;
  const willRetry = !ok && !permanent && attempts < delivery.maxAttempts;

  await NotificationDelivery.updateOne(
    { _id: delivery._id },
    {
      $set: {
        status: ok ? 'sent' : willRetry ? 'queued' : 'failed',
        attempts,
        provider,
        providerRef,
        error: error ? error.slice(0, 400) : null,
        sentAt: ok ? new Date() : null,
        nextAttemptAt: willRetry ? new Date(Date.now() + Math.min(60_000 * attempts, 900_000)) : null,
      },
    },
  );

  if (ok) {
    await NotificationDestination.updateOne(
      { _id: destination._id },
      { $set: { verified: true, verifiedAt: new Date(), lastError: null } },
    );
    if (incident) {
      await IncidentEvent.create({
        incidentId: incident._id,
        workspaceId: incident.workspaceId,
        type: 'notification_delivered',
        message:
          provider === 'development_outbox'
            ? `Email accepted by the development outbox (no real mailbox was contacted).`
            : `${delivery.channel === 'email' ? 'Email' : 'Slack message'} accepted by ${provider}.`,
        actor: 'BreakGlass',
        source: 'system',
        details: { deliveryId: String(delivery._id), provider, providerRef },
      });
    }
  } else {
    if (incident) {
      await IncidentEvent.create({
        incidentId: incident._id,
        workspaceId: incident.workspaceId,
        type: 'notification_failed',
        message: willRetry
          ? `Notification delivery failed and will be retried (attempt ${attempts} of ${delivery.maxAttempts}): ${error}`
          : `Notification delivery failed permanently: ${error}`,
        actor: 'BreakGlass',
        source: 'system',
        details: { deliveryId: String(delivery._id), attempt: attempts },
      });
    }
  }

  if (!ok && willRetry) return { ok: false, error: error ?? 'delivery failed' };
  return { ok, ...(error ? { error } : {}) };
}

/* ------------------------------------------------------------------ */
/* Message rendering                                                   */
/* ------------------------------------------------------------------ */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeSlack(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function formatInTimezone(iso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone || 'UTC',
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZoneName: 'short',
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString();
  }
}

export function wrapEmail(params: { heading: string; body: string; footer: string }): string {
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f6f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#111">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e5e0;border-radius:12px">
    <tr><td style="padding:28px 28px 8px 28px">
      <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#6b6b66;margin-bottom:14px">BreakGlass</div>
      <h1 style="margin:0 0 12px 0;font-size:22px;line-height:1.3;font-weight:600">${escapeHtml(params.heading)}</h1>
    </td></tr>
    <tr><td style="padding:0 28px 20px 28px;font-size:14px;line-height:1.65;color:#33332f">${params.body}</td></tr>
    <tr><td style="padding:0 28px 28px 28px;font-size:12px;line-height:1.6;color:#8a8a84;border-top:1px solid #eee;padding-top:16px">${params.footer}</td></tr>
  </table>
</body></html>`;
}

export function buildIncidentMessage(params: {
  eventType: string;
  incident: IncidentDoc | null;
  projectName: string;
  projectUrl: string;
  workspaceName: string;
  timezone: string;
}) {
  const env = loadEnv();
  const base = env.APP_ORIGIN.replace(/\/$/, '');
  const incident = params.incident;
  const link = incident ? `/app/incidents/${String(incident._id)}` : '/app';

  if (!incident) {
    return {
      subject: 'BreakGlass notification',
      text: 'A BreakGlass notification was requested.',
      html: wrapEmail({ heading: 'BreakGlass', body: '<p>Notification</p>', footer: '' }),
      link,
      absoluteLink: `${base}${link}`,
    };
  }

  const firstFailure = formatInTimezone(incident.firstFailureAt.toISOString(), params.timezone);
  const lastFailure = formatInTimezone(incident.lastFailureAt.toISOString(), params.timezone);
  const duration = formatDurationMs((incident.resolvedAt ?? new Date()).getTime() - incident.firstFailureAt.getTime());

  if (params.eventType === 'incident_resolved') {
    const resolvedAt = incident.resolvedAt ? formatInTimezone(incident.resolvedAt.toISOString(), params.timezone) : 'just now';
    const subject = `Resolved — ${params.projectName}: ${incident.checkName}`;
    const text = [
      `${params.projectName} (${params.projectUrl}) is responding normally again.`,
      '',
      `Check: ${incident.checkName}`,
      `Status: resolved (recovery verified)`,
      `First failure: ${firstFailure}`,
      `Resolved: ${resolvedAt}`,
      `Duration: ${duration}`,
      '',
      `Details: ${base}${link}`,
    ].join('\n');
    const html = wrapEmail({
      heading: 'Recovered',
      body: `
        <p style="margin:0 0 14px 0"><strong>${escapeHtml(params.projectName)}</strong><br/><span style="color:#77776f">${escapeHtml(params.projectUrl)}</span></p>
        <p style="margin:0 0 14px 0">The check <strong>${escapeHtml(incident.checkName)}</strong> has passed its recovery threshold, so the incident is resolved.</p>
        <table style="font-size:13px;border-collapse:collapse">
          <tr><td style="padding:2px 12px 2px 0;color:#77776f">First failure</td><td>${escapeHtml(firstFailure)}</td></tr>
          <tr><td style="padding:2px 12px 2px 0;color:#77776f">Resolved</td><td>${escapeHtml(resolvedAt)}</td></tr>
          <tr><td style="padding:2px 12px 2px 0;color:#77776f">Duration</td><td>${escapeHtml(duration)}</td></tr>
        </table>
        <p style="margin:18px 0 0 0"><a href="${base}${link}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:13px">Open incident</a></p>`,
      footer: `BreakGlass monitoring for ${escapeHtml(params.workspaceName)}. Recovery is only declared after ${incident.recoveryVerifiedCount || 'the configured'} consecutive successful checks.`,
    });
    return { subject, text, html, link, absoluteLink: `${base}${link}` };
  }

  const isRepeat = params.eventType === 'incident_repeat';
  const subject = `${isRepeat ? 'Still failing' : 'Incident opened'} — ${params.projectName}: ${incident.checkName}`;
  const text = [
    `${params.projectName} (${params.projectUrl}) is failing its configured check.`,
    '',
    `Check: ${incident.checkName}`,
    `Severity: ${incident.severity}`,
    `Observed: ${incident.summary}`,
    `First failure: ${firstFailure}`,
    `Last failure: ${lastFailure}`,
    `Failed checks in this incident: ${incident.failureCount}`,
    `Status: ${incident.status}`,
    '',
    'Suggested next steps (these are suggestions, not confirmed causes):',
    ...incident.suggestedSteps.map((step) => ` - ${step}`),
    '',
    `Details: ${base}${link}`,
  ].join('\n');

  const html = wrapEmail({
    heading: isRepeat ? 'Still failing' : 'Incident opened',
    body: `
      <p style="margin:0 0 14px 0"><strong>${escapeHtml(params.projectName)}</strong><br/><span style="color:#77776f">${escapeHtml(params.projectUrl)}</span></p>
      <p style="margin:0 0 14px 0">${escapeHtml(incident.summary)}</p>
      <table style="font-size:13px;border-collapse:collapse">
        <tr><td style="padding:2px 12px 2px 0;color:#77776f">Check</td><td>${escapeHtml(incident.checkName)}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#77776f">Severity</td><td>${escapeHtml(incident.severity)}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#77776f">First failure</td><td>${escapeHtml(firstFailure)}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#77776f">Last failure</td><td>${escapeHtml(lastFailure)}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#77776f">Failed checks</td><td>${incident.failureCount}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#77776f">Status</td><td>${escapeHtml(incident.status)}</td></tr>
      </table>
      <p style="margin:18px 0 6px 0;font-size:13px;color:#77776f">Suggested next steps — suggestions only, not confirmed causes:</p>
      <ul style="margin:0 0 0 18px;padding:0;font-size:13px;line-height:1.7">${incident.suggestedSteps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ul>
      <p style="margin:18px 0 0 0"><a href="${base}${link}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:13px">Investigate</a></p>`,
    footer: `BreakGlass monitoring for ${escapeHtml(params.workspaceName)}. Times shown in ${escapeHtml(params.timezone)}.`,
  });

  return { subject, text, html, link, absoluteLink: `${base}${link}` };
}

export function emailStatusForUi() {
  const env = loadEnv();
  const configured = emailIsConfigured(env);
  return {
    configured,
    provider: env.EMAIL_PROVIDER,
    mode: configured ? ('live' as const) : ('development_outbox' as const),
    message: configured
      ? `Alerts are sent through ${env.EMAIL_PROVIDER}.`
      : 'No email provider is configured, so alerts are written to the local development outbox instead of being delivered. Set EMAIL_PROVIDER and its credentials to send real email.',
  };
}
