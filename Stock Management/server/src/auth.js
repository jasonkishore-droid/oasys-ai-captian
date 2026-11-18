// Staff login with server-side sessions.
// The browser gets an HttpOnly, SameSite=Lax cookie holding a random token; the database stores only
// its SHA-256, so a leaked database cannot be used to log in. Other clients can send the same token as
// "Authorization: Bearer <token>".
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const config = require('./config');
const { HttpError } = require('./errors');
const { ROLE_LEVEL } = require('./constants');

const COOKIE = 'vasamo_sid';
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser', 10);

const publicUser = (u) => ({
  id: u.id, name: u.name, username: u.username, role: u.role, active: !!u.active,
  last_login_at: u.last_login_at || null, created_at: u.created_at,
});

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function setCookie(res, token, maxAgeSec) {
  const attrs = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (config.auth.cookieSecure) attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
}

const tokenFrom = (req) => {
  const h = req.get('authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : readCookie(req, COOKIE);
};

module.exports = function auth(db) {
  async function authenticate(req, res, next) {
    const token = tokenFrom(req);
    if (!token) return next(new HttpError(401, 'Please sign in'));
    const session = await db('sessions').where({ id: hashToken(token) }).first();
    if (!session || new Date(session.expires_at) <= new Date()) return next(new HttpError(401, 'Your session has expired, please sign in again'));
    const user = await db('users').where({ id: session.user_id }).first();
    if (!user || !user.active) return next(new HttpError(401, 'This account is disabled'));
    req.user = publicUser(user);
    req.sessionId = session.id;
    next();
  }

  const requireRole = (role) => (req, _res, next) =>
    ROLE_LEVEL[req.user?.role] >= ROLE_LEVEL[role] ? next() : next(new HttpError(403, `Only ${role === 'admin' ? 'an' : 'a'} ${role} can do that`));

  const router = express.Router();

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.isTest ? 1000 : 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: 'Too many sign-in attempts. Wait 15 minutes and try again.' },
  });

  const loginSchema = z.object({
    username: z.string().trim().toLowerCase().min(1).max(40),
    password: z.string().min(1).max(200),
  });

  router.post('/login', loginLimiter, async (req, res) => {
    const { username, password } = loginSchema.parse(req.body || {});
    const user = await db('users').where({ username }).first();
    const ok = await bcrypt.compare(password, user?.password_hash || DUMMY_HASH);
    if (!user || !ok || !user.active) throw new HttpError(401, 'Wrong username or password');

    const token = crypto.randomBytes(32).toString('base64url');
    const now = new Date();
    const expires = new Date(now.getTime() + config.auth.sessionHours * 3600 * 1000);
    await db('sessions').where('expires_at', '<', now.toISOString()).del(); // housekeeping
    await db('sessions').insert({
      id: hashToken(token), user_id: user.id, created_at: now.toISOString(), expires_at: expires.toISOString(),
      ip: String(req.ip || '').slice(0, 64), user_agent: String(req.get('user-agent') || '').slice(0, 200),
    });
    await db('users').where({ id: user.id }).update({ last_login_at: now.toISOString() });
    setCookie(res, token, config.auth.sessionHours * 3600);
    res.json({ user: publicUser({ ...user, last_login_at: now.toISOString() }), expires_at: expires.toISOString() });
  });

  router.post('/logout', async (req, res) => {
    const token = tokenFrom(req);
    if (token) await db('sessions').where({ id: hashToken(token) }).del();
    setCookie(res, '', 0);
    res.status(204).end();
  });

  router.get('/me', authenticate, (req, res) => res.json({ user: req.user }));

  const passwordSchema = z.object({
    current_password: z.string().min(1),
    new_password: z.string().min(8, 'must be at least 8 characters').max(200),
  });

  router.post('/password', authenticate, async (req, res) => {
    const { current_password, new_password } = passwordSchema.parse(req.body || {});
    const user = await db('users').where({ id: req.user.id }).first();
    if (!(await bcrypt.compare(current_password, user.password_hash))) throw new HttpError(400, 'Current password is wrong');
    await db('users').where({ id: user.id }).update({ password_hash: await bcrypt.hash(new_password, 12) });
    // Sign out every other device.
    await db('sessions').where({ user_id: user.id }).whereNot({ id: req.sessionId }).del();
    res.json({ ok: true });
  });

  return { router, authenticate, requireRole, publicUser };
};

module.exports.hashPassword = (p) => bcrypt.hash(p, 12);
