import 'dotenv/config';
import os from 'node:os';
import crypto from 'node:crypto';
import {
  connectDatabase,
  disconnectDatabase,
  ensureIndexes,
  getQueue,
  logger,
  loadEnv,
  processCheckRun,
  processDelivery,
  enqueueDueChecks,
  runMaintenance,
  WorkerHeartbeat,
  type CheckRunJobPayload,
  type ConsumerHandle,
  type QueueName,
  type ReservedJob,
} from '@breakglass/core';

const WORKER_ID = `worker-${os.hostname()}-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
const LOCK_MS = 120_000;

let running = true;
let inFlight = 0;
let processed = 0;
let failed = 0;

function log() {
  return logger().child({ workerId: WORKER_ID });
}

/* ------------------------------------------------------------------ */
/* Job handlers                                                        */
/* ------------------------------------------------------------------ */

async function handleJob(job: ReservedJob): Promise<void> {
  switch (job.queue) {
    case 'check-run': {
      const payload = job.payload as unknown as CheckRunJobPayload;
      const outcome = await processCheckRun({
        checkId: String(payload.checkId),
        triggeredBy: payload.triggeredBy ?? 'schedule',
        jobId: job.id,
        attempt: job.attempts,
      });
      if (!outcome.ran) {
        log().info({ checkId: payload.checkId, reason: outcome.reason }, 'Check run skipped');
      } else {
        log().info(
          { checkId: payload.checkId, runId: outcome.runId, success: outcome.success },
          'Check run completed',
        );
      }
      return;
    }
    case 'notify': {
      const deliveryId = String(job.payload.deliveryId ?? '');
      if (!deliveryId) return;
      const result = await processDelivery(deliveryId);
      if (!result.ok) {
        // Throwing lets the queue apply its retry/backoff policy.
        throw new Error(result.error ?? 'Notification delivery failed');
      }
      return;
    }
    case 'maintenance': {
      const result = await runMaintenance();
      log().info(result, 'Maintenance pass finished');
      return;
    }
    default:
      log().warn({ queue: job.queue }, 'Unknown job type');
  }
}

/* ------------------------------------------------------------------ */
/* Worker loop                                                         */
/* ------------------------------------------------------------------ */

async function pollQueue(queue: QueueName): Promise<void> {
  while (running) {
    let job: ReservedJob | null = null;
    try {
      job = await getQueue().reserve(queue, WORKER_ID, LOCK_MS);
    } catch (error) {
      log().error({ err: (error as Error).message, queue }, 'Failed to reserve a job');
      await sleep(3000);
      continue;
    }

    if (!job) {
      await sleep(1000);
      continue;
    }

    inFlight += 1;
    try {
      await handleJob(job);
      await getQueue().complete(job.id);
      processed += 1;
    } catch (error) {
      failed += 1;
      const message = (error as Error).message ?? 'Unknown job failure';
      const outcome = await getQueue().fail(job.id, message);
      log().error(
        { jobId: job.id, queue, attempt: job.attempts, willRetry: outcome.willRetry, err: message },
        'Job failed',
      );
    } finally {
      inFlight -= 1;
    }
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function heartbeat() {
  try {
    await WorkerHeartbeat.updateOne(
      { workerId: WORKER_ID },
      {
        $set: {
          workerId: WORKER_ID,
          host: os.hostname(),
          concurrency: loadEnv().WORKER_CONCURRENCY,
          queues: ['check-run', 'notify', 'maintenance'],
          driver: getQueue().kind,
          lastSeenAt: new Date(),
          processed,
          failed,
        },
        $setOnInsert: { startedAt: new Date() },
      },
      { upsert: true },
    );
  } catch (error) {
    log().warn({ err: (error as Error).message }, 'Heartbeat failed');
  }
}

async function main() {
  const env = loadEnv();
  log().info(
    { env: env.NODE_ENV, concurrency: env.WORKER_CONCURRENCY, queue: getQueue().kind },
    'Starting BreakGlass worker',
  );

  await connectDatabase();
  await ensureIndexes();

  await heartbeat();
  const heartbeatTimer = setInterval(() => void heartbeat(), 15_000);

  // Scheduler: enqueues durable jobs for due checks. Runs in the worker so
  // monitoring continues even when no dashboard is open.
  const schedulerTimer = setInterval(async () => {
    try {
      const result = await enqueueDueChecks();
      if (result.enqueued || result.deduplicated) {
        log().debug(result, 'Scheduler tick');
      }
    } catch (error) {
      log().error({ err: (error as Error).message }, 'Scheduler tick failed');
    }
  }, env.SCHEDULER_INTERVAL_MS);

  // Maintenance: retention, artifact purge and scheduling repair.
  const maintenanceTimer = setInterval(
    async () => {
      try {
        await getQueue().enqueue('maintenance', {
          name: 'maintenance',
          payload: {},
          dedupeKey: `maintenance:${Math.floor(Date.now() / 3_600_000)}`,
          maxAttempts: 1,
        });
      } catch (error) {
        log().warn({ err: (error as Error).message }, 'Could not enqueue maintenance');
      }
    },
    60 * 60_000,
  );

  // One scheduler tick at boot so a restart immediately picks up missed work.
  setTimeout(() => void enqueueDueChecks().catch(() => undefined), 2000);

  // Consumption differs by driver: the Mongo queue is polled, while BullMQ owns
  // its own worker loops and only needs the handler.
  const checkConcurrency = Math.max(1, env.WORKER_CONCURRENCY);
  const notifyConcurrency = Math.max(1, Math.ceil(env.WORKER_CONCURRENCY / 2));
  let consumer: ConsumerHandle | null = null;
  const loops: Promise<void>[] = [];

  if (typeof getQueue().startConsumers === 'function') {
    consumer = await getQueue().startConsumers!(
      {
        // Same accounting as the polling loop so heartbeats report real numbers.
        handle: async (job) => {
          inFlight += 1;
          try {
            await handleJob(job);
            processed += 1;
          } catch (error) {
            failed += 1;
            throw error;
          } finally {
            inFlight -= 1;
          }
        },
      },
      { workerId: WORKER_ID, checkConcurrency, notifyConcurrency, isRunning: () => running },
    );
  } else {
    for (let i = 0; i < checkConcurrency; i += 1) loops.push(pollQueue('check-run'));
    for (let i = 0; i < notifyConcurrency; i += 1) loops.push(pollQueue('notify'));
    loops.push(pollQueue('maintenance'));
  }

  const shutdown = async (signal: string) => {
    log().info({ signal, inFlight }, 'Graceful shutdown requested');
    running = false;
    clearInterval(heartbeatTimer);
    clearInterval(schedulerTimer);
    clearInterval(maintenanceTimer);

    // BullMQ waits for in-flight jobs; the Mongo driver relies on `inFlight`.
    if (consumer) {
      await consumer.stop().catch((error) =>
        log().warn({ err: (error as Error).message }, 'Consumer shutdown error'),
      );
    }

    const deadline = Date.now() + 30_000;
    while (inFlight > 0 && Date.now() < deadline) {
      await sleep(250);
    }
    await WorkerHeartbeat.deleteOne({ workerId: WORKER_ID }).catch(() => undefined);
    await getQueue().close?.().catch(() => undefined);
    await disconnectDatabase();
    log().info({ processed, failed }, 'Worker stopped');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    log().error({ reason: String(reason) }, 'Unhandled promise rejection in worker');
  });

  await Promise.all(loops);
}

main().catch((error) => {
  logger().fatal({ err: (error as Error).message }, 'Worker failed to start');
  process.exit(1);
});
