// The front door: the one public port. No dependencies.
//   /stock and /stock/*   Stock Management (its web app and API), with the /stock prefix taken off
//   everything else       the Captain (the tablet app, /kds, /waiter, /api/oasys, /api/live ...)
// Streams (server-sent events) and WebSockets (the Gemini voice link at /api/live) pass straight through.
// The original Host header is kept, because Stock Management's same-origin check compares it with the browser's Origin.
import http from 'node:http'
import net from 'node:net'

const PORT = Number(process.env.PORT) || 8080
const CAPTAIN = { host: process.env.CAPTAIN_HOST || '127.0.0.1', port: Number(process.env.CAPTAIN_PORT) || 5181 }
const STOCK = { host: process.env.STOCK_HOST || '127.0.0.1', port: Number(process.env.STOCK_PORT) || 4020 }
const PREFIX = '/stock'

const isStock = (url) => url === PREFIX || url.startsWith(`${PREFIX}/`) || url.startsWith(`${PREFIX}?`)
// which service gets this request, and the path it should see
function route(url = '/') {
  if (!isStock(url)) return { to: CAPTAIN, path: url }
  const rest = url.slice(PREFIX.length)
  return { to: STOCK, path: rest.startsWith('/') ? rest : `/${rest}` }
}

const server = http.createServer((req, res) => {
  // /stock without the slash: the app's files are addressed relative to /stock/
  if (req.url === PREFIX) {
    res.writeHead(308, { Location: `${PREFIX}/` }).end()
    return
  }
  const { to, path } = route(req.url)
  const upstream = http.request({ ...to, path, method: req.method, headers: req.headers }, (up) => {
    res.writeHead(up.statusCode, up.headers)
    up.pipe(res)
  })
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' })
    res.end('Bad gateway: the service is starting or restarting. Reload in a few seconds.')
  })
  req.on('aborted', () => upstream.destroy())
  req.pipe(upstream)
})

// WebSocket upgrades (the voice chat)
server.on('upgrade', (req, socket, head) => {
  const { to, path } = route(req.url)
  const up = net.connect(to.port, to.host, () => {
    const lines = [`${req.method} ${path} HTTP/${req.httpVersion}`]
    for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`)
    up.write(`${lines.join('\r\n')}\r\n\r\n`)
    if (head?.length) up.write(head)
    socket.pipe(up).pipe(socket)
  })
  const close = () => { socket.destroy(); up.destroy() }
  up.on('error', close)
  socket.on('error', close)
})

server.listen(PORT, '0.0.0.0', () => console.log(`[gateway] listening on ${PORT}: / -> Captain :${CAPTAIN.port}, ${PREFIX} -> Stock Management :${STOCK.port}`))
