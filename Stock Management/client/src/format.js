export { computeTotals, round2 } from '../../shared/billing.mjs';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inrShort = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });

export const money = (n) => inr.format(n || 0); // ₹1,20,000.00
export const moneyShort = (n) => inrShort.format(n || 0); // ₹1,20,000
export const pct = (n) => (n === null || n === undefined ? '—' : `${Math.round(n * 10) / 10}%`);

// Stock is stored in kg / L / pcs. Small amounts read better as g / ml.
export function qty(n, unit, { small = true } = {}) {
  const v = Number(n || 0);
  if (small && Math.abs(v) < 1 && v !== 0 && unit === 'kg') return `${num.format(Math.round(v * 1000 * 10) / 10)} g`;
  if (small && Math.abs(v) < 1 && v !== 0 && unit === 'L') return `${num.format(Math.round(v * 1000 * 10) / 10)} ml`;
  return `${num.format(v)} ${unit}`;
}

export const dateTime = (iso) => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
export const time = (iso) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
export const shortDate = (ymd) => new Date(`${ymd}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
export const weekday = (ymd) => new Date(`${ymd}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short' });

export const addDays = (ymd, n) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const ORDER_TYPE_LABEL = { dine_in: 'Dine-in', takeaway: 'Takeaway', delivery: 'Delivery' };
export const PAYMENT_LABEL = { cash: 'Cash', upi: 'UPI', card: 'Card' };
export const MOVEMENT_LABEL = {
  opening: 'Opening', purchase: 'Received', sale: 'Sold', void: 'Void (returned)', wastage: 'Wastage', adjustment: 'Adjustment', count: 'Stock count',
};

export function toCsv(rows, columns) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map((c) => esc(c.label)).join(','), ...rows.map((r) => columns.map((c) => esc(c.value(r))).join(','))].join('\n');
}

export function downloadCsv(filename, rows, columns) {
  const blob = new Blob(['﻿' + toCsv(rows, columns)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
