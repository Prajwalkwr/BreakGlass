import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import IORedis from 'ioredis';
import { RedisQueue } from './redisQueue';
import { resetEnvCache } from '../config/env';
import type { ReservedJob } from './driver';

/**
 * Redis + BullMQ driver tests.
 *
 * These run against a real Redis (the same one the worker uses) and are skipped
 * when none is reachable, so `npm test` still passes in environments without
 * Redis — the Mongo driver tests remain the always-on coverage.
 */

const REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379';
let queue: RedisQueue;

async function probe(): Promise<boolean> {
  const client = new IORedis(REDIS_URL, { maxRetriesPerRequest: 1, retryStrategy: () => null, lazyConnect: true });
  client.on('error', () => undefined);
  try {
    await client.connect();
    const pong = await client.ping();
    return pong === 'PONG';
  } catch {
    return false;
  } finally {
    client.disconnect();
  }
}

// Probed at module scope so `describe.skipIf` sees the real answer.
const available = await probe();

beforeAll(async () => {
  if (!available) return;
  process.env.REDIS_URL = REDIS_URL;
  process.env.QUEUE_DRIVER = 'redis';
  resetEnvCache();
  queue = new RedisQueue();
  // Start from a clean slate for this suite's queues.
  await queue.stats();
  const client = new IORedis(REDIS_URL);
  const keys = await client.keys('bull:breakglass-*');
  if (keys.length) await client.del(...keys);
  client.disconnect();
});

afterAll(async () => {
  if (available && queue) await queue.close();
});

describe.skipIf(!available)('Redis + BullMQ queue', () => {
  it('reports its driver kind so health can surface it', () => {
    expect(queue.kind).toBe('redis');
  });

  it('enqueues a job that shows up in queue stats', async () => {
    const result = await queue.enqueue('check-run', {
      name: 'run-check',
      payload: { checkId: 'abc' },
    });
    expect(result.deduplicated).toBe(false);

    const stats = await queue.stats('check-run');
    expect(stats.waiting + stats.active + stats.delayed).toBeGreaterThanOrEqual(1);
  });

  it('deduplicates while a keyed job is still live', async () => {
    const first = await queue.enqueue('notify', {
      name: 'deliver-notification',
      payload: { deliveryId: 'one' },
      dedupeKey: 'dedupe-live',
    });
    const second = await queue.enqueue('notify', {
      name: 'deliver-notification',
      payload: { deliveryId: 'two' },
      dedupeKey: 'dedupe-live',
    });

    expect(second.jobId).toBe(first.jobId);
    expect(second.deduplicated).toBe(true);
  });

  it('delivers jobs to a BullMQ consumer with the payload intact', async () => {
    const seen: ReservedJob[] = [];
    const consumer = await queue.startConsumers(
      {
        handle: async (job) => {
          seen.push(job);
        },
      },
      { workerId: 'test-worker', checkConcurrency: 1, notifyConcurrency: 1, isRunning: () => true },
    );

    await queue.enqueue('check-run', {
      name: 'run-check',
      payload: { checkId: 'consumer-check', triggeredBy: 'schedule' },
      dedupeKey: 'consumer-test-job',
    });

    const deadline = Date.now() + 15_000;
    while (seen.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await consumer.stop();

    // Earlier tests leave unrelated jobs in the same queue, so match ours.
    const ours = seen.filter((job) => (job.payload as { checkId?: string }).checkId === 'consumer-check');
    expect(ours.length).toBe(1);
    expect(ours[0].payload).toMatchObject({ triggeredBy: 'schedule' });
    expect(ours[0].queue).toBe('check-run');
  });

  it('retries a failing job and records the failure after the attempts are spent', async () => {
    let attempts = 0;
    const consumer = await queue.startConsumers(
      {
        handle: async () => {
          attempts += 1;
          throw new Error('simulated handler failure');
        },
      },
      { workerId: 'test-worker-retry', checkConcurrency: 1, notifyConcurrency: 1, isRunning: () => true },
    );

    await queue.enqueue('check-run', {
      name: 'run-check',
      payload: { checkId: 'always-fails' },
      dedupeKey: 'retry-test-job',
      maxAttempts: 2,
    });

    // BullMQ backs off exponentially; the first retry lands a few seconds later.
    const deadline = Date.now() + 25_000;
    while (attempts < 2 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    await consumer.stop();

    expect(attempts).toBeGreaterThanOrEqual(2);
    const stats = await queue.stats('check-run');
    expect(stats.dead).toBeGreaterThanOrEqual(1);
  });

  it('refuses the poll-based API so a misconfigured worker fails loudly', async () => {
    await expect(queue.reserve()).rejects.toThrow(/call startConsumers/);
    await expect(queue.complete()).rejects.toThrow(/BullMQ/);
    await expect(queue.fail()).rejects.toThrow(/BullMQ/);
  });
});
