// Staff accounts (admin only).
const express = require('express');
const { z } = require('zod');
const { HttpError, notFound, idParam } = require('../errors');
const { ROLES } = require('../constants');
const { hashPassword } = require('../auth');

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/, '3-40 letters, digits, dot, dash or underscore'),
  role: z.enum(ROLES),
  password: z.string().min(8, 'must be at least 8 characters').max(200),
});
const updateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  role: z.enum(ROLES),
  active: z.boolean(),
  password: z.string().min(8, 'must be at least 8 characters').max(200),
}).partial();

module.exports = function userRoutes(db, { requireRole, publicUser }) {
  const router = express.Router();
  router.use(requireRole('admin'));

  router.get('/', async (_req, res) => {
    res.json((await db('users').orderBy('name')).map(publicUser));
  });

  router.post('/', async (req, res) => {
    const { password, ...data } = createSchema.parse(req.body || {});
    const [{ id }] = await db('users').insert({ ...data, password_hash: await hashPassword(password), created_at: new Date().toISOString() }).returning('id');
    res.status(201).json(publicUser(await db('users').where({ id }).first()));
  });

  router.patch('/:id', async (req, res) => {
    const id = idParam(req.params.id, 'User');
    const { password, ...data } = updateSchema.parse(req.body || {});
    const user = await db('users').where({ id }).first();
    if (!user) throw notFound('User');
    const losesAdmin = user.role === 'admin' && user.active && ((data.role && data.role !== 'admin') || data.active === false);
    if (losesAdmin) {
      const admins = await db('users').where({ role: 'admin', active: true }).count({ n: '*' }).first();
      if (Number(admins.n) <= 1) throw new HttpError(409, 'Keep at least one active admin');
    }
    if (id === req.user.id && data.active === false) throw new HttpError(409, "You can't disable your own account");
    await db.transaction(async (trx) => {
      const patch = { ...data };
      if (password) patch.password_hash = await hashPassword(password);
      if (Object.keys(patch).length) await trx('users').where({ id }).update(patch);
      // A password reset or deactivation signs the user out everywhere.
      if (password || data.active === false || data.role) await trx('sessions').where({ user_id: id }).del();
    });
    res.json(publicUser(await db('users').where({ id }).first()));
  });

  return router;
};
