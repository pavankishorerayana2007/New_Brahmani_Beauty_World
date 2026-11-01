const router = require('express').Router();
const { tx } = require('../config/db');
const { HttpError, asyncHandler } = require('../utils/httpError');
const { parse, z } = require('../middleware/validate');
const { requireRole } = require('../middleware/auth');
const { notify } = require('../services/notify');

router.use(requireRole('owner'));

router.post('/:id/block', asyncHandler(async (req, res) => {
  const b = parse(z.object({ blocked: z.boolean() }), req.body);
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw new HttpError(400, 'Invalid buyer');
  await tx(async (c) => {
    const { rows: [u] } = await c.query("select id from users where id = $1 and role = 'buyer' for update", [req.params.id]);
    if (!u) throw new HttpError(404, 'Buyer not found');
    await c.query('update users set blocked = $1, blocked_at = now() where id = $2', [b.blocked, u.id]);
    await notify(c, u.id, b.blocked ? 'Account restricted' : 'Account restored',
      b.blocked ? 'Your account is blocked from placing new orders. Please contact the store.' : 'You can place orders again.', 'orders');
  });
  res.json({ ok: true });
}));

module.exports = router;
