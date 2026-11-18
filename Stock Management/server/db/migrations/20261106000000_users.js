// Staff accounts and login sessions. Schema-builder only, so it runs unchanged on SQLite and Postgres.
exports.up = async (knex) => {
  await knex.schema.createTable('users', (t) => {
    t.increments('id').primary();
    t.string('name', 80).notNullable();
    t.string('username', 40).notNullable().unique();
    t.string('password_hash', 100).notNullable();
    t.string('role', 20).notNullable(); // admin | manager | cashier
    t.boolean('active').notNullable().defaultTo(true);
    t.timestamp('last_login_at', { useTz: true });
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('sessions', (t) => {
    t.string('id', 64).primary(); // sha256 of the cookie token; the raw token is never stored
    t.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.timestamp('created_at', { useTz: true }).notNullable();
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.string('ip', 64);
    t.string('user_agent', 200);
    t.index(['user_id']);
    t.index(['expires_at']);
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('sessions');
  await knex.schema.dropTableIfExists('users');
};
