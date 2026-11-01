const bcrypt = require('bcryptjs');
const router = require('express').Router();
const { query, tx } = require('../config/db');
const { HttpError, asyncHandler } = require('../utils/httpError');
const { parse, z, password } = require('../middleware/validate');
const { requireAuth, requireRole, setSession } = require('../middleware/auth');
const { buildState } = require('../services/state');
const ids = require('../utils/ids');

router.use(requireAuth);

// Everything the signed-in user may see (the frontend re-loads this after each action).
router.get('/state', asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await buildState(req.user));
}));

router.patch('/me', asyncHandler(async (req, res) => {
  const b = parse(z.object({
    name: z.string().trim().min(2, 'Enter your name').max(100),
    mobile: z.string().trim().regex(/^(\d{10})?$/, '10 digits'),
    address: z.string().trim().max(300).optional(),
    shop: z.string().trim().min(2, 'Enter your store name').max(100).optional(),
  }), req.body);
  await tx(async (c) => {
    if (req.user.role === 'owner') {
      await c.query('update users set name = $1, mobile = $2 where id = $3', [b.name, b.mobile, req.user.id]);
      if (b.shop) await c.query('update store set shop_name = $1', [b.shop]);
    } else {
      await c.query('update users set name = $1, mobile = $2, address = coalesce($3, address) where id = $4',
        [b.name, b.mobile, b.address ?? null, req.user.id]);
    }
  });
  res.json({ ok: true });
}));

router.post('/me/password', asyncHandler(async (req, res) => {
  const b = parse(z.object({ current: z.string().min(1, 'Required').max(200), next: password }), req.body);
  if (!(await bcrypt.compare(b.current, req.user.password_hash))) {
    throw new HttpError(400, 'Current password is incorrect');
  }
  const hash = await bcrypt.hash(b.next, 12);
  // token_version++ signs out every other device; this session gets a fresh cookie
  const { rows } = await query('update users set password_hash = $1, token_version = token_version + 1 where id = $2 returning *', [hash, req.user.id]);
  setSession(res, rows[0]);
  res.json({ ok: true });
}));

router.post('/wishlist/:pid', requireRole('buyer'), asyncHandler(async (req, res) => {
  const pid = ids.product.from(req.params.pid);
  if (!pid) throw new HttpError(400, 'Invalid product');
  const del = await query('delete from wishlist where user_id = $1 and product_id = $2', [req.user.id, pid]);
  if (del.rowCount) return res.json({ on: false });
  const p = await query('select 1 from products where id = $1 and deleted = false', [pid]);
  if (!p.rowCount) throw new HttpError(404, 'Product not found');
  await query('insert into wishlist (user_id, product_id) values ($1,$2) on conflict do nothing', [req.user.id, pid]);
  res.json({ on: true });
}));

router.post('/notifications/read', asyncHandler(async (req, res) => {
  const b = parse(z.object({ id: z.number().int().positive().optional() }), req.body || {});
  if (b.id) await query('update notifications set is_read = true where id = $1 and user_id = $2', [b.id, req.user.id]);
  else await query('update notifications set is_read = true where user_id = $1 and is_read = false', [req.user.id]);
  res.json({ ok: true });
}));

module.exports = router;
