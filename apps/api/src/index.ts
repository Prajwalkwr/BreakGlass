import 'dotenv/config';
import http from 'node:http';
import { connectDatabase, disconnectDatabase, ensureIndexes, loadEnv, logger } from '@breakglass/core';

async function main() {
  const env = loadEnv();
  const log = logger();

  await connectDatabase();
  if (env.NODE_ENV !== 'test') {
    await ensureIndexes();
  }

  // Imported after the database is reachable so route modules that build
  // models at import time see a live connection.
  const { createApp } = await import('./app');
  const app = createApp();
  const server = http.createServer(app);

  server.listen(env.PORT, '0.0.0.0', () => {
    log.info({ port: env.PORT, env: env.NODE_ENV }, 'BreakGlass API listening');
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'Shutting down API');
    server.close(() => {
      void disconnectDatabase().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 15_000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    log.error({ reason: String(reason) }, 'Unhandled promise rejection');
  });
}

main().catch((error) => {
  logger().fatal({ err: (error as Error).message }, 'API failed to start');
  process.exit(1);
});
