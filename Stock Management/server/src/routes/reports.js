// Dashboard and management reports. All ranges are business dates (restaurant-local, inclusive).
const express = require('express');
const { z } = require('zod');
const { HttpError } = require('../errors');
const { businessDate, addDays } = require('../constants');
const { listDishes } = require('../services/menu');
const { shapeIngredient } = require('./stock');
const { round2, round3 } = require('../../../shared/billing.mjs');

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');
const rangeSchema = z.object({ from: isoDate.optional(), to: isoDate.optional() });

function range(query) {
  const { from, to } = rangeSchema.parse(query);
  const end = to || businessDate();
  const start = from || addDays(end, -6);
  if (start > end) throw new HttpError(400, '"from" must be on or before "to"');
  if (addDays(start, 366) < end) throw new HttpError(400, 'Range can be at most one year');
  return { from: start, to: end };
}

const n = (v) => Number(v || 0);

module.exports = function reportRoutes(db, { requireRole }) {
  const router = express.Router();

  const paid = (from, to) => db('bills').where('status', 'paid').whereBetween('business_date', [from, to]);

  async function salesSummary(from, to) {
    const t = await paid(from, to)
      .count({ bills: '*' })
      .sum({ subtotal: 'subtotal', discount: 'discount', service: 'service_charge', taxable: 'taxable', cgst: 'cgst', sgst: 'sgst', total: 'total', food_cost: 'food_cost' })
      .first();
    const voids = await db('bills').where('status', 'void').whereBetween('business_date', [from, to])
      .count({ count: '*' }).sum({ amount: 'total' }).first();
    const net = round2(n(t.subtotal) - n(t.discount));
    return {
      bills: n(t.bills),
      gross_sales: round2(n(t.subtotal)),
      discount: round2(n(t.discount)),
      net_sales: net,
      service_charge: round2(n(t.service)),
      taxable: round2(n(t.taxable)),
      cgst: round2(n(t.cgst)),
      sgst: round2(n(t.sgst)),
      total_collected: round2(n(t.total)),
      avg_bill: n(t.bills) ? round2(n(t.total) / n(t.bills)) : 0,
      food_cost: round2(n(t.food_cost)),
      food_cost_pct: net > 0 ? round2((n(t.food_cost) / net) * 100) : null,
      voids: n(voids.count),
      void_amount: round2(n(voids.amount)),
    };
  }

  async function byDay(from, to) {
    const rows = await paid(from, to).select('business_date').count({ bills: '*' })
      .sum({ total: 'total', net: db.raw('subtotal - discount'), food_cost: 'food_cost' })
      .groupBy('business_date').orderBy('business_date');
    const map = new Map(rows.map((r) => [String(r.business_date).slice(0, 10), r]));
    const out = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const r = map.get(d);
      out.push({ date: d, bills: n(r?.bills), total: round2(n(r?.total)), net: round2(n(r?.net)), food_cost: round2(n(r?.food_cost)) });
    }
    return out;
  }

  async function topDishes(from, to, limit) {
    const q = db('bill_items as bi').join('bills as b', 'b.id', 'bi.bill_id')
      .leftJoin('dishes as d', 'd.id', 'bi.dish_id')
      .leftJoin('menu_sections as s', 's.id', 'd.section_id')
      .where('b.status', 'paid').whereBetween('b.business_date', [from, to])
      .select('bi.dish_id', 'bi.name', 'bi.diet', 's.name as section')
      .sum({ quantity: 'bi.quantity', revenue: 'bi.line_total', cost: 'bi.cost' })
      .groupBy('bi.dish_id', 'bi.name', 'bi.diet', 's.name')
      .orderBy('revenue', 'desc');
    if (limit) q.limit(limit);
    return (await q).map((r) => ({
      dish_id: r.dish_id, name: r.name, diet: r.diet, section: r.section || '—',
      quantity: n(r.quantity), revenue: round2(n(r.revenue)), cost: round2(n(r.cost)),
      margin: round2(n(r.revenue) - n(r.cost)),
      food_cost_pct: n(r.revenue) > 0 ? round2((n(r.cost) / n(r.revenue)) * 100) : null,
    }));
  }

  // ---------- Dashboard (everyone signed in) ----------
  router.get('/dashboard', async (_req, res) => {
    const today = businessDate();
    const yesterday = addDays(today, -1);
    const [todaySum, yestSum, days, top, ingredients, dishes, recent] = await Promise.all([
      salesSummary(today, today),
      salesSummary(yesterday, yesterday),
      byDay(addDays(today, -13), today),
      topDishes(today, today, 5),
      db('ingredients as i').leftJoin('suppliers as s', 's.id', 'i.supplier_id').where('i.active', true).select('i.*', 's.name as supplier'),
      listDishes(db),
      db('bills').orderBy('id', 'desc').limit(6)
        .select('id', 'bill_no', 'status', 'total', 'table_no', 'order_type', 'payment_mode', 'created_at', 'source'),
    ]);
    const stock = ingredients.map((r) => shapeIngredient(r, today));
    const attention = stock
      .filter((i) => i.status !== 'in_stock' || i.expired || i.expiring_soon)
      .sort((a, b) => (a.quantity / (a.par_level || 1)) - (b.quantity / (b.par_level || 1)));
    res.json({
      business_date: today,
      today: todaySum,
      yesterday: yestSum,
      by_day: days,
      top_dishes: top,
      stock: {
        ingredients: stock.length,
        value: round2(stock.reduce((s, i) => s + i.value, 0)),
        low: stock.filter((i) => i.status === 'low_stock').length,
        out: stock.filter((i) => i.status === 'out_of_stock').length,
        expiring: stock.filter((i) => i.expiring_soon || i.expired).length,
        attention: attention.slice(0, 12),
      },
      menu: {
        dishes: dishes.length,
        unavailable: dishes.filter((d) => !d.available).length,
        cannot_make: dishes.filter((d) => d.available && d.portions === 0).map((d) => ({ id: d.id, name: d.name, limited_by: d.limited_by })),
        running_low: dishes.filter((d) => d.available && d.portions > 0 && d.portions <= 5).map((d) => ({ id: d.id, name: d.name, portions: d.portions, limited_by: d.limited_by })),
      },
      recent_bills: recent.map((b) => ({ ...b, total: n(b.total) })),
    });
  });

  // ---------- Sales ----------
  router.get('/sales', requireRole('manager'), async (req, res) => {
    const { from, to } = range(req.query);
    const [summary, days, payments, orderTypes, sections] = await Promise.all([
      salesSummary(from, to),
      byDay(from, to),
      paid(from, to).select('payment_mode').count({ bills: '*' }).sum({ total: 'total' }).groupBy('payment_mode'),
      paid(from, to).select('order_type').count({ bills: '*' }).sum({ total: 'total' }).groupBy('order_type'),
      db('bill_items as bi').join('bills as b', 'b.id', 'bi.bill_id').leftJoin('dishes as d', 'd.id', 'bi.dish_id')
        .leftJoin('menu_sections as s', 's.id', 'd.section_id')
        .where('b.status', 'paid').whereBetween('b.business_date', [from, to])
        .select('s.name as section').sum({ quantity: 'bi.quantity', revenue: 'bi.line_total', cost: 'bi.cost' })
        .groupBy('s.name').orderBy('revenue', 'desc'),
    ]);
    res.json({
      from, to, summary, by_day: days,
      by_payment: payments.map((p) => ({ payment_mode: p.payment_mode, bills: n(p.bills), total: round2(n(p.total)) })),
      by_order_type: orderTypes.map((p) => ({ order_type: p.order_type, bills: n(p.bills), total: round2(n(p.total)) })),
      by_section: sections.map((s) => ({
        section: s.section || '—', quantity: n(s.quantity), revenue: round2(n(s.revenue)), cost: round2(n(s.cost)),
        food_cost_pct: n(s.revenue) > 0 ? round2((n(s.cost) / n(s.revenue)) * 100) : null,
      })),
    });
  });

  router.get('/dishes', requireRole('manager'), async (req, res) => {
    const { from, to } = range(req.query);
    res.json({ from, to, dishes: await topDishes(from, to) });
  });

  // ---------- Stock reconciliation ----------
  // closing(to) = on hand now − movements after `to`; opening(from) = closing − movements within the range.
  router.get('/stock', requireRole('manager'), async (req, res) => {
    const { from, to } = range(req.query);
    const [items, within, after] = await Promise.all([
      db('ingredients').where('active', true).select('id', 'name', 'category', 'unit', 'quantity', 'avg_cost').orderBy('name'),
      db('stock_movements').whereBetween('business_date', [from, to]).select('ingredient_id', 'type')
        .sum({ qty: 'quantity', value: db.raw('quantity * unit_cost') }).groupBy('ingredient_id', 'type'),
      db('stock_movements').where('business_date', '>', to).select('ingredient_id').sum({ qty: 'quantity' }).groupBy('ingredient_id'),
    ]);
    const afterMap = new Map(after.map((a) => [a.ingredient_id, n(a.qty)]));
    const inMap = new Map();
    for (const w of within) {
      if (!inMap.has(w.ingredient_id)) inMap.set(w.ingredient_id, {});
      inMap.get(w.ingredient_id)[w.type] = { qty: n(w.qty), value: n(w.value) };
    }
    const rows = items.map((i) => {
      const m = inMap.get(i.id) || {};
      const q = (t) => m[t]?.qty || 0;
      const closing = round3(n(i.quantity) - (afterMap.get(i.id) || 0));
      const moved = Object.values(m).reduce((s, x) => s + x.qty, 0);
      const consumed = round3(-(q('sale') + q('void')));
      return {
        id: i.id, name: i.name, category: i.category, unit: i.unit,
        opening: round3(closing - moved + q('opening')), // stock brought in by an 'opening' entry counts as opening
        purchased: round3(q('purchase')),
        consumed,
        wasted: round3(-q('wastage')),
        adjusted: round3(q('adjustment') + q('count')),
        closing,
        consumed_value: round2(-((m.sale?.value || 0) + (m.void?.value || 0))),
        wasted_value: round2(-(m.wastage?.value || 0)),
        variance_value: round2((m.adjustment?.value || 0) + (m.count?.value || 0)),
        closing_value: round2(Math.max(0, closing) * n(i.avg_cost)),
      };
    });
    const sum = (k) => round2(rows.reduce((s, r) => s + r[k], 0));
    const purchases = await db('purchases').whereBetween('business_date', [from, to]).sum({ total: 'total' }).first();
    res.json({
      from, to, rows,
      totals: {
        purchased_value: round2(n(purchases.total)),
        consumed_value: sum('consumed_value'),
        wasted_value: sum('wasted_value'),
        variance_value: sum('variance_value'),
        closing_value: sum('closing_value'),
      },
    });
  });

  return router;
};
