import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import {
  Check,
  Incident,
  IncidentEvent,
  Project,
  User,
  Workspace,
  applyRunToIncident,
  acknowledgeIncident,
  isNonOutageFailure,
  resolveIncidentManually,
} from '../index';
import { failureResult, successResult } from '../monitoring/types';
import type { CheckDoc } from '../models/check';

/**
 * The incident state machine is the most consequential logic in the product:
 * it decides whether a client is told their site is down. These tests assert
 * the documented transitions, threshold behaviour, deduplication of continuing
 * failures and the separation of acknowledgement from resolution.
 */

let workspaceId: mongoose.Types.ObjectId;
let projectId: mongoose.Types.ObjectId;
let userId: mongoose.Types.ObjectId;

beforeAll(async () => {
  const user = await User.create({
    name: 'Incident Tester',
    email: `incident-${Date.now()}@example.com`,
    normalizedEmail: `incident-${Date.now()}@example.com`,
    passwordHash: 'x'.repeat(30),
    timezone: 'UTC',
    emailVerified: true,
  });
  userId = user._id;
  const workspace = await Workspace.create({ name: 'Incident Agency', ownerId: user._id, alertEmail: 'alerts@example.com' });
  workspaceId = workspace._id;
  const project = await Project.create({
    workspaceId: workspace._id,
    name: 'Client Site',
    url: 'https://client-site.example.com',
    canonicalUrl: 'https://client-site.example.com/',
    createdBy: user._id,
  });
  projectId = project._id;
});

async function makeCheck(overrides: Partial<CheckDoc> = {}): Promise<CheckDoc> {
  return Check.create({
    workspaceId,
    projectId,
    name: 'Homepage responds',
    type: 'http',
    config: { url: 'https://client-site.example.com', method: 'GET', followRedirects: true },
    enabled: true,
    intervalSeconds: 300,
    timeoutMs: 10_000,
    failureThreshold: 2,
    recoveryThreshold: 2,
    severity: 'major',
    createdBy: userId,
    ...overrides,
  }) as unknown as Promise<CheckDoc>;
}

/** Applies `n` runs and returns the transitions observed in order. */
async function applyRuns(checkId: mongoose.Types.ObjectId, outcomes: boolean[]) {
  const transitions: string[] = [];
  for (const [index, success] of outcomes.entries()) {
    const check = (await Check.findById(checkId)) as unknown as CheckDoc;
    if (success) {
      check.consecutiveSuccesses += 1;
      check.consecutiveFailures = 0;
    } else {
      check.consecutiveFailures += 1;
      check.consecutiveSuccesses = 0;
    }
    await Check.updateOne(
      { _id: check._id },
      { $set: { consecutiveFailures: check.consecutiveFailures, consecutiveSuccesses: check.consecutiveSuccesses } },
    );

    const result = success
      ? successResult(120, { httpStatus: 200 })
      : failureResult(index === 0 ? 'http_status' : 'http_status', 'The website returned HTTP 500', 120, { httpStatus: 500 }, [], 500);

    const applied = await applyRunToIncident({
      check,
      result,
      runId: `run-${index}`,
      startedAt: new Date(Date.now() + index * 1000),
      failureCategory: result.failureCategory,
      errorSummary: result.errorSummary,
    });
    transitions.push(applied.transition);
  }
  return transitions;
}

describe('incident state machine: Healthy → Suspected → Open → Recovery → Resolved', () => {
  it('does not open an incident below the failure threshold', async () => {
    const check = await makeCheck({ failureThreshold: 3 });
    const transitions = await applyRuns(check._id, [false, false]);
    expect(transitions).toEqual(['none', 'none']);
    expect(await Incident.countDocuments({ checkId: check._id })).toBe(0);
  });

  it('opens exactly one incident once the threshold is reached and dedupes continuing failures', async () => {
    const check = await makeCheck({ failureThreshold: 2 });
    const transitions = await applyRuns(check._id, [false, false, false, false, false]);

    expect(transitions).toEqual(['none', 'opened', 'failure_recorded', 'failure_recorded', 'failure_recorded']);
    const incidents = await Incident.find({ checkId: check._id });
    expect(incidents).toHaveLength(1);
    expect(incidents[0].status).toBe('open');
    expect(incidents[0].failureCount).toBe(5);

    // The timeline preserves every run, not just the first.
    const events = await IncidentEvent.find({ incidentId: incidents[0]._id }).sort({ createdAt: 1 });
    expect(events.map((event) => event.type)).toEqual(['opened', 'failure', 'failure', 'failure']);
  });

  it('requires the configured number of consecutive successes before resolving', async () => {
    const check = await makeCheck({ failureThreshold: 1, recoveryThreshold: 2 });
    await applyRuns(check._id, [false]);

    const transitions = await applyRuns(check._id, [true, true]);
    expect(transitions).toEqual(['recovery_started', 'resolved']);

    const incident = await Incident.findOne({ checkId: check._id });
    expect(incident?.status).toBe('resolved');
    expect(incident?.resolvedAt).toBeInstanceOf(Date);
    expect(incident?.recoveryVerifiedCount).toBeGreaterThanOrEqual(2);
    expect(incident?.activeKey).toBeNull();
    expect(incident?.resolvedBy ?? null).toBeNull();
    expect(incident?.resolvedByName).toBe('Recovery verified automatically');
  });

  it('returns to open when recovery verification fails', async () => {
    const check = await makeCheck({ failureThreshold: 1, recoveryThreshold: 3 });
    await applyRuns(check._id, [false]);
    await applyRuns(check._id, [true]);

    const transitions = await applyRuns(check._id, [false]);
    expect(transitions[0]).toBe('recovery_failed');

    const incident = await Incident.findOne({ checkId: check._id });
    expect(incident?.status).toBe('open');
    expect(await Incident.countDocuments({ checkId: check._id })).toBe(1);
  });

  it('opens a new incident after a resolution', async () => {
    const check = await makeCheck({ failureThreshold: 1, recoveryThreshold: 1 });
    await applyRuns(check._id, [false, true]);
    const transitions = await applyRuns(check._id, [false]);

    expect(transitions[0]).toBe('opened');
    expect(await Incident.countDocuments({ checkId: check._id })).toBe(2);
  });
});

describe('incident state machine: non-outage failures', () => {
  it.each(['auth_failure', 'config_error', 'blocked_destination', 'internal_error', 'browser_runtime_error'] as const)(
    'classifies %s as non-outage',
    (category) => {
      expect(isNonOutageFailure(category)).toBe(true);
    },
  );

  it.each(['http_status', 'connection_refused', 'timeout', 'assertion_failed', 'content_mismatch', 'dns_failure'] as const)(
    'classifies %s as a potential outage',
    (category) => {
      expect(isNonOutageFailure(category)).toBe(false);
    },
  );

  it('never opens an incident for an authentication failure', async () => {
    const check = await makeCheck({ failureThreshold: 1 });
    for (let index = 0; index < 4; index += 1) {
      const current = (await Check.findById(check._id)) as unknown as CheckDoc;
      const result = failureResult('auth_failure', 'The site rejected the stored test credentials', 90, {}, [], 401);
      const applied = await applyRunToIncident({
        check: current,
        result,
        runId: `auth-${index}`,
        startedAt: new Date(),
        failureCategory: 'auth_failure',
        errorSummary: result.errorSummary,
      });
      expect(applied.transition).toBe('verification_skipped');
    }
    expect(await Incident.countDocuments({ checkId: check._id })).toBe(0);
  });

  it('does not resolve an open incident when verification is impossible', async () => {
    const check = await makeCheck({ failureThreshold: 1, recoveryThreshold: 1 });
    await applyRuns(check._id, [false]);

    const current = (await Check.findById(check._id)) as unknown as CheckDoc;
    const result = failureResult('config_error', 'The selector no longer exists', 80, {}, [], null);
    const applied = await applyRunToIncident({
      check: current,
      result,
      runId: 'config-1',
      startedAt: new Date(),
      failureCategory: 'config_error',
      errorSummary: result.errorSummary,
    });

    expect(applied.transition).toBe('verification_skipped');
    const incident = await Incident.findOne({ checkId: check._id });
    expect(incident?.status).toBe('open');
  });
});

describe('incident actions', () => {
  let incidentId: mongoose.Types.ObjectId;

  beforeEach(async () => {
    const check = await makeCheck({ failureThreshold: 1, recoveryThreshold: 5 });
    await applyRuns(check._id, [false]);
    const incident = await Incident.findOne({ checkId: check._id });
    incidentId = incident!._id;
  });

  it('acknowledgement does not change the monitoring verdict', async () => {
    const before = await Incident.findById(incidentId);
    await acknowledgeIncident({ workspaceId: String(workspaceId), incidentId, userId: String(userId), userName: 'Incident Tester' });
    const after = await Incident.findById(incidentId);

    expect(before?.status).toBe('open');
    expect(after?.status).toBe('acknowledged');
    expect(after?.acknowledgedAt).toBeInstanceOf(Date);
    expect(after?.resolvedAt).toBeNull();
    expect(after?.activeKey).toBe('active');
  });

  it('manual resolution is recorded separately from recovery verification', async () => {
    await resolveIncidentManually({
      workspaceId: String(workspaceId),
      incidentId,
      userId: String(userId),
      userName: 'Incident Tester',
      note: 'Client rebooted the origin server',
    });
    const incident = await Incident.findById(incidentId);
    expect(incident?.status).toBe('resolved');
    expect(incident?.resolvedBy?.toString()).toBe(String(userId));
    expect(incident?.resolvedByName).toBe('Incident Tester');
    expect(incident?.resolutionNote).toBe('Client rebooted the origin server');
    expect(incident?.activeKey).toBeNull();

    const events = await IncidentEvent.find({ incidentId }).sort({ createdAt: 1 });
    const last = events[events.length - 1];
    expect(last.type).toBe('resolved');
    expect(last.message).toContain('Client rebooted the origin server');
  });
});
