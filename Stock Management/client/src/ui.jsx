import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

// ---------- session / settings context ----------
export const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);
const LEVEL = { cashier: 1, manager: 2, admin: 3 };
export const can = (user, role) => LEVEL[user?.role] >= LEVEL[role];

// ---------- toasts ----------
const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((text, kind = 'ok') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
      </div>
    </ToastContext.Provider>
  );
}

// ---------- data loading ----------
export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: '' });
  const seq = useRef(0);
  const reload = useCallback(() => {
    const n = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: '' }));
    return fn().then(
      (data) => { if (n === seq.current) setState({ data, loading: false, error: '' }); return data; },
      (e) => { if (n === seq.current) setState((s) => ({ ...s, loading: false, error: e.message })); },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload, setData: (d) => setState((s) => ({ ...s, data: typeof d === 'function' ? d(s.data) : d })) };
}

// ---------- components ----------
export function Modal({ title, onClose, children, actions, size = '', busy }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className={`modal ${size}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close" disabled={busy}>×</button>
        </div>
        <div className="modal-body">{children}</div>
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  );
}

export function Confirm({ title, message, confirmLabel = 'Confirm', danger, onConfirm, onClose, children }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    setBusy(true);
    setError('');
    try { await onConfirm(); onClose(); } catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onClose} size="small" busy={busy}
      actions={<>
        <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className={`btn ${danger ? 'danger' : 'primary'}`} onClick={go} disabled={busy}>{busy ? 'Working…' : confirmLabel}</button>
      </>}>
      {message && <p className="muted">{message}</p>}
      {children}
      {error && <Alert>{error}</Alert>}
    </Modal>
  );
}

export const Alert = ({ children, onClose, kind = 'error' }) => (
  <div className={`alert ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
    <span>{children}</span>
    {onClose && <button onClick={onClose} aria-label="Dismiss">×</button>}
  </div>
);

export function Stat({ label, value, sub, tone = '', onClick, active }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className={`stat ${tone} ${active ? 'active' : ''}`} onClick={onClick}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </Tag>
  );
}

const STATUS_LABEL = { in_stock: 'In stock', low_stock: 'Low', out_of_stock: 'Out' };
export const StatusBadge = ({ status }) => <span className={`badge ${status}`}>{STATUS_LABEL[status]}</span>;

// Indian veg / non-veg mark: a square with a dot (green / brown), egg shown as yellow.
export const DietMark = ({ diet }) => (
  <span className={`diet ${diet}`} title={{ veg: 'Vegetarian', nonveg: 'Non-vegetarian', egg: 'Contains egg' }[diet]} aria-label={diet} />
);

// Bar spans 0 → 2× par; the tick marks par (the reorder point).
export function LevelBar({ qty, par }) {
  const pctFill = par > 0 ? Math.min(100, (Math.max(0, qty) / (par * 2)) * 100) : 100;
  const tone = qty <= 0 ? 'out' : qty < par ? 'low' : 'ok';
  return (
    <div className="level" title={`Par ${par}`}>
      <div className="track">
        <div className={`fill ${tone}`} style={{ width: `${pctFill}%` }} />
        {par > 0 && <div className="par" />}
      </div>
    </div>
  );
}

export const Empty = ({ children }) => <p className="empty">{children}</p>;
export const Loading = () => <p className="empty">Loading…</p>;

export function Field({ label, children, full, hint, error }) {
  return (
    <label className={`field ${full ? 'full' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Segmented({ value, onChange, options }) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map(([k, l]) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{l}</button>
      ))}
    </div>
  );
}
