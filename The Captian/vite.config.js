import { spawn } from 'node:child_process'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { liveProxy } from './server/liveProxy.js'
import { faceRoutes } from './server/api.js'
import { voiceRoutes } from './server/voiceApi.js'
import { factRoutes } from './server/factsApi.js'
import { photoRoutes } from './server/photosApi.js'
import { desktopRoutes } from './server/desktopApi.js'
import { oasysRoutes } from './server/oasysApi.js'
import { factsRepo } from './server/db/facts.js'
import { openDatabase } from './server/db/index.js'
import { facesRepo } from './server/db/faces.js'
import { voicesRepo } from './server/db/voices.js'

// Starts a Python helper next to the dev server and stops it with the server.
function startSidecar(env, server, { tag, script, port }) {
  const child = spawn(env.PYTHON || 'python', ['-u', script, port], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  })
  const pattern = new RegExp(`\\[${tag}\\]|Error|error`)
  const log = (d) => d.toString().split('\n').filter((l) => pattern.test(l)).forEach((l) => console.log(l))
  child.stdout.on('data', log)
  child.stderr.on('data', log)
  child.on('error', (e) => console.warn(`[${tag}] could not start ${script}: ${e.message}`))
  const stop = () => child.kill()
  server.httpServer?.on('close', stop)
  process.on('exit', stop)
}

// The SpeechBrain speaker-embedding service
// (set VOICE_SERVICE_URL to use one you run yourself, VOICE_AUTOSTART=0 to skip).
function startVoiceService(env, server) {
  const port = env.VOICE_PORT || '8791'
  const url = env.VOICE_SERVICE_URL || `http://127.0.0.1:${port}`
  if (env.VOICE_SERVICE_URL || env.VOICE_AUTOSTART === '0') return url
  startSidecar(env, server, { tag: 'voice', script: 'sidecar/voice_service.py', port })
  return url
}

// The desktop-control service behind the mouse tools (DESKTOP_AUTOSTART=0 to skip).
function startDesktopService(env, server) {
  const port = env.DESKTOP_PORT || '8792'
  if (env.DESKTOP_AUTOSTART !== '0') startSidecar(env, server, { tag: 'desktop', script: 'sidecar/desktop_service.py', port })
  return `http://127.0.0.1:${port}`
}

// REST API (faces, voices), the Gemini Live relay and the voice service,
// all served by the dev/preview server
function backend(env) {
  let dbPromise
  const getDb = () => (dbPromise ??= openDatabase(env))
  const attach = (server) => {
    const voiceUrl = startVoiceService(env, server)
    const route = (prefix, make) =>
      server.middlewares.use(async (req, res, next) => {
        if (!prefix.some((p) => req.url?.startsWith(p))) return next()
        try {
          return make(await getDb())(req, res, next)
        } catch (e) {
          console.error('[db]', e)
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Database unavailable' }))
        }
      })
    // /kds and /waiter are their own pages (kds.html, waiter.html); in dev Vite finds them, a built site needs the mapping
    server.middlewares.use((req, _res, next) => {
      const [path, query] = (req.url || '').split('?')
      const to = path === '/kds' ? '/kds.html' : path === '/waiter' ? '/waiter.html' : null
      if (to) req.url = query ? `${to}?${query}` : to
      next()
    })
    route(['/api/faces'], (db) => faceRoutes(db))
    route(['/api/voices', '/api/voice/'], (db) => voiceRoutes(db, voiceUrl))
    route(['/api/facts'], (db) => factRoutes(db))
    server.middlewares.use(photoRoutes(env.PHOTOS_DIR || 'data/photos')) // take_photo's "save to folder"
    server.middlewares.use(oasysRoutes(env)) // Oasys Restaurant club app: menu + voice orders (get_menu, place_order)
    // the mouse tools: this computer's real mouse and keyboard
    server.middlewares.use(desktopRoutes(startDesktopService(env, server), { allowLan: env.DESKTOP_ALLOW_LAN === '1' }))
    liveProxy(
      env,
      async () => {
        const db = await getDb()
        const names = [...(await facesRepo(db).names()), ...(await voicesRepo(db).names())]
        return [...new Set(names)].sort()
      },
      async () => factsRepo(await getDb()).list()
    ).configureServer(server)
  }
  return { name: 'ai-captain-backend', configureServer: attach, configurePreviewServer: attach }
}

export default defineConfig(({ mode }) => {
  // empty prefix: read GEMINI_* for the server only; they are not exposed to the client
  const env = loadEnv(mode, process.cwd(), '')
  // `npm run dev:lan`: open to other devices on the network. Browsers only allow
  // the camera and mic on https (or localhost), so it serves with a self-signed
  // certificate; accept the warning once on each device.
  // Cross-origin isolation lets the detection models run on several CPU threads
  // (WebAssembly threads need SharedArrayBuffer). `credentialless` keeps Google
  // Fonts loading without CORP headers.
  const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' }
  if (mode === 'lan') {
    const lan = { host: true, https: true, port: 5444, strictPort: true, headers }
    return { plugins: [react(), basicSsl(), backend(env)], server: lan, preview: lan }
  }
  // build: the tablet app and the two staff pages. preview (what the deployed service runs) answers to any host name,
  // because it sits behind the host's own address
  return {
    plugins: [react(), backend(env)],
    server: { headers },
    preview: { headers, allowedHosts: true },
    build: { rollupOptions: { input: { main: 'index.html', kds: 'kds.html', waiter: 'waiter.html' } } },
  }
})
