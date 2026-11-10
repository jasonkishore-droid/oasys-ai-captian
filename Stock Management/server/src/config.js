// All environment settings in one place, parsed and checked once at startup.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const env = process.env;
const bool = (v, def) => (v === undefined || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));
const num = (v, def) => (v === undefined || v === '' ? def : Number(v));

const isProd = env.NODE_ENV === 'production';

const config = {
  env: env.NODE_ENV || 'development',
  isProd,
  isTest: env.NODE_ENV === 'test',
  port: num(env.PORT, 4020),
  host: env.HOST || '0.0.0.0',
  trustProxy: env.TRUST_PROXY ? (/^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY) : false,
  logLevel: env.LOG_LEVEL || (env.NODE_ENV === 'test' ? 'silent' : 'info'),
  timezone: env.TIMEZONE || 'Asia/Kolkata',
  corsOrigins: (env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),

  restaurant: {
    name: env.RESTAURANT_NAME || 'Vasamo',
    tagline: env.RESTAURANT_TAGLINE || 'South Indian Kitchen',
    address: env.RESTAURANT_ADDRESS || 'Chennai, Tamil Nadu',
    phone: env.RESTAURANT_PHONE || '',
    gstin: env.GSTIN || '',
    fssai: env.FSSAI_LICENSE || '',
  },

  billing: {
    prefix: env.BILL_PREFIX || 'VAS',
    taxRate: num(env.GST_RATE, 5),
    defaultServiceRate: num(env.DEFAULT_SERVICE_RATE, 0),
    // A kitchen's book stock is never exact. When true (default) a sale still goes through if the
    // recipe says an ingredient is short; the ingredient goes negative and shows up on the dashboard.
    allowNegativeStock: bool(env.ALLOW_NEGATIVE_STOCK, true),
  },

  stock: {
    expiringDays: num(env.EXPIRING_DAYS, 2),
  },

  auth: {
    sessionHours: num(env.SESSION_HOURS, 12),
    cookieSecure: bool(env.COOKIE_SECURE, isProd),
  },

  email: {
    resendKey: env.RESEND_API_KEY || '',
    from: env.EMAIL_FROM || 'Vasamo <onboarding@resend.dev>',
    replyTo: env.EMAIL_REPLY_TO || '',
  },

  integrations: {
    apiKey: env.ORDER_API_KEY || '',
    serviceRate: num(env.ORDER_SERVICE_RATE, 0),
  },
};

const problems = [];
if (!Number.isInteger(config.port) || config.port <= 0) problems.push('PORT must be a positive integer');
if (!(config.billing.taxRate >= 0 && config.billing.taxRate <= 28)) problems.push('GST_RATE must be between 0 and 28');
if (!/^[A-Z0-9]{1,6}$/i.test(config.billing.prefix)) problems.push('BILL_PREFIX must be 1-6 letters/digits (GST invoice numbers are max 16 chars)');
if (config.integrations.apiKey && config.integrations.apiKey.length < 24) problems.push('ORDER_API_KEY must be at least 24 characters');
try { new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }); } catch { problems.push(`TIMEZONE "${config.timezone}" is not valid`); }
if (problems.length) {
  throw new Error(`Invalid configuration in server/.env:\n  - ${problems.join('\n  - ')}`);
}

module.exports = config;
