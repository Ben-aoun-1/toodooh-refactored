/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  server: {
    // Same-origin dev proxy (survey §8.2.1): the browser talks to Vite's origin; /api
    // and /auth proxy to the API on :4000, so the Lax session cookie rides same-origin
    // and dev mirrors the prod nginx single-origin model. The browser's Origin
    // (WEB_ORIGIN) is forwarded to the API → matched by better-auth trustedOrigins.
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/auth': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
