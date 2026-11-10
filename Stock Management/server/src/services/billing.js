// Bills: priced from the database (never from the caller), numbered gap-free per financial year,
// and recipe ingredients deducted from stock, all in one transaction.
const { z } = require('zod');
const config = require('../config');
const { HttpError } = require('../errors');
const { ORDER_TYPES, PAYMENT_MODES, businessDate } = require('../constants');
const { applyMovements, consumption } = require('./stock');
const { recipesFor } = require('./menu');
const { computeTotals, financialYear, formatBillNo, round2 } = require('../../../shared/billing.mjs');

const optText = (max) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);

const billInput = z.object({
  order_type: z.enum(ORDER_TYPES).default('dine_in'),
  table_no: optText(20),
  customer: optText(120),
  customer_phone: z.string().trim().max(20).regex(/^[+\d\s-]*$/, 'digits only').optional().nullable().transform((v) => v || null),
  customer_email: z.union([z.string().trim().email('looks invalid').max(254), z.literal('')]).optional().nullable().transform((v) => v || null),
  payment_mode: z.enum(PAYMENT_MODES),
  discount: z.coerce.number().min(0).max(1e6).default(0),
  service_rate: z.coerce.number().min(0).max(20).default(config.billing.defaultServiceRate),
  note: optText(255),
  items: z.array(z.object({
    dish_id: z.coerce.number().int().positive(),
    quantity: z.coerce.number().int().min(1).max(500),
  })).min(1, 'Add at least one dish to the bill').max(100),
});

const shapeBill = (b) => {
  const out = { ...b };
  for (const k of ['subtotal', 'discount', 'service_rate', 'service_charge', 'taxable', 'tax_rate', 'cgst', 'sgst', 'round_off', 'total', 'food_cost'])
    if (b[k] !== undefined) out[k] = Number(b[k]);
  if (b.item_count !== undefined) out.item_count = Number(b.item_count);
  out.tax = round2(out.cgst + out.sgst);
  return out;
};
const shapeLine = (l) => ({
  ...l, quantity: Number(l.quantity), unit_price: Number(l.unit_price), line_total: Number(l.line_total), cost: Number(l.cost),
});

async function nextNumber(trx, name) {
  await trx('counters').insert({ name, value: 0 }).onConflict('name').ignore();
  // UPDATE … RETURNING is atomic on Postgres and SQLite ≥ 3.35, and a rolled-back bill gives its number back.
  const r = await trx.raw('UPDATE counters SET value = value + 1 WHERE name = ? RETURNING value', [name]);
  const row = Array.isArray(r) ? r[0] : r.rows[0];
  return Number(row.value);
}

async function peekNextBillNo(db, at = new Date()) {
  const fy = financialYear(businessDate(at));
  const row = await db('counters').where({ name: `bill:${fy}` }).first();
  return formatBillNo(config.billing.prefix, fy, Number(row?.value || 0) + 1);
}

async function getBill(db, id) {
  const bill = await db('bills as b')
    .leftJoin('users as u', 'u.id', 'b.created_by')
    .leftJoin('users as v', 'v.id', 'b.voided_by')
    .select('b.*', 'u.name as cashier', 'v.name as voided_by_name')
    .where('b.id', id)
    .first();
  if (!bill) return null;
  const items = await db('bill_items').where({ bill_id: id }).orderBy('id');
  return { ...shapeBill(bill), items: items.map(shapeLine) };
}

/**
 * @param input  raw request body (validated here)
 * @param ctx    { user_id, source = 'pos', at? (ISO, seeding only), allowNegative? }
 * @returns      bill id
 */
async function createBill(db, input, ctx = {}) {
  const body = billInput.parse(input);
  const at = ctx.at || new Date().toISOString();
  const day = businessDate(new Date(at));
  const fy = financialYear(day);

  // Merge repeated dishes ("one dosa … and another dosa").
  const qty = new Map();
  for (const l of body.items) qty.set(l.dish_id, (qty.get(l.dish_id) || 0) + l.quantity);
  const ids = [...qty.keys()];

  return db.transaction(async (trx) => {
    const dishes = await trx('dishes').whereIn('id', ids).select('id', 'name', 'price', 'diet', 'available', 'active');
    const byId = new Map(dishes.map((d) => [d.id, d]));
    for (const id of ids) {
      const d = byId.get(id);
      if (!d || !d.active) throw new HttpError(400, `Dish ${id} is not on the menu`);
      if (!d.available) throw new HttpError(409, `${d.name} is marked unavailable today`);
    }

    const recipes = await recipesFor(trx, ids);
    const lines = ids.map((id) => {
      const d = byId.get(id);
      const q = qty.get(id);
      const unitCost = (recipes.get(id) || []).reduce((s, r) => s + r.quantity * r.avg_cost, 0);
      return {
        dish_id: id, name: d.name, diet: d.diet, quantity: q,
        unit_price: Number(d.price), line_total: round2(q * Number(d.price)), cost: round2(q * unitCost),
      };
    });

    const totals = computeTotals(lines.map((l) => l.line_total), {
      discount: body.discount, service_rate: body.service_rate, tax_rate: config.billing.taxRate,
    });
    const bill_no = formatBillNo(config.billing.prefix, fy, await nextNumber(trx, `bill:${fy}`));

    const [{ id }] = await trx('bills').insert({
      bill_no,
      financial_year: fy,
      business_date: day,
      status: 'paid',
      source: ctx.source || 'pos',
      order_type: body.order_type,
      table_no: body.table_no,
      customer: body.customer,
      customer_phone: body.customer_phone,
      customer_email: body.customer_email,
      payment_mode: body.payment_mode,
      subtotal: totals.subtotal,
      discount: totals.discount,
      service_rate: body.service_rate,
      service_charge: totals.service_charge,
      taxable: totals.taxable,
      tax_rate: config.billing.taxRate,
      cgst: totals.cgst,
      sgst: totals.sgst,
      round_off: totals.round_off,
      total: totals.total,
      food_cost: round2(lines.reduce((s, l) => s + l.cost, 0)),
      note: body.note,
      created_by: ctx.user_id || null,
      created_at: at,
    }).returning('id');

    await trx('bill_items').insert(lines.map((l) => ({ bill_id: id, ...l })));

    const use = consumption(lines, recipes);
    await applyMovements(
      trx,
      [...use].map(([ingredient_id, q]) => ({ ingredient_id, delta: -q, type: 'sale', ref_type: 'bill', ref_id: id, note: bill_no })),
      { user_id: ctx.user_id, at, allowNegative: ctx.allowNegative },
    );
    return id;
  });
}

// Voids keep the bill (GST invoices must not disappear) and put back exactly what the sale took.
async function voidBill(db, id, reason, ctx = {}) {
  const at = ctx.at || new Date().toISOString();
  await db.transaction(async (trx) => {
    const bill = await trx('bills').where({ id }).first('id', 'bill_no', 'status');
    if (!bill) throw new HttpError(404, 'Bill not found');
    if (bill.status === 'void') throw new HttpError(409, `${bill.bill_no} is already void`);
    const n = await trx('bills').where({ id, status: 'paid' })
      .update({ status: 'void', void_reason: reason, voided_by: ctx.user_id || null, voided_at: at });
    if (!n) throw new HttpError(409, `${bill.bill_no} is already void`);
    const sold = await trx('stock_movements').where({ ref_type: 'bill', ref_id: id, type: 'sale' }).select('ingredient_id', 'quantity');
    await applyMovements(
      trx,
      sold.map((m) => ({ ingredient_id: m.ingredient_id, delta: -Number(m.quantity), type: 'void', ref_type: 'bill', ref_id: id, note: `Void ${bill.bill_no}: ${reason}` })),
      { user_id: ctx.user_id, at, allowNegative: true },
    );
  });
}

module.exports = { billInput, createBill, voidBill, getBill, peekNextBillNo, shapeBill, shapeLine };
