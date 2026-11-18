import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useApp, useLoad, useLiveStock, useToast, DietMark, Modal, Alert, Loading, Segmented, Field } from '../ui.jsx';
import { money, computeTotals, round2, ORDER_TYPE_LABEL, PAYMENT_LABEL } from '../format';
import Receipt from '../Receipt.jsx';
import { PrintBillButton } from '../PrinterControl.jsx';
import * as printer from '../printer';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const blankMeta = (settings) => ({
  order_type: 'dine_in', table_no: '', customer: '', customer_phone: '', customer_email: '',
  payment_mode: 'upi', discount: '', service_rate: settings.default_service_rate || 0, note: '',
});

export default function Pos() {
  const { settings } = useApp();
  const toast = useToast();
  const dishesQ = useLoad(() => api.dishes());
  useLiveStock(dishesQ.refresh); // "59 left" follows the kitchen: no reload needed
  const [section, setSection] = useState('all');
  const [search, setSearch] = useState('');
  const [diet, setDiet] = useState('all');
  const [cart, setCart] = useState([]); // [{ dish_id, name, diet, unit_price, quantity }]
  const [meta, setMeta] = useState(() => blankMeta(settings));
  const [preview, setPreview] = useState(null); // { bill, draft }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [nextNo, setNextNo] = useState('');

  useEffect(() => { api.nextBillNo().then(setNextNo).catch(() => {}); }, []);

  const dishes = dishesQ.data || [];
  const sections = useMemo(() => [...new Map(dishes.map((d) => [d.section_id, d.section])).entries()], [dishes]);
  const inCart = (id) => cart.find((l) => l.dish_id === id)?.quantity || 0;

  const visible = useMemo(() => {
    const s = search.trim().toLowerCase();
    return dishes.filter((d) =>
      (section === 'all' || String(d.section_id) === section) &&
      (diet === 'all' || d.diet === diet) &&
      (!s || d.name.toLowerCase().includes(s)));
  }, [dishes, section, diet, search]);

  const add = (d) => {
    setError('');
    setCart((c) => (c.some((l) => l.dish_id === d.id)
      ? c.map((l) => (l.dish_id === d.id ? { ...l, quantity: l.quantity + 1 } : l))
      : [...c, { dish_id: d.id, name: d.name, diet: d.diet, unit_price: d.price, quantity: 1 }]));
  };
  const setQty = (id, q) => setCart((c) => c.map((l) => (l.dish_id === id ? { ...l, quantity: Math.max(0, Math.min(500, Math.floor(Number(q) || 0))) } : l)).filter((l) => l.quantity > 0));
  const setM = (k) => (e) => setMeta((m) => ({ ...m, [k]: e?.target ? e.target.value : e }));

  const totals = computeTotals(cart.map((l) => round2(l.quantity * l.unit_price)), {
    discount: meta.discount, service_rate: meta.service_rate, tax_rate: settings.tax_rate,
  });
  const emailInvalid = meta.customer_email.trim() !== '' && !EMAIL_RE.test(meta.customer_email.trim());
  const shortages = cart
    .map((l) => ({ l, d: dishes.find((x) => x.id === l.dish_id) }))
    .filter(({ l, d }) => d && d.portions !== null && l.quantity > d.portions);

  const draft = {
    ...meta, bill_no: nextNo, tax_rate: settings.tax_rate, service_rate: Number(meta.service_rate || 0),
    items: cart.map((l) => ({ ...l, line_total: round2(l.quantity * l.unit_price) })), ...totals,
  };

  const reset = () => { setCart([]); setMeta(blankMeta(settings)); setError(''); };

  const confirm = async () => {
    setSaving(true);
    try {
      const saved = await api.createBill({
        ...meta,
        discount: Number(meta.discount || 0),
        service_rate: Number(meta.service_rate || 0),
        table_no: meta.order_type === 'dine_in' ? meta.table_no : '',
        items: cart.map((l) => ({ dish_id: l.dish_id, quantity: l.quantity })),
      });
      setPreview({ bill: saved, draft: false });
      reset();
      toast(`${saved.bill_no} saved · ${money(saved.total)}`);
      const pr = printer.getState();
      if (pr.autoPrint && pr.status === 'connected') {
        printer.printBytes(printer.billToEscPos(saved, settings)).then(() => toast(`${saved.bill_no} printed`), (e) => toast(`Print failed: ${e.message}`, 'error'));
      }
      dishesQ.reload();
      api.nextBillNo().then(setNextNo).catch(() => {});
      if (saved.customer_email && settings.email_configured) {
        api.emailBill(saved.id).then(() => toast(`Receipt emailed to ${saved.customer_email}`), (e) => toast(`Email failed: ${e.message}`, 'error'));
      }
    } catch (e) {
      setError(e.message);
      setPreview(null);
    } finally {
      setSaving(false);
    }
  };

  if (dishesQ.loading && !dishesQ.data) return <Loading />;

  return (
    <div className="page pos">
      <section className="card pad pos-menu">
        <div className="pos-tools">
          <input className="search" placeholder="Search dishes…  (e.g. ghee roast)" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
          <Segmented value={diet} onChange={setDiet} options={[['all', 'All'], ['veg', 'Veg'], ['egg', 'Egg'], ['nonveg', 'Non-veg']]} />
        </div>
        <div className="section-tabs" role="tablist">
          <button role="tab" aria-selected={section === 'all'} className={section === 'all' ? 'on' : ''} onClick={() => setSection('all')}>All</button>
          {sections.map(([id, name]) => (
            <button key={id} role="tab" aria-selected={section === String(id)} className={section === String(id) ? 'on' : ''} onClick={() => setSection(String(id))}>{name}</button>
          ))}
        </div>
        {dishesQ.error && <Alert>{dishesQ.error}</Alert>}
        <div className="dish-grid">
          {visible.map((d) => {
            const left = d.portions === null ? null : d.portions - inCart(d.id);
            const off = !d.available;
            const short = left !== null && left <= 0;
            const blocked = off || (short && !settings.allow_negative_stock);
            return (
              <button key={d.id} className={`dish-tile ${off ? 'off' : ''} ${short ? 'short' : ''}`} onClick={() => add(d)} disabled={blocked}
                title={off ? 'Switched off for today' : short ? `Book stock short of ${d.limited_by}` : d.description || ''}>
                <span className="dish-top"><DietMark diet={d.diet} /><span className="dish-name">{d.name}</span></span>
                <span className="dish-bottom">
                  <span className="price">{money(d.price)}</span>
                  <span className={`portions ${short ? 'danger' : left !== null && left <= 5 ? 'warn' : ''}`}>
                    {off ? 'Off today' : left === null ? '' : short ? 'Short' : `${left} left`}
                  </span>
                </span>
                {inCart(d.id) > 0 && <span className="in-cart">{inCart(d.id)}</span>}
              </button>
            );
          })}
          {visible.length === 0 && <p className="empty">No dishes match.</p>}
        </div>
      </section>

      <section className="card pad pos-cart">
        <div className="card-head">
          <h2>New bill {nextNo && <span className="bill-no">{nextNo}</span>}</h2>
          {cart.length > 0 && <button className="link danger" onClick={reset}>Clear</button>}
        </div>

        <Segmented value={meta.order_type} onChange={setM('order_type')} options={Object.entries(ORDER_TYPE_LABEL)} />
        <div className="grid two tight">
          {meta.order_type === 'dine_in' && <Field label="Table"><input value={meta.table_no} onChange={setM('table_no')} placeholder="e.g. T4" maxLength={20} /></Field>}
          <Field label="Guest name"><input value={meta.customer} onChange={setM('customer')} placeholder="Optional" maxLength={120} /></Field>
          <Field label="Phone"><input value={meta.customer_phone} onChange={setM('customer_phone')} placeholder="Optional" inputMode="tel" maxLength={20} /></Field>
          <Field label="Email for e-receipt" error={emailInvalid ? 'Looks invalid' : ''} hint={meta.customer_email && !settings.email_configured ? 'Email not set up on the server' : ''}>
            <input type="email" value={meta.customer_email} onChange={setM('customer_email')} placeholder="Optional" className={emailInvalid ? 'invalid' : ''} />
          </Field>
        </div>

        {cart.length === 0 ? <p className="empty small">Tap dishes to add them.</p> : (
          <ul className="lines">
            {cart.map((l) => (
              <li key={l.dish_id}>
                <div className="line-name"><DietMark diet={l.diet} /><span>{l.name}<span className="sub block">{money(l.unit_price)}</span></span></div>
                <div className="qty">
                  <button className="step" onClick={() => setQty(l.dish_id, l.quantity - 1)} aria-label={`Less ${l.name}`}>−</button>
                  <input className="qty-input" type="number" min="0" value={l.quantity} onChange={(e) => setQty(l.dish_id, e.target.value)} aria-label="Quantity" />
                  <button className="step" onClick={() => setQty(l.dish_id, l.quantity + 1)} aria-label={`More ${l.name}`}>+</button>
                </div>
                <span className="line-total">{money(l.quantity * l.unit_price)}</span>
              </li>
            ))}
          </ul>
        )}

        {shortages.length > 0 && (
          <Alert kind="warn">
            Book stock is short for {shortages.map(({ d }) => `${d.name} (${d.limited_by})`).join(', ')}.
            {settings.allow_negative_stock ? ' The bill will still save; please check the store.' : ' Receive or count stock before billing.'}
          </Alert>
        )}

        <div className="grid three tight">
          <Field label="Discount ₹"><input type="number" min="0" step="1" value={meta.discount} onChange={setM('discount')} placeholder="0" /></Field>
          <Field label="Service %" hint="Optional for guest"><input type="number" min="0" max="20" step="0.5" value={meta.service_rate} onChange={setM('service_rate')} /></Field>
          <Field label="Payment">
            <select value={meta.payment_mode} onChange={setM('payment_mode')}>
              {Object.entries(PAYMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
        </div>

        <div className="summary">
          <div><span>Subtotal</span><span>{money(totals.subtotal)}</span></div>
          {totals.discount > 0 && <div><span>Discount</span><span>− {money(totals.discount)}</span></div>}
          {totals.service_charge > 0 && <div><span>Service charge</span><span>{money(totals.service_charge)}</span></div>}
          <div><span>CGST {settings.tax_rate / 2}% + SGST {settings.tax_rate / 2}%</span><span>{money(totals.tax)}</span></div>
          {totals.round_off !== 0 && <div className="muted"><span>Round off</span><span>{money(totals.round_off)}</span></div>}
          <div className="grand"><span>Total</span><span>{money(totals.total)}</span></div>
        </div>

        {error && <Alert onClose={() => setError('')}>{error}</Alert>}
        <button className="btn primary block" disabled={!cart.length || emailInvalid || (shortages.length > 0 && !settings.allow_negative_stock)}
          onClick={() => { api.nextBillNo().then(setNextNo).catch(() => {}); setPreview({ bill: draft, draft: true }); }}>
          Review bill · {money(totals.total)}
        </button>
      </section>

      {preview && (
        <Modal title={preview.draft ? 'Review bill' : `Bill ${preview.bill.bill_no}`} onClose={() => setPreview(null)} size="narrow" busy={saving}
          actions={preview.draft ? (
            <>
              <button className="btn" onClick={() => setPreview(null)} disabled={saving}>Back</button>
              <button className="btn primary" onClick={confirm} disabled={saving}>{saving ? 'Saving…' : `Confirm · ${PAYMENT_LABEL[meta.payment_mode]}`}</button>
            </>
          ) : (
            <>
              <button className="btn" onClick={() => setPreview(null)}>New bill</button>
              <button className="btn" onClick={() => window.print()}>Browser print</button>
              <PrintBillButton bill={preview.bill} />
            </>
          )}>
          <Receipt bill={preview.bill} draft={preview.draft} />
        </Modal>
      )}
    </div>
  );
}
