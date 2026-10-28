import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5175,
    strictPort: true,
    // The sandbox preview serves the app from a proxied host.
    allowedHosts: true,
  },
  preview: { host: '0.0.0.0', port: 5175, allowedHosts: true },
  build: { target: 'es2020', cssCodeSplit: true },
});
