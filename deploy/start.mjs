// Starts the whole demo as one service (what the Dockerfile runs):
//   1. gets the shared disk ready (the databases and the waiters' pictures live on it, so they survive a redeploy)
//   2. sets up Stock Management's database on first start (migrations, and the starter data if it is empty)
//   3. starts Stock Management (internal :4020), the Captain (internal :5181) and the front door (public $PORT)
// If any one of them stops, everything stops, and Railway restarts the service.
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = join(dirname(fileURLToPath(import.meta.url)), '..') // /app
const STOCK = join(APP, 'stock', 'server')
const CAPTAIN = join(APP, 'captain')
const DATA = process.env.DATA_DIR || '/data' // the Railway volume's mount path

const log = (m) => console.log(`[start] ${m}`)
const die = (m) => { console.error(`[start] ${m}`); process.exit(1) }

// ---- 1. the shared disk ----
mkdirSync(join(DATA, 'stock'), { recursive: true })
mkdirSync(join(DATA, 'captain'), { recursive: true })
mkdirSync(join(DATA, 'waiters'), { recursive: true })
// the Captain keeps its databases in captain/data and the waiters' pictures in captain/assets/waiters: point both at the disk
for (const [link, target] of [[join(CAPTAIN, 'data'), join(DATA, 'captain')], [join(CAPTAIN, 'assets', 'waiters'), join(DATA, 'waiters')]]) {
  rmSync(link, { recursive: true, force: true })
  mkdirSync(dirname(link), { recursive: true })
  symlinkSync(target, link, 'junction')
}

// ---- secrets ----
// the key the Captain uses to ask Stock Management to print: any long random string, only the two processes here use it
const ORDER_API_KEY = process.env.ORDER_API_KEY && process.env.ORDER_API_KEY.length >= 24 ? process.env.ORDER_API_KEY : randomBytes(24).toString('hex')

const stockFile = join(DATA, 'stock', 'vasamo.sqlite3')
const stockEnv = {
  ...process.env,
  NODE_ENV: 'production',
  PORT: '4020',
  HOST: '127.0.0.1',
  SQLITE_FILE: stockFile,
  SEED_DEMO_DAYS: process.env.SEED_DEMO_DAYS || '0',
  TRUST_PROXY: '1', // the front door and Railway's own proxy sit in front
  ORDER_API_KEY,
}

// ---- 2. Stock Management's database ----
const run = (args, env) => spawnSync(process.execPath, args, { cwd: STOCK, env, stdio: 'inherit' })
const knex = join(STOCK, 'node_modules', 'knex', 'bin', 'cli.js')
log('Stock Management: applying migrations')
if (run([knex, 'migrate:latest'], stockEnv).status !== 0) die('migrations failed')
const empty = spawnSync(process.execPath, ['-e', "const k=require('knex')(require('./knexfile'));k('users').count({n:'*'}).first().then(r=>{process.exit(Number(r.n)?0:1)}).catch(()=>process.exit(1))"], { cwd: STOCK, env: stockEnv })
if (empty.status !== 0) {
  if (!process.env.SEED_PASSWORD) die('First start: set SEED_PASSWORD (the password for the admin, manager and cashier accounts) in the service variables, then redeploy.')
  log('Stock Management: empty database, adding the starter data (menu, recipes, accounts)')
  if (run([knex, 'seed:run'], stockEnv).status !== 0) die('seeding failed')
}

// ---- 3. the three processes ----
const captainEnv = {
  ...process.env,
  INVENTORY_DB: stockFile,
  INVENTORY_DIR: STOCK,
  INVENTORY_API_URL: 'http://127.0.0.1:4020',
  MENU_CARD_DIR: join(APP, 'menu-card'),
  ORDER_API_KEY,
  // the voice-recognition and desktop-control helpers are Python programs for a local machine: not part of the demo
  VOICE_AUTOSTART: '0',
  DESKTOP_AUTOSTART: '0',
}
const children = [
  ['stock', process.execPath, ['src/index.js'], STOCK, stockEnv],
  ['captain', process.execPath, [join(CAPTAIN, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', '5181', '--host', '127.0.0.1', '--strictPort'], CAPTAIN, captainEnv],
  ['gateway', process.execPath, [join(APP, 'deploy', 'gateway.mjs')], APP, { ...process.env, PORT: process.env.PORT || '8080' }],
].map(([name, cmd, args, cwd, env]) => {
  const p = spawn(cmd, args, { cwd, env, stdio: 'inherit' })
  p.on('exit', (code, sig) => {
    console.error(`[start] ${name} stopped (${sig || code}): stopping everything so the host restarts it`)
    for (const c of children) if (c !== p && !c.killed) c.kill()
    process.exit(code || 1)
  })
  return p
})
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { for (const c of children) c.kill(); process.exit(0) })
log(`running: public port ${process.env.PORT || 8080}`)
if (!existsSync(join(CAPTAIN, 'dist', 'index.html'))) log('warning: the Captain has no build (dist/)')
