// Menu with live costing: recipe cost per portion, food-cost %, and how many portions the
// current stock can still make (limited by the scarcest ingredient).
const { round2 } = require('../../../shared/billing.mjs');

const bool = (v) => v === true || v === 1 || v === '1';

const shapeDish = (d) => ({
  id: d.id,
  section_id: d.section_id,
  section: d.section,
  name: d.name,
  price: Number(d.price),
  diet: d.diet,
  description: d.description,
  available: bool(d.available),
  active: bool(d.active),
  sort_order: d.sort_order,
});

async function recipesFor(db, dishIds) {
  const q = db('recipe_lines as r')
    .join('ingredients as i', 'i.id', 'r.ingredient_id')
    .select('r.dish_id', 'r.ingredient_id', 'r.quantity', 'i.name', 'i.unit', 'i.quantity as on_hand', 'i.avg_cost')
    .orderBy('r.id');
  if (dishIds) q.whereIn('r.dish_id', dishIds);
  const rows = await q;
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.dish_id)) map.set(r.dish_id, []);
    map.get(r.dish_id).push({
      ingredient_id: r.ingredient_id,
      name: r.name,
      unit: r.unit,
      quantity: Number(r.quantity),
      on_hand: Number(r.on_hand),
      avg_cost: Number(r.avg_cost),
    });
  }
  return map;
}

function costing(dish, recipe = []) {
  const cost = round2(recipe.reduce((s, r) => s + r.quantity * r.avg_cost, 0));
  let portions = null;
  let limited_by = null;
  for (const r of recipe) {
    if (r.quantity <= 0) continue;
    const can = Math.max(0, Math.floor(r.on_hand / r.quantity + 1e-9));
    if (portions === null || can < portions) { portions = can; limited_by = r.name; }
  }
  return {
    cost,
    food_cost_pct: dish.price > 0 && recipe.length ? round2((cost / dish.price) * 100) : null,
    margin: round2(dish.price - cost),
    portions, // null = no recipe, so not stock-tracked
    limited_by,
    recipe_lines: recipe.length,
  };
}

async function listDishes(db, { includeInactive = false, ids } = {}) {
  const q = db('dishes as d')
    .join('menu_sections as s', 's.id', 'd.section_id')
    .select('d.*', 's.name as section', 's.sort_order as section_order')
    .orderBy([{ column: 's.sort_order' }, { column: 'd.sort_order' }, { column: 'd.name' }]);
  if (!includeInactive) q.where('d.active', true);
  if (ids) q.whereIn('d.id', ids);
  const rows = await q;
  const recipes = await recipesFor(db, ids);
  return rows.map((r) => {
    const dish = shapeDish(r);
    return { ...dish, ...costing(dish, recipes.get(r.id)) };
  });
}

async function getDish(db, id) {
  const [dish] = await listDishes(db, { includeInactive: true, ids: [id] });
  if (!dish) return null;
  const recipes = await recipesFor(db, [id]);
  return { ...dish, recipe: recipes.get(id) || [] };
}

module.exports = { listDishes, getDish, recipesFor, costing, shapeDish };
