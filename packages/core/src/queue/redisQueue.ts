import { Queue, Worker, type Job } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { loadEnv } from '../config/env';
import { logger } from '../lib/logger';
import type {
  ConsumerHandle,
  ConsumerOptions,
  EnqueueOptions,
  JobHandler,
  QueueDriver,
  QueueName,
  QueueStats,
  ReservedJob,
} from './driver';

const PREFIX = 'breakglass';
const BACKOFF_MS = 5_000;
const COMPLETED_RETENTION_SECONDS = 3_600;

/**
 * BullMQ rejects ":" in queue names (it reserves that character for its own key
 * namespace), so the prefix uses a dash.
 */
function redisName(queue: QueueName): string {
  return `${PREFIX}-${queue}`;
}

/**
 * Dedupe keys in the application are structured (`notify:<id>`,
 * `checkrun:<id>`, `maintenance:<bucket>`), but BullMQ job ids may not contain
 * ":". Rather than change every call site — the Mongo driver stores the keys
 * verbatim — keys with reserved characters are hex-encoded, which is injective
 * (two different keys can never map to the same job id).
 */
function jobIdFor(dedupeKey: string): string {
  return /^[A-Za-z0-9_.-]+$/.test(dedupeKey) ? dedupeKey : `h${Buffer.from(dedupeKey, 'utf8').toString('hex')}`;
}

/**
 * Redis + BullMQ queue driver.
 *
 * Selected when `QUEUE_DRIVER=redis` or when `REDIS_URL` is configured. BullMQ
 * owns retries, exponential backoff, stalled-job recovery (a crashed worker's
 * job is re-delivered once its lock expires), per-queue concurrency and
 * graceful shutdown, so the worker process only supplies the job handler.
 *
 * Deduplication uses BullMQ job ids: while a job with a given `dedupeKey` is
 * waiting/active, a second `add` with the same id is a no-op; once the job
 * completes it is removed, which frees the id for the next recurring run — the
 * same "dedupe while live, reusable afterwards" semantics as the Mongo driver.
 */
export class RedisQueue implements QueueDriver {
  readonly kind = 'redis' as const;

  private connection: Redis | null = null;
  private readonly queues = new Map<QueueName, Queue>();

  private redis(): Redis {
    if (!this.connection) {
      const env = loadEnv();
      const url = env.REDIS_URL;
      if (!url) throw new Error('REDIS_URL is required when QUEUE_DRIVER=redis.');
      this.connection = new IORedis(url, {
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
        lazyConnect: false,
      });
      this.connection.on('error', (error: Error) => {
        logger().error({ err: error.message }, 'Redis connection error (queue)');
      });
    }
    return this.connection;
  }

  private queue(name: QueueName): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(redisName(name), { connection: this.redis() });
      this.queues.set(name, queue);
    }
    return queue;
  }

  async enqueue(queue: QueueName, options: EnqueueOptions): Promise<{ jobId: string; deduplicated: boolean }> {
    const target = this.queue(queue);
    const delay = options.runAt
      ? Math.max(0, options.runAt.getTime() - Date.now())
      : Math.max(0, options.delayMs ?? 0);

    const startedAt = Date.now();
    const jobId = options.dedupeKey ? jobIdFor(options.dedupeKey) : undefined;
    const existing = jobId ? await target.getJob(jobId) : null;

    const job = await target.add(options.name, options.payload, {
      ...(jobId ? { jobId } : {}),
      delay,
      // BullMQ treats a lower number as higher priority; our callers use 0 or omit.
      ...(options.priority ? { priority: Math.max(1, 1000 - options.priority) } : {}),
      attempts: options.maxAttempts ?? 3,
      backoff: { type: 'exponential', delay: BACKOFF_MS },
      removeOnComplete: { age: COMPLETED_RETENTION_SECONDS, count: 5_000 },
      removeOnFail: { age: 24 * 3_600, count: 1_000 },
    });

    // `add` returns the stored job when the id already exists; its timestamp
    // predates this call, which is what tells us the enqueue was deduplicated.
    // BullMQ's job-id uniqueness is what actually guarantees a single job — this
    // flag is for callers' metrics only.
    const deduplicated = Boolean(existing) || job.timestamp < startedAt;
    return { jobId: String(job.id), deduplicated };
  }

  /** Not used: BullMQ consumes jobs through its own worker loops. */
  async reserve(): Promise<ReservedJob | null> {
    throw new Error('RedisQueue is consumed by BullMQ workers; call startConsumers() instead of reserve().');
  }

  async complete(): Promise<void> {
    throw new Error('RedisQueue completes jobs through BullMQ; call startConsumers() instead of complete().');
  }

  async fail(): Promise<{ willRetry: boolean; attempt: number }> {
    throw new Error('RedisQueue fails jobs through BullMQ; call startConsumers() instead of fail().');
  }

  async release(): Promise<void> {
    throw new Error('RedisQueue releases jobs through BullMQ; call startConsumers() instead of release().');
  }

  async stats(queue?: QueueName): Promise<QueueStats> {
    const names: QueueName[] = queue ? [queue] : ['check-run', 'notify', 'maintenance'];
    const totals: QueueStats = { waiting: 0, active: 0, delayed: 0, dead: 0, completedLastHour: 0 };
    const since = Date.now() - 3_600_000;

    for (const name of names) {
      const target = this.queue(name);
      const counts = await target.getJobCounts('waiting', 'active', 'delayed', 'failed');
      totals.waiting += counts.waiting ?? 0;
      totals.active += counts.active ?? 0;
      totals.delayed += counts.delayed ?? 0;
      totals.dead += counts.failed ?? 0;

      // Completed jobs are retained for an hour, so this is a real count of the
      // last hour rather than an all-time number.
      const completed = await target.getJobs(['completed'], 0, 500, false);
      totals.completedLastHour += completed.filter((job) => (job.finishedOn ?? 0) >= since).length;
    }

    return totals;
  }

  async startConsumers(handler: JobHandler, options: ConsumerOptions): Promise<ConsumerHandle> {
    const log = logger().child({ workerId: options.workerId, driver: 'redis' });
    const workers: Worker[] = [];

    const build = (queue: QueueName, concurrency: number) => {
      const worker = new Worker(
        redisName(queue),
        async (job: Job) => {
          const reserved: ReservedJob = {
            id: String(job.id),
            queue,
            name: job.name,
            payload: (job.data ?? {}) as Record<string, unknown>,
            attempts: job.attemptsMade + 1,
            maxAttempts: job.opts.attempts ?? 3,
          };
          // Throwing here lets BullMQ apply backoff and retry accounting.
          await handler.handle(reserved);
        },
        {
          connection: this.redis().duplicate({ maxRetriesPerRequest: null }),
          concurrency,
          // A browser check can legitimately take 45s; keep the lock well above it.
          lockDuration: 120_000,
          stalledInterval: 30_000,
          maxStalledCount: 2,
        },
      );

      worker.on('failed', (job, error) => {
        log.error(
          { jobId: job?.id, queue, attempt: job?.attemptsMade, err: error.message },
          'Job failed',
        );
      });
      worker.on('error', (error) => {
        log.error({ err: error.message, queue }, 'BullMQ worker error');
      });
      worker.on('stalled', (jobId) => {
        log.warn({ jobId, queue }, 'Job stalled and will be retried after its lock expires');
      });

      workers.push(worker);
    };

    build('check-run', Math.max(1, options.checkConcurrency));
    build('notify', Math.max(1, options.notifyConcurrency));
    build('maintenance', 1);

    log.info({ workers: workers.length }, 'BullMQ consumers started');

    return {
      stop: async () => {
        // close() waits for in-flight jobs instead of killing them.
        await Promise.all(workers.map((worker) => worker.close()));
        log.info('BullMQ consumers stopped');
      },
    };
  }

  async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
    this.queues.clear();
    if (this.connection) {
      await this.connection.quit().catch(() => this.connection?.disconnect());
      this.connection = null;
    }
  }
}
