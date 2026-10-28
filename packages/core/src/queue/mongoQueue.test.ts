import { beforeEach, describe, expect, it } from 'vitest';
import { Job } from '../models/infra';
import { MongoQueue } from './mongoQueue';

const queue = new MongoQueue();

beforeEach(async () => {
  await Job.deleteMany({});
});

describe('durable queue', () => {
  it('claims a job for exactly one worker', async () => {
    const { jobId } = await queue.enqueue('check-run', { name: 'run-check', payload: { checkId: 'a' } });

    const first = await queue.reserve('check-run', 'worker-1', 60_000);
    const second = await queue.reserve('check-run', 'worker-2', 60_000);

    expect(first?.id).toBe(jobId);
    expect(second).toBeNull();
  });

  it('does not reserve a job whose delay has not elapsed', async () => {
    await queue.enqueue('check-run', { name: 'delayed', payload: {}, delayMs: 60_000 });
    const reserved = await queue.reserve('check-run', 'worker-1', 60_000);
    expect(reserved).toBeNull();
  });

  it('is idempotent while a dedupe key is live, and reusable after completion', async () => {
    const key = 'check:dedupe-1:2026-01-01T00:00';
    const first = await queue.enqueue('check-run', { name: 'run-check', payload: {}, dedupeKey: key });
    const second = await queue.enqueue('check-run', { name: 'run-check', payload: {}, dedupeKey: key });

    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    expect(second.jobId).toBe(first.jobId);

    await queue.complete(first.jobId);

    const third = await queue.enqueue('check-run', { name: 'run-check', payload: {}, dedupeKey: key });
    expect(third.deduplicated).toBe(false);
    expect(third.jobId).not.toBe(first.jobId);
  });

  it('reclaims a job whose worker lock expired', async () => {
    const { jobId } = await queue.enqueue('notify', { name: 'send', payload: { deliveryId: 'x' } });
    const reserved = await queue.reserve('notify', 'worker-crashed', 50);
    expect(reserved?.id).toBe(jobId);

    await new Promise((resolve) => setTimeout(resolve, 120));

    const reclaimed = await queue.reserve('notify', 'worker-healthy', 60_000);
    expect(reclaimed?.id).toBe(jobId);
    expect(reclaimed?.attempts).toBe(2);
  });

  it('retries with backoff and finally parks the job as dead', async () => {
    const { jobId } = await queue.enqueue('check-run', { name: 'flaky', payload: {}, maxAttempts: 2 });
    const first = await queue.reserve('check-run', 'worker-1', 60_000);
    expect(first?.id).toBe(jobId);

    const retry = await queue.fail(jobId, 'simulated failure');
    expect(retry.willRetry).toBe(true);
    expect(retry.attempt).toBe(1);

    const delayed = await Job.findById(jobId);
    expect(delayed?.status).toBe('waiting');
    expect(delayed?.runAt.getTime()).toBeGreaterThan(Date.now());
    expect(delayed?.lastError).toContain('simulated failure');

    // Make the backoff elapsed, claim it again and exhaust the attempts.
    await Job.updateOne({ _id: jobId }, { $set: { runAt: new Date(Date.now() - 1000) } });
    const second = await queue.reserve('check-run', 'worker-1', 60_000);
    expect(second?.attempts).toBe(2);

    const final = await queue.fail(jobId, 'still failing');
    expect(final.willRetry).toBe(false);

    const dead = await Job.findById(jobId);
    expect(dead?.status).toBe('dead');
  });

  it('reports queue statistics', async () => {
    const { jobId } = await queue.enqueue('maintenance', { name: 'sweep', payload: {}, maxAttempts: 1 });
    await queue.reserve('maintenance', 'worker-1', 60_000);
    await queue.fail(jobId, 'sweep failed');

    const stats = await queue.stats('maintenance');
    expect(stats).toHaveProperty('waiting');
    expect(stats).toHaveProperty('active');
    expect(stats).toHaveProperty('dead');
    expect(stats.dead).toBeGreaterThanOrEqual(1);
  });
});
