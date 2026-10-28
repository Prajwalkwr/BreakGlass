import mongoose from 'mongoose';
import { loadEnv } from '../config/env';
import { logger } from '../lib/logger';

let connecting: Promise<typeof mongoose> | null = null;

export async function connectDatabase(uri?: string): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return mongoose;
  if (connecting) return connecting;

  const env = loadEnv();
  const target = uri ?? env.MONGODB_URI;

  mongoose.set('strictQuery', true);
  // NOTE: `sanitizeFilter` is intentionally not enabled. Every filter in this
  // codebase is built field-by-field from validated identifiers and enums
  // (never from a raw request body), and the global sanitiser breaks ordinary
  // range queries such as { lockedUntil: { $lt: date } }.

  connecting = mongoose
    .connect(target, {
      serverSelectionTimeoutMS: 10_000,
      maxPoolSize: 20,
      minPoolSize: 1,
      retryWrites: true,
      autoIndex: env.NODE_ENV !== 'production',
    })
    .then((m) => {
      logger().info({ db: mongoose.connection.name }, 'MongoDB connected');
      return m;
    })
    .catch((error) => {
      connecting = null;
      logger().error({ err: (error as Error).message }, 'MongoDB connection failed');
      throw error;
    });

  mongoose.connection.on('disconnected', () => {
    logger().warn('MongoDB disconnected');
  });
  mongoose.connection.on('reconnected', () => {
    logger().info('MongoDB reconnected');
  });

  return connecting;
}

export async function disconnectDatabase(): Promise<void> {
  if (mongoose.connection.readyState === 0) return;
  await mongoose.disconnect();
  connecting = null;
}

/**
 * Production index build. Run on deploy (`npm run start` calls this once the
 * connection is up) so indexes exist before traffic arrives.
 */
export async function ensureIndexes(): Promise<void> {
  const models = Object.values(mongoose.models);
  const results = await Promise.allSettled(models.map((model) => model.createIndexes()));
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length) {
    // An index that already exists with different options must be migrated by
    // an operator, not crash the service on boot.
    for (const failure of failures) {
      logger().error(
        { err: String((failure as PromiseRejectedResult).reason?.message ?? failure) },
        'Index creation problem — run the migration noted in docs/OPERATIONS.md',
      );
    }
  }
  logger().info({ models: models.length, failures: failures.length }, 'MongoDB indexes ensured');
}

export function databaseState(): 'connected' | 'disconnected' {
  return mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
}
