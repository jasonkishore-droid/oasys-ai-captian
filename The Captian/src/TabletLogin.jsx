import { useState } from 'react'
import { SETTINGS_KEY } from './settings.js'

// The tablet's start page: whoever sets the tablet up on a table enters the table number and the staff password.
// The table number is saved with the other settings (it is what the tablet's order tab and waiter calls are kept under),
// and the tablet stays unlocked until someone logs out from its gear menu.
// Like the other screen locks here, the password is checked in the browser: it keeps guests out of setup, it is not real security.
export const TABLET_PASSWORD = '1234'
const LOGIN_KEY = 'captain-login'

export const isTabletLoggedIn = () => {
  try {
    return localStorage.getItem(LOGIN_KEY) === '1'
  } catch {
    return false
  }
}
export const tabletLogout = () => {
  try {
    localStorage.removeItem(LOGIN_KEY)
  } catch { /* nothing to forget */ }
}
const savedTable = () => {
  try {
    return String(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}').tableNo || '')
  } catch {
    return ''
  }
}
// writes only the table number into the saved settings, so nothing else set in an earlier session is lost
const saveTable = (tableNo) => {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...saved, tableNo }))
    localStorage.setItem(LOGIN_KEY, '1')
  } catch { /* private window: the tablet still starts, it just asks again next time */ }
}

const POINTS = ['Order by voice or on the screen', 'Call a waiter from the table', 'Follow your order live']

const Icon = ({ children }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
)

export default function TabletLogin({ onLogin }) {
  const [table, setTable] = useState(savedTable)
  const [pass, setPass] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const submit = (e) => {
    e.preventDefault()
    if (pass !== TABLET_PASSWORD) {
      setError('Wrong password.')
      setPass('')
      return
    }
    saveTable(table.trim())
    onLogin()
  }
  return (
    <main className="tl-page">
      <div className="tl-card">
        <aside className="tl-side">
          <span className="tl-logo" aria-hidden="true">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="5" width="18" height="14" rx="4" />
              <path d="M9 10.5v2M15 10.5v2M10 15.5h4" />
            </svg>
          </span>
          <h1>Oasys Restaurant</h1>
          <p className="tl-role">Table tablet</p>
          <ul>
            {POINTS.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </aside>

        <form className="tl-form" onSubmit={submit} aria-label="Set up this table">
          <h2>Set up this table</h2>
          <p className="tl-sub">Enter the table number and the staff password.</p>

          <label className="tl-field">
            <span>Table number</span>
            <div className="tl-input">
              <Icon>
                <path d="M4 10h16M6 10v9M18 10v9M3 10l2-5h14l2 5" />
              </Icon>
              <input value={table} maxLength={20} placeholder="e.g. 7 or T4" autoComplete="off" autoFocus inputMode="text" onChange={(e) => { setTable(e.target.value.trimStart()); setError('') }} />
            </div>
          </label>

          <label className="tl-field">
            <span>Password</span>
            <div className="tl-input">
              <Icon>
                <rect x="4" y="11" width="16" height="10" rx="2" />
                <path d="M8 11V8a4 4 0 0 1 8 0v3" />
              </Icon>
              <input type={show ? 'text' : 'password'} value={pass} placeholder="Enter the password" autoComplete="off" inputMode="numeric" onChange={(e) => { setPass(e.target.value); setError('') }} />
              <button type="button" className="tl-eye" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
                <Icon>
                  <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
                  <circle cx="12" cy="12" r="3" />
                  {show && <path d="M4 4l16 16" />}
                </Icon>
              </button>
            </div>
          </label>

          {error && (
            <p className="tl-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="tl-submit" disabled={!table.trim() || !pass}>
            Start
            <Icon>
              <path d="M5 12h14M13 6l6 6-6 6" />
            </Icon>
          </button>
        </form>
      </div>
    </main>
  )
}
