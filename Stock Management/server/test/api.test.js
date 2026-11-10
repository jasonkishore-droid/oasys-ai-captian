// End-to-end API tests against an in-memory SQLite database (real migrations + seed, small demo history).
process.env.NODE_ENV = 'test';
process.env.SQLITE_FILE = ':memory:';
process.env.DB_CLIENT = 'sqlite';
process.env.SEED_DEMO_DAYS = '2';
process.env.SEED_PASSWORD = 'test-password-1';
process.env.ORDER_API_KEY = 'test-integration-key-0123456789';
process.env.ALLOW_NEGATIVE_STOCK = 'true';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('../src/db');
const { createApp } = require('../src/app');
const { computeTotals, financialYear, formatBillNo } = require('../../shared/billing.mjs');

let app;
const agents = {};
const PASSWORD = process.env.SEED_PASSWORD;

before(async () => {
  await db.migrate.latest();
  await db.seed.run();
  app = createApp(db);
  for (const u of ['admin', 'manager', 'cashier']) {
    agents[u] = request.agent(app);
    const r = await agents[u].post('/api/auth/login').send({ username: u, password: PASSWORD });
    assert.equal(r.status, 200, `login ${u}`);
  }
});
after(() => db.destroy());

const dishByName = async (name) => (await agents.cashier.get('/api/dishes')).body.find((d) => d.name === name);
const ingredientByName = async (name) => (await agents.manager.get('/api/ingredients')).body.find((i) => i.name === name);

// ---------- pure billing math ----------
test('GST totals: discount, service charge, CGST/SGST split and rupee round-off', () => {
  const t = computeTotals([110, 45.5], { discount: 10, service_rate: 5, tax_rate: 5 });
  assert.equal(t.subtotal, 155.5);
  assert.equal(t.service_charge, 7.28); // 5% of 145.5
  assert.equal(t.taxable, 152.78);
  assert.equal(t.cgst, 3.82);
  assert.equal(t.sgst, 3.82);
  assert.equal(t.total, 160);
  assert.equal(t.round_off, -0.42);
  assert.equal(computeTotals([100], { discount: 500 }).discount, 100, 'discount is capped at subtotal');
});

test('financial year and GST invoice number format', () => {
  assert.equal(financialYear('2026-11-06'), '2026-27');
  assert.equal(financialYear('2027-03-31'), '2026-27');
  assert.equal(financialYear('2027-04-01'), '2027-28');
  const no = formatBillNo('VAS', '2026-27', 42);
  assert.equal(no, 'VAS/2627/00042');
  assert.ok(no.length <= 16);
});

// ---------- auth ----------
test('rejects anonymous access and bad passwords', async () => {
  assert.equal((await request(app).get('/api/ingredients')).status, 401);
  assert.equal((await request(app).post('/api/auth/login').send({ username: 'admin', password: 'nope' })).status, 401);
  const me = await agents.cashier.get('/api/auth/me');
  assert.equal(me.body.user.role, 'cashier');
  assert.equal(me.body.user.password_hash, undefined);
});

test('login cookie is HttpOnly and SameSite', async () => {
  const r = await request(app).post('/api/auth/login').send({ username: 'cashier', password: PASSWORD });
  const cookie = r.headers['set-cookie'][0];
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
});

test('roles: cashier cannot receive stock, void bills or manage users', async () => {
  assert.equal((await agents.cashier.post('/api/purchases').send({ items: [] })).status, 403);
  assert.equal((await agents.cashier.post('/api/bills/1/void').send({ reason: 'test' })).status, 403);
  assert.equal((await agents.manager.get('/api/users')).status, 403);
  assert.equal((await agents.admin.get('/api/users')).status, 200);
});

test('cross-origin writes are blocked', async () => {
  const r = await agents.cashier.post('/api/bills').set('Origin', 'https://evil.example').send({});
  assert.equal(r.status, 403);
});

// ---------- menu & costing ----------
test('menu comes from the Menu Card with recipes and live costing', async () => {
  const dishes = (await agents.cashier.get('/api/dishes')).body;
  assert.equal(dishes.length, 203);
  const dosa = dishes.find((d) => d.name === 'Masala Dosa');
  assert.equal(dosa.price, 110);
  assert.equal(dosa.diet, 'veg');
  assert.ok(dosa.recipe_lines > 5);
  assert.ok(dosa.cost > 10 && dosa.cost < 60, `masala dosa cost ${dosa.cost}`);
  assert.ok(dosa.portions > 0);
  assert.ok(dishes.every((d) => d.recipe_lines > 0), 'every dish has a recipe');
});

// ---------- billing deducts stock ----------
test('a bill deducts recipe ingredients, and a void puts them back', async () => {
  const dish = await dishByName('Chicken Biryani');
  const full = (await agents.cashier.get(`/api/dishes/${dish.id}`)).body;
  const chickenLine = full.recipe.find((r) => r.name === 'Chicken Curry Cut');
  const before = (await ingredientByName('Chicken Curry Cut')).quantity;

  const r = await agents.cashier.post('/api/bills').send({ payment_mode: 'upi', table_no: 'T4', items: [{ dish_id: dish.id, quantity: 3 }] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const bill = r.body;
  assert.match(bill.bill_no, /^VAS\/\d{4}\/\d{5}$/);
  assert.equal(bill.subtotal, 3 * dish.price);
  assert.equal(bill.cgst, bill.sgst);
  assert.equal(bill.total, Math.round(bill.taxable * 1.05));
  assert.ok(bill.food_cost > 0);

  const afterSale = (await ingredientByName('Chicken Curry Cut')).quantity;
  assert.ok(Math.abs(before - afterSale - 3 * chickenLine.quantity) < 0.002, `deducted ${before - afterSale}`);

  const v = await agents.manager.post(`/api/bills/${bill.id}/void`).send({ reason: 'Wrong table' });
  assert.equal(v.status, 200);
  assert.equal(v.body.status, 'void');
  assert.ok(Math.abs((await ingredientByName('Chicken Curry Cut')).quantity - before) < 0.002);
  assert.equal((await agents.manager.post(`/api/bills/${bill.id}/void`).send({ reason: 'again' })).status, 409);
});

test('bill numbers are consecutive and prices come from the database', async () => {
  const dish = await dishByName('Filter Coffee');
  const a = (await agents.cashier.post('/api/bills').send({ payment_mode: 'cash', items: [{ dish_id: dish.id, quantity: 1, unit_price: 1 }] })).body;
  const b = (await agents.cashier.post('/api/bills').send({ payment_mode: 'cash', items: [{ dish_id: dish.id, quantity: 2 }] })).body;
  assert.equal(a.items[0].unit_price, 45, 'client-supplied price ignored');
  assert.equal(Number(b.bill_no.slice(-5)), Number(a.bill_no.slice(-5)) + 1);
});

test('validation errors are clear', async () => {
  const r = await agents.cashier.post('/api/bills').send({ payment_mode: 'cash', items: [] });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /at least one dish/i);
  const bad = await agents.cashier.post('/api/bills').send({ payment_mode: 'bitcoin', items: [{ dish_id: 1, quantity: 1 }] });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /payment_mode/);
});

test('an 86\'d dish cannot be billed', async () => {
  const dish = await dishByName('Rava Kesari');
  assert.equal((await agents.cashier.patch(`/api/dishes/${dish.id}/availability`).send({ available: false })).status, 200);
  const r = await agents.cashier.post('/api/bills').send({ payment_mode: 'cash', items: [{ dish_id: dish.id, quantity: 1 }] });
  assert.equal(r.status, 409);
  await agents.cashier.patch(`/api/dishes/${dish.id}/availability`).send({ available: true });
});

// ---------- stock ----------
test('purchase adds stock and updates weighted-average cost', async () => {
  const ing = await ingredientByName('Ghee');
  const qty = ing.quantity;
  const r = await agents.manager.post('/api/purchases').send({
    invoice_no: 'T-1', items: [{ ingredient_id: ing.id, quantity: qty, unit_cost: ing.avg_cost + 100, expiry_date: '2099-01-01' }],
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const after = await ingredientByName('Ghee');
  assert.ok(Math.abs(after.quantity - 2 * qty) < 0.002);
  assert.ok(Math.abs(after.avg_cost - (ing.avg_cost + 50)) < 0.02, `avg ${after.avg_cost}`);
});

test('wastage needs a reason; stock count records the variance', async () => {
  const ing = await ingredientByName('Tomato');
  assert.equal((await agents.manager.post(`/api/ingredients/${ing.id}/movements`).send({ type: 'wastage', quantity: 1 })).status, 400);
  const w = await agents.manager.post(`/api/ingredients/${ing.id}/movements`).send({ type: 'wastage', quantity: 1, note: 'Spoilt' });
  assert.equal(w.status, 201);
  assert.ok(Math.abs(w.body.ingredient.quantity - (ing.quantity - 1)) < 0.002);

  const c = await agents.manager.post(`/api/ingredients/${ing.id}/movements`).send({ type: 'count', quantity: 5 });
  assert.equal(c.status, 201);
  assert.equal(c.body.ingredient.quantity, 5);
  assert.equal(c.body.movement.type, 'count');
});

test('ingredient quantity cannot be edited directly', async () => {
  const ing = await ingredientByName('Salt');
  const r = await agents.manager.put(`/api/ingredients/${ing.id}`).send({ quantity: 9999, par_level: 3 });
  assert.equal(r.status, 200);
  assert.equal(r.body.quantity, ing.quantity);
  assert.equal(r.body.par_level, 3);
});

test('every ingredient quantity equals the sum of its ledger', async () => {
  const rows = await db('ingredients as i')
    .leftJoin(db('stock_movements').select('ingredient_id').sum({ s: 'quantity' }).groupBy('ingredient_id').as('m'), 'm.ingredient_id', 'i.id')
    .select('i.name', 'i.quantity', 'm.s');
  const off = rows.filter((r) => Math.abs(Number(r.quantity) - Number(r.s || 0)) > 0.001);
  assert.deepEqual(off, []);
});

test('recipe edit changes cost and is validated', async () => {
  const dish = await dishByName('Kulfi');
  const kulfi = await ingredientByName('Kulfi');
  const r = await agents.manager.put(`/api/dishes/${dish.id}`).send({ recipe: [{ ingredient_id: kulfi.id, quantity: 2 }] });
  assert.equal(r.status, 200);
  assert.equal(r.body.cost, Math.round(2 * kulfi.avg_cost * 100) / 100);
  const dup = await agents.manager.put(`/api/dishes/${dish.id}`).send({ recipe: [{ ingredient_id: kulfi.id, quantity: 1 }, { ingredient_id: kulfi.id, quantity: 1 }] });
  assert.equal(dup.status, 400);
});

// ---------- reports ----------
test('dashboard and reports respond with consistent numbers', async () => {
  const d = (await agents.cashier.get('/api/reports/dashboard')).body;
  assert.equal(d.by_day.length, 14);
  assert.ok(d.stock.ingredients > 100);
  const s = (await agents.manager.get('/api/reports/sales')).body;
  assert.ok(s.summary.bills > 0);
  const byPay = s.by_payment.reduce((t, p) => t + p.total, 0);
  assert.ok(Math.abs(byPay - s.summary.total_collected) < 0.01);
  const st = (await agents.manager.get('/api/reports/stock')).body;
  for (const r of st.rows) {
    const calc = r.opening + r.purchased - r.consumed - r.wasted + r.adjusted;
    assert.ok(Math.abs(calc - r.closing) < 0.01, `${r.name}: ${calc} vs ${r.closing}`);
  }
  assert.equal((await agents.cashier.get('/api/reports/sales')).status, 403);
});

// ---------- integrations ----------
test('integration API needs the key and matches spoken dish names', async () => {
  assert.equal((await request(app).get('/api/integrations/menu')).status, 401);
  const key = { 'X-Api-Key': process.env.ORDER_API_KEY };
  const menu = await request(app).get('/api/integrations/menu?search=dosa').set(key);
  assert.equal(menu.status, 200);
  assert.ok(menu.body.dishes.length > 10);

  const quote = await request(app).post('/api/integrations/orders').set(key).send({
    dry_run: true, items: [{ name: 'two masala dosas', quantity: 2 }, { name: 'filter kaapi', quantity: 1 }, { name: 'chicken briyani', quantity: 1 }],
  });
  assert.equal(quote.status, 200, JSON.stringify(quote.body));
  assert.deepEqual(quote.body.lines.map((l) => l.name).sort(), ['Chicken Biryani', 'Filter Coffee', 'Masala Dosa']);

  const amb = await request(app).post('/api/integrations/orders').set(key).send({ dry_run: true, items: [{ name: 'dosa' }] });
  assert.equal(amb.status, 422);
  assert.equal(amb.body.problems[0].problem, 'ambiguous');

  const order = await request(app).post('/api/integrations/orders').set(key).send({ table_no: 'T9', items: [{ name: 'ghee roast' }] });
  assert.equal(order.status, 201);
  assert.equal(order.body.bill.source, 'ai-captain');
  const feed = await request(app).get(`/api/integrations/orders?since_id=${order.body.bill.id - 1}`).set(key);
  assert.equal(feed.body.orders[0].items[0].name, 'Ghee Roast');
});

// ---------- users ----------
test('admin can add staff; last admin cannot be demoted', async () => {
  const r = await agents.admin.post('/api/users').send({ name: 'Ravi', username: 'ravi', role: 'cashier', password: 'longenough1' });
  assert.equal(r.status, 201);
  assert.equal((await request(app).post('/api/auth/login').send({ username: 'ravi', password: 'longenough1' })).status, 200);
  const admin = (await agents.admin.get('/api/users')).body.find((u) => u.username === 'admin');
  assert.equal((await agents.admin.patch(`/api/users/${admin.id}`).send({ role: 'manager' })).status, 409);
});

// ---------- UPI QR settings ----------
test('UPI settings: managers set a valid VPA, cashiers cannot, and it reaches /api/settings', async () => {
  assert.equal((await agents.cashier.put('/api/settings/upi').send({ upi_id: 'vasamo@okhdfcbank', enabled: true })).status, 403);
  const bad = await agents.manager.put('/api/settings/upi').send({ upi_id: 'not a vpa', enabled: true });
  assert.equal(bad.status, 400);
  const ok = await agents.manager.put('/api/settings/upi').send({ upi_id: 'vasamo@okhdfcbank', payee_name: 'Vasamo', enabled: true });
  assert.equal(ok.status, 200);
  const s = (await agents.cashier.get('/api/settings')).body;
  assert.deepEqual(s.upi, { upi_id: 'vasamo@okhdfcbank', payee_name: 'Vasamo', enabled: true, only_upi_bills: false });
  const off = await agents.manager.put('/api/settings/upi').send({ upi_id: '', enabled: true });
  assert.equal(off.body.enabled, false, 'no QR without an ID');
});
