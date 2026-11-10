import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5190,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:4020' },
    fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] }, // ../shared/billing.mjs
  },
  build: { sourcemap: true },
});
