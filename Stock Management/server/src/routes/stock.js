// Ingredients, the stock ledger, and suppliers.
const express = require('express');
const { z } = require('zod');
const config = require('../config');
const { HttpError, notFound, idParam } = require('../errors');
const { UNITS, INGREDIENT_CATEGORIES, MOVEMENT_TYPES, businessDate, addDays } = require('../constants');
const { applyMovements } = require('../services/stock');
const { round2, round3 } = require('../../../shared/billing.mjs');

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');
const optText = (max) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);

function shapeIngredient(row, today = businessDate()) {
  const quantity = Number(row.quantity);
  const par = Number(row.par_level);
  const exp = row.expiry_date ? String(row.expiry_date).slice(0, 10) : null;
  let status = 'in_stock';
  if (quantity <= 0) status = 'out_of_stock';
  else if (quantity < par) status = 'low_stock';
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    unit: row.unit,
    quantity,
    par_level: par,
    reorder_qty: Number(row.reorder_qty),
    avg_cost: Number(row.avg_cost),
    value: round2(Math.max(0, quantity) * Number(row.avg_cost)),
    supplier_id: row.supplier_id,
    supplier: row.supplier || null,
    storage: row.storage,
    expiry_date: exp,
    status,
    expired: !!exp && exp < today,
    expiring_soon: !!exp && exp >= today && exp <= addDays(today, config.stock.expiringDays),
    active: !!row.active,
    used_in: row.used_in !== undefined ? Number(row.used_in) : undefined,
    updated_at: row.updated_at,
  };
}

module.exports = function stockRoutes(db, { requireRole }) {
  const router = express.Router();
  const manager = requireRole('manager');

  const ingredientQuery = () =>
    db('ingredients as i')
      .leftJoin('suppliers as s', 's.id', 'i.supplier_id')
      .select('i.*', 's.name as supplier',
        db('recipe_lines as r').count('*').whereRaw('r.ingredient_id = i.id').as('used_in'));

  const loadIngredient = async (id) => {
    const row = await ingredientQuery().where('i.id', id).first();
    if (!row) throw notFound('Ingredient');
    return shapeIngredient(row);
  };

  // ---------- Ingredients ----------

  router.get('/ingredients', async (req, res) => {
    const q = ingredientQuery().orderBy('i.name');
    if (req.query.include_inactive !== 'true') q.where('i.active', true);
    const today = businessDate();
    res.json((await q).map((r) => shapeIngredient(r, today)));
  });

  router.get('/ingredients/:id', async (req, res) => {
    const id = idParam(req.params.id, 'Ingredient');
    const ingredient = await loadIngredient(id);
    const dishes = await db('recipe_lines as r').join('dishes as d', 'd.id', 'r.dish_id')
      .where('r.ingredient_id', id).where('d.active', true)
      .select('d.id', 'd.name', 'r.quantity').orderBy('d.name');
    res.json({ ...ingredient, dishes: dishes.map((d) => ({ ...d, quantity: Number(d.quantity) })) });
  });

  const ingredientFields = {
    name: z.string().trim().min(1).max(120),
    category: z.enum(INGREDIENT_CATEGORIES),
    unit: z.enum(UNITS),
    par_level: z.coerce.number().min(0).max(1e7),
    reorder_qty: z.coerce.number().min(0).max(1e7),
    avg_cost: z.coerce.number().min(0).max(1e7),
    supplier_id: z.coerce.number().int().positive().nullable(),
    storage: optText(40),
    expiry_date: isoDate.nullable(),
  };
  const createSchema = z.object({
    ...ingredientFields,
    par_level: ingredientFields.par_level.default(0),
    reorder_qty: ingredientFields.reorder_qty.default(0),
    avg_cost: ingredientFields.avg_cost.default(0),
    supplier_id: ingredientFields.supplier_id.optional(),
    expiry_date: ingredientFields.expiry_date.optional(),
    opening_quantity: z.coerce.number().min(0).max(1e7).default(0),
  });
  // Quantity is deliberately not editable here: it only changes through the ledger.
  const updateSchema = z.object({ ...ingredientFields, active: z.boolean() }).partial();

  router.post('/ingredients', manager, async (req, res) => {
    const { opening_quantity, ...data } = createSchema.parse(req.body || {});
    const id = await db.transaction(async (trx) => {
      const now = new Date().toISOString();
      const [{ id }] = await trx('ingredients').insert({ ...data, quantity: 0, created_at: now, updated_at: now }).returning('id');
      if (opening_quantity > 0)
        await applyMovements(trx, [{ ingredient_id: id, delta: opening_quantity, type: 'opening', note: 'Opening stock' }], { user_id: req.user.id });
      return id;
    });
    res.status(201).json(await loadIngredient(id));
  });

  router.put('/ingredients/:id', manager, async (req, res) => {
    const id = idParam(req.params.id, 'Ingredient');
    const data = updateSchema.parse(req.body || {});
    if (data.unit) {
      const cur = await db('ingredients').where({ id }).first('unit');
      if (cur && cur.unit !== data.unit) {
        const used = await db('recipe_lines').where({ ingredient_id: id }).count({ n: '*' }).first();
        if (Number(used.n)) throw new HttpError(409, `Unit can't change while ${used.n} recipe(s) use this ingredient in ${cur.unit}`);
      }
    }
    const n = await db('ingredients').where({ id }).update({ ...data, updated_at: new Date().toISOString() });
    if (!n) throw notFound('Ingredient');
    res.json(await loadIngredient(id));
  });

  // Ingredients with history are archived, never hard-deleted, so the ledger stays complete.
  router.delete('/ingredients/:id', manager, async (req, res) => {
    const id = idParam(req.params.id, 'Ingredient');
    const used = await db('recipe_lines as r').join('dishes as d', 'd.id', 'r.dish_id')
      .where('r.ingredient_id', id).where('d.active', true).select('d.name').limit(5);
    if (used.length) throw new HttpError(409, `Remove it from these recipes first: ${used.map((u) => u.name).join(', ')}`);
    const history = await db('stock_movements').where({ ingredient_id: id }).first('id');
    const n = history
      ? await db('ingredients').where({ id }).update({ active: false, updated_at: new Date().toISOString() })
      : await db.transaction(async (trx) => {
        await trx('recipe_lines').where({ ingredient_id: id }).del();
        return trx('ingredients').where({ id }).del();
      });
    if (!n) throw notFound('Ingredient');
    res.json({ ok: true, archived: !!history });
  });

  // ---------- Stock ledger ----------

  const movementSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('wastage'), quantity: z.coerce.number().positive(), note: z.string().trim().min(3, 'say why it was wasted').max(255) }),
    z.object({ type: z.literal('adjustment'), quantity: z.coerce.number().refine((n) => n !== 0, 'cannot be zero'), note: z.string().trim().min(3, 'give a reason').max(255) }),
    z.object({ type: z.literal('count'), quantity: z.coerce.number().min(0), note: optText(255) }),
  ]);

  router.post('/ingredients/:id/movements', manager, async (req, res) => {
    const id = idParam(req.params.id, 'Ingredient');
    const m = movementSchema.parse(req.body || {});
    const row = await db.transaction(async (trx) => {
      const cur = await trx('ingredients').where({ id }).first('quantity', 'unit');
      if (!cur) throw notFound('Ingredient');
      let delta = m.quantity;
      let note = m.note;
      if (m.type === 'wastage') delta = -m.quantity;
      if (m.type === 'count') {
        delta = round3(m.quantity - Number(cur.quantity));
        note = [`Counted ${m.quantity} ${cur.unit} (book ${round3(cur.quantity)})`, m.note].filter(Boolean).join(' · ');
      }
      const [written] = await applyMovements(trx, [{ ingredient_id: id, delta, type: m.type, note }], { user_id: req.user.id, allowNegative: true });
      return written;
    });
    res.status(201).json({ movement: row || null, ingredient: await loadIngredient(id) });
  });

  // Bulk stock take: [{ ingredient_id, quantity }] counted at close. One transaction for the lot.
  const countSchema = z.object({
    note: optText(255),
    counts: z.array(z.object({ ingredient_id: z.coerce.number().int().positive(), quantity: z.coerce.number().min(0) })).min(1).max(1000),
  });
  router.post('/stock-count', manager, async (req, res) => {
    const { counts, note } = countSchema.parse(req.body || {});
    const result = await db.transaction(async (trx) => {
      const out = [];
      for (const c of counts) {
        const cur = await trx('ingredients').where({ id: c.ingredient_id }).first('quantity', 'unit', 'avg_cost', 'name');
        if (!cur) throw new HttpError(400, `Ingredient ${c.ingredient_id} not found`);
        const delta = round3(c.quantity - Number(cur.quantity));
        await applyMovements(trx, [{
          ingredient_id: c.ingredient_id, delta, type: 'count',
          note: [`Counted ${c.quantity} ${cur.unit} (book ${round3(cur.quantity)})`, note].filter(Boolean).join(' · '),
        }], { user_id: req.user.id, allowNegative: true });
        out.push({ ingredient_id: c.ingredient_id, name: cur.name, variance: delta, variance_value: round2(delta * Number(cur.avg_cost)) });
      }
      return out;
    });
    res.status(201).json({ counted: result.length, variances: result.filter((r) => r.variance !== 0) });
  });

  const movementsQuery = z.object({
    ingredient_id: z.coerce.number().int().positive().optional(),
    type: z.enum(MOVEMENT_TYPES).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    limit: z.coerce.number().int().min(1).max(1000).default(200),
    before_id: z.coerce.number().int().positive().optional(),
  });

  router.get('/movements', async (req, res) => {
    const f = movementsQuery.parse(req.query);
    const q = db('stock_movements as m')
      .join('ingredients as i', 'i.id', 'm.ingredient_id')
      .leftJoin('users as u', 'u.id', 'm.user_id')
      .select('m.*', 'i.name as ingredient', 'i.unit', 'u.name as user')
      .orderBy('m.id', 'desc')
      .limit(f.limit);
    if (f.ingredient_id) q.where('m.ingredient_id', f.ingredient_id);
    if (f.type) q.where('m.type', f.type);
    if (f.from) q.where('m.business_date', '>=', f.from);
    if (f.to) q.where('m.business_date', '<=', f.to);
    if (f.before_id) q.where('m.id', '<', f.before_id);
    const rows = await q;
    res.json(rows.map((r) => ({
      ...r, quantity: Number(r.quantity), balance_after: Number(r.balance_after), unit_cost: Number(r.unit_cost),
      value: round2(Number(r.quantity) * Number(r.unit_cost)),
    })));
  });

  // ---------- Suppliers ----------

  const supplierSchema = z.object({
    name: z.string().trim().min(1).max(120),
    contact: optText(80),
    phone: optText(30),
    email: z.union([z.string().trim().email().max(254), z.literal('')]).optional().nullable().transform((v) => v || null),
    gstin: z.union([z.string().trim().toUpperCase().regex(/^[0-9]{2}[A-Z0-9]{13}$/, 'must be a 15-character GSTIN'), z.literal('')])
      .optional().nullable().transform((v) => v || null),
    active: z.boolean().optional(),
  });

  router.get('/suppliers', async (_req, res) => {
    const rows = await db('suppliers as s')
      .select('s.*', db('ingredients as i').count('*').whereRaw('i.supplier_id = s.id').andWhere('i.active', true).as('ingredient_count'))
      .orderBy('s.name');
    res.json(rows.map((s) => ({ ...s, active: !!s.active, ingredient_count: Number(s.ingredient_count) })));
  });

  router.post('/suppliers', manager, async (req, res) => {
    const data = supplierSchema.parse(req.body || {});
    const [{ id }] = await db('suppliers').insert(data).returning('id');
    res.status(201).json(await db('suppliers').where({ id }).first());
  });

  router.put('/suppliers/:id', manager, async (req, res) => {
    const id = idParam(req.params.id, 'Supplier');
    const n = await db('suppliers').where({ id }).update(supplierSchema.partial().parse(req.body || {}));
    if (!n) throw notFound('Supplier');
    res.json(await db('suppliers').where({ id }).first());
  });

  return router;
};

module.exports.shapeIngredient = shapeIngredient;
