// Turns database rows into the shapes the existing frontend already renders.
const { query } = require('../config/db');
const ids = require('../utils/ids');
const { ms } = require('../utils/format');

const noEmpty = (s) => (s === '' || s == null ? undefined : s);

function productOut(p, logs, ownerView) {
  const imgs = p.images || [];
  return {
    id: ids.product.to(p.id), t: p.type, n: p.name, br: p.brand, c: p.category, d: p.description,
    us: p.how_to_use, sz: p.size, va: p.variant, u: p.unit, pr: p.price, dc: p.discount_pct, st: p.stock,
    k: p.kind, h: p.hue, imgs, img: imgs[0], items: p.combo_items || undefined,
    on: p.active ? 1 : 0, del: p.deleted ? 1 : 0, cr: ms(p.created_at), up: ms(p.updated_at),
    exp: p.expiry || '',
    loc: ownerView ? p.shelf : '', q0: ownerView ? p.initial_stock : 0,
    log: ownerView ? (logs[p.id] || []).map((l) => ({ k: l.kind, x: l.detail, d: l.delta, t: ms(l.created_at) })) : [],
  };
}

function orderOut(o, items, events, ownerId, shop) {
  const hist = events.map((e) => e.status);
  const ts = {};
  events.forEach((e) => { ts[e.status] = ms(e.at); });
  return {
    id: ids.order.to(o.id), by: o.buyer_email, bid: o.buyer_id, oid: ownerId, shop,
    items: items.map((i) => ({
      id: i.product_id ? ids.product.to(i.product_id) : 'P0', n: i.name, q: i.qty, pr: i.unit_price,
      k: i.kind, h: i.hue, img: i.image || undefined, u: i.unit,
    })),
    sub: o.subtotal, del: o.delivery_charge, tot: o.total, st: o.status, pm: o.payment_method, pay: o.payment_status,
    ref: o.utr || undefined, hasProof: !!o.proof_path, cr: ms(o.created_at), hist, ts, addr: o.address,
    km: o.distance_km, dm: o.estimated ? 1 : 0, far: o.far ? 1 : 0,
    drid: o.delivery_request_id ? ids.request.to(o.delivery_request_id) : '', ddel: o.delivery_charge,
    cx: ms(o.cancelled_at) || undefined, cxr: o.cancel_reason || undefined,
    recv: ms(o.received_at) || undefined, done: ms(o.delivered_at) || 0,
  };
}

function requestOut(r, ownerId, shop) {
  return {
    id: ids.request.to(r.id), bid: r.buyer_id, by: r.buyer_email, bn: r.buyer_name, bm: r.buyer_mobile,
    oid: ownerId, shop, addr: r.address, ak: r.addr_key, key: r.items_key, items: r.items, sub: r.subtotal,
    km: r.distance_km, dm: r.estimated ? 1 : 0, sg: r.suggested_charge, st: r.status, cr: ms(r.created_at),
    cart: r.from_cart ? 1 : 0, chg: r.approved_charge == null ? undefined : r.approved_charge,
    note: r.note || undefined, at: ms(r.decided_at) || undefined,
    ord: r.order_id ? ids.order.to(r.order_id) : undefined,
  };
}

function meOut(u, store, wishlist) {
  const owner = u.role === 'owner';
  return {
    id: u.id, role: u.role, name: u.name, email: u.email, m: u.mobile, a: u.address, c: u.city, p: u.pincode,
    loc: owner ? (store && store.loc) || null : u.loc || null, shop: owner && store ? store.shop_name : undefined,
    blocked: u.blocked ? 1 : 0, w: wishlist, ll: ms(u.last_login_at),
  };
}

const buyerOut = (u) => ({
  id: u.id, role: 'buyer', name: u.name, email: u.email, m: u.mobile, a: u.address, c: u.city, p: u.pincode,
  loc: u.loc || null, blocked: u.blocked ? 1 : 0, ll: ms(u.last_login_at), bat: ms(u.blocked_at) || undefined,
});

async function getStore() {
  const { rows } = await query('select s.*, u.name as owner_name, u.email as owner_email from store s join users u on u.id = s.owner_id');
  return rows[0] || null;
}

async function loadItemsAndEvents(orderIds) {
  if (!orderIds.length) return { items: {}, events: {} };
  const [it, ev] = await Promise.all([
    query('select * from order_items where order_id = any($1) order by id', [orderIds]),
    query('select * from order_events where order_id = any($1) order by at, id', [orderIds]),
  ]);
  const items = {}; const events = {};
  it.rows.forEach((r) => (items[r.order_id] = items[r.order_id] || []).push(r));
  ev.rows.forEach((r) => (events[r.order_id] = events[r.order_id] || []).push(r));
  return { items, events };
}

/** Everything the signed-in user is allowed to see. */
async function buildState(user) {
  const store = await getStore();
  const owner = user.role === 'owner';
  const ownerId = store ? store.owner_id : null;
  const shop = store ? store.shop_name : 'Store';

  const prodSql = owner
    ? 'select * from products order by created_at desc, id desc'
    : 'select * from products where deleted = false and active = true order by created_at desc, id desc';
  const orderSql = owner
    ? 'select o.*, u.email as buyer_email from orders o join users u on u.id = o.buyer_id order by o.created_at desc, o.id desc limit 1000'
    : 'select o.*, u.email as buyer_email from orders o join users u on u.id = o.buyer_id where o.buyer_id = $1 order by o.created_at desc, o.id desc limit 300';
  const reqSql = owner
    ? 'select r.*, u.email as buyer_email from delivery_requests r join users u on u.id = r.buyer_id order by r.created_at desc, r.id desc limit 500'
    : 'select r.*, u.email as buyer_email from delivery_requests r join users u on u.id = r.buyer_id where r.buyer_id = $1 order by r.created_at desc, r.id desc limit 100';
  const arg = owner ? [] : [user.id];

  const [prods, ords, reqs, notes, wl, buyers] = await Promise.all([
    query(prodSql),
    query(orderSql, arg),
    query(reqSql, arg),
    query('select * from notifications where user_id = $1 order by created_at desc, id desc limit 100', [user.id]),
    query('select product_id from wishlist where user_id = $1', [user.id]),
    owner ? query("select * from users where role = 'buyer' order by name") : Promise.resolve({ rows: [] }),
  ]);

  const logs = {};
  if (owner && prods.rows.length) {
    const lg = await query('select * from product_logs where product_id = any($1) order by created_at, id', [prods.rows.map((p) => p.id)]);
    lg.rows.forEach((l) => (logs[l.product_id] = logs[l.product_id] || []).push(l));
  }
  const { items, events } = await loadItemsAndEvents(ords.rows.map((o) => o.id));
  const wished = wl.rows.map((r) => ids.product.to(r.product_id));

  const ownerPublic = store
    ? { id: ownerId, role: 'owner', name: store.owner_name, shop, loc: store.loc || null, ...(owner ? { email: store.owner_email } : {}) }
    : null;

  const me = meOut(user, store, wished);
  return {
    me,
    S: {
      u: [...(ownerPublic ? [ownerPublic] : []), ...buyers.rows.map(buyerOut)],
      p: prods.rows.map((p) => productOut(p, logs, owner)),
      o: ords.rows.map((o) => orderOut(o, items[o.id] || [], events[o.id] || [], ownerId, shop)),
      dr: reqs.rows.map((r) => requestOut(r, ownerId, shop)),
      n: notes.rows.map((n) => ({
        id: n.id, r: user.role, u: user.id, t: n.title, m: n.message, g: noEmpty(n.goto), at: ms(n.created_at), rd: n.is_read ? 1 : 0,
      })),
      set: { cod: !store || store.cod_enabled ? 1 : 0, qr: store && store.qr_url ? store.qr_url : undefined },
      sto: ownerId
        ? { [ownerId]: store.paused ? { paused: 1, msg: store.pause_message, since: ms(store.paused_since) } : { paused: 0 } }
        : {},
    },
  };
}

module.exports = { buildState, getStore };
