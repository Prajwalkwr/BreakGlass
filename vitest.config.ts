import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Unit + integration tests run against TypeScript sources (aliases below), so
 * `npm test` never requires a prior build.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@breakglass/shared': path.resolve(__dirname, 'packages/shared/src/index.ts'),
      '@breakglass/core': path.resolve(__dirname, 'packages/core/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/**/*.test.ts', 'apps/api/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // Each file gets its own database; files run in separate processes.
    fileParallelism: true,
    pool: 'forks',
    reporters: ['default'],
  },
});
