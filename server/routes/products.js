const router = require('express').Router();
const { tx } = require('../config/db');
const { CATS, COMBO, KIND, HUES, MEASURE_UNITS, LOW_STOCK } = require('../config/constants');
const { HttpError, asyncHandler } = require('../utils/httpError');
const { parse, z, flag } = require('../middleware/validate');
const { requireRole } = require('../middleware/auth');
const { notify } = require('../services/notify');
const { isOurPublicUrl } = require('../services/storage');
const { getStore } = require('../services/state');
const { money } = require('../utils/format');
const ids = require('../utils/ids');

router.use(requireRole('owner'));

const imageUrl = z.string().refine(isOurPublicUrl, 'Upload the image again');
const category = z.enum(CATS, { errorMap: () => ({ message: 'Choose a category' }) });
const unit = z.enum(MEASURE_UNITS);
const price = z.number({ invalid_type_error: 'Enter a number above 0' }).positive('Enter a number above 0').max(10_000_000);
const stock = z.number({ invalid_type_error: 'Whole number, 0 or more' }).int('Whole number, 0 or more').min(0).max(1_000_000);
const futureDate = z.string().trim().refine((s) => !s || (/^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s) > new Date()), 'Expiry date must be in the future');
const optText = (n) => z.string().trim().max(n).default('');

const single = z.object({
  type: z.literal('single'),
  name: z.string().trim().min(2, 'Enter at least 2 characters').max(150),
  brand: z.string().trim().min(1, 'Required').max(100),
  category,
  description: z.string().trim().min(10, 'Describe the product (10+ characters)').max(3000),
  howToUse: optText(2000), variant: optText(100), size: optText(60),
  price, discount: z.number().int().min(0).max(90).default(0),
  stock, unit, expiry: futureDate.default(''), shelf: optText(100),
  active: flag.default(true),
  images: z.array(imageUrl).min(1, 'Upload at least one image').max(4),
});
const combo = z.object({
  type: z.literal('combo'),
  name: z.string().trim().min(2, 'Enter at least 2 characters').max(150),
  description: z.string().trim().min(10, 'Describe the combo (10+ characters)').max(3000),
  price, stock: stock.min(1, 'Whole number above 0'),
  images: z.array(imageUrl).min(1, 'Upload at least one image').max(4),
  items: z.array(z.object({
    n: z.string().trim().min(2).max(150), img: imageUrl, d: z.string().trim().min(5).max(1000),
    cat: category, q: z.number().int().min(1).max(10000), u: unit,
  })).min(2).max(8),
});

const log = (c, pid, kind, detail, delta = 0) =>
  c.query('insert into product_logs (product_id, kind, detail, delta) values ($1,$2,$3,$4)', [pid, kind, detail, delta]);

async function stockAlert(c, ownerId, p) {
  if (p.stock <= LOW_STOCK) await notify(c, ownerId, p.stock ? 'Low stock' : 'Out of stock', `${p.name}: ${p.stock} left`, 'hist');
}

// ---- create ----
router.post('/', asyncHandler(async (req, res) => {
  const b = parse(z.discriminatedUnion('type', [single, combo]), req.body);
  const store = await getStore();
  if (!store) throw new HttpError(503, 'Store is not set up yet. Run: npm run owner:seed');
  const isCombo = b.type === 'combo';
  const row = await tx(async (c) => {
    const { rows: [p] } = await c.query(
      `insert into products (type,name,brand,category,description,how_to_use,size,variant,unit,price,discount_pct,
                             stock,initial_stock,expiry,shelf,active,kind,images,combo_items)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13,$14,$15,$16,$17,$18) returning *`,
      [b.type, b.name, isCombo ? store.shop_name : b.brand, isCombo ? COMBO : b.category, b.description,
        isCombo ? '' : b.howToUse, isCombo ? '' : b.size, isCombo ? '' : b.variant, isCombo ? 'package' : b.unit,
        b.price, isCombo ? 0 : b.discount, b.stock, isCombo ? null : b.expiry || null,
        isCombo ? 'Main store' : b.shelf || 'Main store', isCombo ? true : b.active,
        isCombo ? 'jar' : KIND[CATS.indexOf(b.category)] || 'jar', b.images, isCombo ? JSON.stringify(b.items) : null],
    );
    await c.query('update products set hue = $1 where id = $2', [HUES[p.id % 6], p.id]);
    await log(c, p.id, 'Created', `Listed with ${p.stock} in stock`, p.stock);
    await stockAlert(c, store.owner_id, p);
    await notify(c, store.owner_id, isCombo ? 'Combo added' : 'Product added',
      isCombo ? `${p.name} is live.` : `${p.name} is ${p.active ? 'active' : 'inactive'}.`, 'hist');
    return p;
  });
  res.status(201).json({ id: ids.product.to(row.id), active: row.active });
}));

// ---- edit (every change is written to the product history) ----
const editSchema = z.object({
  name: z.string().trim().min(2).max(150),
  description: z.string().trim().min(10, 'Describe it (10+ characters)').max(3000),
  brand: z.string().trim().min(1).max(100).optional(),
  category: category.optional(),
  howToUse: z.string().trim().max(2000).optional(),
  size: z.string().trim().max(60).optional(),
  variant: z.string().trim().max(100).optional(),
  expiry: z.string().trim().optional(),
  price, discount: z.number().int().min(0).max(90).optional(),
  stock, reason: z.string().trim().max(200).default(''),
  shelf: z.string().trim().min(2).max(100),
  active: flag,
  images: z.array(imageUrl).min(1).max(4).optional(),
});

router.put('/:id', asyncHandler(async (req, res) => {
  const pid = ids.product.from(req.params.id);
  if (!pid) throw new HttpError(400, 'Invalid product');
  const b = parse(editSchema, req.body);
  const store = await getStore();
  const out = await tx(async (c) => {
    const { rows: [p] } = await c.query('select * from products where id = $1 for update', [pid]);
    if (!p || p.deleted) throw new HttpError(404, 'Product not found');
    const combo = p.type === 'combo';
    if (b.stock !== p.stock && b.reason.length < 3) throw new HttpError(400, 'Give a reason for the quantity change');
    if (!combo) {
      if (b.expiry && b.expiry !== (p.expiry || '') && !futureDate.safeParse(b.expiry).success) {
        throw new HttpError(400, 'Expiry date must be in the future');
      }
    }
    const set = {}; let n = 0; let warning;
    const L = async (k, x, d = 0) => { await log(c, pid, k, x, d); n++; };
    const ed = async (col, key, label, nv) => {
      if (nv === undefined) return;
      if (String(p[col] ?? '') !== String(nv)) { await L('Edited', `${label}: ${p[col] ?? '\u2014'} \u2192 ${nv}`); set[key] = nv; }
    };
    await ed('name', 'name', 'Name', b.name);
    await ed('description', 'description', 'Description', b.description);
    if (!combo) {
      await ed('brand', 'brand', 'Brand', b.brand);
      if (b.category && b.category !== p.category) {
        await L('Edited', `Category: ${p.category} \u2192 ${b.category}`);
        set.category = b.category; set.kind = KIND[CATS.indexOf(b.category)] || p.kind;
      }
      await ed('how_to_use', 'how_to_use', 'How to use', b.howToUse);
      await ed('size', 'size', 'Size', b.size);
      await ed('variant', 'variant', 'Variant', b.variant);
      if (b.expiry !== undefined) {
        const cur = p.expiry || '';
        if (cur !== b.expiry) { await L('Edited', `Expiry: ${cur || '\u2014'} \u2192 ${b.expiry || '\u2014'}`); set.expiry = b.expiry || null; }
      }
    }
    if (b.price !== p.price) { await L('Edited', `Price: ${money(p.price)} \u2192 ${money(b.price)}`); set.price = b.price; }
    if (!combo && b.discount !== undefined && b.discount !== p.discount_pct) {
      await L('Edited', `Discount: ${p.discount_pct}% \u2192 ${b.discount}%`); set.discount_pct = b.discount;
    }
    if (b.images) { await L('Edited', 'Images replaced'); set.images = b.images; }
    const d = b.stock - p.stock;
    if (d) {
      await L(d > 0 ? 'Quantity increased' : 'Quantity decreased', `Quantity ${p.stock} \u2192 ${b.stock}. Reason: ${b.reason}`, d);
      set.stock = b.stock;
    }
    await ed('shelf', 'shelf', 'Location', b.shelf);
    if (b.active !== p.active) {
      if (b.active && (set.stock ?? p.stock) <= 0) warning = 'Cannot set Active: no stock available';
      else { await L('Status', `Status changed to ${b.active ? 'Active' : 'Inactive'}`); set.active = b.active; }
    }
    const cols = Object.keys(set);
    if (cols.length) {
      await c.query(`update products set ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1`, [pid, ...cols.map((k) => set[k])]);
    }
    if (n) {
      if (set.stock !== undefined && set.stock <= LOW_STOCK) await stockAlert(c, store.owner_id, { name: set.name || p.name, stock: set.stock });
      await notify(c, store.owner_id, 'Product updated', `${set.name || p.name}: ${n} change(s) saved.`, 'hist');
    }
    return { changes: n, warning };
  });
  res.json(out);
}));

// ---- stop / resume / delete (soft delete keeps history and past orders) ----
router.post('/:id/status', asyncHandler(async (req, res) => {
  const pid = ids.product.from(req.params.id);
  if (!pid) throw new HttpError(400, 'Invalid product');
  const { status } = parse(z.object({ status: z.enum(['Active', 'Inactive', 'Deleted']) }), req.body);
  await tx(async (c) => {
    const { rows: [p] } = await c.query('select * from products where id = $1 for update', [pid]);
    if (!p || p.deleted) throw new HttpError(404, 'Product not found');
    if (status === 'Active') {
      if (p.stock <= 0) throw new HttpError(400, 'Cannot resume: no stock available');
      await c.query('update products set active = true where id = $1', [pid]);
      await log(c, pid, 'Status', 'Status changed to Active');
    } else if (status === 'Inactive') {
      await c.query('update products set active = false where id = $1', [pid]);
      await log(c, pid, 'Status', 'Status changed to Inactive');
    } else {
      await c.query('update products set active = false, deleted = true where id = $1', [pid]);
      await log(c, pid, 'Status', 'Deleted (hidden from the shop; records kept)');
    }
  });
  res.json({ ok: true });
}));

module.exports = router;
