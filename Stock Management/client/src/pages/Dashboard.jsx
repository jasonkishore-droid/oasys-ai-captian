import { useState } from 'react';
import { api } from '../api';
import { useApp, useLoad, useLiveStock, can, Stat, StatusBadge, LevelBar, DietMark, Alert, Loading, Empty } from '../ui.jsx';
import { money, moneyShort, pct, qty, shortDate, weekday, time } from '../format';

export default function Dashboard() {
  const { user, go } = useApp();
  const { data, error, loading, reload, refresh } = useLoad(() => api.dashboard());
  useLiveStock(refresh);
  if (loading && !data) return <Loading />;
  if (error && !data) return <Alert>{error} <button className="link" onClick={reload}>Retry</button></Alert>;

  const t = data.today;
  const y = data.yesterday;
  const change = y.total_collected > 0 ? ((t.total_collected - y.total_collected) / y.total_collected) * 100 : null;

  return (
    <div className="page">
      <section className="stats">
        <Stat label="Sales today" value={moneyShort(t.total_collected)} sub={change === null ? 'No sales yesterday' : `${change >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(change))}% vs yesterday (${moneyShort(y.total_collected)})`} />
        <Stat label="Bills today" value={t.bills} sub={t.bills ? `Avg ${moneyShort(t.avg_bill)}${t.voids ? ` · ${t.voids} void` : ''}` : 'No bills yet'} />
        <Stat label="Food cost today" value={pct(t.food_cost_pct)} sub={`${moneyShort(t.food_cost)} of ${moneyShort(t.net_sales)} net`}
          tone={t.food_cost_pct > 35 ? 'warn' : ''} />
        <Stat label="Low / out of stock" value={`${data.stock.low} / ${data.stock.out}`} sub={`${data.stock.expiring} expiring soon`}
          tone={data.stock.out ? 'danger' : data.stock.low ? 'warn' : ''} onClick={() => go('stock')} />
        <Stat label="Stock value" value={moneyShort(data.stock.value)} sub={`${data.stock.ingredients} ingredients at cost`} />
      </section>

      <div className="grid-2">
        <section className="card pad">
          <div className="card-head">
            <h2>Sales, last 14 days</h2>
            <span className="muted">Total collected incl. GST</span>
          </div>
          <SalesChart days={data.by_day} today={data.business_date} />
        </section>

        <section className="card pad">
          <div className="card-head"><h2>Top dishes today</h2>{can(user, 'manager') && <button className="link" onClick={() => go('reports')}>Reports →</button>}</div>
          {data.top_dishes.length === 0 ? <Empty>No sales yet today.</Empty> : (
            <ol className="rank">
              {data.top_dishes.map((d) => (
                <li key={d.dish_id ?? d.name}>
                  <DietMark diet={d.diet} />
                  <span className="rank-name">{d.name}</span>
                  <span className="muted">{d.quantity} sold</span>
                  <strong className="num">{moneyShort(d.revenue)}</strong>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <div className="grid-2">
        <section className="card pad">
          <div className="card-head">
            <h2>Needs attention</h2>
            <button className="link" onClick={() => go('stock')}>All stock →</button>
          </div>
          {data.stock.attention.length === 0 ? <Empty>All ingredients are above par.</Empty> : (
            <table className="compact">
              <thead><tr><th>Ingredient</th><th className="num">On hand</th><th>Level</th><th>Status</th></tr></thead>
              <tbody>
                {data.stock.attention.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <div className="name">{i.name}</div>
                      <div className="sub">{i.supplier || '—'}{(i.expired || i.expiring_soon) && <span className={i.expired ? 'exp expired' : 'exp soon'}> · {i.expired ? 'expired' : 'expires'} {shortDate(i.expiry_date)}</span>}</div>
                    </td>
                    <td className="num">{qty(i.quantity, i.unit)}<div className="sub">par {qty(i.par_level, i.unit)}</div></td>
                    <td><LevelBar qty={i.quantity} par={i.par_level} /></td>
                    <td><StatusBadge status={i.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card pad">
          <div className="card-head"><h2>Menu availability</h2><button className="link" onClick={() => go('menu')}>Menu →</button></div>
          <p className="muted small">{data.menu.dishes} dishes · {data.menu.unavailable} switched off today</p>
          {data.menu.cannot_make.length > 0 && (
            <>
              <h3 className="mini-head danger">Out of stock to make ({data.menu.cannot_make.length})</h3>
              <ul className="pill-list">{data.menu.cannot_make.map((d) => <li key={d.id} className="pill danger" title={`Short of ${d.limited_by}`}>{d.name} <span>· {d.limited_by}</span></li>)}</ul>
            </>
          )}
          {data.menu.running_low.length > 0 && (
            <>
              <h3 className="mini-head warn">5 or fewer portions left ({data.menu.running_low.length})</h3>
              <ul className="pill-list">{data.menu.running_low.slice(0, 18).map((d) => <li key={d.id} className="pill warn" title={`Limited by ${d.limited_by}`}>{d.name} <span>· {d.portions}</span></li>)}</ul>
            </>
          )}
          {!data.menu.cannot_make.length && !data.menu.running_low.length && <Empty>Every dish can be made from current stock.</Empty>}

          <h3 className="mini-head">Recent bills</h3>
          <ul className="recent-bills">
            {data.recent_bills.map((b) => (
              <li key={b.id}>
                <span className="mono">{b.bill_no}</span>
                <span className="muted">{time(b.created_at)} · {b.table_no || b.order_type.replace('_', ' ')}</span>
                {b.status === 'void' ? <span className="badge out_of_stock">Void</span> : <strong className="num">{money(b.total)}</strong>}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

// Single-series bar chart: one hue, thin rounded bars on a shared baseline, hover tooltip, today emphasised.
function SalesChart({ days, today }) {
  const [hover, setHover] = useState(null);
  const W = 640, H = 220, padL = 44, padB = 26, padT = 12;
  const max = Math.max(1000, ...days.map((d) => d.total));
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const slot = (W - padL) / days.length;
  const barW = Math.max(6, Math.min(26, slot - 8));
  const y = (v) => padT + (H - padT - padB) * (1 - v / top);
  const ticks = Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step);
  const h = hover !== null ? days[hover] : null;

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Daily sales for the last 14 days" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W} y1={y(t)} y2={y(t)} className="grid-line" />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" className="axis">{t >= 1000 ? `${t / 1000}k` : t}</text>
          </g>
        ))}
        {days.map((d, i) => {
          const x = padL + i * slot + (slot - barW) / 2;
          const top0 = y(d.total);
          const hgt = Math.max(0, y(0) - top0);
          const r = Math.min(4, barW / 2, hgt);
          const path = hgt > 0
            ? `M${x},${y(0)} V${top0 + r} Q${x},${top0} ${x + r},${top0} H${x + barW - r} Q${x + barW},${top0} ${x + barW},${top0 + r} V${y(0)} Z`
            : '';
          return (
            <g key={d.date}>
              <rect x={padL + i * slot} y={padT} width={slot} height={H - padT - padB} fill="transparent" onMouseEnter={() => setHover(i)} />
              {path && <path d={path} className={`bar ${d.date === today ? 'today' : ''} ${hover === i ? 'hover' : ''}`} pointerEvents="none" />}
              {(i % 2 === days.length % 2 || d.date === today) && (
                <text x={x + barW / 2} y={H - 8} textAnchor="middle" className={`axis ${d.date === today ? 'strong' : ''}`}>
                  {d.date === today ? 'Today' : shortDate(d.date)}
                </text>
              )}
            </g>
          );
        })}
        <line x1={padL} x2={W} y1={y(0)} y2={y(0)} className="baseline" />
      </svg>
      {h && (
        <div className="tooltip" style={{ left: `${((padL + hover * slot + slot / 2) / W) * 100}%` }}>
          <strong>{weekday(h.date)} {shortDate(h.date)}</strong>
          <span>{money(h.total)}</span>
          <span className="muted">{h.bills} bills{h.net > 0 ? ` · food cost ${pct((h.food_cost / h.net) * 100)}` : ''}</span>
        </div>
      )}
    </div>
  );
}

function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
