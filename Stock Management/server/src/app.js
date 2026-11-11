// Builds the Express app. Kept separate from index.js so tests can mount it without listening.
const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const pinoHttp = require('pino-http');
const config = require('./config');
const logger = require('./logger');
const { HttpError, errorHandler } = require('./errors');
const { UNITS, INGREDIENT_CATEGORIES, ROLES, ORDER_TYPES, PAYMENT_MODES, businessDate } = require('./constants');
const email = require('./services/email');

function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  app.use(helmet({
    contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } }, // plain-HTTP LAN installs must still work
    strictTransportSecurity: config.auth.cookieSecure, // only promise HTTPS when it is actually configured
  }));
  app.use(compression());
  app.use(pinoHttp({
    logger,
    genReqId: (req, res) => {
      const id = req.get('x-request-id') || require('crypto').randomUUID();
      res.setHeader('X-Request-Id', id);
      return id;
    },
    autoLogging: { ignore: (req) => req.url === '/api/health' },
    customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    serializers: { req: (r) => ({ id: r.id, method: r.method, url: r.url }), res: (r) => ({ status: r.statusCode }) },
  }));
  app.use(express.json({ limit: '200kb' }));

  // CSRF defence on top of SameSite cookies: a browser request that changes data must come from our own origin
  // (or an origin listed in CORS_ORIGINS).
  app.use('/api', (req, res, next) => {
    const origin = req.get('origin');
    if (origin) {
      let sameHost = false;
      try { sameHost = new URL(origin).host === req.get('host'); } catch { /* malformed */ }
      const allowed = sameHost || config.corsOrigins.includes(origin);
      if (allowed && !sameHost) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Vary', 'Origin');
        if (req.method === 'OPTIONS') {
          res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Api-Key');
          return res.status(204).end();
        }
      }
      if (!allowed && !['GET', 'HEAD'].includes(req.method)) return next(new HttpError(403, 'Cross-origin request blocked'));
    }
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // ---- public ----
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/ready', async (_req, res) => {
    try {
      await db.raw('select 1');
      res.json({ ok: true, db: db.client.config.client });
    } catch (err) {
      logger.error({ err }, 'readiness check failed');
      res.status(503).json({ ok: false });
    }
  });

  const auth = require('./auth')(db);
  app.use('/api/auth', auth.router);
  app.use('/api/integrations', require('./routes/integrations')(db));

  // ---- signed-in staff ----
  app.use('/api', auth.authenticate);
  const deps = { requireRole: auth.requireRole, publicUser: auth.publicUser };

  app.get('/api/settings', async (_req, res) => res.json({
    upi: await require('./routes/settings').getUpi(db),
    restaurant: config.restaurant,
    business_date: businessDate(),
    timezone: config.timezone,
    tax_rate: config.billing.taxRate,
    default_service_rate: config.billing.defaultServiceRate,
    bill_prefix: config.billing.prefix,
    allow_negative_stock: config.billing.allowNegativeStock,
    expiring_days: config.stock.expiringDays,
    email_configured: email.isConfigured(),
    units: UNITS,
    ingredient_categories: INGREDIENT_CATEGORIES,
    roles: ROLES,
    order_types: ORDER_TYPES,
    payment_modes: PAYMENT_MODES,
  }));

  // Print jobs queued from outside (AI Captain): the tab with the Bluetooth printer collects and reports them.
  const printJobs = require('./services/printJobs');
  // (The path was /api/print-jobs in an earlier build whose page printed a test page for every job.
  // A tab still running that build must not receive jobs, so the path changed with the job format.)
  // The stream is server-sent events: one "data:" line per job, and a comment line every 20 s so
  // proxies keep it open. no-transform stops the compression middleware from buffering it.
  app.get('/api/print-queue/stream', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(': connected\n\n');
    const tab = /^[a-z0-9]{6,40}$/.test(String(req.query.tab || '')) ? String(req.query.tab) : '';
    const leave = printJobs.subscribe((job) => res.write(`data: ${JSON.stringify(job)}\n\n`), tab);
    const beat = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => { clearInterval(beat); leave(); });
  });
  // the tab's printer: connected | connecting | disconnected (shown on the AI Captain's screen)
  app.post('/api/print-queue/status', (req, res) => {
    res.json({ ok: printJobs.setPrinter(String(req.body?.tab || ''), req.body?.status, req.body?.name) });
  });
  app.post('/api/print-queue/:id/claim', (req, res) => res.json({ ok: printJobs.claim(Number(req.params.id)) }));
  app.post('/api/print-queue/:id/done', (req, res) => {
    if (!printJobs.finish(Number(req.params.id), req.body?.ok === true, req.body?.error)) throw new HttpError(404, 'Print job not found');
    res.json({ ok: true });
  });

  app.use('/api/settings', require('./routes/settings')(db, deps));
  app.use('/api', require('./routes/stock')(db, deps));
  app.use('/api', require('./routes/menu')(db, deps));
  app.use('/api/purchases', require('./routes/purchases')(db, deps));
  app.use('/api/bills', require('./routes/bills')(db, deps));
  app.use('/api/reports', require('./routes/reports')(db, deps));
  app.use('/api/users', require('./routes/users')(db, deps));
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

  // ---- the built React app (npm run build) ----
  const dist = path.join(__dirname, '../../client/dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use('/assets', express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '1y' }));
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
