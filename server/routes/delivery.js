const router = require('express').Router();
const { tx } = require('../config/db');
const { BLK_MSG } = require('../config/constants');
const { HttpError, asyncHandler } = require('../utils/httpError');
const { parse, z, mobile, flag, location } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { notify } = require('../services/notify');
const P = require('../services/pricing');
const { money } = require('../utils/format');
const ids = require('../utils/ids');

router.use(requireAuth);

// ---- buyer asks the owner to approve a delivery above 10 km ----
router.post('/', requireRole('buyer'), asyncHandler(async (req, res) => {
  const b = parse(z.object({
    lines: z.record(z.string().regex(/^P\d+$/), z.number().int().min(1).max(1000)).refine((o) => Object.keys(o).length >= 1 && Object.keys(o).length <= 50),
    addr: location.extend({ n: z.string().trim().min(2).max(100), m: mobile }),
    cart: flag.optional(),
  }), req.body);
  const addr = {
    n: b.addr.n, m: b.addr.m, a: b.addr.a, c: b.addr.c, p: b.addr.p,
    lat: b.addr.gps ? b.addr.lat ?? null : null, lng: b.addr.gps ? b.addr.lng ?? null : null, gps: b.addr.gps ? 1 : 0,
  };
  const lines = Object.entries(b.lines);
  const id = await tx(async (c) => {
    const { rows: [buyer] } = await c.query('select * from users where id = $1 for update', [req.user.id]);
    if (buyer.blocked) throw new HttpError(403, BLK_MSG);
    const { rows: [store] } = await c.query('select * from store');
    if (!store) throw new HttpError(503, 'The store is not set up yet. Please try again later.');
    const pids = lines.map(([k]) => ids.product.from(k));
    const { rows: prods } = await c.query('select * from products where id = any($1)', [pids]);
    const byId = new Map(prods.map((p) => [p.id, p]));
    let sub = 0;
    const items = lines.map(([k, q]) => {
      const p = byId.get(ids.product.from(k));
      if (!p || p.deleted || !p.active || p.stock < q) throw new HttpError(409, `${p ? p.name : 'An item'} is no longer available`);
      sub += P.fin(p) * q;
      return { id: k, n: p.name, q, pr: P.fin(p) };
    });
    const { km, estimated } = P.distance(store.loc, addr);
    if (!P.isFar(km)) throw new HttpError(400, 'This address is within 10 km, so no approval is needed.');
    const ak = P.addrKey(addr);
    const ik = P.itemsKey(lines);
    const dup = await c.query(
      "select 1 from delivery_requests where buyer_id = $1 and addr_key = $2 and items_key = $3 and status in ('Pending','Approved')",
      [req.user.id, ak, ik]);
    if (dup.rowCount) throw new HttpError(409, 'Request already sent');
    const { rows: [r] } = await c.query(
      `insert into delivery_requests (buyer_id,buyer_name,buyer_mobile,address,addr_key,items_key,items,subtotal,distance_km,estimated,suggested_charge,from_cart)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
      [req.user.id, addr.n, addr.m, JSON.stringify(addr), ak, ik, JSON.stringify(items), sub, km, estimated, P.suggestedFarCharge(km), !!b.cart]);
    const rid = ids.request.to(r.id);
    await notify(c, store.owner_id, `Delivery request ${rid}`, `${addr.n || 'A buyer'} \u00B7 about ${km} km \u00B7 items ${money(sub)}. Approval needed.`, 'req');
    await notify(c, req.user.id, 'Request sent', `Delivery request ${rid} was sent to ${store.shop_name}. You can pay after approval.`, 'orders');
    return r.id;
  });
  res.status(201).json({ id: ids.request.to(id) });
}));

async function pendingRequest(c, idStr) {
  const id = ids.request.from(idStr);
  if (!id) throw new HttpError(400, 'Invalid request');
  const { rows: [r] } = await c.query('select * from delivery_requests where id = $1 for update', [id]);
  if (!r) throw new HttpError(404, 'Request not found');
  if (r.status !== 'Pending') throw new HttpError(409, 'This request was already answered');
  return r;
}

// ---- owner approves (and may change the charge) or rejects ----
router.post('/:id/approve', requireRole('owner'), asyncHandler(async (req, res) => {
  const b = parse(z.object({ charge: z.number({ invalid_type_error: 'Enter a delivery charge (0 or more)' }).int().min(0).max(100000) }), req.body);
  await tx(async (c) => {
    const r = await pendingRequest(c, req.params.id);
    await c.query("update delivery_requests set status = 'Approved', approved_charge = $1, decided_at = now() where id = $2", [b.charge, r.id]);
    await notify(c, r.buyer_id, 'Delivery approved',
      `Owner approved ${ids.request.to(r.id)}. Final delivery charge ${money(b.charge)} \u00B7 grand total ${money(r.subtotal + b.charge)}. Open Orders to continue to checkout.`, 'orders');
  });
  res.json({ ok: true });
}));

router.post('/:id/reject', requireRole('owner'), asyncHandler(async (req, res) => {
  const b = parse(z.object({ note: z.string().trim().max(300).optional() }), req.body || {});
  await tx(async (c) => {
    const r = await pendingRequest(c, req.params.id);
    await c.query("update delivery_requests set status = 'Rejected', note = $1, decided_at = now() where id = $2", [b.note || null, r.id]);
    await notify(c, r.buyer_id, 'Delivery request rejected',
      `Owner could not approve ${ids.request.to(r.id)}${b.note ? ': ' + b.note : '.'}`, 'orders');
  });
  res.json({ ok: true });
}));

module.exports = router;
