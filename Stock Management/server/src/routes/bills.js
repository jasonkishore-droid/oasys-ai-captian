const express = require('express');
const { z } = require('zod');
const { HttpError, notFound, idParam } = require('../errors');
const billing = require('../services/billing');
const email = require('../services/email');

const listQuery = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(['paid', 'void']).optional(),
  search: z.string().trim().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

module.exports = function billRoutes(db, { requireRole }) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const f = listQuery.parse(req.query);
    // An earlier build of the page polled exactly this query every few seconds and printed each new
    // voice order by itself. Receipts are now printed only on request (services/printJobs.js), so a
    // tab still running that build gets nothing to print. The current page never asks for this.
    if (f.status === 'paid' && f.limit === 20 && !f.date && !f.search) return res.json([]);
    const q = db('bills as b')
      .leftJoin('users as u', 'u.id', 'b.created_by')
      .select('b.id', 'b.bill_no', 'b.business_date', 'b.status', 'b.source', 'b.order_type', 'b.table_no', 'b.customer',
        'b.customer_email', 'b.payment_mode', 'b.subtotal', 'b.discount', 'b.service_rate', 'b.service_charge', 'b.taxable',
        'b.tax_rate', 'b.cgst', 'b.sgst', 'b.round_off', 'b.total', 'b.food_cost', 'b.created_at', 'b.emailed_at', 'u.name as cashier',
        db('bill_items as bi').sum('quantity').whereRaw('bi.bill_id = b.id').as('item_count'))
      .orderBy('b.id', 'desc')
      .limit(f.limit);
    if (f.date) q.where('b.business_date', f.date);
    if (f.status) q.where('b.status', f.status);
    if (f.search) {
      const s = `%${f.search.toLowerCase()}%`;
      q.where((w) => w.whereRaw('LOWER(b.bill_no) LIKE ?', [s]).orWhereRaw('LOWER(b.customer) LIKE ?', [s]).orWhereRaw('LOWER(b.table_no) LIKE ?', [s]));
    }
    res.json((await q).map(billing.shapeBill));
  });

  router.get('/next-number', async (_req, res) => {
    res.json({ bill_no: await billing.peekNextBillNo(db) });
  });

  router.get('/:id', async (req, res) => {
    const bill = await billing.getBill(db, idParam(req.params.id, 'Bill'));
    if (!bill) throw notFound('Bill');
    res.json(bill);
  });

  router.post('/', requireRole('cashier'), async (req, res) => {
    const id = await billing.createBill(db, req.body || {}, { user_id: req.user.id, source: 'pos' });
    res.status(201).json(await billing.getBill(db, id));
  });

  router.post('/:id/void', requireRole('manager'), async (req, res) => {
    const id = idParam(req.params.id, 'Bill');
    const { reason } = z.object({ reason: z.string().trim().min(3, 'give a reason').max(255) }).parse(req.body || {});
    await billing.voidBill(db, id, reason, { user_id: req.user.id });
    req.log.info({ bill_id: id, by: req.user.username, reason }, 'bill voided');
    res.json(await billing.getBill(db, id));
  });

  router.post('/:id/email', async (req, res) => {
    const bill = await billing.getBill(db, idParam(req.params.id, 'Bill'));
    if (!bill) throw notFound('Bill');
    const to = String(req.body?.to || bill.customer_email || '').trim();
    if (!to) throw new HttpError(400, 'No email address for this bill');
    const message_id = await email.sendBillEmail(bill, to);
    await db('bills').where({ id: bill.id }).update({ customer_email: to, emailed_at: new Date().toISOString() });
    res.json({ ok: true, to, message_id, bill: await billing.getBill(db, bill.id) });
  });

  router.get('/:id/email-preview', async (req, res) => {
    const bill = await billing.getBill(db, idParam(req.params.id, 'Bill'));
    if (!bill) throw notFound('Bill');
    const { subject, text, html } = email.buildEmail(bill);
    if (req.query.format === 'text') return res.type('text/plain').send(`Subject: ${subject}\n\n${text}`);
    res.type('html').send(html || `<pre>${text}</pre>`);
  });

  return router;
};
