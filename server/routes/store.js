const router = require('express').Router();
const { query } = require('../config/db');
const { HttpError, asyncHandler } = require('../utils/httpError');
const { parse, z, location } = require('../middleware/validate');
const { requireRole } = require('../middleware/auth');
const { removePublic } = require('../services/storage');

router.use(requireRole('owner'));

router.put('/location', asyncHandler(async (req, res) => {
  const b = parse(location, req.body);
  const loc = { a: b.a, c: b.c, p: b.p, lat: b.gps ? b.lat ?? null : null, lng: b.gps ? b.lng ?? null : null, gps: b.gps ? 1 : 0 };
  const r = await query('update store set loc = $1', [JSON.stringify(loc)]);
  if (!r.rowCount) throw new HttpError(503, 'Store is not set up yet. Run: npm run owner:seed');
  res.json({ ok: true });
}));

router.post('/cod', asyncHandler(async (req, res) => {
  const b = parse(z.object({ on: z.boolean() }), req.body);
  await query('update store set cod_enabled = $1', [b.on]);
  res.json({ ok: true });
}));

router.post('/pause', asyncHandler(async (req, res) => {
  const b = parse(z.object({ paused: z.boolean(), message: z.string().trim().max(300).optional() }), req.body);
  if (b.paused) {
    if (!b.message || b.message.length < 3) throw new HttpError(400, 'Write a short message for buyers');
    await query('update store set paused = true, pause_message = $1, paused_since = now()', [b.message]);
  } else {
    await query("update store set paused = false, pause_message = '', paused_since = null");
  }
  res.json({ ok: true });
}));

router.delete('/qr', asyncHandler(async (_req, res) => {
  const { rows: [s] } = await query('select qr_path from store');
  await query('update store set qr_url = null, qr_path = null');
  if (s) await removePublic(s.qr_path);
  res.json({ ok: true });
}));

module.exports = router;
