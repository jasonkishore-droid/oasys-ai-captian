// Machine-to-machine API for the AI Captain (voice/chat waiter) and the Kitchen Terminal.
// Protected by a shared secret: set ORDER_API_KEY in server/.env and send it as X-Api-Key.
// With no key configured the integration is switched off.
//
//   GET  /api/integrations/ping
//   GET  /api/integrations/menu?search=&section=&diet=veg|nonveg|egg
//   POST /api/integrations/orders     { items: [{ name | dish_id, quantity }], table_no, customer,
//                                       customer_phone, payment_mode, dry_run, source }
//        dry_run: true  -> quote only (matched dishes, GST totals, next bill number)
//        otherwise      -> creates the bill (stock deducted) exactly as the POS would
//   POST /api/integrations/orders/email  { bill_no, to }  -> e-receipt for a placed bill
//   GET  /api/integrations/orders?since_id=   -> bills after an id, with lines (kitchen ticket feed)
//   POST /api/integrations/print-test         -> queue a test page for the Bluetooth printer
//   POST /api/integrations/print-receipt { bill_no }  -> queue a paper receipt for a placed bill
//   GET  /api/integrations/print-jobs/:id     -> waiting | printing | printed | failed
//   GET  /api/integrations/printer            -> { tab_online, connected, connecting, name }
const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const config = require('../config');
const { HttpError } = require('../errors');
const { PAYMENT_MODES } = require('../constants');
const { listDishes } = require('../services/menu');
const billing = require('../services/billing');
const email = require('../services/email');
const printJobs = require('../services/printJobs');
const { computeTotals, round2 } = require('../../../shared/billing.mjs');

// ---- forgiving name matching: "two masala dosas", "chicken briyani", "filter kaapi" ----
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const ALIASES = { briyani: 'biryani', biriyani: 'biryani', dosai: 'dosa', thosai: 'dosa', kaapi: 'coffee', kapi: 'coffee', parota: 'parotta', porotta: 'parotta', uttapam: 'uthappam', uthapam: 'uthappam', omlet: 'omelette', omelet: 'omelette' };
const stem = (w) => {
  const a = ALIASES[w] || w;
  return a.length > 3 ? a.replace(/(es|s)$/, '') : a;
};
const STOP = new Set(['a', 'an', 'the', 'of', 'one', 'two', 'three', 'four', 'plate', 'plates', 'please', 'some', 'and', 'with', 'pcs', 'pc', 'piece', 'pieces']);
const tokens = (s) => norm(s).split(' ').filter((w) => w && !STOP.has(w) && !/^\d+$/.test(w)).map(stem);

function match(query, dishes) {
  const q = tokens(query);
  if (!q.length) return { status: 'not_found' };
  const exact = dishes.filter((d) => norm(d.name) === norm(query));
  if (exact.length === 1) return { status: 'ok', dish: exact[0] };
  const scored = dishes.map((d) => {
    const nt = tokens(d.name);
    const hits = q.filter((t) => nt.some((n) => n === t || (t.length > 3 && (n.startsWith(t) || t.startsWith(n))))).length;
    const missing = nt.length - hits; // fewer unmatched words = closer ("masala dosa" beats "mysore masala dosa")
    return { dish: d, hits, score: hits * 10 - missing };
  }).filter((s) => s.hits === q.length || (q.length > 2 && s.hits >= q.length - 1))
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return { status: 'not_found' };
  const top = scored.filter((s) => s.score === scored[0].score);
  if (top.length > 1) return { status: 'ambiguous', options: top.slice(0, 6).map((s) => s.dish.name) };
  return { status: 'ok', dish: scored[0].dish };
}

const orderSchema = z.object({
  items: z.array(z.object({
    name: z.string().max(120).optional(),
    dish_id: z.coerce.number().int().positive().optional(),
    quantity: z.coerce.number().int().min(1).max(50).default(1),
  })).min(1, 'items is required: [{ name, quantity }]').max(50),
  table_no: z.string().max(20).optional().nullable(),
  customer: z.string().max(120).optional().nullable(),
  customer_phone: z.string().max(20).optional().nullable(),
  customer_email: z.string().max(254).optional().nullable(),
  order_type: z.enum(['dine_in', 'takeaway', 'delivery']).default('dine_in'),
  payment_mode: z.enum(PAYMENT_MODES).default('cash'),
  dry_run: z.boolean().default(false),
  source: z.string().regex(/^[a-z0-9-]{2,20}$/).default('ai-captain'),
});

module.exports = function integrationRoutes(db) {
  const router = express.Router();

  router.use(rateLimit({ windowMs: 60 * 1000, limit: 240, standardHeaders: 'draft-7', legacyHeaders: false }));
  router.use((req, res, next) => {
    const expected = config.integrations.apiKey;
    if (!expected) return res.status(503).json({ error: 'Integration is off: set ORDER_API_KEY in server/.env' });
    const a = crypto.createHash('sha256').update(String(req.get('x-api-key') || '')).digest();
    const b = crypto.createHash('sha256').update(expected).digest();
    if (!crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Invalid API key' });
    next();
  });

  const orderable = async () => (await listDishes(db)).filter((d) => d.available);
  const publicDish = (d) => ({
    id: d.id, name: d.name, section: d.section, diet: d.diet, price: d.price, description: d.description,
    portions_left: d.portions, sold_out: d.portions === 0 && !config.billing.allowNegativeStock,
  });

  router.get('/ping', (_req, res) => res.json({ ok: true, restaurant: config.restaurant.name, currency: 'INR', gst_rate: config.billing.taxRate }));

  router.get('/menu', async (req, res) => {
    const s = tokens(req.query.search);
    const section = norm(req.query.section);
    let dishes = await orderable();
    if (req.query.diet) dishes = dishes.filter((d) => d.diet === req.query.diet);
    if (section) dishes = dishes.filter((d) => norm(d.section).includes(section));
    if (s.length) dishes = dishes.filter((d) => s.every((t) => tokens(d.name).some((n) => n.startsWith(t) || t.startsWith(n))));
    res.json({ currency: 'INR', gst_rate: config.billing.taxRate, dishes: dishes.map(publicDish) });
  });

  router.post('/orders', async (req, res) => {
    const b = orderSchema.parse(req.body || {});
    const dishes = await orderable();
    const byId = new Map(dishes.map((d) => [d.id, d]));
    const merged = new Map();
    const problems = [];

    for (const r of b.items) {
      const m = r.dish_id
        ? (byId.has(r.dish_id) ? { status: 'ok', dish: byId.get(r.dish_id) } : { status: 'not_found' })
        : match(r.name, dishes);
      if (m.status === 'not_found') { problems.push({ requested: r.name || r.dish_id, problem: 'not_on_menu' }); continue; }
      if (m.status === 'ambiguous') { problems.push({ requested: r.name, problem: 'ambiguous', options: m.options }); continue; }
      merged.set(m.dish.id, { dish: m.dish, quantity: (merged.get(m.dish.id)?.quantity || 0) + r.quantity });
    }

    const lines = [];
    for (const { dish, quantity } of merged.values()) {
      if (!config.billing.allowNegativeStock && dish.portions !== null && quantity > dish.portions) {
        problems.push({ requested: dish.name, problem: dish.portions === 0 ? 'sold_out' : 'not_enough_stock', portions_left: dish.portions });
      } else {
        lines.push({ dish_id: dish.id, name: dish.name, diet: dish.diet, quantity, unit_price: dish.price, line_total: round2(quantity * dish.price) });
      }
    }
    const totals = computeTotals(lines.map((l) => l.line_total), { service_rate: config.integrations.serviceRate, tax_rate: config.billing.taxRate });
    if (problems.length || !lines.length) return res.status(422).json({ ok: false, problems, lines, ...totals, tax_rate: config.billing.taxRate, currency: 'INR' });

    if (b.dry_run) {
      return res.json({ ok: true, dry_run: true, lines, ...totals, tax_rate: config.billing.taxRate, currency: 'INR', next_bill_no: await billing.peekNextBillNo(db) });
    }
    const id = await billing.createBill(db, {
      items: lines.map((l) => ({ dish_id: l.dish_id, quantity: l.quantity })),
      table_no: b.table_no, customer: b.customer, customer_phone: b.customer_phone, customer_email: b.customer_email,
      order_type: b.order_type, payment_mode: b.payment_mode, service_rate: config.integrations.serviceRate,
    }, { source: b.source });
    res.status(201).json({ ok: true, bill: await billing.getBill(db, id) });
  });

  // E-receipt for a bill placed through this API, after the guest confirmed the address.
  router.post('/orders/email', async (req, res) => {
    const { bill_no, to } = z.object({ bill_no: z.string().trim().min(1).max(16), to: z.string().trim().max(254) }).parse(req.body || {});
    const row = await db('bills').where({ bill_no }).first('id');
    if (!row) throw new HttpError(404, 'Bill not found');
    const bill = await billing.getBill(db, row.id);
    const message_id = await email.sendBillEmail(bill, to);
    await db('bills').where({ id: bill.id }).update({ customer_email: to, emailed_at: new Date().toISOString() });
    res.json({ ok: true, to, message_id, bill_no: bill.bill_no });
  });

  // Test page on the Bluetooth printer: queued here, printed by a signed-in tab that has the printer
  // connected (see services/printJobs.js). Poll the job to learn whether it printed.
  const NO_TAB = 'The receipt printer is offline. Open the Stock Management app in a browser, sign in (reload it if it is already open), then press "Connect printer".';
  router.post('/print-test', (_req, res) => {
    if (!printJobs.tabOnline()) throw new HttpError(409, NO_TAB);
    const job = printJobs.add('test');
    res.status(202).json({ ok: true, job_id: job.id, status: job.status });
  });
  // Paper receipt for a placed bill, when the guest asks for one.
  router.post('/print-receipt', async (req, res) => {
    const { bill_no } = z.object({ bill_no: z.string().trim().min(1).max(16) }).parse(req.body || {});
    const row = await db('bills').where({ bill_no }).first('id');
    if (!row) throw new HttpError(404, 'Bill not found');
    if (!printJobs.tabOnline()) throw new HttpError(409, NO_TAB);
    const job = printJobs.add('bill', { bill_id: row.id });
    res.status(202).json({ ok: true, job_id: job.id, status: job.status, bill_no });
  });
  router.get('/printer', (_req, res) => res.json({ ok: true, ...printJobs.printerStatus() }));
  router.get('/print-jobs/:id', (req, res) => {
    const job = printJobs.get(Number(req.params.id));
    if (!job) throw new HttpError(404, 'Print job not found');
    res.json({ ok: true, job_id: job.id, status: job.status, error: job.error });
  });

  // Kitchen ticket feed: poll with the last id you have seen.
  router.get('/orders', async (req, res) => {
    const since = Math.max(0, Number(req.query.since_id) || 0);
    const bills = await db('bills').where('id', '>', since).where('status', 'paid').orderBy('id').limit(50)
      .select('id', 'bill_no', 'order_type', 'table_no', 'source', 'note', 'created_at');
    const items = bills.length ? await db('bill_items').whereIn('bill_id', bills.map((x) => x.id)).select('bill_id', 'dish_id', 'name', 'diet', 'quantity') : [];
    res.json({
      orders: bills.map((x) => ({ ...x, items: items.filter((i) => i.bill_id === x.id).map(({ bill_id, ...i }) => i) })),
      last_id: bills.length ? bills[bills.length - 1].id : since,
    });
  });

  if (!config.isProd) router.post('/_match', (req, res, next) => orderable().then((d) => res.json(match(req.body?.name, d))).catch(next));

  return router;
};

module.exports.match = match;
