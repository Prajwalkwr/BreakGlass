import { loadEnv } from '../config/env';
import { logger } from '../lib/logger';
import type { StorageDriver } from './driver';
import { localStorageDriver } from './localStorage';
import { createS3StorageDriver } from './s3Storage';

let cached: StorageDriver | null = null;

/**
 * Storage driver selection.
 *
 *   STORAGE_DRIVER=auto  → S3 when a bucket + credentials are configured, else local
 *   STORAGE_DRIVER=s3    → S3 only; a missing bucket is a startup error, never a
 *                          silent fallback (evidence must not be written to a
 *                          disk the rest of the fleet cannot read)
 *   STORAGE_DRIVER=local → filesystem, for development and single-host installs
 */
export function getStorage(): StorageDriver {
  if (cached) return cached;
  const env = loadEnv();
  const configured = Boolean(env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY);

  if (env.STORAGE_DRIVER === 's3' && !configured) {
    throw new Error('STORAGE_DRIVER=s3 requires S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.');
  }

  if ((env.STORAGE_DRIVER === 's3' || (env.STORAGE_DRIVER === 'auto' && configured)) && configured) {
    cached = createS3StorageDriver({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET!,
      accessKeyId: env.S3_ACCESS_KEY_ID!,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      prefix: env.S3_PREFIX,
    });
    logger().info(
      { driver: 's3', bucket: env.S3_BUCKET, endpoint: env.S3_ENDPOINT ?? 'aws' },
      'Evidence storage driver selected',
    );
    return cached;
  }

  cached = localStorageDriver;
  logger().info({ driver: 'local' }, 'Evidence storage driver selected');
  return cached;
}

/** Test/lifecycle hook: forget the resolved driver (config changed). */
export function resetStorage(): void {
  cached = null;
}

export type { StorageDriver } from './driver';
export { StorageUnavailableError } from './driver';
export { localStorageDriver } from './localStorage';
export { createS3StorageDriver, type S3StorageConfig } from './s3Storage';
