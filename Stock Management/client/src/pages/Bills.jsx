import { useState } from 'react';
import { api } from '../api';
import { useApp, useLoad, useToast, can, Modal, Alert, Loading, Empty, Field, Segmented } from '../ui.jsx';
import { money, time, ORDER_TYPE_LABEL, PAYMENT_LABEL } from '../format';
import Receipt from '../Receipt.jsx';
import { PrintBillButton } from '../PrinterControl.jsx';

export default function Bills() {
  const { settings } = useApp();
  const [date, setDate] = useState(settings.business_date);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(null);
  const q = useLoad(() => api.bills({ date: search ? undefined : date, status, search, limit: 300 }), [date, status, search]);
  const bills = q.data || [];
  const paid = bills.filter((b) => b.status === 'paid');

  return (
    <div className="page">
      <section className="toolbar">
        <input className="search" placeholder="Search bill no, guest or table…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <input type="date" value={date} max={settings.business_date} onChange={(e) => setDate(e.target.value)} disabled={!!search} aria-label="Business date" />
        <Segmented value={status} onChange={setStatus} options={[['', 'All'], ['paid', 'Paid'], ['void', 'Void']]} />
      </section>
      <p className="muted small">{search ? 'Searching all dates' : `${paid.length} paid bills · ${money(paid.reduce((s, b) => s + b.total, 0))} collected`}</p>

      <section className="card">
        {q.error && <Alert>{q.error}</Alert>}
        {q.loading && !q.data ? <Loading /> : bills.length === 0 ? <Empty>No bills for this day.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Bill</th><th>Time</th><th>Type</th><th>Guest</th><th>Payment</th><th className="num">Items</th><th className="num">Total</th><th>Status</th><th /></tr></thead>
              <tbody>
                {bills.map((b) => (
                  <tr key={b.id} className={b.status === 'void' ? 'voided' : ''}>
                    <td><span className="mono">{b.bill_no}</span>{b.source !== 'pos' && <span className="chip via">{b.source}</span>}</td>
                    <td>{search ? new Date(b.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : time(b.created_at)}</td>
                    <td>{ORDER_TYPE_LABEL[b.order_type]}{b.table_no && ` · ${b.table_no}`}</td>
                    <td>{b.customer || <span className="muted">—</span>}</td>
                    <td>{PAYMENT_LABEL[b.payment_mode]}</td>
                    <td className="num">{b.item_count}</td>
                    <td className="num">{money(b.total)}</td>
                    <td>{b.status === 'void' ? <span className="badge out_of_stock">Void</span> : <span className="badge in_stock">Paid</span>}</td>
                    <td className="actions"><button className="link" onClick={() => setOpen(b.id)}>View</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {open && <BillDialog id={open} onClose={() => setOpen(null)} onChanged={q.reload} />}
    </div>
  );
}

function BillDialog({ id, onClose, onChanged }) {
  const { user, settings } = useApp();
  const toast = useToast();
  const q = useLoad(() => api.bill(id), [id]);
  const [mode, setMode] = useState(null); // 'void' | 'email'
  const [reason, setReason] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const bill = q.data;

  const run = async (fn) => {
    setBusy(true);
    setError('');
    try { await fn(); setMode(null); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const doVoid = () => run(async () => {
    q.setData(await api.voidBill(id, reason));
    toast(`${bill.bill_no} voided; ingredients returned to stock`);
    onChanged();
  });
  const doEmail = () => run(async () => {
    const r = await api.emailBill(id, to.trim());
    q.setData(r.bill);
    toast(`Emailed to ${r.to}`);
  });

  return (
    <Modal title={bill ? `Bill ${bill.bill_no}` : 'Bill'} onClose={onClose} size="narrow" busy={busy}
      actions={bill && !mode && (
        <>
          {can(user, 'manager') && bill.status === 'paid' && <button className="btn danger-outline" onClick={() => setMode('void')}>Void…</button>}
          {bill.status === 'paid' && <button className="btn" onClick={() => { setTo(bill.customer_email || ''); setMode('email'); }}>Email…</button>}
          <button className="btn" onClick={() => window.print()}>Browser print</button>
          <PrintBillButton bill={bill} />
        </>
      )}>
      {q.loading && !bill ? <Loading /> : q.error ? <Alert>{q.error}</Alert> : (
        <>
          <Receipt bill={bill} />
          {bill.status === 'void' && <p className="muted small center">Voided by {bill.voided_by_name || '—'} on {new Date(bill.voided_at).toLocaleString('en-IN')}</p>}
          {bill.emailed_at && <p className="muted small center">Emailed to {bill.customer_email}</p>}
          {mode === 'void' && (
            <div className="inline-form no-print">
              <Field label="Reason for voiding" hint="Ingredients used by this bill are returned to stock. The bill stays on record as VOID." full>
                <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Guest changed order" maxLength={255} />
              </Field>
              <div className="row-actions">
                <button className="btn" onClick={() => setMode(null)} disabled={busy}>Cancel</button>
                <button className="btn danger" disabled={busy || reason.trim().length < 3} onClick={doVoid}>{busy ? 'Voiding…' : 'Void bill'}</button>
              </div>
            </div>
          )}
          {mode === 'email' && (
            <div className="inline-form no-print">
              <Field label="Send e-receipt to" hint={settings.email_configured ? '' : 'Email is not set up: add RESEND_API_KEY on the server'} full>
                <input autoFocus type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="guest@example.com" />
              </Field>
              <div className="row-actions">
                <button className="btn" onClick={() => setMode(null)} disabled={busy}>Cancel</button>
                <button className="btn primary" disabled={busy || !settings.email_configured || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())} onClick={doEmail}>{busy ? 'Sending…' : 'Send'}</button>
              </div>
            </div>
          )}
          {error && <Alert>{error}</Alert>}
        </>
      )}
    </Modal>
  );
}
