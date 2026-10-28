import type { Types } from 'mongoose';
import { Job } from '../models/infra';
import type { EnqueueOptions, QueueDriver, QueueName, QueueStats, ReservedJob } from './driver';

const BACKOFF_BASE_MS = 5_000;

function backoffFor(attempt: number): number {
  // 5s, 10s, 20s, 40s … capped at 5 minutes.
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1), 300_000);
}

/**
 * Durable, Mongo-backed job queue.
 *
 * Guarantees relied on by the monitoring pipeline:
 *  - jobs survive process restarts (they are documents, not timers)
 *  - a job is claimed atomically by exactly one worker (findOneAndUpdate)
 *  - a crashed worker's job is reclaimed once its lock expires
 *  - enqueue is idempotent while a `dedupeKey` is live (unique partial index)
 *  - retries use bounded exponential backoff and end in a `dead` state
 */
export class MongoQueue implements QueueDriver {
  readonly kind = 'mongo' as const;

  async enqueue(queue: QueueName, options: EnqueueOptions) {
    const runAt = options.runAt ?? new Date(Date.now() + (options.delayMs ?? 0));
    try {
      const job = await Job.create({
        queue,
        name: options.name,
        payload: options.payload,
        status: runAt.getTime() > Date.now() ? 'delayed' : 'waiting',
        priority: options.priority ?? 0,
        maxAttempts: options.maxAttempts ?? 3,
        runAt,
        dedupeKey: options.dedupeKey ?? null,
      });
      return { jobId: String(job._id), deduplicated: false };
    } catch (error) {
      if ((error as { code?: number }).code === 11000 && options.dedupeKey) {
        const existing = await Job.findOne({ dedupeKey: options.dedupeKey });
        return { jobId: existing ? String(existing._id) : '', deduplicated: true };
      }
      throw error;
    }
  }

  async reserve(queue: QueueName, workerId: string, lockMs: number): Promise<ReservedJob | null> {
    const now = new Date();

    // Reclaim work abandoned by a crashed worker.
    await Job.updateMany(
      { status: 'active', lockedUntil: { $lt: now } },
      { $set: { status: 'waiting', lockedBy: null, lockedUntil: null } },
    );

    const job = await Job.findOneAndUpdate(
      {
        queue,
        status: { $in: ['waiting', 'delayed'] },
        runAt: { $lte: now },
      },
      {
        $set: {
          status: 'active',
          lockedBy: workerId,
          lockedUntil: new Date(now.getTime() + lockMs),
          startedAt: now,
        },
        $inc: { attempts: 1 },
      },
      { sort: { priority: -1, runAt: 1 }, new: true },
    );

    if (!job) return null;
    return {
      id: String(job._id),
      queue: job.queue as QueueName,
      name: job.name,
      payload: (job.payload ?? {}) as Record<string, unknown>,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
    };
  }

  async complete(jobId: string): Promise<void> {
    await Job.updateOne(
      { _id: jobId as unknown as Types.ObjectId },
      {
        $set: { status: 'completed', finishedAt: new Date(), lockedBy: null, lockedUntil: null },
        // Freeing the dedupe key lets the next recurring run be enqueued.
        $unset: { dedupeKey: '' },
      },
    );
  }

  async fail(jobId: string, error: string): Promise<{ willRetry: boolean; attempt: number }> {
    const job = await Job.findById(jobId);
    if (!job) return { willRetry: false, attempt: 0 };

    const willRetry = job.attempts < job.maxAttempts;
    if (willRetry) {
      await Job.updateOne(
        { _id: job._id },
        {
          $set: {
            status: 'waiting',
            runAt: new Date(Date.now() + backoffFor(job.attempts)),
            lockedBy: null,
            lockedUntil: null,
            lastError: error.slice(0, 600),
          },
        },
      );
    } else {
      await Job.updateOne(
        { _id: job._id },
        {
          $set: {
            status: 'dead',
            finishedAt: new Date(),
            lockedBy: null,
            lockedUntil: null,
            lastError: error.slice(0, 600),
          },
          $unset: { dedupeKey: '' },
        },
      );
    }
    return { willRetry, attempt: job.attempts };
  }

  async release(jobId: string, delayMs: number): Promise<void> {
    await Job.updateOne(
      { _id: jobId as unknown as Types.ObjectId },
      {
        $set: {
          status: 'waiting',
          runAt: new Date(Date.now() + delayMs),
          lockedBy: null,
          lockedUntil: null,
        },
      },
    );
  }

  async stats(queue?: QueueName): Promise<QueueStats> {
    const match = queue ? { queue } : {};
    const [counts, completedLastHour] = await Promise.all([
      Job.aggregate<{ _id: string; count: number }>([
        { $match: match },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Job.countDocuments({ ...match, status: 'completed', finishedAt: { $gte: new Date(Date.now() - 3_600_000) } }),
    ]);

    const byStatus = new Map(counts.map((entry) => [entry._id, entry.count]));
    return {
      waiting: byStatus.get('waiting') ?? 0,
      active: byStatus.get('active') ?? 0,
      delayed: byStatus.get('delayed') ?? 0,
      dead: byStatus.get('dead') ?? 0,
      completedLastHour,
    };
  }
}
