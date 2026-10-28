import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(process.cwd(), '../..'), '');
  const apiTarget = env.API_ORIGIN || 'http://127.0.0.1:4000';

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@breakglass/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      // The preview proxy host must be accepted, so no host allowlist here.
      allowedHosts: true,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: false,
          cookieDomainRewrite: '',
        },
      },
    },
    preview: {
      host: '0.0.0.0',
      port: 4173,
      allowedHosts: true,
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      chunkSizeWarningLimit: 900,
    },
  };
});
