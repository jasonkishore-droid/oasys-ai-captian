import { useCallback, useEffect, useState } from 'react';
import { api, setUnauthorizedHandler } from './api';
import { AppContext, can, Modal, Field, Alert, useToast } from './ui.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Pos from './pages/Pos.jsx';
import Stock from './pages/Stock.jsx';
import Menu from './pages/Menu.jsx';
import Purchases from './pages/Purchases.jsx';
import Bills from './pages/Bills.jsx';
import Reports from './pages/Reports.jsx';
import Users from './pages/Users.jsx';
import PrinterControl from './PrinterControl.jsx';
import Settings from './pages/Settings.jsx';

const PAGES = [
  { key: 'dashboard', label: 'Dashboard', icon: '◧', role: 'cashier', component: Dashboard },
  { key: 'pos', label: 'Billing', icon: '₹', role: 'cashier', component: Pos },
  { key: 'bills', label: 'Bills', icon: '☰', role: 'cashier', component: Bills },
  { key: 'stock', label: 'Stock', icon: '▤', role: 'cashier', component: Stock },
  { key: 'menu', label: 'Menu & recipes', icon: '✎', role: 'cashier', component: Menu },
  { key: 'purchases', label: 'Purchases', icon: '⇩', role: 'manager', component: Purchases },
  { key: 'reports', label: 'Reports', icon: '◔', role: 'manager', component: Reports },
  { key: 'settings', label: 'Settings', icon: '⚙', role: 'manager', component: Settings },
  { key: 'users', label: 'Staff', icon: '☺', role: 'admin', component: Users },
];

const readHash = () => window.location.hash.replace(/^#\/?/, '').split('?')[0] || 'dashboard';

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = checking, null = signed out
  const [settings, setSettings] = useState(null);
  const reloadSettings = useCallback(() => api.settings().then(setSettings), []);
  const [page, setPage] = useState(readHash);
  const [navOpen, setNavOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const toast = useToast();

  const signedOut = useCallback(() => { setUser(null); setSettings(null); }, []);
  useEffect(() => { setUnauthorizedHandler(signedOut); }, [signedOut]);

  useEffect(() => {
    api.me().then((r) => setUser(r.user)).catch(() => setUser(null));
    const onHash = () => { setPage(readHash()); setNavOpen(false); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (user) api.settings().then(setSettings).catch((e) => toast(e.message, 'error'));
  }, [user, toast]);

  const updateReady = useNewVersion();

  if (user === undefined) return <div className="boot">Loading…</div>;
  if (!user) return <Login onSignedIn={setUser} />;
  if (!settings) return <div className="boot">Loading…</div>;

  const allowed = PAGES.filter((p) => can(user, p.role));
  const current = allowed.find((p) => p.key === page) || allowed[0];
  const Page = current.component;
  const go = (key) => { window.location.hash = `#/${key}`; };

  const logout = async () => {
    await api.logout().catch(() => {});
    signedOut();
  };

  return (
    <AppContext.Provider value={{ user, settings, go, reloadSettings }}>
      <div className={`shell ${navOpen ? 'nav-open' : ''}`}>
        <aside className="sidebar">
          <div className="brand">
            <span className="logo" aria-hidden>V</span>
            <div>
              <div className="brand-name">{settings.restaurant.name}</div>
              <div className="brand-sub">{settings.restaurant.tagline}</div>
            </div>
          </div>
          <nav className="nav">
            {allowed.map((p) => (
              <a key={p.key} href={`#/${p.key}`} className={p.key === current.key ? 'on' : ''} aria-current={p.key === current.key ? 'page' : undefined}>
                <span className="nav-icon" aria-hidden>{p.icon}</span>{p.label}
              </a>
            ))}
          </nav>
          <div className="me">
            <div className="me-name">{user.name}</div>
            <div className="me-role">{user.role} · {user.username}</div>
            <div className="me-actions">
              <button className="link" onClick={() => setPwOpen(true)}>Password</button>
              <button className="link" onClick={logout}>Sign out</button>
            </div>
          </div>
        </aside>
        <div className="scrim" onClick={() => setNavOpen(false)} />
        <main className="main">
          <header className="topbar">
            <button className="icon-btn menu-btn" onClick={() => setNavOpen(true)} aria-label="Open menu">☰</button>
            <h1>{current.label}</h1>
            <span className="topbar-date">{new Date(`${settings.business_date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
            <PrinterControl />
          </header>
          {updateReady && (
            <div className="alert warn update-banner" role="status">
              <span>A new version of the app is available.</span>
              <button className="btn primary" onClick={() => window.location.reload()}>Reload</button>
            </div>
          )}
          <Page key={current.key} />
        </main>
      </div>
      {pwOpen && <PasswordDialog onClose={() => setPwOpen(false)} />}
    </AppContext.Provider>
  );
}

function PasswordDialog({ onClose }) {
  const [form, setForm] = useState({ current: '', next: '', again: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const mismatch = form.again && form.next !== form.again;
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.changePassword(form.current, form.next);
      toast('Password changed. Other devices were signed out.');
      onClose();
    } catch (err) { setError(err.message); setBusy(false); }
  };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <Modal title="Change password" onClose={onClose} size="small" busy={busy}>
      <form className="grid one" onSubmit={save} id="pw-form">
        <Field label="Current password"><input type="password" autoComplete="current-password" value={form.current} onChange={set('current')} required /></Field>
        <Field label="New password" hint="At least 8 characters"><input type="password" autoComplete="new-password" minLength={8} value={form.next} onChange={set('next')} required /></Field>
        <Field label="Repeat new password" error={mismatch ? "Doesn't match" : ''}><input type="password" autoComplete="new-password" value={form.again} onChange={set('again')} required /></Field>
        {error && <Alert>{error}</Alert>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || mismatch || form.next.length < 8}>{busy ? 'Saving…' : 'Change password'}</button>
        </div>
      </form>
    </Modal>
  );
}

// Notices when the server has a newer build than the one running in this tab (checked every minute and on focus).
function useNewVersion() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const mine = [...document.scripts].map((x) => x.src.match(/assets\/index-[^/]+\.js/)?.[0]).find(Boolean);
    if (!mine) return undefined; // dev server: Vite hot-reloads anyway
    const check = () => fetch('/', { cache: 'no-store' }).then((r) => r.text())
      .then((html) => { const live = html.match(/assets\/index-[^"']+\.js/)?.[0]; if (live && live !== mine) setReady(true); })
      .catch(() => {});
    const timer = setInterval(check, 60000);
    window.addEventListener('focus', check);
    return () => { clearInterval(timer); window.removeEventListener('focus', check); };
  }, []);
  return ready;
}
