const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const client = (process.env.DB_CLIENT || 'sqlite').toLowerCase();

const shared = {
  migrations: { directory: path.join(__dirname, 'db/migrations') },
  seeds: { directory: path.join(__dirname, 'db/seeds') },
};

const sqliteFile = process.env.SQLITE_FILE || './db/vasamo.sqlite3';

const configs = {
  sqlite: {
    client: 'better-sqlite3',
    connection: { filename: sqliteFile === ':memory:' ? ':memory:' : path.resolve(__dirname, sqliteFile) },
    useNullAsDefault: true,
    pool: {
      afterCreate(conn, done) {
        conn.pragma('foreign_keys = ON');
        conn.pragma('journal_mode = WAL'); // readers don't block the till while reports run
        conn.pragma('busy_timeout = 5000');
        done();
      },
    },
    ...shared,
  },
  pg: {
    client: 'pg',
    connection: {
      connectionString: process.env.DATABASE_URL,
      ...(process.env.DB_SSL === 'true' && { ssl: { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' } }),
    },
    pool: { min: 0, max: Number(process.env.DB_POOL_MAX || 10) },
    ...shared,
  },
};

if (!configs[client]) throw new Error(`Unsupported DB_CLIENT "${client}" (use sqlite or pg)`);

module.exports = configs[client];
