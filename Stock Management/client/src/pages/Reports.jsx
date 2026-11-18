import { useMemo, useState } from 'react';
import { api } from '../api';
import { useApp, useLoad, Stat, Alert, Loading, Empty, Segmented, DietMark } from '../ui.jsx';
import { money, moneyShort, pct, qty, shortDate, weekday, dateTime, addDays, downloadCsv, PAYMENT_LABEL, ORDER_TYPE_LABEL, MOVEMENT_LABEL } from '../format';

export default function Reports() {
  const { settings } = useApp();
  const today = settings.business_date;
  const PRESETS = {
    today: [today, today],
    yesterday: [addDays(today, -1), addDays(today, -1)],
    week: [addDays(today, -6), today],
    month: [`${today.slice(0, 8)}01`, today],
    d30: [addDays(today, -29), today],
  };
  const [preset, setPreset] = useState('week');
  const [range, setRange] = useState(PRESETS.week);
  const [tab, setTab] = useState('sales');
  const choose = (p) => { setPreset(p); if (PRESETS[p]) setRange(PRESETS[p]); };
  const [from, to] = range;

  return (
    <div className="page">
      <section className="toolbar">
        <Segmented value={tab} onChange={setTab} options={[['sales', 'Sales'], ['dishes', 'Dishes'], ['stock', 'Stock'], ['ledger', 'Wastage & variance']]} />
        <span className="spacer" />
        <Segmented value={preset} onChange={choose} options={[['today', 'Today'], ['yesterday', 'Yesterday'], ['week', '7 days'], ['month', 'This month'], ['d30', '30 days']]} />
        <input type="date" value={from} max={to} onChange={(e) => { setPreset('custom'); setRange([e.target.value, to]); }} aria-label="From" />
        <input type="date" value={to} min={from} max={today} onChange={(e) => { setPreset('custom'); setRange([from, e.target.value]); }} aria-label="To" />
      </section>
      {tab === 'sales' && <Sales from={from} to={to} />}
      {tab === 'dishes' && <Dishes from={from} to={to} />}
      {tab === 'stock' && <StockRecon from={from} to={to} />}
      {tab === 'ledger' && <Ledger from={from} to={to} />}
    </div>
  );
}

const fileRange = (from, to) => (from === to ? from : `${from}_to_${to}`);

function Sales({ from, to }) {
  const q = useLoad(() => api.salesReport(from, to), [from, to]);
  if (q.loading && !q.data) return <Loading />;
  if (q.error) return <Alert>{q.error}</Alert>;
  const { summary: s, by_day, by_payment, by_order_type, by_section } = q.data;
  const exportDays = () => downloadCsv(`oasys-sales-${fileRange(from, to)}.csv`, by_day, [
    { label: 'Date', value: (d) => d.date }, { label: 'Bills', value: (d) => d.bills },
    { label: 'Net sales (₹)', value: (d) => d.net }, { label: 'Collected incl. GST (₹)', value: (d) => d.total },
    { label: 'Food cost (₹)', value: (d) => d.food_cost },
  ]);
  return (
    <>
      <section className="stats">
        <Stat label="Collected (incl. GST)" value={moneyShort(s.total_collected)} sub={`${s.bills} bills · avg ${moneyShort(s.avg_bill)}`} />
        <Stat label="Net sales" value={moneyShort(s.net_sales)} sub={`Gross ${moneyShort(s.gross_sales)} − discount ${moneyShort(s.discount)}`} />
        <Stat label="GST collected" value={moneyShort(s.cgst + s.sgst)} sub={`CGST ${moneyShort(s.cgst)} · SGST ${moneyShort(s.sgst)}`} />
        <Stat label="Food cost" value={pct(s.food_cost_pct)} sub={`${moneyShort(s.food_cost)} theoretical`} tone={s.food_cost_pct > 35 ? 'warn' : ''} />
        <Stat label="Voids" value={s.voids} sub={s.voids ? moneyShort(s.void_amount) : 'None'} tone={s.voids ? 'warn' : ''} />
      </section>
      <div className="grid-2">
        <section className="card pad">
          <div className="card-head"><h2>By day</h2><button className="link" onClick={exportDays}>Export CSV</button></div>
          <table className="compact">
            <thead><tr><th>Date</th><th className="num">Bills</th><th className="num">Net</th><th className="num">Collected</th><th className="num">Food cost</th></tr></thead>
            <tbody>
              {by_day.map((d) => (
                <tr key={d.date}><td>{weekday(d.date)} {shortDate(d.date)}</td><td className="num">{d.bills}</td><td className="num">{money(d.net)}</td><td className="num">{money(d.total)}</td><td className="num">{d.net ? pct((d.food_cost / d.net) * 100) : '—'}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
        <div className="stack">
          <section className="card pad">
            <div className="card-head"><h2>Payments</h2></div>
            <Breakdown rows={by_payment.map((p) => ({ label: PAYMENT_LABEL[p.payment_mode], bills: p.bills, total: p.total }))} total={s.total_collected} />
          </section>
          <section className="card pad">
            <div className="card-head"><h2>Order type</h2></div>
            <Breakdown rows={by_order_type.map((p) => ({ label: ORDER_TYPE_LABEL[p.order_type], bills: p.bills, total: p.total }))} total={s.total_collected} />
          </section>
        </div>
      </div>
      <section className="card pad">
        <div className="card-head"><h2>By menu section</h2></div>
        {by_section.length === 0 ? <Empty>No sales in this range.</Empty> : (
          <table className="compact">
            <thead><tr><th>Section</th><th className="num">Portions</th><th className="num">Revenue</th><th className="num">Recipe cost</th><th className="num">Food cost</th></tr></thead>
            <tbody>{by_section.map((r) => <tr key={r.section}><td className="name">{r.section}</td><td className="num">{r.quantity}</td><td className="num">{money(r.revenue)}</td><td className="num">{money(r.cost)}</td><td className="num">{pct(r.food_cost_pct)}</td></tr>)}</tbody>
          </table>
        )}
      </section>
    </>
  );
}

// Share-of-total list: a label, a thin bar in one hue, and the value in text ink.
function Breakdown({ rows, total }) {
  if (!rows.length) return <Empty>No sales.</Empty>;
  return (
    <ul className="breakdown">
      {rows.sort((a, b) => b.total - a.total).map((r) => (
        <li key={r.label}>
          <span className="bd-label">{r.label}<span className="sub"> · {r.bills} bills</span></span>
          <span className="bd-bar"><span style={{ width: `${total ? (r.total / total) * 100 : 0}%` }} /></span>
          <span className="num">{money(r.total)} <span className="sub">{total ? Math.round((r.total / total) * 100) : 0}%</span></span>
        </li>
      ))}
    </ul>
  );
}

function Dishes({ from, to }) {
  const q = useLoad(() => api.dishReport(from, to), [from, to]);
  const [sort, setSort] = useState('revenue');
  const rows = useMemo(() => [...(q.data?.dishes || [])].sort((a, b) => (sort === 'cost_pct' ? (b.food_cost_pct ?? 0) - (a.food_cost_pct ?? 0) : b[sort] - a[sort])), [q.data, sort]);
  if (q.loading && !q.data) return <Loading />;
  if (q.error) return <Alert>{q.error}</Alert>;
  const exportCsv = () => downloadCsv(`oasys-dish-sales-${fileRange(from, to)}.csv`, rows, [
    { label: 'Dish', value: (d) => d.name }, { label: 'Section', value: (d) => d.section }, { label: 'Portions', value: (d) => d.quantity },
    { label: 'Revenue (₹)', value: (d) => d.revenue }, { label: 'Recipe cost (₹)', value: (d) => d.cost }, { label: 'Margin (₹)', value: (d) => d.margin },
    { label: 'Food cost %', value: (d) => d.food_cost_pct },
  ]);
  return (
    <section className="card pad">
      <div className="card-head">
        <h2>Dish performance <span className="muted">({rows.length} dishes sold)</span></h2>
        <div className="row-actions">
          <Segmented value={sort} onChange={setSort} options={[['revenue', 'Revenue'], ['quantity', 'Portions'], ['margin', 'Margin'], ['cost_pct', 'Food cost %']]} />
          <button className="btn" onClick={exportCsv}>Export CSV</button>
        </div>
      </div>
      {rows.length === 0 ? <Empty>No sales in this range.</Empty> : (
        <div className="table-wrap">
          <table className="compact">
            <thead><tr><th>#</th><th>Dish</th><th>Section</th><th className="num">Portions</th><th className="num">Revenue</th><th className="num">Cost</th><th className="num">Margin</th><th className="num">Food cost</th></tr></thead>
            <tbody>
              {rows.map((d, i) => (
                <tr key={`${d.dish_id}-${d.name}`}>
                  <td className="muted">{i + 1}</td>
                  <td><div className="dish-cell"><DietMark diet={d.diet} /><span className="name">{d.name}</span></div></td>
                  <td className="sub">{d.section}</td>
                  <td className="num">{d.quantity}</td><td className="num">{money(d.revenue)}</td><td className="num">{money(d.cost)}</td>
                  <td className="num">{money(d.margin)}</td><td className="num">{pct(d.food_cost_pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function StockRecon({ from, to }) {
  const q = useLoad(() => api.stockReport(from, to), [from, to]);
  const [onlyMoved, setOnlyMoved] = useState(true);
  if (q.loading && !q.data) return <Loading />;
  if (q.error) return <Alert>{q.error}</Alert>;
  const { rows, totals } = q.data;
  const shown = onlyMoved ? rows.filter((r) => r.purchased || r.consumed || r.wasted || r.adjusted) : rows;
  const exportCsv = () => downloadCsv(`oasys-stock-reconciliation-${fileRange(from, to)}.csv`, rows, [
    { label: 'Ingredient', value: (r) => r.name }, { label: 'Category', value: (r) => r.category }, { label: 'Unit', value: (r) => r.unit },
    { label: 'Opening', value: (r) => r.opening }, { label: 'Purchased', value: (r) => r.purchased }, { label: 'Consumed (sales)', value: (r) => r.consumed },
    { label: 'Wasted', value: (r) => r.wasted }, { label: 'Adjusted / count variance', value: (r) => r.adjusted }, { label: 'Closing', value: (r) => r.closing },
    { label: 'Consumed value (₹)', value: (r) => r.consumed_value }, { label: 'Wasted value (₹)', value: (r) => r.wasted_value },
    { label: 'Variance value (₹)', value: (r) => r.variance_value }, { label: 'Closing value (₹)', value: (r) => r.closing_value },
  ]);
  return (
    <>
      <section className="stats">
        <Stat label="Purchased" value={moneyShort(totals.purchased_value)} />
        <Stat label="Used by sales" value={moneyShort(totals.consumed_value)} />
        <Stat label="Wasted" value={moneyShort(totals.wasted_value)} tone={totals.wasted_value ? 'warn' : ''} />
        <Stat label="Count variance" value={moneyShort(totals.variance_value)} tone={totals.variance_value < 0 ? 'danger' : ''} sub="Counted minus book" />
        <Stat label="Closing stock value" value={moneyShort(totals.closing_value)} />
      </section>
      <section className="card pad">
        <div className="card-head">
          <h2>Opening + purchased − used − wasted ± variance = closing</h2>
          <div className="row-actions">
            <label className="check"><input type="checkbox" checked={onlyMoved} onChange={(e) => setOnlyMoved(e.target.checked)} /> Only items that moved</label>
            <button className="btn" onClick={exportCsv}>Export CSV</button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="compact">
            <thead><tr><th>Ingredient</th><th className="num">Opening</th><th className="num">Purchased</th><th className="num">Used</th><th className="num">Wasted</th><th className="num">Variance</th><th className="num">Closing</th><th className="num">Value</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td className="name">{r.name}</td>
                  <td className="num">{qty(r.opening, r.unit, { small: false })}</td>
                  <td className="num plus">{r.purchased ? `+${qty(r.purchased, r.unit, { small: false })}` : '—'}</td>
                  <td className="num">{r.consumed ? qty(r.consumed, r.unit, { small: false }) : '—'}</td>
                  <td className="num neg">{r.wasted ? qty(r.wasted, r.unit, { small: false }) : '—'}</td>
                  <td className={`num ${r.adjusted < 0 ? 'neg' : 'plus'}`}>{r.adjusted ? `${r.adjusted > 0 ? '+' : ''}${qty(r.adjusted, r.unit, { small: false })}` : '—'}</td>
                  <td className="num"><strong>{qty(r.closing, r.unit, { small: false })}</strong></td>
                  <td className="num">{money(r.closing_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Ledger({ from, to }) {
  const [type, setType] = useState('wastage');
  const q = useLoad(() => api.movements({ type, from, to, limit: 500 }), [type, from, to]);
  const rows = q.data || [];
  const value = rows.reduce((s, m) => s + m.value, 0);
  const exportCsv = () => downloadCsv(`oasys-${type}-${fileRange(from, to)}.csv`, rows, [
    { label: 'When', value: (m) => m.created_at }, { label: 'Ingredient', value: (m) => m.ingredient }, { label: 'Change', value: (m) => m.quantity },
    { label: 'Unit', value: (m) => m.unit }, { label: 'Value (₹)', value: (m) => m.value }, { label: 'Note', value: (m) => m.note }, { label: 'By', value: (m) => m.user },
  ]);
  return (
    <section className="card pad">
      <div className="card-head">
        <h2>{MOVEMENT_LABEL[type]} <span className="muted">· {rows.length} entries · {money(value)}</span></h2>
        <div className="row-actions">
          <Segmented value={type} onChange={setType} options={[['wastage', 'Wastage'], ['count', 'Counts'], ['adjustment', 'Adjustments'], ['purchase', 'Received'], ['void', 'Voids']]} />
          <button className="btn" onClick={exportCsv} disabled={!rows.length}>Export CSV</button>
        </div>
      </div>
      {q.error && <Alert>{q.error}</Alert>}
      {q.loading && !q.data ? <Loading /> : rows.length === 0 ? <Empty>Nothing recorded in this range.</Empty> : (
        <div className="table-wrap">
          <table className="compact">
            <thead><tr><th>When</th><th>Ingredient</th><th className="num">Change</th><th className="num">Value</th><th>Note</th><th>By</th></tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td>{dateTime(m.created_at)}</td><td className="name">{m.ingredient}</td>
                  <td className={`num ${m.quantity < 0 ? 'neg' : 'plus'}`}>{m.quantity > 0 ? '+' : ''}{qty(m.quantity, m.unit)}</td>
                  <td className="num">{money(m.value)}</td><td className="sub">{m.note || '—'}</td><td className="sub">{m.user || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
