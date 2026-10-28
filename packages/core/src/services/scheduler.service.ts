import { Check } from '../models/check';
import { Project } from '../models/project';
import { Job } from '../models/infra';
import { logger } from '../lib/logger';
import { getQueue } from '../queue';
import { purgeExpiredArtifacts } from './artifacts.service';
import { loadEnv } from '../config/env';

export interface SchedulerTickResult {
  due: number;
  enqueued: number;
  deduplicated: number;
  skippedPausedProjects: number;
}

/**
 * Enqueues a durable job for every check whose next run is due.
 *
 * Concurrency safety: the check's `nextRunAt` is advanced with a conditional
 * atomic update, so two scheduler instances can never enqueue the same due
 * run twice. Duplicate workers additionally cannot pile up jobs for one check
 * because the enqueue is keyed with a `dedupeKey`.
 */
export async function enqueueDueChecks(now = new Date()): Promise<SchedulerTickResult> {
  const due = await Check.find({ enabled: true, nextRunAt: { $lte: now } })
    .select('_id projectId intervalSeconds nextRunAt')
    .limit(200)
    .lean();

  const result: SchedulerTickResult = { due: due.length, enqueued: 0, deduplicated: 0, skippedPausedProjects: 0 };
  if (!due.length) return result;

  const projectIds = [...new Set(due.map((check) => String(check.projectId)))];
  const activeProjects = await Project.find({ _id: { $in: projectIds }, status: 'active' }).select('_id').lean();
  const activeProjectIds = new Set(activeProjects.map((project) => String(project._id)));

  for (const check of due) {
    const interval = check.intervalSeconds ?? 300;
    // Advance first: the conditional update guarantees a single winner.
    const advanced = await Check.findOneAndUpdate(
      { _id: check._id, enabled: true, nextRunAt: { $lte: now } },
      { $set: { nextRunAt: new Date(now.getTime() + interval * 1000) } },
      { new: false },
    );
    if (!advanced) continue;

    if (!activeProjectIds.has(String(check.projectId))) {
      result.skippedPausedProjects += 1;
      continue;
    }

    const enqueued = await getQueue().enqueue('check-run', {
      name: 'run-check',
      payload: { checkId: String(check._id), triggeredBy: 'schedule' },
      dedupeKey: `checkrun:${String(check._id)}`,
      maxAttempts: 3,
      priority: 0,
    });

    if (enqueued.deduplicated) result.deduplicated += 1;
    else result.enqueued += 1;
  }

  return result;
}

/** Checks that are far past due indicate a stalled scheduler or worker. */
export async function findOverdueChecks(graceMultiplier = 3): Promise<
  { checkId: string; name: string; minutesOverdue: number }[]
> {
  const now = Date.now();
  const checks = await Check.find({ enabled: true, nextRunAt: { $ne: null } })
    .select('_id name nextRunAt intervalSeconds')
    .limit(500)
    .lean();

  return checks
    .filter((check) => {
      if (!check.nextRunAt) return false;
      const overdueMs = now - new Date(check.nextRunAt).getTime();
      return overdueMs > check.intervalSeconds * 1000 * graceMultiplier;
    })
    .map((check) => ({
      checkId: String(check._id),
      name: check.name,
      minutesOverdue: Math.round((now - new Date(check.nextRunAt as Date).getTime()) / 60_000),
    }));
}

/** Housekeeping: repair scheduling state and apply retention policies. */
export async function runMaintenance(): Promise<{
  repaired: number;
  runsDeleted: number;
  artifactsDeleted: number;
  staleJobs: number;
}> {
  const env = loadEnv();
  const now = new Date();

  // Re-enable scheduling for checks that were left without a next run.
  const repair = await Check.updateMany(
    { enabled: true, nextRunAt: null },
    [{ $set: { nextRunAt: { $add: ['$$NOW', { $multiply: ['$intervalSeconds', 1000] }] } } }],
  );

  const cutoff = new Date(Date.now() - env.RETENTION_DAYS_RUNS * 86_400_000);
  const deletedRuns = await (await import('../models/checkRun')).CheckRun.deleteMany({ startedAt: { $lt: cutoff } });
  const artifactsDeleted = await purgeExpiredArtifacts();

  const staleJobs = await Job.countDocuments({
    status: { $in: ['waiting', 'delayed'] },
    runAt: { $lt: new Date(Date.now() - 3_600_000) },
  });

  const deadJobs = await Job.countDocuments({ status: 'dead' });
  if (deadJobs > 0) {
    logger().warn({ deadJobs }, 'Dead jobs present in the queue — inspect worker logs');
  }
  if (staleJobs > 0) {
    logger().warn({ staleJobs }, 'Jobs have been waiting for over an hour — check worker capacity');
  }

  void now;
  return {
    repaired: repair.modifiedCount ?? 0,
    runsDeleted: deletedRuns.deletedCount ?? 0,
    artifactsDeleted,
    staleJobs,
  };
}

/** Verifies a queue exists and the scheduler can read it — used by /health. */
export async function schedulerHealth() {
  const stats = await getQueue().stats();
  const overdue = await findOverdueChecks();
  return { stats, overdue };
}
