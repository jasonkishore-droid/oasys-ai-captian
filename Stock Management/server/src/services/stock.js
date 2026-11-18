// The only code that changes ingredient quantities. Each change is one atomic UPDATE plus a
// ledger row, inside the caller's transaction, so stock and its history can never disagree.
const config = require('../config');
const { HttpError } = require('../errors');
const { businessDate } = require('../constants');
const { round3 } = require('../../../shared/billing.mjs');

const fmtQty = (n, unit) => `${round3(n)} ${unit}`;

/**
 * @param trx   knex transaction
 * @param moves [{ ingredient_id, delta, type, unit_cost?, ref_type?, ref_id?, note? }]
 *              Purchases pass unit_cost, which updates the weighted-average cost.
 * @param ctx   { user_id, at?: ISO string, allowNegative?: boolean }
 * @returns     the movement rows written
 */
async function applyMovements(trx, moves, ctx = {}) {
  const at = ctx.at || new Date().toISOString();
  const day = businessDate(new Date(at));
  const allowNegative = ctx.allowNegative ?? config.billing.allowNegativeStock;
  const written = [];

  for (const m of moves) {
    const delta = round3(m.delta);
    if (!Number.isFinite(delta)) throw new HttpError(400, 'Stock change must be a number');
    if (delta === 0 && m.type !== 'count') continue;

    const before = await trx('ingredients').where({ id: m.ingredient_id }).first('id', 'name', 'unit', 'quantity', 'avg_cost');
    if (!before) throw new HttpError(400, `Ingredient ${m.ingredient_id} not found`);

    const patch = { quantity: trx.raw('ROUND(quantity + ?, 3)', [delta]), updated_at: at };
    if (m.type === 'purchase' && delta > 0) {
      // Weighted average: (on hand × avg + received × price) / (on hand + received). If the shelf was
      // empty (or negative), the new price simply becomes the average.
      const price = Number(m.unit_cost) || 0;
      patch.avg_cost = trx.raw(
        'ROUND(CASE WHEN quantity <= 0 THEN ? ELSE (quantity * avg_cost + ? * ?) / (quantity + ?) END, 2)',
        [price, delta, price, delta],
      );
    }
    await trx('ingredients').where({ id: m.ingredient_id }).update(patch);
    const after = await trx('ingredients').where({ id: m.ingredient_id }).first('quantity', 'avg_cost');
    const balance = Number(after.quantity);

    if (delta < 0 && balance < 0 && !allowNegative) {
      throw new HttpError(409, `Not enough ${before.name}: need ${fmtQty(-delta, before.unit)}, have ${fmtQty(before.quantity, before.unit)}`, {
        ingredient_id: before.id, needed: -delta, on_hand: Number(before.quantity),
      });
    }

    const row = {
      ingredient_id: m.ingredient_id,
      type: m.type,
      quantity: delta,
      balance_after: balance,
      unit_cost: m.type === 'purchase' ? Number(m.unit_cost) || 0 : Number(before.avg_cost),
      ref_type: m.ref_type || null,
      ref_id: m.ref_id || null,
      note: m.note ? String(m.note).slice(0, 255) : null,
      user_id: ctx.user_id || null,
      business_date: day,
      created_at: at,
    };
    await trx('stock_movements').insert(row);
    written.push(row);
  }
  return written;
}

// Sum recipe usage per ingredient for a set of { dish_id, quantity } lines.
function consumption(lines, recipeByDish) {
  const use = new Map();
  for (const l of lines) {
    for (const r of recipeByDish.get(l.dish_id) || []) {
      use.set(r.ingredient_id, (use.get(r.ingredient_id) || 0) + Number(r.quantity) * l.quantity);
    }
  }
  return use;
}

module.exports = { applyMovements, consumption };
