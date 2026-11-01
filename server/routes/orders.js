const router = require('express').Router();
const { tx, query } = require('../config/db');
const { BLK_MSG, LOW_STOCK } = require('../config/constants');
const { HttpError, asyncHandler } = require('../utils/httpError');
const { parse, z, mobile, flag, location } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { notify } = require('../services/notify');
const { signedProofUrl } = require('../services/storage');
const P = require('../services/pricing');
const { money } = require('../utils/format');
const ids = require('../utils/ids');

router.use(requireAuth);

const FLOW = ['Confirmed', 'Packed', 'Shipped', 'Delivered'];

const orderSchema = z.object({
  lines: z.record(z.string().regex(/^P\d+$/, 'Invalid product'), z.number().int().min(1).max(1000))
    .refine((o) => { const n = Object.keys(o).length; return n >= 1 && n <= 50; }, 'Your bag is empty'),
  addr: location.extend({ n: z.string().trim().min(2, 'Required').max(100), m: mobile }),
  pm: z.enum(['cod', 'upi']),
  ref: z.string().trim().regex(/^[A-Za-z0-9]{8,22}$/, 'Enter 8\u201322 letters or digits').optional(),
  proof: z.string().max(300).optional(),
  cart: flag.optional(),
});

/** Move an order to a new status, recording the timestamp. `sets` = extra columns. */
async function moveTo(c, orderId, status, sets = {}) {
  const cols = Object.keys(sets);
  const extra = cols.map((k, i) => `, ${k} = $${i + 3}`).join('');
  await c.query(`update orders set status = $2${extra} where id = $1`, [orderId, status, ...cols.map((k) => sets[k])]);
  await c.query('insert into order_events (order_id, status) values ($1,$2)', [orderId, status]);
}

async function lockOrder(c, idStr) {
  const id = ids.order.from(idStr);
  if (!id) throw new HttpError(400, 'Invalid order');
  const { rows: [o] } = await c.query('select * from orders where id = $1 for update', [id]);
  if (!o) throw new HttpError(404, 'Order not found');
  return o;
}

// ---------------- place an order (buyer) ----------------
router.post('/', requireRole('buyer'), asyncHandler(async (req, res) => {
  const b = parse(orderSchema, req.body);
  const upi = b.pm === 'upi';
  if (upi) {
    if (!b.ref) throw new HttpError(400, 'Enter 8\u201322 letters or digits');
    if (!b.proof || !b.proof.startsWith(`proofs/${req.user.id}/`)) throw new HttpError(400, 'Upload a screenshot of your payment');
  }
  const addr = {
    n: b.addr.n, m: b.addr.m, a: b.addr.a, c: b.addr.c, p: b.addr.p,
    lat: b.addr.gps ? b.addr.lat ?? null : null, lng: b.addr.gps ? b.addr.lng ?? null : null, gps: b.addr.gps ? 1 : 0,
  };
  const lines = Object.entries(b.lines);

  let orderId;
  try {
    orderId = await tx(async (c) => {
      const { rows: [buyer] } = await c.query('select * from users where id = $1 for update', [req.user.id]);
      if (buyer.blocked) throw new HttpError(403, BLK_MSG);
      const { rows: [store] } = await c.query('select * from store for share');
      if (!store) throw new HttpError(503, 'The store is not set up yet. Please try again later.');
      if (store.paused) throw new HttpError(409, `${store.shop_name} is temporarily paused. Orders are not accepted.`);
      if (b.pm === 'cod' && !store.cod_enabled) throw new HttpError(409, 'Cash on Delivery is currently unavailable. Please choose another method.');

      const pids = lines.map(([k]) => ids.product.from(k));
      const { rows: prods } = await c.query('select * from products where id = any($1) order by id for update', [pids]);
      const byId = new Map(prods.map((p) => [p.id, p]));
      let sub = 0;
      const picked = lines.map(([k, q]) => {
        const p = byId.get(ids.product.from(k));
        if (!p || p.deleted || !p.active || p.stock < q) throw new HttpError(409, `${p ? p.name : 'An item'} is no longer available`);
        sub += P.fin(p) * q;
        return { p, q };
      });

      const { km, estimated } = P.distance(store.loc, addr);
      const far = P.isFar(km);
      let delivery = P.standardDelivery(sub);
      let dr = null;
      if (far) {
        const r = await c.query(
          "select * from delivery_requests where buyer_id = $1 and status = 'Approved' and addr_key = $2 and items_key = $3 order by id desc limit 1 for update",
          [req.user.id, P.addrKey(addr), P.itemsKey(lines)]);
        dr = r.rows[0];
        if (!dr) throw new HttpError(403, 'Owner approval is required for deliveries above 10 km.');
        delivery = dr.approved_charge;
      }
      const total = sub + delivery;
      const status = upi ? 'Awaiting Payment' : 'Confirmed';
      const pay = upi ? 'Awaiting verification' : 'Pending (COD)';

      const { rows: [o] } = await c.query(
        `insert into orders (buyer_id,status,payment_method,payment_status,utr,proof_path,subtotal,delivery_charge,total,
                             distance_km,estimated,far,delivery_request_id,address)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,
        [req.user.id, status, b.pm, pay, upi ? b.ref : null, upi ? b.proof : null, sub, delivery, total, km, estimated, far,
          dr ? dr.id : null, JSON.stringify(addr)]);
      const oid = ids.order.to(o.id);
      await c.query('insert into order_events (order_id, status) values ($1,$2)', [o.id, status]);

      for (const { p, q } of picked) {
        await c.query(
          'insert into order_items (order_id, product_id, name, qty, unit_price, unit, kind, hue, image) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [o.id, p.id, p.name, q, P.fin(p), p.unit, p.kind, p.hue, (p.images || [])[0] || null]);
        await c.query('update products set stock = stock - $1 where id = $2', [q, p.id]);
        await c.query('insert into product_logs (product_id, kind, detail, delta) values ($1,$2,$3,$4)',
          [p.id, 'Quantity decreased', `${upi ? 'Reserved for order ' : 'Sold: order '}${oid}`, -q]);
        if (p.stock - q <= LOW_STOCK) {
          await notify(c, store.owner_id, p.stock - q ? 'Low stock' : 'Out of stock', `${p.name}: ${p.stock - q} left`, 'hist');
        }
      }
      if (dr) await c.query("update delivery_requests set status = 'Used', order_id = $1 where id = $2", [o.id, dr.id]);

      await notify(c, store.owner_id, upi ? 'Payment to confirm' : 'New order',
        `${oid} \u00B7 ${money(total)}${upi ? ` \u00B7 UPI ref ${b.ref}` : ' \u00B7 COD, payment pending'}`, 'ord');
      await notify(c, req.user.id, 'Order confirmed',
        upi ? `${oid} is awaiting payment confirmation by the store.` : `${oid} is confirmed (Cash on Delivery).`, 'orders');
      await c.query('update users set mobile = $1, address = $2, city = $3, pincode = $4, loc = $5 where id = $6',
        [addr.m, addr.a, addr.c, addr.p, JSON.stringify({ a: addr.a, c: addr.c, p: addr.p, lat: addr.lat, lng: addr.lng, gps: addr.gps }), req.user.id]);
      return o.id;
    });
  } catch (e) {
    if (e.code === '23505' && String(e.constraint).includes('utr')) throw new HttpError(409, 'This reference was already submitted');
    throw e;
  }
  res.status(201).json({ orders: [ids.order.to(orderId)] });
}));

// ---------------- cancel (buyer: with a reason; owner: reject) ----------------
router.post('/:id/cancel', asyncHandler(async (req, res) => {
  const b = parse(z.object({ reason: z.string().trim().max(300).optional() }), req.body || {});
  const buyer = req.user.role === 'buyer';
  if (buyer && (!b.reason || b.reason.length < 3)) throw new HttpError(400, 'Please give a reason to cancel');
  await tx(async (c) => {
    const o = await lockOrder(c, req.params.id);
    if (buyer && o.buyer_id !== req.user.id) throw new HttpError(404, 'Order not found');
    if (!['Awaiting Payment', 'Confirmed'].includes(o.status)) throw new HttpError(409, 'This order can no longer be cancelled');
    const oid = ids.order.to(o.id);
    const { rows: items } = await c.query('select * from order_items where order_id = $1 and product_id is not null order by product_id', [o.id]);
    for (const i of items) {
      await c.query('update products set stock = stock + $1 where id = $2', [i.qty, i.product_id]);
      await c.query('insert into product_logs (product_id, kind, detail, delta) values ($1,$2,$3,$4)',
        [i.product_id, 'Quantity increased', `Order cancelled: ${oid}`, i.qty]);
    }
    await moveTo(c, o.id, 'Cancelled', { cancelled_at: new Date(), cancel_reason: b.reason || null });
    const { rows: [store] } = await c.query('select owner_id from store');
    if (buyer) await notify(c, store.owner_id, 'Order cancelled', `${oid} was cancelled by the buyer. Reason: ${b.reason}`, 'ord');
    else await notify(c, o.buyer_id, 'Order cancelled', `${oid} was cancelled by the store.`, 'orders');
  });
  res.json({ ok: true });
}));

// ---------------- owner: confirm a UPI payment after checking their own account ----------------
router.post('/:id/confirm-payment', requireRole('owner'), asyncHandler(async (req, res) => {
  await tx(async (c) => {
    const o = await lockOrder(c, req.params.id);
    if (o.status !== 'Awaiting Payment') throw new HttpError(409, 'This order is not waiting for payment');
    await moveTo(c, o.id, 'Confirmed', { payment_status: 'Paid (confirmed by owner)' });
    await notify(c, o.buyer_id, 'Payment confirmed', `${ids.order.to(o.id)} is confirmed and will be packed.`, 'orders');
  });
  res.json({ ok: true });
}));

// ---------------- owner: Confirmed -> Packed -> Shipped -> Delivered ----------------
router.post('/:id/advance', requireRole('owner'), asyncHandler(async (req, res) => {
  const next = await tx(async (c) => {
    const o = await lockOrder(c, req.params.id);
    const i = FLOW.indexOf(o.status);
    if (i < 0 || i === FLOW.length - 1) throw new HttpError(409, 'This order cannot move to the next step');
    const n = FLOW[i + 1];
    const sets = {};
    if (n === 'Delivered') {
      sets.delivered_at = new Date();
      if (o.payment_method === 'cod') sets.payment_status = 'Cash pending (buyer confirms collection)';
    }
    await moveTo(c, o.id, n, sets);
    await notify(c, o.buyer_id, `Order ${n.toLowerCase()}`, `${ids.order.to(o.id)} is now ${n}.`, 'orders');
    return n;
  });
  res.json({ status: next });
}));

// ---------------- buyer: "I have taken the order" (Cash on Delivery) ----------------
router.post('/:id/received', requireRole('buyer'), asyncHandler(async (req, res) => {
  await tx(async (c) => {
    const o = await lockOrder(c, req.params.id);
    if (o.buyer_id !== req.user.id) throw new HttpError(404, 'Order not found');
    if (o.payment_method !== 'cod') throw new HttpError(409, 'Not allowed');
    if (o.received_at) throw new HttpError(409, 'Already confirmed');
    if (!['Shipped', 'Delivered'].includes(o.status)) throw new HttpError(409, 'Not available until the order is shipped');
    await moveTo(c, o.id, 'Received by Buyer', {
      received_at: new Date(), delivered_at: o.delivered_at || new Date(), payment_status: 'Paid (cash collected, buyer confirmed)',
    });
    const { rows: [store] } = await c.query('select owner_id from store');
    await notify(c, store.owner_id, 'Received by Buyer', `${ids.order.to(o.id)}: the buyer confirmed receipt and cash payment.`, 'ord');
  });
  res.json({ ok: true });
}));

// ---------------- owner: view the payment screenshot (short-lived private link) ----------------
router.get('/:id/proof', requireRole('owner'), asyncHandler(async (req, res) => {
  const id = ids.order.from(req.params.id);
  if (!id) throw new HttpError(400, 'Invalid order');
  const { rows: [o] } = await query('select proof_path from orders where id = $1', [id]);
  if (!o || !o.proof_path) throw new HttpError(404, 'Payment screenshot is not available');
  res.set('Cache-Control', 'no-store');
  res.json({ url: await signedProofUrl(o.proof_path) });
}));

module.exports = router;
