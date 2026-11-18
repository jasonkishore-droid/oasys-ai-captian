const config = require('./config');
const logger = require('./logger');
const db = require('./db');
const { createApp } = require('./app');

async function main() {
  // Refuse to start against an out-of-date schema rather than fail on the first request.
  const [, pending] = await db.migrate.list();
  if (pending.length) {
    logger.fatal({ pending: pending.map((p) => p.file || p.name || p) }, 'Database has pending migrations: run `npm run setup` (or `npm --prefix server run db:migrate`)');
    process.exit(1);
  }

  const app = createApp(db);
  const server = app.listen(config.port, config.host, () => {
    logger.info({ port: config.port, db: db.client.config.client, env: config.env }, `${config.restaurant.name} stock API on http://localhost:${config.port}`);
  });
  server.keepAliveTimeout = 65_000;

  let closing = false;
  const shutdown = (signal) => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, 'shutting down');
    server.close(async () => {
      await db.destroy().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
