// Goods received (GRN): adds stock, updates weighted-average cost and earliest expiry.
const express = require('express');
const { z } = require('zod');
const { HttpError, notFound, idParam } = require('../errors');
const { businessDate } = require('../constants');
const { applyMovements } = require('../services/stock');
const { round2, round3 } = require('../../../shared/billing.mjs');

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');

const purchaseSchema = z.object({
  supplier_id: z.coerce.number().int().positive().nullable().optional(),
  invoice_no: z.string().trim().max(40).optional().nullable().transform((v) => v || null),
  invoice_date: isoDate.optional().nullable().transform((v) => v || null),
  note: z.string().trim().max(255).optional().nullable().transform((v) => v || null),
  items: z.array(z.object({
    ingredient_id: z.coerce.number().int().positive(),
    quantity: z.coerce.number().positive().max(1e6),
    unit_cost: z.coerce.number().min(0).max(1e6),
    expiry_date: isoDate.optional().nullable().transform((v) => v || null),
  })).min(1, 'Add at least one item').max(300),
});

const shapePurchase = (p) => ({ ...p, total: Number(p.total), item_count: p.item_count !== undefined ? Number(p.item_count) : undefined });

module.exports = function purchaseRoutes(db, { requireRole }) {
  const router = express.Router();

  const getPurchase = async (id) => {
    const p = await db('purchases as p')
      .leftJoin('suppliers as s', 's.id', 'p.supplier_id')
      .leftJoin('users as u', 'u.id', 'p.created_by')
      .select('p.*', 's.name as supplier', 'u.name as received_by')
      .where('p.id', id).first();
    if (!p) return null;
    const items = await db('purchase_items as pi').join('ingredients as i', 'i.id', 'pi.ingredient_id')
      .where('pi.purchase_id', id).select('pi.*', 'i.name', 'i.unit').orderBy('pi.id');
    return {
      ...shapePurchase(p),
      items: items.map((i) => ({ ...i, quantity: Number(i.quantity), unit_cost: Number(i.unit_cost), line_total: Number(i.line_total) })),
    };
  };

  router.get('/', requireRole('manager'), async (req, res) => {
    const limit = Math.min(200, Number(req.query.limit) || 50);
    const rows = await db('purchases as p')
      .leftJoin('suppliers as s', 's.id', 'p.supplier_id')
      .leftJoin('users as u', 'u.id', 'p.created_by')
      .select('p.*', 's.name as supplier', 'u.name as received_by',
        db('purchase_items as pi').count('*').whereRaw('pi.purchase_id = p.id').as('item_count'))
      .orderBy('p.id', 'desc').limit(limit);
    res.json(rows.map(shapePurchase));
  });

  router.get('/:id', requireRole('manager'), async (req, res) => {
    const p = await getPurchase(idParam(req.params.id, 'Purchase'));
    if (!p) throw notFound('Purchase');
    res.json(p);
  });

  // Receives goods inside a transaction: the purchase, its lines, the stock movements and the expiry dates.
  const receive = async (trx, body, userId, at) => {
    const ids = [...new Set(body.items.map((i) => i.ingredient_id))];
    if (ids.length !== body.items.length) throw new HttpError(400, 'Each ingredient should appear once per receipt');
    const found = await trx('ingredients').whereIn('id', ids).select('id', 'quantity', 'expiry_date', 'active');
    if (found.length !== ids.length) throw new HttpError(400, 'One of the ingredients no longer exists');
    const before = new Map(found.map((f) => [f.id, f]));

    const lines = body.items.map((i) => ({ ...i, line_total: round2(i.quantity * i.unit_cost) }));
    const [{ id }] = await trx('purchases').insert({
      supplier_id: body.supplier_id || null,
      invoice_no: body.invoice_no,
      invoice_date: body.invoice_date,
      note: body.note,
      business_date: businessDate(new Date(at)),
      total: round2(lines.reduce((s, l) => s + l.line_total, 0)),
      created_by: userId,
      created_at: at,
    }).returning('id');
    await trx('purchase_items').insert(lines.map((l) => ({ purchase_id: id, ...l })));

    await applyMovements(trx, lines.map((l) => ({
      ingredient_id: l.ingredient_id, delta: l.quantity, unit_cost: l.unit_cost, type: 'purchase',
      ref_type: 'purchase', ref_id: id, note: body.invoice_no ? `Invoice ${body.invoice_no}` : body.note,
    })), { user_id: userId, at });

    // Earliest expiry wins, unless the shelf was empty, in which case the new batch defines it.
    for (const l of lines) {
      const b = before.get(l.ingredient_id);
      const patch = { active: true };
      if (l.expiry_date) {
        const cur = b.expiry_date ? String(b.expiry_date).slice(0, 10) : null;
        if (Number(b.quantity) <= 0 || !cur || l.expiry_date < cur) patch.expiry_date = l.expiry_date;
      } else if (Number(b.quantity) <= 0) {
        patch.expiry_date = null;
      }
      await trx('ingredients').where({ id: l.ingredient_id }).update(patch);
    }
    return id;
  };

  router.post('/', requireRole('manager'), async (req, res) => {
    const body = purchaseSchema.parse(req.body || {});
    const at = new Date().toISOString();
    const id = await db.transaction((trx) => receive(trx, body, req.user.id, at));
    res.status(201).json(await getPurchase(id));
  });

  // Restock: for every ingredient that is low (below its par level) or out of stock, order the usual
  // reorder quantity at its average cost. If that would still leave it below par (stock gone negative,
  // say), order enough to reach par plus the reorder quantity. Items with no par level and no reorder
  // quantity are skipped. { dry_run: true } only shows the list; otherwise one purchase is recorded per
  // supplier, in a single transaction (all or nothing).
  router.post('/restock', requireRole('manager'), async (req, res) => {
    const { dry_run: dryRun } = z.object({ dry_run: z.boolean().optional() }).parse(req.body || {});
    const rows = await db('ingredients as i').leftJoin('suppliers as s', 's.id', 'i.supplier_id')
      .where('i.active', true).andWhereRaw('i.quantity < i.par_level OR i.quantity <= 0')
      .select('i.*', 's.name as supplier').orderBy('i.name');
    const items = [];
    for (const r of rows) {
      const quantity = Number(r.quantity); const par = Number(r.par_level); const rq = Number(r.reorder_qty);
      const base = rq > 0 ? rq : par;
      if (!(base > 0)) continue; // nothing to base an order on
      let add = base;
      if (quantity + add < par) add = par - quantity + base;
      add = round3(add);
      items.push({
        ingredient_id: r.id, name: r.name, unit: r.unit, supplier_id: r.supplier_id, supplier: r.supplier,
        status: quantity <= 0 ? 'out_of_stock' : 'low_stock', on_hand: quantity, par_level: par,
        quantity: add, unit_cost: Number(r.avg_cost), line_total: round2(add * Number(r.avg_cost)),
      });
    }
    const total = round2(items.reduce((s, l) => s + l.line_total, 0));
    if (dryRun || !items.length) return res.json({ items, count: items.length, total, purchases: [] });

    const at = new Date().toISOString();
    const bySupplier = new Map();
    for (const i of items) (bySupplier.get(i.supplier_id) || bySupplier.set(i.supplier_id, []).get(i.supplier_id)).push(i);
    const purchases = await db.transaction(async (trx) => {
      const ids = [];
      for (const [supplierId, list] of bySupplier) {
        ids.push(await receive(trx, {
          supplier_id: supplierId || null, invoice_no: null, invoice_date: null, note: 'Auto restock',
          items: list.map((l) => ({ ingredient_id: l.ingredient_id, quantity: l.quantity, unit_cost: l.unit_cost, expiry_date: null })),
        }, req.user.id, at));
      }
      return ids;
    });
    res.status(201).json({ items, count: items.length, total, purchases });
  });

  return router;
};
