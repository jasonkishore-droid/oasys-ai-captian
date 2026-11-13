import { useEffect, useRef } from 'react'

// Order status on the tablet (F7): while a table number is set, watch the kitchen's live stream and call
// onChange(ticket) whenever one of THIS table's tickets moves to a new stage (preparing, ready, served).
// Tickets already on the board when the tablet starts are only remembered, never announced.
export function useOrderStatus(tableNo, onChange) {
  const latest = useRef(onChange)
  latest.current = onChange

  useEffect(() => {
    const key = String(tableNo || '').trim().toLowerCase()
    if (!key) return undefined
    let stopped = false
    let known = null // ticket id -> the stage last seen

    const load = async () => {
      try {
        const r = await fetch('/api/oasys/kitchen/board', { cache: 'no-store' })
        if (!r.ok || stopped) return
        const { tickets = [] } = await r.json()
        const mine = tickets.filter((t) => String(t.table_no || '').trim().toLowerCase() === key)
        if (known) {
          for (const t of mine) {
            const was = known.get(t.id)
            if (was !== undefined && was !== t.status && ['preparing', 'ready', 'served'].includes(t.status)) latest.current?.(t)
          }
        }
        known = new Map(mine.map((t) => [t.id, t.status]))
      } catch {
        /* offline for a moment: the stream reconnects and the next event loads it again */
      }
    }
    load()
    const es = typeof EventSource === 'undefined' ? null : new EventSource('/api/oasys/kitchen/stream')
    es?.addEventListener('kitchen', load)
    return () => {
      stopped = true
      es?.close()
    }
  }, [tableNo])
}
