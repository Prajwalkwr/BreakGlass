import 'dotenv/config';
import {
  connectDatabase,
  disconnectDatabase,
  enqueueDueChecks,
  loadEnv,
  logger,
  getQueue,
} from '@breakglass/core';

/**
 * Standalone scheduler tick. Deployments that want the scheduler isolated
 * from the execution workers can run this on a cron (for example every
 * minute) instead of relying on the worker's internal timer. Both are safe to
 * run together because due checks are claimed atomically.
 */
async function main() {
  const env = loadEnv();
  await connectDatabase();
  const result = await enqueueDueChecks();
  const stats = await getQueue().stats();
  logger().info({ ...result, queue: stats, scheduler: 'standalone' }, 'Scheduler tick complete');
  await disconnectDatabase();
  void env;
}

main().catch((error) => {
  logger().fatal({ err: (error as Error).message }, 'Standalone scheduler failed');
  process.exit(1);
});
