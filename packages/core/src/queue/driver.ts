export type QueueName = 'check-run' | 'notify' | 'maintenance';

export interface EnqueueOptions {
  name: string;
  payload: Record<string, unknown>;
  /** While set, a second job with the same key cannot be enqueued. */
  dedupeKey?: string;
  delayMs?: number;
  priority?: number;
  maxAttempts?: number;
  runAt?: Date;
}

export interface ReservedJob {
  id: string;
  queue: QueueName;
  name: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

export interface QueueStats {
  waiting: number;
  active: number;
  delayed: number;
  dead: number;
  completedLastHour: number;
}

/** Everything a worker needs to execute one job. */
export interface JobHandler {
  handle(job: ReservedJob): Promise<void>;
}

export interface ConsumerOptions {
  workerId: string;
  /** Parallel check-run jobs. */
  checkConcurrency: number;
  /** Parallel notification deliveries. */
  notifyConcurrency: number;
  /** Returns false once shutdown has started. */
  isRunning: () => boolean;
}

export interface ConsumerHandle {
  /** Stops accepting new work and waits for in-flight jobs. */
  stop(): Promise<void>;
}

/**
 * Durable queue contract.
 *
 * Two implementations ship with BreakGlass:
 *  - `MongoQueue` (default): jobs are documents with atomic claims and leases.
 *  - `RedisQueue`: BullMQ over Redis, selected with `QUEUE_DRIVER=redis` or by
 *    setting `REDIS_URL` (see docs/ARCHITECTURE.md).
 *
 * Both implement `enqueue`/`stats`, so the API and scheduler never care which
 * one is in use. Consumption differs by design: the Mongo driver is polled
 * (`reserve` → `complete`/`fail`), while BullMQ owns its own worker loops, so a
 * driver may instead expose `startConsumers` and let the worker hand it the
 * same handler.
 */
export interface QueueDriver {
  readonly kind: 'mongo' | 'redis';
  enqueue(queue: QueueName, options: EnqueueOptions): Promise<{ jobId: string; deduplicated: boolean }>;
  reserve(queue: QueueName, workerId: string, lockMs: number): Promise<ReservedJob | null>;
  complete(jobId: string): Promise<void>;
  fail(jobId: string, error: string): Promise<{ willRetry: boolean; attempt: number }>;
  release(jobId: string, delayMs: number): Promise<void>;
  stats(queue?: QueueName): Promise<QueueStats>;

  /** Push-based consumption (BullMQ). When absent, the worker polls. */
  startConsumers?(handler: JobHandler, options: ConsumerOptions): Promise<ConsumerHandle>;
  /** Releases connections held by the driver. */
  close?(): Promise<void>;
  /** True when the driver needs `reserve`/`complete`/`fail` to be polled. */
  readonly polled?: boolean;
}
