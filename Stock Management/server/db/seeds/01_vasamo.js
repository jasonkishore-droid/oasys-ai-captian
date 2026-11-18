// Oasys Restaurant starter data: staff, suppliers, ~120 ingredients, the 203 dishes from the Menu Card with recipes,
// and (optionally) a couple of weeks of realistic trading so the dashboard and reports have something to show.
//
// Demo trading goes through the real billing/stock services, so every number in the ledger reconciles.
//   SEED_DEMO_DAYS=14   days of history (0 = clean install: opening stock only, no bills)
//   SEED_PASSWORD=...   password for the admin / manager / cashier accounts (required in production)
const bcrypt = require('bcryptjs');
const menu = require('../seed-data/menu.json');
const { SUPPLIERS, INGREDIENTS } = require('../seed-data/ingredients');
const { RECIPES } = require('../seed-data/recipes');
const { applyMovements } = require('../../src/services/stock');
const { createBill, voidBill } = require('../../src/services/billing');
const { businessDate, addDays } = require('../../src/constants');
const { round2, round3 } = require('../../../shared/billing.mjs');

const DEFAULT_PASSWORD = 'Vasamo@123';

// Deterministic randomness so every reseed gives the same demo.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pickWeighted = (rand, items, weight) => {
  const total = items.reduce((s, x) => s + weight(x), 0);
  let r = rand() * total;
  for (const x of items) { r -= weight(x); if (r <= 0) return x; }
  return items[items.length - 1];
};

// India has no DST, so IST is a fixed +05:30.
const istIso = (ymd, hour, minute) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour, minute) - 330 * 60 * 1000).toISOString();
};

const niceQty = (x, unit) => {
  if (unit === 'pcs') return Math.max(1, Math.ceil(x));
  if (x < 1) return Math.max(0.1, Math.ceil(x * 10) / 10);
  if (x < 10) return Math.ceil(x * 2) / 2;
  return Math.ceil(x);
};

// When each section sells (IST hour ranges) and how popular it is.
const SECTION_PROFILE = {
  'Breakfast & Tiffin': { w: 1.5, hours: [[7, 11], [16, 23]] },
  'Dosa Varieties': { w: 1.7, hours: [[7, 11], [16, 23]] },
  'Uthappam & Paniyaram': { w: 0.5, hours: [[7, 11], [16, 23]] },
  'Parotta & Breads': { w: 1.1, hours: [[12, 16], [19, 23]] },
  'Vegetarian Starters': { w: 0.6, hours: [[12, 23]] },
  'Chicken Starters': { w: 1.0, hours: [[12, 16], [19, 23]] },
  'Mutton Starters': { w: 0.35, hours: [[12, 16], [19, 23]] },
  'From the Sea': { w: 0.5, hours: [[12, 16], [19, 23]] },
  'Egg Dishes': { w: 0.4, hours: [[7, 23]] },
  'Vegetarian Gravies': { w: 0.5, hours: [[12, 16], [19, 23]] },
  'Non-Vegetarian Gravies': { w: 0.7, hours: [[12, 16], [19, 23]] },
  'Biryani & Rice': { w: 1.5, hours: [[12, 16], [19, 23]] },
  'Meals': { w: 1.2, hours: [[12, 16]] },
  'Soups & Sides': { w: 0.4, hours: [[12, 23]] },
  'Desserts': { w: 0.45, hours: [[12, 23]] },
  'Beverages': { w: 0.8, hours: [[7, 23]] },
};
const HOUR_WEIGHT = { 7: 2, 8: 3.5, 9: 3.5, 10: 2.5, 11: 1, 12: 2.5, 13: 4, 14: 3.5, 15: 1.5, 16: 1.2, 17: 1.8, 18: 2, 19: 3, 20: 4.5, 21: 4.5, 22: 2.5 };

// Final demo stock as a multiple of par. Most items are comfortable; a few are short so the dashboard has work to show.
const STOCK_STORY = {
  Paneer: 0.6, 'Curry Leaves': 0.5, Prawns: 0.7, 'Cashew Nuts': 0.8, Mushroom: 0.4, 'Coriander Leaves': 0.7,
  'Mutton Brain': 0, 'Banana Flower': 0,
};

exports.seed = async (knex) => {
  const days = Number(process.env.SEED_DEMO_DAYS ?? 14);
  const password = process.env.SEED_PASSWORD || DEFAULT_PASSWORD;
  if (process.env.NODE_ENV === 'production' && password === DEFAULT_PASSWORD) {
    throw new Error('Set SEED_PASSWORD before seeding a production database');
  }
  const started = Date.now();

  for (const t of ['stock_movements', 'bill_items', 'bills', 'purchase_items', 'purchases', 'recipe_lines', 'dishes',
    'menu_sections', 'ingredients', 'suppliers', 'sessions', 'app_settings', 'users', 'counters']) {
    await knex(t).del();
  }

  // ---------- staff ----------
  const hash = await bcrypt.hash(password, 12);
  const now = new Date().toISOString();
  await knex('users').insert([
    { name: 'Owner (Admin)', username: 'admin', role: 'admin', password_hash: hash, created_at: now },
    { name: 'Kitchen Manager', username: 'manager', role: 'manager', password_hash: hash, created_at: now },
    { name: 'Front Desk', username: 'cashier', role: 'cashier', password_hash: hash, created_at: now },
  ]);
  const users = Object.fromEntries((await knex('users').select('id', 'username')).map((u) => [u.username, u.id]));

  // ---------- suppliers & ingredients ----------
  await knex('suppliers').insert(Object.values(SUPPLIERS).map((s) => ({ ...s, created_at: now })));
  const supplierId = Object.fromEntries((await knex('suppliers').select('id', 'name')).map((s) => [s.name, s.id]));
  await knex('ingredients').insert(INGREDIENTS.map(([name, category, unit, cost, sup, storage]) => ({
    name, category, unit, quantity: 0, avg_cost: cost, supplier_id: supplierId[SUPPLIERS[sup].name], storage,
    created_at: now, updated_at: now,
  })));
  const ing = new Map((await knex('ingredients').select('*')).map((i) => [i.name, i]));
  const meta = new Map(INGREDIENTS.map(([name, , unit, cost, sup, , shelf]) => [name, { unit, cost, sup, shelf }]));

  // ---------- menu & recipes ----------
  const missingRecipes = [];
  for (const s of menu.sections) {
    const [{ id: sectionId }] = await knex('menu_sections').insert({ name: s.name, note: s.note, sort_order: s.sort_order }).returning('id');
    for (const d of s.dishes) {
      const [{ id: dishId }] = await knex('dishes').insert({
        section_id: sectionId, name: d.name, price: d.price, diet: d.diet, description: d.description,
        sort_order: d.sort_order, created_at: now, updated_at: now,
      }).returning('id');
      const recipe = RECIPES[d.name];
      if (!recipe) { missingRecipes.push(d.name); continue; }
      const lines = recipe.map(([name, quantity]) => {
        if (!ing.has(name)) throw new Error(`Recipe for "${d.name}" uses unknown ingredient "${name}"`);
        return { dish_id: dishId, ingredient_id: ing.get(name).id, quantity: round3(quantity) || 0.001 };
      });
      await knex('recipe_lines').insert(lines);
    }
  }
  const unused = Object.keys(RECIPES).filter((n) => !menu.sections.some((s) => s.dishes.some((d) => d.name === n)));
  if (missingRecipes.length) console.warn(`  ! ${missingRecipes.length} dish(es) have no recipe (not stock-tracked): ${missingRecipes.join(', ')}`);
  if (unused.length) console.warn(`  ! Recipes for dishes not on the menu: ${unused.join(', ')}`);

  const dishes = await knex('dishes as d').join('menu_sections as s', 's.id', 'd.section_id')
    .select('d.id', 'd.name', 'd.sort_order', 's.name as section');
  const recipeRows = await knex('recipe_lines').select('*');
  const recipeByDish = new Map();
  for (const r of recipeRows) {
    if (!recipeByDish.has(r.dish_id)) recipeByDish.set(r.dish_id, []);
    recipeByDish.get(r.dish_id).push(r);
  }

  // ---------- plan the demo trading ----------
  const rand = rng(20261106);
  const today = businessDate();
  const nowIst = new Date(Date.now() + 330 * 60 * 1000);
  const events = []; // { at, kind, ... } executed in time order
  const use = new Map(); // ingredient_id -> total planned consumption
  const timeline = new Map(); // ingredient_id -> [{ at, delta }]
  const track = (id, at, delta) => {
    if (!timeline.has(id)) timeline.set(id, []);
    timeline.get(id).push({ at, delta });
  };

  for (let back = days; back >= 0 && days > 0; back--) {
    const day = addDays(today, -back);
    const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
    const weekend = dow === 0 || dow === 6;
    let count = Math.round((weekend ? 58 : 40) + rand() * 12);
    if (back === 0) count = Math.round(count * Math.min(1, Math.max(0, (nowIst.getUTCHours() - 7) / 15)));

    for (let b = 0; b < count; b++) {
      const hour = Number(pickWeighted(rand, Object.keys(HOUR_WEIGHT), (h) => HOUR_WEIGHT[h]));
      const minute = Math.floor(rand() * 60);
      if (back === 0 && (hour > nowIst.getUTCHours() || (hour === nowIst.getUTCHours() && minute >= nowIst.getUTCMinutes()))) continue;
      const open = dishes.filter((d) => (SECTION_PROFILE[d.section]?.hours || [[0, 24]]).some(([a, z]) => hour >= a && hour < z));
      const weight = (d) => (SECTION_PROFILE[d.section]?.w || 0.5) / (1 + (d.sort_order - 1) * 0.12);
      const lines = new Map();
      const n = 1 + Math.floor(rand() * rand() * 5);
      for (let k = 0; k < n; k++) {
        const d = pickWeighted(rand, open, weight);
        lines.set(d.id, (lines.get(d.id) || 0) + (rand() < 0.8 ? 1 : 2));
      }
      if (rand() < 0.35) {
        const bev = dishes.filter((d) => d.section === 'Beverages');
        const d = hour < 11 ? bev.find((x) => x.name === 'Filter Coffee') : pickWeighted(rand, bev, weight);
        lines.set(d.id, (lines.get(d.id) || 0) + 1);
      }
      const at = istIso(day, hour, minute);
      const items = [...lines].map(([dish_id, quantity]) => ({ dish_id, quantity }));
      for (const it of items) for (const r of recipeByDish.get(it.dish_id) || []) {
        const q = Number(r.quantity) * it.quantity;
        use.set(r.ingredient_id, (use.get(r.ingredient_id) || 0) + q);
        track(r.ingredient_id, at, -q);
      }
      const takeaway = rand() < 0.22;
      events.push({
        at, kind: 'bill',
        input: {
          items,
          order_type: takeaway ? 'takeaway' : 'dine_in',
          table_no: takeaway ? null : `T${1 + Math.floor(rand() * 18)}`,
          payment_mode: pickWeighted(rand, ['upi', 'cash', 'card'], (m) => ({ upi: 55, cash: 30, card: 15 })[m]),
          discount: rand() < 0.04 ? 50 : 0,
        },
        user: rand() < 0.7 ? users.cashier : users.manager,
      });
    }
  }

  // ---------- par levels from usage ----------
  const tradingDays = Math.max(1, days + 0.5);
  for (const [name, i] of ing) {
    const daily = (use.get(i.id) || 0) / tradingDays;
    const unit = meta.get(name).unit;
    const par = daily > 0 ? niceQty(daily * 2.5, unit) : niceQty(unit === 'pcs' ? 10 : 1, unit);
    i.par_level = par;
    i.reorder_qty = niceQty(par * 1.5, unit);
    await knex('ingredients').where({ id: i.id }).update({ par_level: par, reorder_qty: i.reorder_qty });
  }

  // ---------- deliveries and wastage during the demo period ----------
  const deliveries = days > 0 ? [
    { back: Math.min(days, 7), sups: ['veg', 'dairy', 'meat', 'sea', 'grain', 'spice', 'bev'], invoice: 'A' },
    { back: Math.min(days, 4), sups: ['veg', 'dairy', 'meat', 'sea'], invoice: 'B' },
    { back: 1, sups: ['veg', 'dairy', 'meat'], invoice: 'C' },
  ] : [];
  const purchased = new Map();
  for (const dl of deliveries) {
    const day = addDays(today, -dl.back);
    for (const sup of dl.sups) {
      const lines = [];
      for (const [name, i] of ing) {
        const m = meta.get(name);
        if (m.sup !== sup || !(use.get(i.id) > 0)) continue;
        if (STOCK_STORY[name] !== undefined && dl.back <= 4) continue; // items we "forgot" to reorder this week
        const qty = niceQty(i.reorder_qty, m.unit);
        const unit_cost = round2(m.cost * (0.96 + rand() * 0.08));
        lines.push({ ingredient_id: i.id, quantity: qty, unit_cost, expiry_date: m.shelf ? addDays(day, m.shelf) : null });
        purchased.set(i.id, (purchased.get(i.id) || 0) + qty);
        track(i.id, istIso(day, 7, 30), qty);
      }
      if (lines.length) events.push({ at: istIso(day, 7, 30), kind: 'purchase', supplier_id: supplierId[SUPPLIERS[sup].name], invoice_no: `${sup.toUpperCase()}-${day.replace(/-/g, '').slice(2)}${dl.invoice}`, lines });
    }
  }
  const WASTE = [
    { back: 5, name: 'Milk', qty: 2, note: 'Curdled overnight, fridge door left open' },
    { back: 3, name: 'Coriander Leaves', qty: 0.4, note: 'Wilted' },
    { back: 2, name: 'Anchovies (Nethili)', qty: 0.8, note: 'Not fresh on delivery check' },
    { back: 1, name: 'Tomato', qty: 1.5, note: 'Overripe' },
  ].filter((w) => w.back <= days);
  const wasted = new Map();
  for (const w of WASTE) {
    const i = ing.get(w.name);
    const at = istIso(addDays(today, -w.back), 15, 0);
    events.push({ at, kind: 'wastage', ingredient_id: i.id, qty: w.qty, note: w.note });
    wasted.set(i.id, (wasted.get(i.id) || 0) + w.qty);
    track(i.id, at, -w.qty);
  }

  // ---------- opening stock: end at the target, and (except the story items) never dip below 30% of par ----------
  const openingAt = istIso(addDays(today, -days - 1), 22, 30);
  const openings = [];
  for (const [name, i] of ing) {
    const story = STOCK_STORY[name];
    const rawTarget = i.par_level * (story ?? (1.2 + rand() * 1.4));
    const target = meta.get(name).unit === 'pcs' ? Math.round(rawTarget) : round3(rawTarget);
    let run = 0;
    let lowest = 0;
    for (const e of (timeline.get(i.id) || []).sort((a, b) => a.at.localeCompare(b.at))) { run += e.delta; lowest = Math.min(lowest, run); }
    const floor = story === undefined ? 0.3 * i.par_level : 0;
    let opening = Math.max(target - run, floor - lowest);
    opening = Math.max(0, round3(opening));
    if (opening > 0) openings.push({ ingredient_id: i.id, delta: opening, type: 'opening', note: 'Opening stock' });
  }
  await knex.transaction((trx) => applyMovements(trx, openings, { user_id: users.admin, at: openingAt, allowNegative: true }));

  // ---------- run the demo in time order ----------
  events.sort((a, b) => a.at.localeCompare(b.at));
  const billIds = [];
  for (const e of events) {
    if (e.kind === 'bill') {
      billIds.push({ id: await createBill(knex, e.input, { user_id: e.user, at: e.at, allowNegative: true }), at: e.at });
    } else if (e.kind === 'purchase') {
      await knex.transaction(async (trx) => {
        const lines = e.lines.map((l) => ({ ...l, line_total: round2(l.quantity * l.unit_cost) }));
        const [{ id }] = await trx('purchases').insert({
          supplier_id: e.supplier_id, invoice_no: e.invoice_no, invoice_date: e.at.slice(0, 10),
          business_date: businessDate(new Date(e.at)), total: round2(lines.reduce((s, l) => s + l.line_total, 0)),
          created_by: users.manager, created_at: e.at,
        }).returning('id');
        await trx('purchase_items').insert(lines.map((l) => ({ purchase_id: id, ...l })));
        await applyMovements(trx, lines.map((l) => ({
          ingredient_id: l.ingredient_id, delta: l.quantity, unit_cost: l.unit_cost, type: 'purchase', ref_type: 'purchase', ref_id: id, note: `Invoice ${e.invoice_no}`,
        })), { user_id: users.manager, at: e.at });
      });
    } else if (e.kind === 'wastage') {
      await knex.transaction((trx) => applyMovements(trx, [{ ingredient_id: e.ingredient_id, delta: -e.qty, type: 'wastage', note: e.note }], { user_id: users.manager, at: e.at, allowNegative: true }));
    }
  }

  // Two voided bills, as happens in real service.
  const voids = [
    [Math.floor(billIds.length * 0.55), 'Guest changed order: re-billed'],
    [Math.floor(billIds.length * 0.85), 'Duplicate bill printed by mistake'],
  ];
  for (const [idx, reason] of voids) {
    const b = billIds[idx];
    if (b) await voidBill(knex, b.id, reason, { user_id: users.manager, at: new Date(new Date(b.at).getTime() + 4 * 60 * 1000).toISOString() });
  }

  // ---------- expiry dates for perishables on hand ----------
  const soon = { Milk: 1, 'Anchovies (Nethili)': 1, Curd: 2, Mushroom: 1 };
  for (const [name, i] of ing) {
    const shelf = meta.get(name).shelf;
    if (!shelf) continue;
    // Perishables were delivered this morning (or are restocked daily), so they keep for their full shelf life.
    const exp = soon[name] !== undefined ? addDays(today, soon[name]) : addDays(today, Math.max(3, shelf));
    await knex('ingredients').where({ id: i.id }).update({ expiry_date: exp });
  }

  const billCount = billIds.length;
  console.log(`  Oasys Restaurant seeded: ${ing.size} ingredients, ${dishes.length} dishes, ${recipeRows.length} recipe lines, ` +
    `${billCount} demo bills over ${days} day(s) in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (password === DEFAULT_PASSWORD) console.log(`  Sign in as admin / manager / cashier with password "${DEFAULT_PASSWORD}" (change it after first login)`);
};
