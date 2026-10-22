import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    // The preview environment proxies the port; disable strict host checks.
    allowedHosts: true,
    proxy: {
      // Optional convenience: call the API through the dev server origin when
      // VITE_API_BASE_URL is not set.
      '/api': {
        target: process.env.VITE_DEV_API_TARGET ?? 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
    // `vite preview` serves the production bundle from this port, so it needs
    // the same API proxy as the dev server for single-origin deployments.
    proxy: {
      '/api': {
        target: process.env.VITE_DEV_API_TARGET ?? 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 1200,
  },
});
