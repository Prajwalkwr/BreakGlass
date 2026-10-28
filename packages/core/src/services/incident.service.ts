import { Types } from 'mongoose';
import {
  NON_OUTAGE_CATEGORIES,
  type CheckType,
  type FailureCategory,
} from '@breakglass/shared';
import { Check, type CheckDoc } from '../models/check';
import { Incident, IncidentEvent, type IncidentDoc } from '../models/incident';
import { Deployment } from '../models/notification';
import { logger } from '../lib/logger';
import type { ExecutionResult } from '../monitoring/types';

export type IncidentTransition =
  | 'none'
  | 'opened'
  | 'failure_recorded'
  | 'recovery_started'
  | 'recovery_failed'
  | 'resolved'
  | 'verification_skipped';

/**
 * Categories that mean "the monitor could not verify the site" rather than
 * "the site is down". These must never open or resolve an incident on their
 * own, because doing so would misreport the state of the client's website.
 */
export function isNonOutageFailure(category: FailureCategory | null): boolean {
  return category !== null && NON_OUTAGE_CATEGORIES.includes(category);
}

const SUGGESTIONS: Record<string, string[]> = {
  http_status: [
    'Open the affected URL in a browser to confirm what visitors see.',
    'Check the application logs for unhandled errors around the first failure time.',
    'If a deployment was recorded shortly before the failure, review that change first.',
    'Confirm whether a WAF, CDN or maintenance page is intercepting requests.',
  ],
  content_mismatch: [
    'Compare the live page against the expected content configured on this check.',
    'Check whether the page renders for anonymous visitors (not just logged-in staff).',
    'Confirm no feature flag or A/B test changed the copy this check looks for.',
  ],
  json_assertion_failed: [
    'Call the endpoint manually with the same request configuration and inspect the payload.',
    'Confirm the API contract has not changed (field renamed, moved or removed).',
    'Check whether the response is an error envelope returned with a 2xx status.',
  ],
  connection_timeout: [
    'Check whether the origin server is responding to other requests.',
    'Look for elevated latency or saturation on the host, database or upstream dependencies.',
    'Confirm the timeout configured on this check still reflects the site’s normal response time.',
  ],
  connection_refused: [
    'Confirm the web server is running and listening on the configured port.',
    'Check for a firewall, proxy or load-balancer change that could refuse connections.',
    'Verify DNS still points at the intended host.',
  ],
  dns_failure: [
    'Check the DNS records for the domain and their TTL values.',
    'Confirm the domain has not expired or moved registrars.',
    'Test resolution from another network to rule out a resolver-specific problem.',
  ],
  tls_error: [
    'Inspect the certificate chain and expiry date for the domain.',
    'Confirm the certificate covers the exact hostname being monitored.',
    'Check whether an intermediate certificate was omitted during renewal.',
  ],
  redirect_error: [
    'Follow the redirect chain manually and confirm it terminates on a 2xx response.',
    'Check for a redirect loop or a redirect to a host that is no longer served.',
  ],
  response_too_large: [
    'Raise the response size limit if large pages are expected on this site.',
    'Point the check at a lighter page or endpoint that still proves the site is healthy.',
  ],
  element_not_found: [
    'Confirm the selector still exists on the page — layout or component refactors often change it.',
    'Re-run the journey manually with the same viewport size.',
    'Check whether the page needs longer than the configured timeout to render.',
  ],
  text_not_found: [
    'Confirm the expected text is still rendered for the test account and locale.',
    'Check whether the content is loaded asynchronously and needs a wait step.',
  ],
  navigation_timeout: [
    'Measure the page load time in a browser; check for slow third-party scripts.',
    'Check whether the origin is under load or a CDN is degraded.',
  ],
  journey_step_failed: [
    'Walk through the journey manually to see where it diverges.',
    'Review the attached screenshot and console errors captured on failure.',
  ],
  auth_failure: [
    'Confirm the dedicated test account still exists and is not locked or expired.',
    'Rotate the stored password for this check if the client changed it.',
    'Ask the client whether the login form or flow changed recently.',
  ],
  config_error: [
    'Open the check configuration and correct the highlighted field.',
    'Re-run the configuration test before re-enabling the check.',
  ],
  blocked_destination: [
    'Confirm the URL points at a public hostname (private and internal addresses are blocked by design).',
    'If the site is genuinely private, contact support about private-network monitoring.',
  ],
  browser_runtime_error: [
    'The monitoring worker could not start a browser. This is an infrastructure problem, not a website outage.',
    'Check worker logs and confirm the browser runtime is installed on the worker host.',
  ],
  internal_error: [
    'This is a BreakGlass monitoring error rather than a confirmed website failure.',
    'Check the worker logs for the run identifier above.',
  ],
  unknown: ['Inspect the evidence captured with this run and re-run the check manually.'],
};

export function suggestedStepsFor(category: FailureCategory | null, checkType: CheckType): string[] {
  const base = category ? SUGGESTIONS[category] ?? SUGGESTIONS.unknown : SUGGESTIONS.unknown;
  const steps = [...base];
  if (checkType === 'browser') {
    steps.push('For browser journeys, the saved screenshot shows the page state at failure time.');
  }
  return steps.slice(0, 4);
}

function incidentTitle(check: CheckDoc): string {
  return `${check.name} is failing`;
}

async function addEvent(
  incidentId: Types.ObjectId,
  workspaceId: Types.ObjectId,
  type:
    | 'opened'
    | 'failure'
    | 'recovery_started'
    | 'recovery_failed'
    | 'resolved'
    | 'acknowledged'
    | 'reopened'
    | 'note'
    | 'deployment_correlation'
    | 'verification_skipped',
  message: string,
  options: { actor?: string; source?: 'system' | 'user' | 'worker'; details?: Record<string, unknown> } = {},
): Promise<void> {
  await IncidentEvent.create({
    incidentId,
    workspaceId,
    type,
    message,
    actor: options.actor ?? 'BreakGlass',
    source: options.source ?? 'system',
    details: options.details ?? null,
  });
}

export async function findOpenIncident(checkId: string | Types.ObjectId): Promise<IncidentDoc | null> {
  return Incident.findOne({ checkId, activeKey: 'active' });
}

/**
 * Applies one finished check run to the incident state machine and returns
 * the resulting transition so the caller can queue notifications.
 */
export async function applyRunToIncident(params: {
  check: CheckDoc;
  result: ExecutionResult;
  runId: string;
  startedAt: Date;
  failureCategory: FailureCategory | null;
  errorSummary: string | null;
}): Promise<{ transition: IncidentTransition; incident: IncidentDoc | null }> {
  const { check, result, runId, startedAt, failureCategory, errorSummary } = params;
  const workspaceId = check.workspaceId as Types.ObjectId;
  const openIncident = await findOpenIncident(String(check._id));

  /* ---------------- Non-outage outcomes ---------------- */
  if (isNonOutageFailure(failureCategory)) {
    // Verification was impossible; incident state is deliberately untouched.
    if (openIncident) {
      await addEvent(
        openIncident._id,
        workspaceId,
        'verification_skipped',
        `A run could not verify the website (${failureCategory}). The incident remains open because recovery has not been confirmed.`,
        { details: { runId, failureCategory } },
      );
      await Incident.updateOne(
        { _id: openIncident._id },
        { $set: { lastFailureAt: openIncident.lastFailureAt } },
      );
    }
    return { transition: 'verification_skipped', incident: openIncident };
  }

  /* ---------------- Qualifying success ---------------- */
  if (result.success) {
    if (!openIncident) return { transition: 'none', incident: null };

    if (check.consecutiveSuccesses >= check.recoveryThreshold) {
      const resolvedAt = new Date();
      const durationMs = resolvedAt.getTime() - openIncident.firstFailureAt.getTime();
      const updated = await Incident.findOneAndUpdate(
        { _id: openIncident._id, activeKey: 'active' },
        {
          $set: {
            status: 'resolved',
            resolvedAt,
            activeKey: null,
            resolvedByName: 'Recovery verified automatically',
            recoveryVerifiedCount: check.consecutiveSuccesses,
          },
        },
        { new: true },
      );
      if (!updated) return { transition: 'none', incident: null };

      await addEvent(
        updated._id,
        workspaceId,
        'resolved',
        `Recovery verified after ${check.consecutiveSuccesses} consecutive successful checks. Incident duration ${formatDurationMs(durationMs)}.`,
        { details: { runId, consecutiveSuccesses: check.consecutiveSuccesses } },
      );
      return { transition: 'resolved', incident: updated };
    }

    if (openIncident.status !== 'recovering') {
      const updated = await Incident.findOneAndUpdate(
        { _id: openIncident._id, activeKey: 'active' },
        { $set: { status: 'recovering', recoveringSince: new Date() } },
        { new: true },
      );
      await addEvent(
        openIncident._id,
        workspaceId,
        'recovery_started',
        `A successful check was observed. Recovery verification started (${check.consecutiveSuccesses} of ${check.recoveryThreshold} required).`,
        { details: { runId } },
      );
      return { transition: 'recovery_started', incident: updated ?? openIncident };
    }

    return { transition: 'none', incident: openIncident };
  }

  /* ---------------- Qualifying failure ---------------- */
  if (openIncident) {
    const wasRecovering = openIncident.status === 'recovering';
    const updated = await Incident.findOneAndUpdate(
      { _id: openIncident._id, activeKey: 'active' },
      {
        $set: {
          lastFailureAt: startedAt,
          lastFailureCategory: failureCategory,
          lastErrorSummary: errorSummary,
          lastRunId: runId,
          status: openIncident.status === 'recovering' ? (openIncident.acknowledgedAt ? 'acknowledged' : 'open') : openIncident.status,
          recoveringSince: null,
        },
        $inc: { failureCount: 1 },
      },
      { new: true },
    );
    await addEvent(
      openIncident._id,
      workspaceId,
      wasRecovering ? 'recovery_failed' : 'failure',
      wasRecovering
        ? `Recovery verification failed — the check is failing again (${failureCategory ?? 'unknown'}).`
        : `Another failed check was recorded (${failureCategory ?? 'unknown'}).`,
      { source: 'worker', details: { runId, failureCategory, errorSummary } },
    );
    return { transition: wasRecovering ? 'recovery_failed' : 'failure_recorded', incident: updated ?? openIncident };
  }

  if (check.consecutiveFailures < check.failureThreshold) {
    // Suspected failure: not yet an incident.
    return { transition: 'none', incident: null };
  }

  return { transition: 'opened', incident: await openIncidentFor({ check, runId, startedAt, failureCategory, errorSummary }) };
}

export async function openIncidentFor(params: {
  check: CheckDoc;
  runId: string;
  startedAt: Date;
  failureCategory: FailureCategory | null;
  errorSummary: string | null;
}): Promise<IncidentDoc | null> {
  const { check, runId, startedAt, failureCategory, errorSummary } = params;
  const workspaceId = check.workspaceId as Types.ObjectId;

  const summary = buildSummary(failureCategory, check.name, errorSummary);
  const recentDeployment = await Deployment.findOne({
    projectId: check.projectId,
    deployedAt: { $gte: new Date(startedAt.getTime() - 60 * 60 * 1000), $lte: startedAt },
  }).sort({ deployedAt: -1 });

  try {
    const incident = await Incident.create({
      workspaceId,
      projectId: check.projectId,
      checkId: check._id,
      checkName: check.name,
      checkType: check.type,
      status: 'open',
      severity: check.severity,
      title: incidentTitle(check),
      summary,
      firstFailureAt: startedAt,
      lastFailureAt: startedAt,
      failureCount: check.consecutiveFailures,
      lastFailureCategory: failureCategory,
      lastErrorSummary: errorSummary,
      firstRunId: runId,
      lastRunId: runId,
      checkConfigSnapshot: {
        type: check.type,
        config: check.config,
        configVersion: check.configVersion,
        intervalSeconds: check.intervalSeconds,
        timeoutMs: check.timeoutMs,
        failureThreshold: check.failureThreshold,
        recoveryThreshold: check.recoveryThreshold,
      },
      suggestedSteps: suggestedStepsFor(failureCategory, check.type),
      activeKey: 'active',
    });

    await addEvent(
      incident._id,
      workspaceId,
      'opened',
      `Incident opened after ${check.consecutiveFailures} consecutive failed checks (threshold ${check.failureThreshold}).`,
      { source: 'worker', details: { runId, failureCategory, errorSummary } },
    );

    if (recentDeployment) {
      const minutesBefore = Math.round((startedAt.getTime() - recentDeployment.deployedAt.getTime()) / 60_000);
      await addEvent(
        incident._id,
        workspaceId,
        'deployment_correlation',
        `A deployment was recorded approximately ${minutesBefore} minute${minutesBefore === 1 ? '' : 's'} before the first observed failure. Timing correlation is not proof of cause.`,
        {
          details: {
            deploymentId: String(recentDeployment._id),
            commitSha: recentDeployment.commitSha,
            deployedAt: recentDeployment.deployedAt.toISOString(),
            minutesBefore,
          },
        },
      );
      await Incident.updateOne(
        { _id: incident._id },
        {
          $set: {
            suggestedSteps: [
              `A deployment was recorded ${minutesBefore} minute${minutesBefore === 1 ? '' : 's'} before the first failure — review that change first.`,
              ...incident.suggestedSteps,
            ].slice(0, 5),
          },
        },
      );
      return (await Incident.findById(incident._id)) ?? incident;
    }

    return incident;
  } catch (error) {
    // A concurrent worker opened the incident first: update instead of duplicating.
    if ((error as { code?: number }).code === 11000) {
      const existing = await findOpenIncident(String(check._id));
      if (existing) {
        await Incident.updateOne(
          { _id: existing._id },
          {
            $set: { lastFailureAt: startedAt, lastFailureCategory: failureCategory, lastErrorSummary: errorSummary },
            $inc: { failureCount: 1 },
          },
        );
        return existing;
      }
    }
    logger().error({ err: (error as Error).message, checkId: String(check._id) }, 'Failed to open incident');
    throw error;
  }
}

function buildSummary(category: FailureCategory | null, checkName: string, errorSummary: string | null): string {
  const observed = errorSummary ?? 'The check failed without a specific error message.';
  switch (category) {
    case 'http_status':
      return `Observed: ${observed} The check "${checkName}" is configured to expect a different status, so this is a confirmed deviation from the configured expectation.`;
    case 'content_mismatch':
    case 'json_assertion_failed':
      return `Observed: ${observed} The website responded, but its content no longer matches what the check expects.`;
    case 'connection_timeout':
      return `Observed: ${observed} The site did not respond within the configured timeout.`;
    case 'connection_refused':
    case 'dns_failure':
    case 'tls_error':
      return `Observed: ${observed} Visitors are likely unable to load the site.`;
    case 'element_not_found':
    case 'text_not_found':
    case 'journey_step_failed':
    case 'navigation_timeout':
      return `Observed: ${observed} The automated browser journey could not complete.`;
    default:
      return `Observed: ${observed}`;
  }
}

export function formatDurationMs(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours < 24) return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/* ------------------------------------------------------------------ */
/* Manual actions                                                      */
/* ------------------------------------------------------------------ */

export async function acknowledgeIncident(params: {
  workspaceId: string;
  incidentId: string;
  userId: string;
  userName: string;
}): Promise<IncidentDoc> {
  const incident = await Incident.findOne({ _id: params.incidentId, workspaceId: params.workspaceId });
  if (!incident) throw new Error('not_found');
  if (incident.status === 'resolved') {
    throw new Error('resolved');
  }

  const updated = await Incident.findOneAndUpdate(
    { _id: incident._id },
    {
      $set: {
        status: incident.status === 'recovering' ? 'recovering' : 'acknowledged',
        acknowledgedAt: new Date(),
        acknowledgedBy: params.userId,
        acknowledgedByName: params.userName,
      },
    },
    { new: true },
  );

  await addEvent(
    incident._id,
    incident.workspaceId as Types.ObjectId,
    'acknowledged',
    `${params.userName} acknowledged the incident. Acknowledgement does not change the monitoring verdict or mark the website healthy.`,
    { actor: params.userName, source: 'user' },
  );

  return updated ?? incident;
}

export async function resolveIncidentManually(params: {
  workspaceId: string;
  incidentId: string;
  userId: string;
  userName: string;
  note?: string;
}): Promise<IncidentDoc> {
  const incident = await Incident.findOne({ _id: params.incidentId, workspaceId: params.workspaceId });
  if (!incident) throw new Error('not_found');
  if (incident.status === 'resolved') throw new Error('resolved');

  const updated = await Incident.findOneAndUpdate(
    { _id: incident._id, activeKey: 'active' },
    {
      $set: {
        status: 'resolved',
        resolvedAt: new Date(),
        activeKey: null,
        resolvedBy: params.userId,
        resolvedByName: params.userName,
        resolutionNote: params.note ?? null,
      },
    },
    { new: true },
  );

  await addEvent(
    incident._id,
    incident.workspaceId as Types.ObjectId,
    'resolved',
    `${params.userName} resolved the incident manually.${params.note ? ` Note: ${params.note}` : ''} Monitoring continues — a new incident will open if the check fails again.`,
    { actor: params.userName, source: 'user' },
  );

  return updated ?? incident;
}

/** Recomputes the check's runtime status without touching incident state. */
export async function syncCheckRuntimeStatus(check: CheckDoc): Promise<void> {
  const open = await findOpenIncident(String(check._id));
  let runtimeStatus: CheckDoc['runtimeStatus'] = 'healthy';

  if (!check.enabled) runtimeStatus = 'paused';
  else if (check.lastResult && !check.lastResult.success && open) runtimeStatus = 'failing';
  else if (check.lastResult && !check.lastResult.success) {
    if (check.lastResult.failureCategory === 'auth_failure') runtimeStatus = 'auth_failure';
    else if (['config_error', 'blocked_destination'].includes(check.lastResult.failureCategory ?? '')) {
      runtimeStatus = 'misconfigured';
    } else if (['browser_runtime_error', 'internal_error'].includes(check.lastResult.failureCategory ?? '')) {
      runtimeStatus = 'worker_error';
    } else runtimeStatus = 'suspected';
  } else if (!check.lastResult) runtimeStatus = 'pending';

  await Check.updateOne({ _id: check._id }, { $set: { runtimeStatus } });
}
