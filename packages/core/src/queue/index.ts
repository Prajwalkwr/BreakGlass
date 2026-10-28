import { loadEnv } from '../config/env';
import { logger } from '../lib/logger';
import { MongoQueue } from './mongoQueue';
import { RedisQueue } from './redisQueue';
import type { QueueDriver } from './driver';

export * from './driver';
export { MongoQueue };
export { RedisQueue };

let driver: QueueDriver | null = null;

/**
 * Queue driver selection.
 *
 *   QUEUE_DRIVER=mongo   always the MongoDB-backed queue (default)
 *   QUEUE_DRIVER=redis   BullMQ over Redis (requires REDIS_URL)
 *   QUEUE_DRIVER=auto    Redis when REDIS_URL is set, otherwise Mongo
 *
 * The Mongo driver is durable and needs no extra service; the Redis driver is
 * the higher-throughput path and delegates retries, backoff and stalled-job
 * recovery to BullMQ. Both satisfy the same `QueueDriver` contract, so nothing
 * upstream has to change when a deployment switches.
 */
export function getQueue(): QueueDriver {
  if (driver) return driver;

  const env = loadEnv();
  const requested = env.QUEUE_DRIVER;
  const useRedis = requested === 'redis' || (requested === 'auto' && Boolean(env.REDIS_URL));

  if (useRedis && !env.REDIS_URL) {
    logger().error('QUEUE_DRIVER=redis but REDIS_URL is not set — falling back to the MongoDB queue.');
    driver = new MongoQueue();
    return driver;
  }

  driver = useRedis ? new RedisQueue() : new MongoQueue();
  logger().info({ driver: driver.kind }, 'Queue driver selected');
  return driver;
}

export function setQueueForTesting(next: QueueDriver | null): void {
  driver = next;
}
