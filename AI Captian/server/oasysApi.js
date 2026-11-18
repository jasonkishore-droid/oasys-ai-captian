// Relay to the Oasys Bay club app (the Stock Management project) for voice ordering.
// The browser calls /api/oasys/*; this forwards to INVENTORY_API_URL/api/integrations/* and adds
// the shared ORDER_API_KEY, so the key never reaches the browser.
//
//   GET  /api/oasys/ping   GET /api/oasys/menu?search=&section=   POST /api/oasys/orders
//   POST /api/oasys/orders/email { bill_no, to }   (e-receipt after the guest confirmed the address)
//   POST /api/oasys/print-test   POST /api/oasys/print-receipt { bill_no }   GET /api/oasys/print-jobs/:id
//        (a test page or a paper receipt on the restaurant's printer; poll the job to see if it printed)
const ROUTE = /^\/api\/oasys\/(ping|menu|orders|orders\/email|print-test|print-receipt|print-jobs\/\d+)$/

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
    const m = u.pathname.match(ROUTE)
    if (!m) return send(res, 404, { error: 'Not found' })
    if (!key) return send(res, 503, { error: 'ORDER_API_KEY is not set in AI Captian/.env' })
    try {
      const body = req.method === 'POST' ? await readBody(req) : undefined
      const r = await fetch(`${base}/api/integrations/${m[1]}${u.search}`, {
        method: req.method,
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': key },
        body,
        signal: AbortSignal.timeout(10_000),
      })
      return send(res, r.status, await r.text())
    } catch (e) {
      if (e.status) return send(res, e.status, { error: e.message })
      return send(res, 502, { error: `Cannot reach Oasys Bay at ${base}. Is the Stock Management app running?` })
    }
  }
}
