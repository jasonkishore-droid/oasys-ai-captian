import { useState } from 'react';
import { api } from '../api';

// The sign-in page: a navy brand panel beside the form (stacked on a phone), the same design as the Kitchen Display's.
const Icon = ({ children }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

const POINTS = ['Ingredient stock and recipes', 'Purchases and GST billing', 'Daily sales and stock reports'];

export default function Login({ onSignedIn }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api.login(username.trim(), password);
      onSignedIn(r.user);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <main className="slg-page">
      <div className="slg-card">
        <aside className="slg-side">
          <span className="slg-logo" aria-hidden="true">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 14.2A3.9 3.9 0 1 1 8.6 6.7a3.9 3.9 0 0 1 6.8 0A3.9 3.9 0 1 1 17 14.2" />
              <path d="M7 14.2V19.5a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5V14.2" />
              <path d="M7 17h10" />
            </svg>
          </span>
          <h1>Oasys Restaurant</h1>
          <p className="slg-role">Stock &amp; Billing</p>
          <ul>
            {POINTS.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </aside>

        <form className="slg-form" onSubmit={submit} aria-label="Sign in">
          <h2>Welcome back</h2>
          <p className="slg-sub">Sign in to manage stock and bills.</p>

          <label className="slg-field">
            <span>Username</span>
            <div className="slg-input">
              <Icon>
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
              </Icon>
              <input autoFocus autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="Enter your username" value={username} onChange={(e) => setUsername(e.target.value)} required />
            </div>
          </label>

          <label className="slg-field">
            <span>Password</span>
            <div className="slg-input">
              <Icon>
                <rect x="4" y="11" width="16" height="10" rx="2" />
                <path d="M8 11V8a4 4 0 0 1 8 0v3" />
              </Icon>
              <input type={show ? 'text' : 'password'} autoComplete="current-password" placeholder="Enter your password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              <button type="button" className="slg-eye" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
                <Icon>
                  <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
                  <circle cx="12" cy="12" r="3" />
                  {show && <path d="M4 4l16 16" />}
                </Icon>
              </button>
            </div>
          </label>

          {error && (
            <p className="slg-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="slg-submit" disabled={busy || !username.trim() || !password}>
            {busy ? 'Signing in…' : 'Sign in'}
            <Icon>
              <path d="M5 12h14M13 6l6 6-6 6" />
            </Icon>
          </button>
        </form>
      </div>
    </main>
  );
}
