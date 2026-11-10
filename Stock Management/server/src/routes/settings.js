// App settings editable by managers. Currently: UPI payment QR printed on bills.
const express = require('express');
const { z } = require('zod');

// UPI virtual payment address, e.g. vasamo@okhdfcbank, 9876543210@ybl
const VPA = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,64}$/;

const upiSchema = z.object({
  upi_id: z.union([z.string().trim().regex(VPA, 'should look like name@bank, e.g. vasamo@okhdfcbank'), z.literal('')]),
  payee_name: z.string().trim().max(50).default(''),
  enabled: z.boolean(),
  only_upi_bills: z.boolean().default(false),
});

const DEFAULT_UPI = { upi_id: '', payee_name: '', enabled: false, only_upi_bills: false };

async function getUpi(db) {
  const row = await db('app_settings').where({ key: 'upi' }).first();
  let saved = {};
  try { saved = row?.value ? JSON.parse(row.value) : {}; } catch { /* corrupt row: fall back to defaults */ }
  const upi = { ...DEFAULT_UPI, ...saved };
  upi.enabled = upi.enabled && !!upi.upi_id; // no QR without an ID
  return upi;
}

module.exports = function settingsRoutes(db, { requireRole }) {
  const router = express.Router();

  router.get('/upi', async (_req, res) => res.json(await getUpi(db)));

  router.put('/upi', requireRole('manager'), async (req, res) => {
    const data = upiSchema.parse(req.body || {});
    const row = { key: 'upi', value: JSON.stringify(data), updated_by: req.user.id, updated_at: new Date().toISOString() };
    await db('app_settings').insert(row).onConflict('key').merge();
    req.log.info({ by: req.user.username, enabled: data.enabled }, 'UPI settings changed');
    res.json(await getUpi(db));
  });

  return router;
};

module.exports.getUpi = getUpi;
