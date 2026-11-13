// The Kitchen Display on its own port (default 5182): `npm run kds`, or `npm run kds:lan` to let the
// kitchen's own tablet or screen reach it over the network. It serves only the kitchen screen and the
// ordering API (the same inventory code and database as the tablet app), none of the tablet app.
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { oasysRoutes } from './server/oasysApi.js'

function kitchen(env) {
  const attach = (server) => {
    // the home page is the kitchen screen
    server.middlewares.use((req, _res, next) => {
      const path = (req.url || '').split('?')[0]
      if (path === '/' || path === '/index.html') req.url = '/kds.html'
      next()
    })
    server.middlewares.use(oasysRoutes(env))
  }
  return { name: 'kitchen-display', configureServer: attach, configurePreviewServer: attach }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const port = Number(env.KDS_PORT) || 5182
  return {
    plugins: [react(), kitchen(env)],
    publicDir: false,
    // its own dependency cache: sharing the tablet app's folder made the two servers overwrite each other (two copies of React)
    cacheDir: 'node_modules/.vite-kds',
    optimizeDeps: { include: ['react', 'react-dom', 'react-dom/client'] },
    server: { port, strictPort: true },
    preview: { port, strictPort: true },
    build: { outDir: 'dist-kds', emptyOutDir: true, rollupOptions: { input: 'kds.html' } },
  }
})
