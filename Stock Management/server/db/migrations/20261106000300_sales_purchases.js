// GST bills, purchase receipts (GRN) and gap-free counters.
exports.up = async (knex) => {
  await knex.schema.createTable('counters', (t) => {
    t.string('name', 40).primary(); // e.g. 'bill:2026-27' — bill numbers restart each financial year
    t.integer('value').notNullable().defaultTo(0);
  });

  await knex.schema.createTable('bills', (t) => {
    t.increments('id').primary();
    t.string('bill_no', 16).notNullable().unique();
    t.string('financial_year', 7).notNullable();
    t.date('business_date').notNullable();
    t.string('status', 10).notNullable().defaultTo('paid'); // paid | void (bills are never deleted)
    t.string('source', 20).notNullable().defaultTo('pos'); // pos | ai-captain | …
    t.string('order_type', 12).notNullable().defaultTo('dine_in'); // dine_in | takeaway | delivery
    t.string('table_no', 20);
    t.string('customer', 120);
    t.string('customer_phone', 20);
    t.string('customer_email', 254);
    t.string('payment_mode', 10).notNullable(); // cash | upi | card
    t.decimal('subtotal', 12, 2).notNullable();
    t.decimal('discount', 12, 2).notNullable().defaultTo(0);
    t.decimal('service_rate', 5, 2).notNullable().defaultTo(0);
    t.decimal('service_charge', 12, 2).notNullable().defaultTo(0);
    t.decimal('taxable', 12, 2).notNullable();
    t.decimal('tax_rate', 5, 2).notNullable();
    t.decimal('cgst', 12, 2).notNullable();
    t.decimal('sgst', 12, 2).notNullable();
    t.decimal('round_off', 6, 2).notNullable().defaultTo(0);
    t.decimal('total', 12, 2).notNullable();
    t.decimal('food_cost', 12, 2).notNullable().defaultTo(0); // theoretical recipe cost at sale time
    t.string('note', 255);
    t.string('void_reason', 255);
    t.integer('voided_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('voided_at', { useTz: true });
    t.timestamp('emailed_at', { useTz: true });
    t.integer('created_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable();
    t.index(['business_date', 'status']);
  });

  await knex.schema.createTable('bill_items', (t) => {
    t.increments('id').primary();
    t.integer('bill_id').unsigned().notNullable().references('id').inTable('bills').onDelete('CASCADE');
    t.integer('dish_id').unsigned().references('id').inTable('dishes').onDelete('SET NULL');
    // Snapshot at sale time, so old bills stay correct if the dish changes later.
    t.string('name', 120).notNullable();
    t.string('diet', 10).notNullable();
    t.integer('quantity').notNullable();
    t.decimal('unit_price', 10, 2).notNullable();
    t.decimal('line_total', 12, 2).notNullable();
    t.decimal('cost', 12, 2).notNullable().defaultTo(0);
    t.index(['bill_id']);
    t.index(['dish_id']);
  });

  await knex.schema.createTable('purchases', (t) => {
    t.increments('id').primary();
    t.integer('supplier_id').unsigned().references('id').inTable('suppliers').onDelete('SET NULL');
    t.string('invoice_no', 40);
    t.date('invoice_date');
    t.date('business_date').notNullable();
    t.decimal('total', 12, 2).notNullable();
    t.string('note', 255);
    t.integer('created_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable();
    t.index(['business_date']);
  });

  await knex.schema.createTable('purchase_items', (t) => {
    t.increments('id').primary();
    t.integer('purchase_id').unsigned().notNullable().references('id').inTable('purchases').onDelete('CASCADE');
    t.integer('ingredient_id').unsigned().notNullable().references('id').inTable('ingredients').onDelete('RESTRICT');
    t.decimal('quantity', 14, 3).notNullable();
    t.decimal('unit_cost', 12, 2).notNullable();
    t.decimal('line_total', 12, 2).notNullable();
    t.date('expiry_date');
    t.index(['purchase_id']);
  });
};

exports.down = async (knex) => {
  for (const t of ['purchase_items', 'purchases', 'bill_items', 'bills', 'counters']) await knex.schema.dropTableIfExists(t);
};
