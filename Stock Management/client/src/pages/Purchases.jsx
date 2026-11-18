import { useMemo, useState } from 'react';
import { api } from '../api';
import { useApp, useLoad, useToast, Modal, Alert, Loading, Empty, Field, Segmented } from '../ui.jsx';
import { money, qty, dateTime, round2 } from '../format';

export default function Purchases() {
  const [tab, setTab] = useState('receipts');
  return (
    <div className="page">
      <section className="toolbar">
        <Segmented value={tab} onChange={setTab} options={[['receipts', 'Goods received'], ['suppliers', 'Suppliers']]} />
      </section>
      {tab === 'receipts' ? <Receipts /> : <Suppliers />}
    </div>
  );
}

function Receipts() {
  const q = useLoad(() => Promise.all([api.purchases(), api.suppliers(), api.ingredients()]));
  const [receiving, setReceiving] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [list, suppliers, ingredients] = q.data || [[], [], []];
  const below = ingredients.filter((i) => i.quantity < i.par_level);

  if (q.loading && !q.data) return <Loading />;
  return (
    <>
      <div className="split-head">
        <p className="muted">{below.length} ingredient{below.length === 1 ? ' is' : 's are'} below par. Receiving goods adds stock, updates the average cost, and records the earliest expiry.</p>
        <button className="btn primary" onClick={() => setReceiving(true)}>+ Receive goods</button>
      </div>
      {q.error && <Alert>{q.error}</Alert>}
      <section className="card">
        {list.length === 0 ? <Empty>No purchases yet.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Received</th><th>Supplier</th><th>Invoice</th><th className="num">Lines</th><th className="num">Value</th><th>By</th><th /></tr></thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id}>
                    <td>{dateTime(p.created_at)}</td>
                    <td className="name">{p.supplier || '—'}</td>
                    <td className="mono">{p.invoice_no || '—'}</td>
                    <td className="num">{p.item_count}</td>
                    <td className="num">{money(p.total)}</td>
                    <td className="sub">{p.received_by}</td>
                    <td className="actions"><button className="link" onClick={() => setViewing(p.id)}>View</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {receiving && <ReceiveForm suppliers={suppliers} ingredients={ingredients} onClose={() => setReceiving(false)} onSaved={() => { setReceiving(false); q.reload(); }} />}
      {viewing && <PurchaseView id={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

function ReceiveForm({ suppliers, ingredients, onClose, onSaved }) {
  const { settings } = useApp();
  const toast = useToast();
  const [supplierId, setSupplierId] = useState('');
  const [invoice, setInvoice] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(settings.business_date);
  const [note, setNote] = useState('');
  const [lines, setLines] = useState([]);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const byId = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);
  const pool = supplierId ? ingredients.filter((i) => String(i.supplier_id) === supplierId) : ingredients;

  const lineFor = (i) => ({ ingredient_id: i.id, quantity: i.reorder_qty || i.par_level || '', unit_cost: i.avg_cost, expiry_date: '' });
  const addLine = (id) => {
    const i = byId.get(Number(id));
    if (i && !lines.some((l) => l.ingredient_id === i.id)) setLines((ls) => [...ls, lineFor(i)]);
    setPick('');
  };
  const suggest = () => {
    const due = pool.filter((i) => i.quantity < i.par_level && !lines.some((l) => l.ingredient_id === i.id));
    setLines((ls) => [...ls, ...due.map(lineFor)]);
    if (!due.length) toast('Nothing from this supplier is below par');
  };
  const setLine = (idx, k, v) => setLines((ls) => ls.map((l, j) => (j === idx ? { ...l, [k]: v } : l)));
  const valid = lines.length > 0 && lines.every((l) => Number(l.quantity) > 0 && Number(l.unit_cost) >= 0 && l.unit_cost !== '');
  const total = round2(lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unit_cost || 0), 0));

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const p = await api.createPurchase({
        supplier_id: supplierId ? Number(supplierId) : null, invoice_no: invoice, invoice_date: invoiceDate || null, note,
        items: lines.map((l) => ({ ingredient_id: l.ingredient_id, quantity: Number(l.quantity), unit_cost: Number(l.unit_cost), expiry_date: l.expiry_date || null })),
      });
      toast(`Received ${p.items.length} items · ${money(p.total)}`);
      onSaved();
    } catch (e) { setError(e.message); setBusy(false); }
  };

  return (
    <Modal title="Receive goods" onClose={onClose} size="wide" busy={busy}
      actions={<>
        <span className="left muted">Invoice value <strong>{money(total)}</strong></span>
        <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn primary" onClick={save} disabled={!valid || busy}>{busy ? 'Saving…' : `Receive ${lines.length} item${lines.length === 1 ? '' : 's'}`}</button>
      </>}>
      <div className="grid four">
        <Field label="Supplier">
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Any / cash purchase</option>
            {suppliers.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Invoice no."><input value={invoice} onChange={(e) => setInvoice(e.target.value)} maxLength={40} /></Field>
        <Field label="Invoice date"><input type="date" value={invoiceDate} max={settings.business_date} onChange={(e) => setInvoiceDate(e.target.value)} /></Field>
        <Field label="Note"><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={255} /></Field>
      </div>
      <div className="add-line">
        <select value={pick} onChange={(e) => addLine(e.target.value)} aria-label="Add ingredient">
          <option value="">+ Add ingredient…</option>
          {pool.filter((i) => !lines.some((l) => l.ingredient_id === i.id)).map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit}){i.quantity < i.par_level ? ' · below par' : ''}</option>)}
        </select>
        <button className="btn" type="button" onClick={suggest}>Add everything below par{supplierId ? ' from this supplier' : ''}</button>
      </div>
      {lines.length > 0 && (
        <div className="table-wrap">
          <table className="compact">
            <thead><tr><th>Ingredient</th><th className="num">On hand</th><th className="num">Received</th><th className="num">₹ per unit</th><th>Expiry</th><th className="num">Amount</th><th /></tr></thead>
            <tbody>
              {lines.map((l, idx) => {
                const i = byId.get(l.ingredient_id);
                const priceJump = i.avg_cost > 0 && Number(l.unit_cost) > i.avg_cost * 1.2;
                return (
                  <tr key={l.ingredient_id}>
                    <td className="name">{i.name}</td>
                    <td className="num sub">{qty(i.quantity, i.unit, { small: false })} / par {qty(i.par_level, i.unit, { small: false })}</td>
                    <td className="num"><input className="count-input" type="number" min="0" step="any" value={l.quantity} onChange={(e) => setLine(idx, 'quantity', e.target.value)} aria-label={`${i.name} quantity`} /> {i.unit}</td>
                    <td className="num">
                      <input className={`count-input ${priceJump ? 'warn-input' : ''}`} type="number" min="0" step="0.01" value={l.unit_cost} onChange={(e) => setLine(idx, 'unit_cost', e.target.value)} aria-label={`${i.name} unit cost`} />
                      {priceJump && <div className="sub warn">+{Math.round((Number(l.unit_cost) / i.avg_cost - 1) * 100)}% vs avg</div>}
                    </td>
                    <td><input type="date" value={l.expiry_date} min={settings.business_date} onChange={(e) => setLine(idx, 'expiry_date', e.target.value)} aria-label={`${i.name} expiry`} /></td>
                    <td className="num">{money(Number(l.quantity || 0) * Number(l.unit_cost || 0))}</td>
                    <td className="actions"><button className="link danger" onClick={() => setLines((ls) => ls.filter((_, j) => j !== idx))}>Remove</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {error && <Alert>{error}</Alert>}
    </Modal>
  );
}

function PurchaseView({ id, onClose }) {
  const q = useLoad(() => api.purchase(id), [id]);
  const p = q.data;
  return (
    <Modal title={p ? `${p.supplier || 'Purchase'} · ${p.invoice_no || `#${p.id}`}` : 'Purchase'} onClose={onClose} size="wide">
      {!p ? (q.error ? <Alert>{q.error}</Alert> : <Loading />) : (
        <>
          <p className="muted">Received {dateTime(p.created_at)} by {p.received_by}{p.invoice_date && ` · invoice dated ${p.invoice_date}`}{p.note && ` · ${p.note}`}</p>
          <table className="compact">
            <thead><tr><th>Ingredient</th><th className="num">Qty</th><th className="num">₹/unit</th><th>Expiry</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {p.items.map((i) => (
                <tr key={i.id}><td className="name">{i.name}</td><td className="num">{qty(i.quantity, i.unit, { small: false })}</td><td className="num">{money(i.unit_cost)}</td><td>{i.expiry_date || '—'}</td><td className="num">{money(i.line_total)}</td></tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={4}><strong>Total</strong></td><td className="num"><strong>{money(p.total)}</strong></td></tr></tfoot>
          </table>
        </>
      )}
    </Modal>
  );
}

const EMPTY_SUPPLIER = { name: '', contact: '', phone: '', email: '', gstin: '' };

function Suppliers() {
  const toast = useToast();
  const q = useLoad(() => api.suppliers());
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setEditing((s) => ({ ...s, [k]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { id, name, contact, phone, email, gstin, active } = editing;
      const body = { name, contact, phone, email, gstin, ...(id && { active }) };
      if (id) await api.updateSupplier(id, body); else await api.createSupplier(body);
      toast(`${name} saved`);
      setEditing(null);
      q.reload();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  if (q.loading && !q.data) return <Loading />;
  return (
    <>
      <div className="split-head"><span /><button className="btn primary" onClick={() => setEditing(EMPTY_SUPPLIER)}>+ Supplier</button></div>
      <section className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Supplier</th><th>Contact</th><th>Phone</th><th>GSTIN</th><th className="num">Ingredients</th><th>Status</th><th /></tr></thead>
            <tbody>
              {(q.data || []).map((s) => (
                <tr key={s.id} className={s.active ? '' : 'voided'}>
                  <td className="name">{s.name}</td><td>{s.contact || '—'}</td><td>{s.phone ? <a href={`tel:${s.phone.replace(/\s/g, '')}`}>{s.phone}</a> : '—'}</td>
                  <td className="mono">{s.gstin || '—'}</td><td className="num">{s.ingredient_count}</td>
                  <td>{s.active ? <span className="badge in_stock">Active</span> : <span className="badge low_stock">Inactive</span>}</td>
                  <td className="actions"><button className="link" onClick={() => setEditing({ ...EMPTY_SUPPLIER, ...Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v ?? ''])) })}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {editing && (
        <Modal title={editing.id ? `Edit ${editing.name}` : 'New supplier'} onClose={() => setEditing(null)} busy={busy}>
          <form className="grid two" onSubmit={save}>
            <Field label="Name" full><input value={editing.name} onChange={set('name')} required maxLength={120} autoFocus /></Field>
            <Field label="Contact person"><input value={editing.contact} onChange={set('contact')} maxLength={80} /></Field>
            <Field label="Phone"><input value={editing.phone} onChange={set('phone')} maxLength={30} inputMode="tel" /></Field>
            <Field label="Email"><input type="email" value={editing.email} onChange={set('email')} maxLength={254} /></Field>
            <Field label="GSTIN" hint="15 characters, e.g. 33AABCS1234F1Z5"><input value={editing.gstin} onChange={set('gstin')} maxLength={15} /></Field>
            {editing.id && <label className="check full"><input type="checkbox" checked={!!editing.active} onChange={(e) => setEditing((s) => ({ ...s, active: e.target.checked }))} /> Active</label>}
            {error && <div className="full"><Alert>{error}</Alert></div>}
            <div className="modal-actions full">
              <button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

