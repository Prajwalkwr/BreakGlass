#!/usr/bin/env node
/**
 * Local development database.
 *
 * Boots a real MongoDB server (via mongodb-memory-server) bound to
 * 127.0.0.1:27017 with a persistent data directory at .data/mongo, so local
 * state survives restarts. This is a development convenience only — point
 * MONGODB_URI at a real MongoDB deployment (Atlas, self-hosted, Docker) in
 * production.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import fs from 'node:fs';
import path from 'node:path';

const dbPath = path.resolve('.data', 'mongo');
const port = Number(process.env.MONGO_PORT || 27017);
fs.mkdirSync(dbPath, { recursive: true });
fs.mkdirSync(path.dirname(path.resolve('.data', 'mongo.pid')), { recursive: true });

const server = await MongoMemoryServer.create({
  instance: {
    port,
    dbName: 'breakglass',
    dbPath,
    storageEngine: 'wiredTiger',
  },
});

console.log(`[breakglass] local MongoDB listening at ${server.getUri()} (data: ${dbPath})`);
console.log('[breakglass] development only — use a managed MongoDB in production');

const stop = async () => {
  await server.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
