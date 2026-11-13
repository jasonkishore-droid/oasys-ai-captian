// The Kitchen Display's calls to the ordering server (server/oasysApi.js).
const BASE = '/api/oasys/kitchen'
const TIMEOUT_MS = 8000

async function call(path, init = {}) {
  const r = await fetch(`${BASE}${path}`, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS), ...init })
  if (!r.ok) {
    const body = await r.json().catch(() => ({}))
    throw new Error(body.error || `The server answered ${r.status}`)
  }
  return r.json()
}

// tickets still cooking, plus those bumped in the last 30 minutes
export const fetchBoard = async () => (await call('/board')).tickets

// status: 'ready' (bump) or 'new' (recall)
export const setTicketStatus = (id, status) =>
  call('/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) })

export const STREAM_URL = `${BASE}/stream`

// the restaurant's name, for the screen's title
export const fetchRestaurant = async () => {
  const r = await fetch('/api/oasys/ping', { signal: AbortSignal.timeout(TIMEOUT_MS) })
  return r.ok ? (await r.json()).restaurant || '' : ''
}
