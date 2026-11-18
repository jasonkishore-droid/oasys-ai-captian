import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  // the one-service deployment serves this app under /stock/ (VITE_BASE=/stock/ at build time); on its own it stays at /
  base: process.env.VITE_BASE || '/',
  server: {
    port: 5190,
    strictPort: true,
    // changeOrigin: false keeps the browser's Host header, which the API's same-origin check compares with Origin
    proxy: { '/api': { target: 'http://127.0.0.1:4020', changeOrigin: false } },
    fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] }, // ../shared/billing.mjs
  },
  build: { sourcemap: true },
});
