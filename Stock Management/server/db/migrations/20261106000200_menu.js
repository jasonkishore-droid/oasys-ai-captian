// Menu sections, dishes (what guests order) and recipes (what each portion uses from stock).
exports.up = async (knex) => {
  await knex.schema.createTable('menu_sections', (t) => {
    t.increments('id').primary();
    t.string('name', 80).notNullable().unique();
    t.string('note', 200);
    t.integer('sort_order').notNullable().defaultTo(0);
  });

  await knex.schema.createTable('dishes', (t) => {
    t.increments('id').primary();
    t.integer('section_id').unsigned().notNullable().references('id').inTable('menu_sections').onDelete('RESTRICT');
    t.string('name', 120).notNullable().unique();
    t.decimal('price', 10, 2).notNullable();
    t.string('diet', 10).notNullable(); // veg | nonveg | egg
    t.string('description', 255);
    t.boolean('available').notNullable().defaultTo(true); // false = "86'd" for the day by the kitchen
    t.boolean('active').notNullable().defaultTo(true); // false = removed from the menu (kept for old bills)
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['section_id']);
  });

  await knex.schema.createTable('recipe_lines', (t) => {
    t.increments('id').primary();
    t.integer('dish_id').unsigned().notNullable().references('id').inTable('dishes').onDelete('CASCADE');
    t.integer('ingredient_id').unsigned().notNullable().references('id').inTable('ingredients').onDelete('RESTRICT');
    t.decimal('quantity', 12, 4).notNullable(); // per portion, in the ingredient's unit
    t.unique(['dish_id', 'ingredient_id']);
    t.index(['ingredient_id']);
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('recipe_lines');
  await knex.schema.dropTableIfExists('dishes');
  await knex.schema.dropTableIfExists('menu_sections');
};
