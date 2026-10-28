import { readFile } from 'node:fs/promises';
import { describe, expect, it, beforeEach } from 'vitest';
import {
  Incident,
  IncidentEvent,
  NotificationDelivery,
  NotificationDestination,
  Workspace,
  processDelivery,
  queueIncidentNotifications,
  createDestination,
} from '@breakglass/core';
import { makeIncident, makeProject, makeWorkspace } from '../testing/fixtures';

/**
 * Notification behaviour: one alert per incident per destination, a throttled
 * repeat event, and delivery records that say exactly what happened.
 */
describe('notification service', () => {
  let workspaceId: string;
  let projectId: string;
  let destinationId: string;
  let incidentId: string;

  beforeEach(async () => {
    const workspace = await makeWorkspace({ name: 'Agency', notifyOnOpen: true, notifyOnResolve: true });
    workspaceId = String(workspace._id);
    const project = await makeProject(workspaceId, { name: 'Client site', url: 'https://example.com' });
    projectId = String(project._id);
    const destination = await createDestination({
      workspaceId,
      type: 'email',
      address: 'ops@example.com',
      label: 'Ops inbox',
    });
    destinationId = String(destination._id);
    const incident = await makeIncident({ workspaceId, projectId, status: 'open' });
    incidentId = String(incident._id);
  });

  it('queues exactly one delivery per destination for an incident opening', async () => {
    const incident = await Incident.findById(incidentId);
    const first = await queueIncidentNotifications({ incident: incident!, eventType: 'incident_opened' });
    const second = await queueIncidentNotifications({ incident: incident!, eventType: 'incident_opened' });

    expect(first).toBe(1);
    expect(second).toBe(0); // dedupe key already exists
    expect(await NotificationDelivery.countDocuments({ incidentId })).toBe(1);
  });

  it('keeps a separate delivery per destination', async () => {
    await createDestination({ workspaceId, type: 'email', address: 'second@example.com', label: 'Second' });
    const incident = await Incident.findById(incidentId);
    const queued = await queueIncidentNotifications({ incident: incident!, eventType: 'incident_opened' });

    expect(queued).toBe(2);
    expect(await NotificationDelivery.countDocuments({ incidentId })).toBe(2);
  });

  it('throttles repeat notifications into one per time bucket', async () => {
    const workspace = await Workspace.findById(workspaceId);
    workspace!.settings.notifyOnRepeatFailures = true;
    await workspace!.save();

    const incident = await Incident.findById(incidentId);
    const first = await queueIncidentNotifications({ incident: incident!, eventType: 'incident_repeat' });
    const second = await queueIncidentNotifications({ incident: incident!, eventType: 'incident_repeat' });

    expect(first).toBe(1);
    expect(second).toBe(0);
  });

  it('records a notification_queued incident event', async () => {
    const incident = await Incident.findById(incidentId);
    await queueIncidentNotifications({ incident: incident!, eventType: 'incident_opened' });
    const events = await IncidentEvent.find({ incidentId, type: 'notification_queued' });
    expect(events).toHaveLength(1);
    expect(events[0].message).toMatch(/Queued 1 opened notification/);
  });

  it('does not notify when the workspace has turned the event off', async () => {
    const workspace = await Workspace.findById(workspaceId);
    workspace!.settings.notifyOnOpen = false;
    await workspace!.save();

    const incident = await Incident.findById(incidentId);
    const queued = await queueIncidentNotifications({ incident: incident!, eventType: 'incident_opened' });
    expect(queued).toBe(0);
  });

  it('skips queuing for a disabled destination', async () => {
    await NotificationDestination.updateOne({ _id: destinationId }, { $set: { enabled: false } });
    const incident = await Incident.findById(incidentId);
    const queued = await queueIncidentNotifications({ incident: incident!, eventType: 'incident_opened' });
    expect(queued).toBe(0);
  });

  it('marks a dev-outbox delivery as sent and links the outbox file', async () => {
    const incident = await Incident.findById(incidentId);
    await queueIncidentNotifications({ incident: incident!, eventType: 'incident_opened' });
    const delivery = await NotificationDelivery.findOne({ incidentId });

    const result = await processDelivery(String(delivery!._id));
    expect(result.ok).toBe(true);

    const updated = await NotificationDelivery.findById(delivery!._id);
    expect(updated!.status).toBe('sent');
    // Honesty check: the provider is the development outbox, not a real mailbox.
    expect(updated!.provider).toBe('development_outbox');
    expect(updated!.attempts).toBe(1);
    expect(updated!.sentAt).toBeInstanceOf(Date);
  });

  it('never claims delivery (only acceptance) for email', async () => {
    const incident = await Incident.findById(incidentId);
    await queueIncidentNotifications({ incident: incident!, eventType: 'incident_opened' });
    const delivery = await NotificationDelivery.findOne({ incidentId });
    await processDelivery(String(delivery!._id));

    const updated = await NotificationDelivery.findById(delivery!._id);
    expect(updated!.status).not.toBe('delivered');
  });

  it('records a failure with the provider error when the destination is unusable', async () => {
    // A slack destination with an unreadable webhook exercises the failure path.
    await NotificationDestination.updateOne(
      { _id: destinationId },
      { $set: { type: 'slack', address: undefined, label: 'Broken webhook' } },
    );
    const incident = await Incident.findById(incidentId);
    await queueIncidentNotifications({ incident: incident!, eventType: 'incident_opened' });
    const delivery = await NotificationDelivery.findOne({ incidentId });

    const result = await processDelivery(String(delivery!._id));
    expect(result.ok).toBe(false);

    const updated = await NotificationDelivery.findById(delivery!._id);
    expect(updated!.status).toBe('failed');
    expect(updated!.error).toBeTruthy();
  });

  it('writes a message that names the incident and states it is a development outbox', async () => {
    const incident = await Incident.findById(incidentId);
    await queueIncidentNotifications({ incident: incident!, eventType: 'incident_opened' });
    const delivery = await NotificationDelivery.findOne({ incidentId });
    await processDelivery(String(delivery!._id));

    const updated = await NotificationDelivery.findById(delivery!._id);
    expect(updated!.providerRef).toBeTruthy();
    const html = await readFile(updated!.providerRef!, 'utf8');
    expect(html).toContain('Incident opened');
    expect(html).toContain('Homepage responds');
    expect(html).toContain('suggestions only, not confirmed causes');
    expect(html).toContain('/app/incidents/');
    // The banner must not pretend a real mailbox was contacted.
    expect(html.toLowerCase()).toContain('not sent to a real mailbox');
  });
});
