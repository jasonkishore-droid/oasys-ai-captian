// Settings that staff change from the app (as opposed to server/.env), e.g. the UPI ID printed as a QR on bills.
exports.up = (knex) => knex.schema.createTable('app_settings', (t) => {
  t.string('key', 60).primary();
  t.text('value');
  t.integer('updated_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
  t.timestamp('updated_at', { useTz: true });
});

exports.down = (knex) => knex.schema.dropTableIfExists('app_settings');
