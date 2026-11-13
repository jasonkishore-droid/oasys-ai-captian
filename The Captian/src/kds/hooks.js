import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { fetchBoard, fetchRestaurant, setTicketStatus, STREAM_URL } from './api.js'

// ---- one shared clock: every timer on screen ticks from a single interval ----
const listeners = new Set()
let clock = Date.now()
let clockTimer = null
const subscribeClock = (fn) => {
  listeners.add(fn)
  if (!clockTimer) {
    clockTimer = setInterval(() => {
      clock = Date.now()
      listeners.forEach((l) => l())
    }, 1000)
  }
  return () => {
    listeners.delete(fn)
    if (!listeners.size) (clearInterval(clockTimer), (clockTimer = null))
  }
}
export const useNow = () => useSyncExternalStore(subscribeClock, () => clock)

// ---- the board: loaded, kept live by the server's event stream, bumped with optimistic updates ----
const FALLBACK_POLL_MS = 30000

export function useBoard() {
  const [tickets, setTickets] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [online, setOnline] = useState(false) // the live stream is connected
  const [error, setError] = useState('')
  const busy = useRef(new Set()) // tickets with a change in flight: a refresh must not undo them

  const refresh = useCallback(async () => {
    try {
      const next = await fetchBoard()
      setTickets((cur) => next.map((t) => (busy.current.has(t.id) ? cur.find((c) => c.id === t.id) || t : t)))
      setLoaded(true)
      setError('')
    } catch (e) {
      setError(e.name === 'TimeoutError' ? 'The server is not answering.' : e.message || 'Could not load tickets.')
    }
  }, [])

  useEffect(() => {
    refresh()
    const es = new EventSource(STREAM_URL) // reconnects by itself; every (re)connect starts with an event
    es.addEventListener('kitchen', refresh)
    es.onopen = () => setOnline(true)
    es.onerror = () => setOnline(false)
    const poll = setInterval(refresh, FALLBACK_POLL_MS) // a safety net if the stream is blocked
    const wake = () => document.visibilityState === 'visible' && refresh()
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('online', refresh)
    return () => {
      es.close()
      clearInterval(poll)
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('online', refresh)
    }
  }, [refresh])

  // move a ticket to another stage (new, preparing, ready, served): the card moves at once, and moves
  // back with a message if the server refuses. A served ticket leaves the board.
  const move = useCallback(async (id, status) => {
    let before = null
    busy.current.add(id)
    setTickets((cur) => {
      before = cur.find((t) => t.id === id) || null
      return cur.map((t) => (t.id === id ? { ...t, status, ready_at: status === 'ready' ? new Date().toISOString() : t.ready_at } : t))
    })
    try {
      await setTicketStatus(id, status)
      setError('')
    } catch (e) {
      if (before) setTickets((cur) => cur.map((t) => (t.id === id ? before : t)))
      setError(`Could not update the ticket: ${e.message}`)
    } finally {
      busy.current.delete(id)
    }
  }, [])

  return { tickets, loaded, online, error, clearError: () => setError(''), move }
}

// ---- new-ticket detection: which tickets just arrived (empty on the first load) ----
export function useArrivals(tickets, loaded) {
  const seen = useRef(null)
  const [arrived, setArrived] = useState([])
  useEffect(() => {
    if (!loaded) return
    const ids = new Set(tickets.map((t) => t.id))
    if (seen.current) {
      const fresh = tickets.filter((t) => !seen.current.has(t.id))
      if (fresh.length) {
        setArrived(fresh)
        const t = setTimeout(() => setArrived([]), 2500)
        seen.current = ids
        return () => clearTimeout(t)
      }
    }
    seen.current = ids
  }, [tickets, loaded])
  return arrived
}

// ---- a short double beep; browsers allow sound only after a tap, hence a toggle ----
export function useSound() {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem('kds-sound') === '1'
    } catch {
      return false
    }
  })
  const ctx = useRef(null)
  const beep = useCallback(() => {
    try {
      const c = (ctx.current ??= new AudioContext())
      for (const at of [0, 0.18]) {
        const o = c.createOscillator()
        const g = c.createGain()
        o.frequency.value = 880
        g.gain.setValueAtTime(0.12, c.currentTime + at)
        g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + at + 0.14)
        o.connect(g).connect(c.destination)
        o.start(c.currentTime + at)
        o.stop(c.currentTime + at + 0.15)
      }
    } catch { /* no audio on this device */ }
  }, [])
  const toggle = useCallback(() => {
    setOn((v) => {
      try {
        localStorage.setItem('kds-sound', v ? '0' : '1')
      } catch { /* private window */ }
      if (!v) setTimeout(beep, 0)
      return !v
    })
  }, [beep])
  return { on, toggle, beep }
}

// ---- keep the screen awake: a kitchen display must not dim ----
export function useWakeLock() {
  useEffect(() => {
    if (!('wakeLock' in navigator)) return
    let lock = null
    let alive = true
    const take = async () => {
      try {
        lock = await navigator.wakeLock.request('screen')
        if (!alive) lock.release()
      } catch { /* refused (battery saver): nothing to do */ }
    }
    const again = () => document.visibilityState === 'visible' && take()
    take()
    document.addEventListener('visibilitychange', again)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', again)
      lock?.release().catch(() => {})
    }
  }, [])
}

// ---- the restaurant's name for the title ----
export function useRestaurant() {
  const [name, setName] = useState('Vasamo')
  useEffect(() => {
    let alive = true
    fetchRestaurant().then((n) => alive && n && setName(n)).catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  return name
}

// ---- light by default; the choice is remembered on this device ----
export function useKdsTheme() {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('kds-theme') === 'dark' ? 'dark' : 'light'
    } catch {
      return 'light'
    }
  })
  const toggle = useCallback(() => {
    setTheme((t) => {
      const next = t === 'light' ? 'dark' : 'light'
      try {
        localStorage.setItem('kds-theme', next)
      } catch { /* private window */ }
      return next
    })
  }, [])
  return [theme, toggle]
}

// the clock in the title bar (shares the one-second ticker)
export const useClock = () => new Date(useNow())
