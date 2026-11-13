import { useEffect, useMemo } from 'react'
import WaiterCalls from '../kds/WaiterCalls.jsx'
import { useArrivals, useClock, useKdsTheme, useRestaurant, useSound, useWaiterCalls, useWakeLock } from '../kds/hooks.js'
import '../kds/kds.css'

// The Waiter Calls screen on its own port (npm run waiter): every table asking for a waiter, live. It shares its
// look and its calls with the Kitchen Display's Waiter calls tab, but needs nothing else from it.
export default function WaiterScreen() {
  const { calls, loaded, online, error, clearError, acknowledge, finish } = useWaiterCalls()
  const arrived = useArrivals(calls, loaded) // tables that just called
  const sound = useSound()
  const name = useRestaurant()
  const [theme, toggleTheme] = useKdsTheme()
  const clock = useClock()
  useWakeLock()

  const waiting = calls.filter((c) => c.status === 'open').length // nobody has answered yet
  const coming = calls.length - waiting // a waiter is on the way
  const fresh = useMemo(() => new Set(arrived.map((c) => c.id)), [arrived])

  useEffect(() => {
    if (arrived.length && sound.on) sound.beep()
  }, [arrived]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    document.title = waiting ? `(${waiting}) Waiter calls · ${name}` : `Waiter calls · ${name}`
  }, [waiting, name])

  return (
    <div className="kds standalone" data-theme={theme} role="main" aria-label={`${name} waiter calls`}>
      <header className="kds-bar">
        <div className="kds-brand">
          <span className="kds-mark" aria-hidden="true">
            {name.charAt(0)}
          </span>
          <div>
            <h1>{name}</h1>
            <p>Waiter calls</p>
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
        </div>
      </header>

      {/* how many are waiting and how many are being answered */}
      <nav className="kds-tabs waiter-summary" aria-label="Summary">
        <span className={waiting ? 'alert' : ''}>
          Waiting <strong>({waiting})</strong>
        </span>
        <span>
          On the way <strong>({coming})</strong>
        </span>
      </nav>

      {error && (
        <div className="kds-alert" role="alert">
          <span>{error}</span>
          <button type="button" className="kds-chip" onClick={clearError}>
            Dismiss
          </button>
        </div>
      )}

      <main className="kds-main">
        <WaiterCalls calls={calls} loaded={loaded} fresh={fresh} onAck={acknowledge} onDone={finish} />
      </main>

      {/* read out by screen readers when a table calls */}
      <p className="kds-sr" aria-live="polite">
        {arrived.length ? `Table ${arrived.map((c) => c.table_no).join(', ')} is calling for a waiter` : ''}
      </p>
    </div>
  )
}
