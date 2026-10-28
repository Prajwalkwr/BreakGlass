import { afterAll, beforeAll } from 'vitest';
import mongoose from 'mongoose';
import { randomBytes } from 'node:crypto';

// Keep the default test environment self-contained; Redis is optional.
process.env.QUEUE_DRIVER = 'mongo';
process.env.REDIS_URL = '';

/**
 * Test bootstrap.
 *
 * Uses TEST_MONGODB_URI when provided (CI service container / local mongod),
 * otherwise boots an in-process mongodb-memory-server. Every test file gets a
 * throw-away database so tenant-isolation assertions can create real data.
 */
let memoryServer: import('mongodb-memory-server').MongoMemoryServer | null = null;

function withDatabase(uri: string, database: string): string {
  const [scheme, rest] = [uri.slice(0, uri.indexOf('://') + 3), uri.slice(uri.indexOf('://') + 3)];
  const queryIndex = rest.indexOf('?');
  const query = queryIndex === -1 ? '' : rest.slice(queryIndex);
  const hostAndDb = queryIndex === -1 ? rest : rest.slice(0, queryIndex);
  const host = hostAndDb.includes('/') ? hostAndDb.slice(0, hostAndDb.indexOf('/')) : hostAndDb;
  return `${scheme}${host}/${database}${query}`;
}

beforeAll(async () => {
  const database = `breakglass_test_${randomBytes(4).toString('hex')}`;
  let baseUri = process.env.TEST_MONGODB_URI ?? '';

  if (!baseUri) {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
    baseUri = memoryServer.getUri();
  }

  process.env.NODE_ENV = 'test';
  process.env.MONGODB_URI = withDatabase(baseUri, database);
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? randomBytes(32).toString('base64');
  process.env.EMAIL_PROVIDER = 'none';
  process.env.EMAIL_FROM = 'BreakGlass <alerts@breakglass.test>';
  process.env.SESSION_COOKIE_NAME = 'bg_session';
  process.env.APP_ORIGIN = 'http://localhost:5173';
  process.env.API_ORIGIN = 'http://localhost:4000';
  process.env.ALLOW_PRIVATE_TARGETS = 'false';
  process.env.LOG_LEVEL = 'silent';

  // Modules read env through a memoised loader.
  const core = await import('@breakglass/core');
  core.resetEnvCache();

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30_000 });

  for (const model of Object.values(mongoose.models)) {
    await model.createIndexes();
  }
});

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
});
