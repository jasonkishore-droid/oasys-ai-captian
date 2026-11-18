const pino = require('pino');
const config = require('./config');

module.exports = pino({
  level: config.logLevel,
  base: { app: 'vasamo-stock' },
  redact: {
    paths: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-api-key"]', 'res.headers["set-cookie"]'],
    censor: '[redacted]',
  },
});
