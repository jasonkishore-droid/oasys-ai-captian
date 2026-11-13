// "Call waiter" on the screen-only view (F6). One tap calls a waiter to this table; while the call
// is waiting it shows how long ago it was made and lets the guest cancel it, and once a waiter has
// acknowledged it on the staff screen it says one is on the way.
//   call: the table's active call from /api/oasys/waiter (null when there is none)
//   onCall / onCancel: run the call_waiter / cancel_waiter_call tools; resolve to the tool's result
import { useEffect, useState } from 'react'
import Icon from './icons.jsx'

const ago = (iso, now) => {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)} min`
}

export default function TabletWaiter({ call, onCall, onCancel }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!call) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [call])
  useEffect(() => {
    if (!error) return
    const id = setTimeout(() => setError(''), 6000)
    return () => clearTimeout(id)
  }, [error])

  const act = async (fn) => {
    setBusy(true)
    setError('')
    try {
      const r = await fn()
      if (r && r.ok === false) setError(r.error || 'Something went wrong. Please wave to a waiter.')
    } finally {
      setBusy(false)
    }
  }

  if (error) {
    return (
      <div className="tablet-inventory bad tablet-waiter" role="alert">
        <span className="tablet-inventory-dot" aria-hidden="true" />
        <span>{error}</span>
      </div>
    )
  }

  if (!call) {
    return (
      <button className="tablet-inventory tablet-waiter" disabled={busy} onClick={() => act(onCall)} aria-label="Call a waiter to this table">
        <Icon name="bell" size={18} />
        <span>{busy ? 'Calling…' : 'Call waiter'}</span>
      </button>
    )
  }

  const coming = call.status === 'acknowledged'
  return (
    <div className={`tablet-inventory tablet-waiter ${coming ? 'ok' : 'wait'}`} role="status" aria-live="polite">
      <span className="tablet-inventory-dot" aria-hidden="true" />
      <span>
        {coming ? 'A waiter is on the way' : 'Waiter called'}
        <small> · {ago(coming ? call.acknowledged_at : call.created_at, now)}</small>
      </span>
      {!coming && (
        <button className="tablet-waiter-cancel" disabled={busy} onClick={() => act(onCancel)} aria-label="Cancel the waiter call">
          Cancel
        </button>
      )}
    </div>
  )
}
