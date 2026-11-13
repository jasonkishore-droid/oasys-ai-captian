import { useCallback, useEffect, useMemo, useState } from 'react'
import Ticket from './Ticket.jsx'
import WaiterCalls from './WaiterCalls.jsx'
import { useArrivals, useBoard, useClock, useKdsTheme, useRestaurant, useSound, useWaiterCalls, useWakeLock } from './hooks.js'
import './kds.css'

const TABS = [
  ['cooking', 'In progress'],
  ['ready', 'Ready'],
  ['served', 'Served'],
  ['all', 'All'],
]

// The Kitchen Display Screen: a full-screen card in the app. Light by default. Tickets arrive live.
export default function KitchenScreen({ onClose }) {
  const { tickets, loaded, online, error, clearError, move } = useBoard()
  const arrived = useArrivals(tickets, loaded)
  const waiter = useWaiterCalls()
  const arrivedCalls = useArrivals(waiter.calls, waiter.loaded) // tables that just called
  const sound = useSound()
  const name = useRestaurant()
  const [theme, toggleTheme] = useKdsTheme()
  const clock = useClock()
  const [tab, setTab] = useState('cooking')
  const [leaving, setLeaving] = useState(false)
  useWakeLock()

  const close = useCallback(() => {
    if (!onClose) return
    setLeaving(true)
    setTimeout(onClose, 220)
  }, [onClose])
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  const cooking = useMemo(() => tickets.filter((t) => t.status === 'new' || t.status === 'preparing').sort((a, b) => a.id - b.id), [tickets])
  const ready = useMemo(() => tickets.filter((t) => t.status === 'ready').sort((a, b) => b.id - a.id), [tickets])
  const served = useMemo(() => tickets.filter((t) => t.status === 'served').sort((a, b) => b.id - a.id), [tickets])
  const shown = tab === 'cooking' ? cooking : tab === 'ready' ? ready : tab === 'served' ? served : [...cooking, ...ready, ...served]
  const counts = { cooking: cooking.length, ready: ready.length, served: served.length, all: tickets.length }
  const fresh = useMemo(() => new Set(arrived.map((t) => t.id)), [arrived])
  const freshCalls = useMemo(() => new Set(arrivedCalls.map((c) => c.id)), [arrivedCalls])
  const waiting = waiter.calls.filter((c) => c.status === 'open').length // calls nobody has answered yet

  useEffect(() => {
    if ((arrived.length || arrivedCalls.length) && sound.on) sound.beep()
  }, [arrived, arrivedCalls]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const n = cooking.length + waiting
    document.title = n ? `(${n}) Kitchen · ${name}` : `Kitchen · ${name}`
    return () => {
      if (onClose) document.title = 'The Captain'
    }
  }, [cooking.length, waiting, name])

  return (
    <div className={`kds${leaving ? ' leaving' : ''}${onClose ? '' : ' standalone'}`} data-theme={theme} role="dialog" aria-label={`${name} kitchen`}>
      <header className="kds-bar">
        <div className="kds-brand">
          <span className="kds-mark" aria-hidden="true">
            {name.charAt(0)}
          </span>
          <div>
            <h1>{name}</h1>
            <p>Kitchen display</p>
          </div>
        </div>
        <time className="kds-clock" dateTime={clock.toISOString()}>
          <span>{clock.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
          <strong>{clock.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })}</strong>
        </time>
        <div className="kds-tools">
          <span className={`kds-link${online ? ' on' : ''}`} role="status">
            <i aria-hidden="true" />
            {online ? 'Live' : 'Reconnecting'}
          </span>
          <button type="button" className="kds-chip" aria-pressed={sound.on} onClick={sound.toggle}>
            Sound {sound.on ? 'on' : 'off'}
          </button>
          <button type="button" className="kds-chip" onClick={toggleTheme} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>
            {theme === 'light' ? 'Dark' : 'Light'}
          </button>
          {onClose && (
            <button type="button" className="kds-close" onClick={close} aria-label="Close the kitchen screen">
              ✕
            </button>
          )}
        </div>
      </header>

      <nav className="kds-tabs" role="tablist" aria-label="Show tickets">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
            {label} <span>({counts[key]})</span>
          </button>
        ))}
        {/* tables asking for a waiter: red while any call is still unanswered */}
        <button type="button" role="tab" className={`kds-tab-calls${waiting ? ' alert' : ''}`} aria-selected={tab === 'calls'} onClick={() => setTab('calls')}>
          Waiter calls <span>({waiter.calls.length})</span>
        </button>
      </nav>

      {(error || waiter.error) && (
        <div className="kds-alert" role="alert">
          <span>{error || waiter.error}</span>
          <button type="button" className="kds-chip" onClick={error ? clearError : waiter.clearError}>
            Dismiss
          </button>
        </div>
      )}

      <main className="kds-main" role="tabpanel">
        {tab === 'calls' ? (
          <WaiterCalls calls={waiter.calls} loaded={waiter.loaded} fresh={freshCalls} onAck={waiter.acknowledge} onDone={waiter.finish} />
        ) : !loaded ? (
          <p className="kds-empty">Loading tickets…</p>
        ) : shown.length ? (
          <div className="kds-wall">
            {shown.map((t) => (
              <Ticket key={t.id} ticket={t} fresh={fresh.has(t.id)} onMove={move} />
            ))}
          </div>
        ) : (
          <p className="kds-empty">{tab === 'ready' ? 'Nothing ready yet.' : tab === 'served' ? 'Nothing served yet.' : tab === 'all' ? 'No tickets yet.' : 'All clear. New orders appear here.'}</p>
        )}
      </main>

      {/* read out by screen readers when a ticket arrives */}
      <p className="kds-sr" aria-live="polite">
        {arrivedCalls.length
          ? `Table ${arrivedCalls.map((c) => c.table_no).join(', ')} is calling for a waiter`
          : arrived.length
            ? `New ticket: ${arrived.map((t) => (t.table_no ? `table ${t.table_no}` : 'no table')).join(', ')}`
            : ''}
      </p>
    </div>
  )
}
