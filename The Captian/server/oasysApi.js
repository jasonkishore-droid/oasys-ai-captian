// The ordering API behind Greeny's voice ordering tools (get_menu, place_order, confirm_order,
// send_receipt, print_receipt). The browser calls /api/oasys/*.
//
// Menu, orders and e-receipts are answered here, by the inventory code in server/inventory,
// working straight on the Stock Management database: no second server or API key needed.
// Printing still goes through the Stock Management app, because its Bluetooth printer is
// reached from that app's signed-in browser tab; those calls are relayed to
// INVENTORY_API_URL/api/integrations/* with the shared ORDER_API_KEY.
//
//   GET  /api/oasys/menu/stream   (server-sent events: a "menu" event whenever stock or the till changes what is sold out)
//   GET  /api/oasys/ping   GET /api/oasys/menu?search=&section=&diet=   POST /api/oasys/orders
//   GET  /api/oasys/orders?since_id=   (paid bills after an id: the kitchen ticket feed)
//   POST /api/oasys/orders/email { bill_no, to }   (e-receipt after the guest confirmed the address)
//   Open tabs (a table's dining session: order in rounds, pay once at the end):
//   GET  /api/oasys/tab?session_id= | ?table_no=        POST /api/oasys/tab/add { session_id?, table_no, items }
//   POST /api/oasys/tab/close { session_id, payment_mode, customer_email? }   POST /api/oasys/tab/cancel { session_id }
//   GET  /api/oasys/kitchen?since_id=   (each round as it is ordered, with its table)
//   POST /api/oasys/print-test   POST /api/oasys/print-receipt { bill_no }   GET /api/oasys/print-jobs/:id
//   GET  /api/oasys/printer   (is the Bluetooth printer connected in a Stock Management tab?)
import { inventoryConfig } from './inventory/config.js'
import { inventoryApi } from './inventory/orders.js'
import { openStore } from './inventory/store.js'
import { openTabs } from './inventory/tabs.js'

const LOCAL = /^\/api\/oasys\/(ping|menu|upi|orders|orders\/email|tab|tab\/add|tab\/close|tab\/cancel|kitchen|kitchen\/board|kitchen\/status)$/
const PRINT = /^\/api\/oasys\/(printer|print-test|print-receipt|print-jobs\/\d+)$/

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > 20_000) {
        reject(Object.assign(new Error('Body too large'), { status: 413 }))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export function oasysRoutes(env) {
  const config = inventoryConfig(env)
  let api = null
  const getApi = () => (api ??= inventoryApi(openStore(config), config, openTabs(config.tabsFile))) // opened on first use

  // Live sold-out sync. Stock Management is a separate process writing the same database, so this
  // watches the menu for changes (cheap: one small read every 2 s, only while a tablet is listening)
  // and pushes a "menu" event whenever any dish's sold-out state or portions left changes.
  // The Kitchen Display Screen (kds.html) uses the same kind of stream for its tickets.
  // channel(event, stamp): a stream that sends `event` whenever stamp() returns something new.
  const channel = (event, stamp) => {
    const watchers = new Set()
    let timer = null
    let last = ''
    const frame = () => `event: ${event}\ndata: ${Date.now()}\n\n`
    const poll = () => {
      let now
      try {
        now = stamp()
      } catch {
        return // the database is busy or missing for a moment: the next tick tries again
      }
      if (now === last) return
      last = now
      for (const w of watchers) w.write(frame())
    }
    return (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
      res.write('retry: 3000\n: connected\n\n')
      if (!watchers.size) {
        try { last = stamp() } catch { last = '' }
        timer = setInterval(poll, 2000)
      }
      res.write(frame()) // the first event: "load it now"
      watchers.add(res)
      const beat = setInterval(() => res.write(': ping\n\n'), 20000)
      req.on('close', () => {
        clearInterval(beat)
        watchers.delete(res)
        if (!watchers.size) clearInterval(timer)
      })
    }
  }
  const watchMenu = channel('menu', () => {
    const { dishes = [] } = getApi().menu({ all: '1' }).body
    return JSON.stringify(dishes.map((d) => [d.id, d.sold_out ? 1 : 0, d.portions_left]))
  })
  const watchKitchen = channel('kitchen', () => JSON.stringify(getApi().kitchenBoard().body.tickets.map((t) => [t.id, t.status])))

  const base = (env.INVENTORY_API_URL || 'http://127.0.0.1:4020').replace(/\/+$/, '')
  const key = env.ORDER_API_KEY || ''
  const send = (res, status, body) => {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json')
    res.end(typeof body === 'string' ? body : JSON.stringify(body))
  }

  return async (req, res, next) => {
    const u = new URL(req.url || '', 'http://x')
    if (!u.pathname.startsWith('/api/oasys/')) return next()
    const query = Object.fromEntries(u.searchParams)
    if (req.method === 'GET' && u.pathname === '/api/oasys/menu/stream') return watchMenu(req, res)
    if (req.method === 'GET' && u.pathname === '/api/oasys/kitchen/stream') return watchKitchen(req, res)
    try {
      const local = u.pathname.match(LOCAL)
      if (local) {
        const what = local[1]
        const post = req.method === 'POST'
        let body = {}
        if (post) {
          try {
            body = JSON.parse((await readBody(req)) || '{}')
          } catch (e) {
            if (e.status) throw e
            return send(res, 400, { error: 'Request body is not valid JSON' })
          }
        }
        const a = getApi()
        const r =
          what === 'ping' ? a.ping()
          : what === 'menu' ? a.menu(query)
          : what === 'upi' ? a.upi()
          : what === 'orders' ? (post ? a.placeOrder(body) : a.ordersSince(query))
          : what === 'tab' ? a.tab(query)
          : what === 'kitchen' ? a.kitchen(query)
          : what === 'kitchen/board' ? a.kitchenBoard()
          : what === 'kitchen/status' && post ? a.kitchenStatus(body)
          : !post ? { status: 405, body: { error: 'Use POST' } }
          : what === 'tab/add' ? a.tabAdd(body)
          : what === 'tab/close' ? a.tabClose(body)
          : what === 'tab/cancel' ? a.tabCancel(body)
          : post ? await a.emailReceipt(body)
          : { status: 405, body: { error: 'Use POST' } }
        return send(res, r.status, r.body)
      }

      const print = u.pathname.match(PRINT)
      if (!print) return send(res, 404, { error: 'Not found' })
      if (!key) return send(res, 503, { error: 'Printing goes through the Stock Management app: set ORDER_API_KEY in this app\'s .env' })
      const body = req.method === 'POST' ? await readBody(req) : undefined
      try {
        const r = await fetch(`${base}/api/integrations/${print[1]}${u.search}`, {
          method: req.method,
          headers: { 'Content-Type': 'application/json', 'X-Api-Key': key },
          body,
          signal: AbortSignal.timeout(10_000),
        })
        return send(res, r.status, await r.text())
      } catch {
        return send(res, 502, { error: `Cannot reach the Stock Management app at ${base} for printing. Is it running?` })
      }
    } catch (e) {
      if (e.status) return send(res, e.status, { error: e.message, ...(e.details && { details: e.details }) })
      console.error('[inventory]', e)
      return send(res, 500, { error: 'The inventory could not handle that request' })
    }
  }
}
