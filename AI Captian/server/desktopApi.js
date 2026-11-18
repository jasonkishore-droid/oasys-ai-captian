import { networkInterfaces } from 'node:os'

// /api/desktop/* -> the desktop-control service (sidecar/desktop_service.py).
// It moves this computer's real mouse, so by default only a browser on this
// computer may use it; set DESKTOP_ALLOW_LAN=1 to let other devices drive it.
const ACTIONS = new Set(['health', 'screenshot', 'read', 'move', 'click', 'click_text', 'fill', 'search', 'scroll', 'type', 'keys', 'open'])

// A request is from this computer when it comes from loopback or from one of
// this computer's own network addresses (opening https://192.168.x.x:5443 on
// the Greeny PC itself counts as local).
const ownAddresses = () =>
  new Set(
    Object.values(networkInterfaces())
      .flat()
      .filter(Boolean)
      .map((i) => i.address)
  )
const isLocal = (req) => {
  const a = (req.socket?.remoteAddress || '').replace(/^::ffff:/, '')
  return a === '127.0.0.1' || a === '::1' || ownAddresses().has(a)
}

export function desktopRoutes(serviceUrl, { allowLan = false } = {}) {
  const send = (res, status, body) => {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(body))
  }

  return async (req, res, next) => {
    const m = req.url?.match(/^\/api\/desktop\/(\w+)$/)
    if (!m) return next()
    if (!ACTIONS.has(m[1])) return send(res, 404, { ok: false, error: 'Unknown desktop action' })
    if (!allowLan && !isLocal(req)) {
      return send(res, 403, {
        ok: false,
        error: 'Mouse control only works from a browser on the Greeny computer itself (set DESKTOP_ALLOW_LAN=1 to allow other devices).',
      })
    }
    try {
      const chunks = []
      for await (const c of req) chunks.push(c)
      const r = await fetch(`${serviceUrl}/${m[1]}`, {
        method: m[1] === 'health' ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: m[1] === 'health' ? undefined : Buffer.concat(chunks).toString('utf8') || '{}',
        signal: AbortSignal.timeout(20000),
      })
      res.statusCode = r.status
      res.setHeader('Content-Type', 'application/json')
      res.end(await r.text())
    } catch (e) {
      send(res, 503, { ok: false, error: `The desktop-control service is not running (${e.message}).` })
    }
  }
}
