// GST bill e-receipts via Resend (https://resend.com/docs/api-reference/emails/send-email).
// Templates in server/templates are re-read on every send, so wording edits apply without a restart.
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { HttpError } = require('../errors');

const TEMPLATE_DIR = path.join(__dirname, '../../templates');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
const money = (n) => inr.format(n || 0);
const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const isConfigured = () => !!config.email.resendKey;
const render = (tpl, vars) => tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? '');

function buildVars(bill, html) {
  const esc = html ? escapeHtml : (s) => String(s ?? '');
  const r = config.restaurant;
  const date = new Date(bill.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: config.timezone });
  const row = (label, value) =>
    html ? `<tr><td style="padding:2px 0">${escapeHtml(label)}</td><td align="right">${escapeHtml(value)}</td></tr>` : `${label.padEnd(24)} ${value.padStart(14)}\n`;
  const items = bill.items.map((l) => (html
    ? `<tr><td style="padding:4px 0">${escapeHtml(l.name)}</td><td align="center">${l.quantity}</td><td align="right">${escapeHtml(money(l.line_total))}</td></tr>`
    : `${String(l.quantity).padStart(3)} x ${l.name.slice(0, 26).padEnd(26)} ${money(l.line_total).padStart(12)}\n`)).join(html ? '\n' : '');

  return {
    restaurant: esc(r.name),
    tagline: esc(r.tagline),
    address: esc(r.address),
    gstin_line: r.gstin ? esc(`GSTIN ${r.gstin}`) : '',
    bill_no: esc(bill.bill_no),
    customer: esc(bill.customer || 'there'),
    table_no: esc(bill.table_no || (bill.order_type === 'dine_in' ? '—' : bill.order_type.replace('_', ' '))),
    date: esc(date),
    payment_mode: esc(String(bill.payment_mode).toUpperCase()),
    items,
    subtotal: esc(money(bill.subtotal)),
    discount_line: bill.discount > 0 ? row('Discount', `− ${money(bill.discount)}`) : '',
    service_line: bill.service_charge > 0 ? row(`Service charge (${bill.service_rate}%)`, money(bill.service_charge)) : '',
    cgst_line: row(`CGST @ ${bill.tax_rate / 2}%`, money(bill.cgst)),
    sgst_line: row(`SGST @ ${bill.tax_rate / 2}%`, money(bill.sgst)),
    round_line: bill.round_off ? row('Round off', money(bill.round_off)) : '',
    total: esc(money(bill.total)),
  };
}

function buildEmail(bill) {
  const txtTpl = fs.readFileSync(path.join(TEMPLATE_DIR, 'bill-email.txt'), 'utf8');
  const htmlPath = path.join(TEMPLATE_DIR, 'bill-email.html');
  let subject = `Your ${config.restaurant.name} bill ${bill.bill_no}`;
  let body = txtTpl;
  const m = txtTpl.match(/^Subject:\s*(.+)\r?\n/);
  if (m) {
    subject = render(m[1].trim(), buildVars(bill, false));
    body = txtTpl.slice(m[0].length).replace(/^\s*\r?\n/, '');
  }
  return {
    subject,
    text: render(body, buildVars(bill, false)),
    html: fs.existsSync(htmlPath) ? render(fs.readFileSync(htmlPath, 'utf8'), buildVars(bill, true)) : undefined,
  };
}

async function sendBillEmail(bill, to) {
  if (!isConfigured()) throw new HttpError(503, 'Email is not set up: add RESEND_API_KEY to server/.env');
  if (!EMAIL_RE.test(to)) throw new HttpError(400, 'Enter a valid email address');
  if (bill.status === 'void') throw new HttpError(409, 'A void bill cannot be emailed');
  const { subject, text, html } = buildEmail(bill);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.email.resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: config.email.from, to: [to], subject, text,
      ...(html && { html }), ...(config.email.replyTo && { reply_to: config.email.replyTo }),
    }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, `Resend rejected the email: ${data.message || res.statusText}`);
  return data.id;
}

module.exports = { sendBillEmail, buildEmail, isConfigured, EMAIL_RE };
