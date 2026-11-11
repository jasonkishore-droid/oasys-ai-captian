import { useEffect, useState } from 'react'

// Tablet-only view: connect to the inventory (the Stock Management app, "Oasys Bay")
// so Greeny can read the menu and place orders. It flips the same setting as the
// "Connect to Oasys Bay" switch in Settings, then checks that the inventory answers.
export default function TabletInventory({ enabled, onChange }) {
  const [state, setState] = useState(null) // null | { ok: true | false | null, text }
  useEffect(() => {
    if (!enabled) return setState(null)
    let live = true
    setState({ ok: null, text: 'Connecting…' })
    fetch('/api/oasys/ping')
      .then(async (r) => {
        const b = await r.json().catch(() => ({}))
        if (!live) return
        setState(r.ok ? { ok: true, text: b.restaurant || b.club || 'Connected' } : { ok: false, text: b.error || `Error ${r.status}` })
      })
      .catch(() => live && setState({ ok: false, text: 'Cannot reach the inventory app' }))
    return () => {
      live = false
    }
  }, [enabled])

  const dot = state?.ok === true ? 'ok' : state?.ok === false ? 'bad' : enabled ? 'wait' : ''
  return (
    <button
      className={`tablet-inventory ${dot}`}
      onClick={() => onChange(!enabled)}
      aria-pressed={enabled}
      title={enabled ? 'Disconnect from the inventory' : 'Connect to the inventory to take orders'}
    >
      <span className="tablet-inventory-dot" aria-hidden="true" />
      {enabled ? (
        <span>
          Inventory · {state?.text || 'Connecting…'}
        </span>
      ) : (
        <span>Connect inventory</span>
      )}
    </button>
  )
}

// Is the receipt printer connected? The Bluetooth printer is driven from a signed-in Stock
// Management tab, which reports its state; this asks every few seconds while it is shown.
const PRINTER_TEXT = {
  ok: (s) => `Printer · ${s.name || 'connected'}`,
  wait: () => 'Printer · reconnecting…',
  bad: (s) => (s.tab_online ? 'Printer not connected' : 'Printer · open Stock Management'),
  off: () => 'Printer · Stock Management offline',
  old: () => 'Printer · restart Stock Management', // it is running a build without the printer report
}

export function TabletPrinter() {
  const [state, setState] = useState(null) // { kind: 'ok'|'wait'|'bad'|'off', ...status }
  useEffect(() => {
    let live = true
    const check = () =>
      fetch('/api/oasys/printer')
        .then(async (r) => {
          const b = await r.json().catch(() => ({}))
          if (!live) return
          // an older Stock Management has no /printer route, so its sign-in check answers instead
          if (r.status === 404 || (r.status === 401 && b.error === 'Please sign in')) return setState({ kind: 'old', error: b.error })
          if (!r.ok) return setState({ kind: 'off', error: b.error })
          setState({ ...b, kind: b.connected ? 'ok' : b.connecting ? 'wait' : 'bad' })
        })
        .catch(() => live && setState({ kind: 'off' }))
    check()
    const id = setInterval(check, 4000)
    return () => {
      live = false
      clearInterval(id)
    }
  }, [])
  if (!state) return null
  const dot = { ok: 'ok', wait: 'wait', bad: 'bad', off: '', old: '' }[state.kind]
  return (
    <div
      className={`tablet-inventory ${dot}`}
      role="status"
      title={state.kind === 'off' ? state.error || 'Cannot reach the Stock Management app' : 'Connect or disconnect the printer in the Stock Management app'}
    >
      <span className="tablet-inventory-dot" aria-hidden="true" />
      <span>{PRINTER_TEXT[state.kind](state)}</span>
    </div>
  )
}
