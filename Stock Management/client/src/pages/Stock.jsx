import { useMemo, useState } from 'react';
import { api } from '../api';
import { useApp, useLoad, useLiveStock, useToast, can, Stat, StatusBadge, LevelBar, Modal, Alert, Loading, Empty, Field, Segmented } from '../ui.jsx';
import { money, moneyShort, qty, shortDate, dateTime, MOVEMENT_LABEL, downloadCsv } from '../format';

const FILTERS = [['all', 'All'], ['low', 'Low / out'], ['expiring', 'Expiring'], ['negative', 'Negative']];

export default function Stock() {
  const { user, settings } = useApp();
  const manager = can(user, 'manager');
  const q = useLoad(() => Promise.all([api.ingredients(), api.suppliers()]));
  useLiveStock(q.refresh); // stays up to date when stock changes, including from the kitchen
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [filter, setFilter] = useState('all');
  const [action, setAction] = useState(null); // { type, item }
  const [history, setHistory] = useState(null);
  const [editing, setEditing] = useState(null);
  const [countMode, setCountMode] = useState(false);

  const [items, suppliers] = q.data || [[], []];
  const upsert = (it) => q.setData(([xs, s]) => [[...xs.filter((x) => x.id !== it.id), it].sort((a, b) => a.name.localeCompare(b.name)), s]);

  const stats = useMemo(() => ({
    value: items.reduce((s, i) => s + i.value, 0),
    low: items.filter((i) => i.status !== 'in_stock').length,
    expiring: items.filter((i) => i.expiring_soon || i.expired).length,
    negative: items.filter((i) => i.quantity < 0).length,
  }), [items]);

  const visible = useMemo(() => {
    const s = search.trim().toLowerCase();
    return items.filter((i) => {
      if (s && !i.name.toLowerCase().includes(s) && !(i.supplier || '').toLowerCase().includes(s)) return false;
      if (category && i.category !== category) return false;
      if (filter === 'low' && i.status === 'in_stock') return false;
      if (filter === 'expiring' && !(i.expiring_soon || i.expired)) return false;
      if (filter === 'negative' && i.quantity >= 0) return false;
      return true;
    });
  }, [items, search, category, filter]);

  const exportCsv = () => downloadCsv(`oasys-stock-${settings.business_date}.csv`, visible, [
    { label: 'Ingredient', value: (i) => i.name }, { label: 'Category', value: (i) => i.category },
    { label: 'On hand', value: (i) => i.quantity }, { label: 'Unit', value: (i) => i.unit },
    { label: 'Par', value: (i) => i.par_level }, { label: 'Reorder qty', value: (i) => i.reorder_qty },
    { label: 'Avg cost (₹)', value: (i) => i.avg_cost }, { label: 'Value (₹)', value: (i) => i.value },
    { label: 'Supplier', value: (i) => i.supplier }, { label: 'Storage', value: (i) => i.storage },
    { label: 'Expiry', value: (i) => i.expiry_date }, { label: 'Status', value: (i) => i.status },
  ]);

  if (q.loading && !q.data) return <Loading />;

  return (
    <div className="page">
      <section className="stats">
        <Stat label="Ingredients" value={items.length} onClick={() => setFilter('all')} active={filter === 'all'} />
        <Stat label="Low / out" value={stats.low} tone="warn" onClick={() => setFilter('low')} active={filter === 'low'} />
        <Stat label={`Expiring ≤ ${settings.expiring_days} days`} value={stats.expiring} tone="danger" onClick={() => setFilter('expiring')} active={filter === 'expiring'} />
        <Stat label="Below zero (check)" value={stats.negative} tone={stats.negative ? 'danger' : ''} onClick={() => setFilter('negative')} active={filter === 'negative'} />
        <Stat label="Stock value at cost" value={moneyShort(stats.value)} />
      </section>

      <section className="toolbar">
        <input className="search" placeholder="Search ingredients or suppliers…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {settings.ingredient_categories.map((c) => <option key={c}>{c}</option>)}
        </select>
        <Segmented value={filter} onChange={setFilter} options={FILTERS} />
        <span className="spacer" />
        <button className="btn" onClick={exportCsv}>Export CSV</button>
        {manager && <button className="btn" onClick={() => setCountMode(true)}>Stock take</button>}
        {manager && <button className="btn primary" onClick={() => setEditing({})}>+ Ingredient</button>}
      </section>

      {q.error && <Alert onClose={q.reload}>{q.error}</Alert>}

      <section className="card">
        {visible.length === 0 ? <Empty>No ingredients match.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Ingredient</th><th>Category</th><th className="num">On hand</th><th>Level</th><th>Status</th><th>Expiry</th><th className="num">Avg cost</th><th className="num">Value</th><th /></tr>
              </thead>
              <tbody>
                {visible.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <button className="name link-plain" onClick={() => setHistory(i)}>{i.name}</button>
                      <div className="sub">{i.supplier || '—'} · {i.storage || '—'}</div>
                    </td>
                    <td><span className="chip">{i.category}</span></td>
                    <td className={`num ${i.quantity < 0 ? 'danger' : ''}`}><strong>{qty(i.quantity, i.unit)}</strong><div className="sub">par {qty(i.par_level, i.unit)}</div></td>
                    <td><LevelBar qty={i.quantity} par={i.par_level} /></td>
                    <td><StatusBadge status={i.status} /></td>
                    <td className="nowrap">{i.expiry_date ? <span className={i.expired ? 'exp expired' : i.expiring_soon ? 'exp soon' : ''}>{shortDate(i.expiry_date)}{i.expired && ' · expired'}</span> : <span className="muted">—</span>}</td>
                    <td className="num">{money(i.avg_cost)}<span className="sub">/{i.unit}</span></td>
                    <td className="num">{money(i.value)}</td>
                    <td className="actions">
                      <button className="link" onClick={() => setHistory(i)}>History</button>
                      {manager && <>
                        <button className="link" onClick={() => setAction({ type: 'count', item: i })}>Count</button>
                        <button className="link" onClick={() => setAction({ type: 'wastage', item: i })}>Waste</button>
                        <button className="link" onClick={() => setAction({ type: 'adjustment', item: i })}>Adjust</button>
                        <button className="link" onClick={() => setEditing(i)}>Edit</button>
                      </>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="muted small">Showing {visible.length} of {items.length}. Quantities change only through purchases, sales, wastage, adjustments and counts, and every change is kept in the history.</p>

      {action && <MovementDialog {...action} onClose={() => setAction(null)} onSaved={upsert} />}
      {history && <HistoryDialog item={history} onClose={() => setHistory(null)} />}
      {editing && <IngredientForm item={editing} suppliers={suppliers} onClose={() => setEditing(null)} onSaved={(it) => { upsert(it); setEditing(null); }} onRemoved={() => { q.reload(); setEditing(null); }} />}
      {countMode && <StockTake items={visible} onClose={() => setCountMode(false)} onDone={() => { setCountMode(false); q.reload(); }} />}
    </div>
  );
}

const ACTION = {
  wastage: { title: 'Record wastage', label: 'Quantity wasted', note: 'Reason', placeholder: 'e.g. Spoilt overnight', button: 'Record wastage' },
  adjustment: { title: 'Adjust stock', label: 'Change (+ add / − remove)', note: 'Reason', placeholder: 'e.g. Borrowed from sister outlet', button: 'Adjust' },
  count: { title: 'Physical count', label: 'Counted on hand', note: 'Note (optional)', placeholder: 'e.g. Night count', button: 'Save count' },
};

function MovementDialog({ type, item, onClose, onSaved }) {
  const toast = useToast();
  const a = ACTION[type];
  const [quantity, setQuantity] = useState(type === 'count' ? String(Math.max(0, item.quantity)) : '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const n = Number(quantity);
  const after = type === 'wastage' ? item.quantity - n : type === 'adjustment' ? item.quantity + n : n;
  const valid = quantity !== '' && Number.isFinite(n) && (type === 'count' ? n >= 0 : type === 'wastage' ? n > 0 : n !== 0) && (type === 'count' || note.trim().length >= 3);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api.moveStock(item.id, { type, quantity: n, note: note.trim() || null });
      onSaved(r.ingredient);
      const v = r.movement ? r.movement.quantity : 0;
      toast(type === 'count' ? `${item.name} counted: variance ${v > 0 ? '+' : ''}${qty(v, item.unit)}` : `${item.name} updated`);
      onClose();
    } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <Modal title={`${a.title}: ${item.name}`} onClose={onClose} size="small" busy={busy}>
      <form onSubmit={save} className="grid one">
        <p className="muted">Book stock: <strong>{qty(item.quantity, item.unit, { small: false })}</strong></p>
        <Field label={`${a.label} (${item.unit})`}>
          <input autoFocus type="number" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
        </Field>
        <Field label={a.note}><input value={note} onChange={(e) => setNote(e.target.value)} placeholder={a.placeholder} maxLength={255} required={type !== 'count'} /></Field>
        {valid && <p className="muted small">After: <strong>{qty(after, item.unit, { small: false })}</strong>{type === 'count' && ` · variance ${after - item.quantity > 0 ? '+' : ''}${qty(after - item.quantity, item.unit, { small: false })} (${money((after - item.quantity) * item.avg_cost)})`}</p>}
        {error && <Alert>{error}</Alert>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className={`btn ${type === 'wastage' ? 'danger' : 'primary'}`} disabled={!valid || busy}>{busy ? 'Saving…' : a.button}</button>
        </div>
      </form>
    </Modal>
  );
}

function HistoryDialog({ item, onClose }) {
  const q = useLoad(() => Promise.all([api.movements({ ingredient_id: item.id, limit: 150 }), api.ingredient(item.id)]), [item.id]);
  const [moves, detail] = q.data || [[], null];
  return (
    <Modal title={item.name} onClose={onClose} size="wide">
      {q.loading && !q.data ? <Loading /> : q.error ? <Alert>{q.error}</Alert> : (
        <>
          <p className="muted">
            {qty(detail.quantity, detail.unit, { small: false })} on hand · par {qty(detail.par_level, detail.unit, { small: false })} · reorder {qty(detail.reorder_qty, detail.unit, { small: false })} · {money(detail.avg_cost)}/{detail.unit}
          </p>
          {detail.dishes.length > 0 && (
            <details className="used-in">
              <summary>Used in {detail.dishes.length} dish{detail.dishes.length === 1 ? '' : 'es'}</summary>
              <ul className="pill-list">{detail.dishes.map((d) => <li key={d.id} className="pill">{d.name} <span>· {qty(d.quantity, detail.unit)}</span></li>)}</ul>
            </details>
          )}
          <div className="table-wrap">
            <table className="compact">
              <thead><tr><th>When</th><th>Type</th><th className="num">Change</th><th className="num">Balance</th><th>Reference</th><th>By</th></tr></thead>
              <tbody>
                {moves.map((m) => (
                  <tr key={m.id}>
                    <td>{dateTime(m.created_at)}</td>
                    <td><span className={`mv ${m.type}`}>{MOVEMENT_LABEL[m.type]}</span></td>
                    <td className={`num ${m.quantity < 0 ? 'neg' : 'plus'}`}>{m.quantity > 0 ? '+' : ''}{qty(m.quantity, m.unit)}</td>
                    <td className="num">{qty(m.balance_after, m.unit)}</td>
                    <td className="sub">{m.note || '—'}</td>
                    <td className="sub">{m.user || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {moves.length === 150 && <p className="muted small">Showing the latest 150 entries.</p>}
        </>
      )}
    </Modal>
  );
}

const EMPTY_FORM = { name: '', category: 'Vegetables & Fruit', unit: 'kg', par_level: '', reorder_qty: '', avg_cost: '', supplier_id: '', storage: '', expiry_date: '', opening_quantity: '' };

function IngredientForm({ item, suppliers, onClose, onSaved, onRemoved }) {
  const { settings } = useApp();
  const toast = useToast();
  const isNew = !item.id;
  const [f, setF] = useState(() => (isNew ? EMPTY_FORM : {
    ...item, supplier_id: item.supplier_id || '', storage: item.storage || '', expiry_date: item.expiry_date || '',
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const body = {
      name: f.name, category: f.category, unit: f.unit, storage: f.storage || null,
      par_level: Number(f.par_level || 0), reorder_qty: Number(f.reorder_qty || 0), avg_cost: Number(f.avg_cost || 0),
      supplier_id: f.supplier_id ? Number(f.supplier_id) : null, expiry_date: f.expiry_date || null,
    };
    try {
      const saved = isNew
        ? await api.createIngredient({ ...body, opening_quantity: Number(f.opening_quantity || 0) })
        : await api.updateIngredient(item.id, body);
      toast(`${saved.name} saved`);
      onSaved(saved);
    } catch (err) { setError(err.message); setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const r = await api.deleteIngredient(item.id);
      toast(r.archived ? `${item.name} archived (history kept)` : `${item.name} deleted`);
      onRemoved();
    } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <Modal title={isNew ? 'New ingredient' : `Edit ${item.name}`} onClose={onClose} busy={busy}>
      <form className="grid two" onSubmit={save}>
        <Field label="Name" full><input value={f.name} onChange={set('name')} required maxLength={120} autoFocus /></Field>
        <Field label="Category">
          <select value={f.category} onChange={set('category')}>{settings.ingredient_categories.map((c) => <option key={c}>{c}</option>)}</select>
        </Field>
        <Field label="Unit" hint={!isNew && item.used_in ? 'Locked while recipes use it' : 'Recipes use the same unit'}>
          <select value={f.unit} onChange={set('unit')} disabled={!isNew && item.used_in > 0}>{settings.units.map((u) => <option key={u}>{u}</option>)}</select>
        </Field>
        <Field label={`Par level (${f.unit})`} hint="Reorder when stock falls below this"><input type="number" min="0" step="any" value={f.par_level} onChange={set('par_level')} /></Field>
        <Field label={`Usual order (${f.unit})`}><input type="number" min="0" step="any" value={f.reorder_qty} onChange={set('reorder_qty')} /></Field>
        <Field label={`Cost ₹ per ${f.unit}`} hint={isNew ? '' : 'Updated automatically by purchases'}><input type="number" min="0" step="0.01" value={f.avg_cost} onChange={set('avg_cost')} /></Field>
        <Field label="Supplier">
          <select value={f.supplier_id} onChange={set('supplier_id')}>
            <option value="">—</option>
            {suppliers.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Storage"><input value={f.storage} onChange={set('storage')} placeholder="e.g. Walk-in Cooler" maxLength={40} /></Field>
        <Field label="Earliest expiry"><input type="date" value={f.expiry_date} onChange={set('expiry_date')} /></Field>
        {isNew && <Field label={`Opening stock (${f.unit})`} hint="Recorded in the ledger as opening stock"><input type="number" min="0" step="any" value={f.opening_quantity} onChange={set('opening_quantity')} /></Field>}
        {error && <div className="full"><Alert>{error}</Alert></div>}
        <div className="modal-actions full">
          {!isNew && <button type="button" className="btn danger-outline left" onClick={remove} disabled={busy}>Remove</button>}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

function StockTake({ items, onClose, onDone }) {
  const toast = useToast();
  const [counts, setCounts] = useState({});
  const [note, setNote] = useState('Closing stock take');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const entered = Object.entries(counts).filter(([, v]) => v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0);
  const varianceValue = entered.reduce((s, [id, v]) => {
    const i = items.find((x) => x.id === Number(id));
    return s + (Number(v) - i.quantity) * i.avg_cost;
  }, 0);

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api.stockCount(entered.map(([id, v]) => ({ ingredient_id: Number(id), quantity: Number(v) })), note);
      toast(`Counted ${r.counted} items · ${r.variances.length} with a variance`);
      onDone();
    } catch (e) { setError(e.message); setBusy(false); }
  };

  return (
    <Modal title="Stock take" onClose={onClose} size="wide" busy={busy}
      actions={<>
        <span className="muted small left">{entered.length} counted · variance {money(varianceValue)}</span>
        <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn primary" onClick={save} disabled={busy || !entered.length}>{busy ? 'Saving…' : `Save ${entered.length} counts`}</button>
      </>}>
      <p className="muted">Enter what is physically on the shelf. Leave blank to skip an item. The {items.length} items shown follow the filters on the Stock page.</p>
      <Field label="Note"><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={255} /></Field>
      <div className="table-wrap">
        <table className="compact">
          <thead><tr><th>Ingredient</th><th>Storage</th><th className="num">Book</th><th className="num">Counted</th><th className="num">Variance</th></tr></thead>
          <tbody>
            {items.map((i) => {
              const v = counts[i.id];
              const diff = v !== undefined && v !== '' ? Number(v) - i.quantity : null;
              return (
                <tr key={i.id}>
                  <td className="name">{i.name}</td>
                  <td className="sub">{i.storage}</td>
                  <td className="num">{qty(i.quantity, i.unit, { small: false })}</td>
                  <td className="num"><input className="count-input" type="number" min="0" step="any" value={v ?? ''} onChange={(e) => setCounts((c) => ({ ...c, [i.id]: e.target.value }))} aria-label={`Counted ${i.name}`} /> {i.unit}</td>
                  <td className={`num ${diff < 0 ? 'neg' : diff > 0 ? 'plus' : ''}`}>{diff === null ? '' : `${diff > 0 ? '+' : ''}${qty(diff, i.unit, { small: false })}`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {error && <Alert>{error}</Alert>}
    </Modal>
  );
}
