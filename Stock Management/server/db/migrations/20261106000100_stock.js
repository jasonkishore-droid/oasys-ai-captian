// Suppliers, ingredients (raw materials) and the stock ledger.
// Every change to an ingredient's quantity writes a row to stock_movements, so the on-hand figure
// can always be explained: opening + purchases − sales + voids − wastage ± adjustments/counts.
exports.up = async (knex) => {
  await knex.schema.createTable('suppliers', (t) => {
    t.increments('id').primary();
    t.string('name', 120).notNullable().unique();
    t.string('contact', 80);
    t.string('phone', 30);
    t.string('email', 254);
    t.string('gstin', 15);
    t.boolean('active').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('ingredients', (t) => {
    t.increments('id').primary();
    t.string('name', 120).notNullable().unique();
    t.string('category', 40).notNullable();
    t.string('unit', 10).notNullable(); // kg | L | pcs — recipes use the same unit
    t.decimal('quantity', 14, 3).notNullable().defaultTo(0); // book stock, maintained only via stock_movements
    t.decimal('par_level', 14, 3).notNullable().defaultTo(0); // reorder point
    t.decimal('reorder_qty', 14, 3).notNullable().defaultTo(0); // usual order size
    t.decimal('avg_cost', 12, 2).notNullable().defaultTo(0); // ₹ per unit, weighted average of purchases
    t.integer('supplier_id').unsigned().references('id').inTable('suppliers').onDelete('SET NULL');
    t.string('storage', 40);
    t.date('expiry_date'); // earliest known expiry of stock on hand
    t.boolean('active').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['category']);
  });

  await knex.schema.createTable('stock_movements', (t) => {
    t.increments('id').primary();
    t.integer('ingredient_id').unsigned().notNullable().references('id').inTable('ingredients').onDelete('RESTRICT');
    t.string('type', 20).notNullable(); // opening | purchase | sale | void | wastage | adjustment | count
    t.decimal('quantity', 14, 3).notNullable(); // signed change
    t.decimal('balance_after', 14, 3).notNullable();
    t.decimal('unit_cost', 12, 2).notNullable().defaultTo(0); // cost at the time (for valuing wastage/sales)
    t.string('ref_type', 20); // bill | purchase
    t.integer('ref_id');
    t.string('note', 255);
    t.integer('user_id').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.date('business_date').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable();
    t.index(['ingredient_id', 'id']);
    t.index(['business_date', 'type']);
    t.index(['ref_type', 'ref_id']);
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('stock_movements');
  await knex.schema.dropTableIfExists('ingredients');
  await knex.schema.dropTableIfExists('suppliers');
};
