// The Waiter Calls screen on its own port (default 5183): `npm run waiter`, or `npm run waiter:lan` to let the
// floor staff's own tablet or phone reach it over the network. It serves only that screen and the ordering API
// (the same code and database as the tablet app and the Kitchen Display).
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { oasysRoutes } from './server/oasysApi.js'

function waiterScreen(env) {
  const attach = (server) => {
    // the home page is the waiter calls screen
    server.middlewares.use((req, _res, next) => {
      const path = (req.url || '').split('?')[0]
      if (path === '/' || path === '/index.html') req.url = '/waiter.html'
      next()
    })
    server.middlewares.use(oasysRoutes(env))
  }
  return { name: 'waiter-calls-screen', configureServer: attach, configurePreviewServer: attach }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const port = Number(env.WAITER_PORT) || 5183
  return {
    plugins: [react(), waiterScreen(env)],
    publicDir: false,
    // its own dependency cache: sharing another server's folder made the servers overwrite each other
    cacheDir: 'node_modules/.vite-waiter',
    optimizeDeps: { include: ['react', 'react-dom', 'react-dom/client'] },
    server: { port, strictPort: true },
    preview: { port, strictPort: true },
    build: { outDir: 'dist-waiter', emptyOutDir: true, rollupOptions: { input: 'waiter.html' } },
  }
})
