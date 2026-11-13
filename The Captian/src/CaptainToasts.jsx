import { useCallback, useEffect, useRef, useState } from 'react'
import { StageIcon } from './kds/StageIcon.jsx'

const SHOW_MS = 6000 // how long a toast stays

// Toasts on the guest's tablet, in The Captain's card look. Two kinds:
//   { kind: 'waiter', title, line }                      a waiter answered the table's call (an animated bell)
//   { kind: 'preparing' | 'ready' | 'served', title, line }   the kitchen moved this table's order on (the stage's own animation)
// push(toast) shows one (at most three at a time); drop(id) removes it; tapping a toast dismisses it.
export function useCaptainToasts() {
  const [toasts, setToasts] = useState([])
  const timers = useRef(new Map())
  const drop = useCallback((id) => {
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])
  const push = useCallback(
    (toast) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      setToasts((t) => [...t.slice(-2), { ...toast, id }])
      timers.current.set(id, setTimeout(() => drop(id), SHOW_MS))
      return id
    },
    [drop]
  )
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  return { toasts, push, drop }
}

const BellIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <g className="bell">
      <path d="M6 16a6 6 0 0 1 12 0z" />
      <path d="M12 7V5M10 5h4" />
      <path d="M4 19h16" />
    </g>
  </svg>
)

export default function CaptainToasts({ toasts, onDrop }) {
  if (!toasts.length) return null
  return (
    <div className="cap-toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} type="button" className="cap-toast" data-kind={t.kind} style={{ '--show': `${SHOW_MS}ms` }} onClick={() => onDrop(t.id)} aria-label={`${t.title}. Dismiss`}>
          <span className="cap-toast-icon">
            <i className="ripple" aria-hidden="true" />
            {t.kind === 'waiter' ? <BellIcon /> : <StageIcon stage={t.kind} />}
          </span>
          <span className="cap-toast-text">
            <strong>{t.title}</strong>
            <small>{t.line}</small>
          </span>
        </button>
      ))}
    </div>
  )
}
