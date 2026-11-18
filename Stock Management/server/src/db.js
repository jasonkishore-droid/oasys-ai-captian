const config = require('../knexfile');

if (config.client === 'pg') {
  // Make Postgres return the same JS types SQLite does.
  const { types } = require('pg');
  types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v))); // NUMERIC -> number
  types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10))); // BIGINT (count) -> number
  types.setTypeParser(1082, (v) => v); // DATE -> 'YYYY-MM-DD' string
}

const db = require('knex')(config);
db.isPg = config.client === 'pg';

module.exports = db;
