const router = require('express').Router();
const { query } = require('../config/db');
const { asyncHandler } = require('../utils/httpError');
const { parse, z } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const storage = require('../services/storage');
const { HttpError } = require('../utils/httpError');

router.use(requireAuth);
const body = z.object({ dataUrl: z.string().max(2_900_000) });

// Product / combo images (owner)
router.post('/product', requireRole('owner'), asyncHandler(async (req, res) => {
  const { dataUrl } = parse(body, req.body);
  const { url } = await storage.uploadPublic('products', dataUrl);
  res.status(201).json({ url });
}));

// Payment QR (owner): stored and attached to the shop in one step
router.post('/qr', requireRole('owner'), asyncHandler(async (req, res) => {
  const { dataUrl } = parse(body, req.body);
  const { rows: [old] } = await query('select qr_path from store');
  const { path, url } = await storage.uploadPublic('qr', dataUrl);
  const r = await query('update store set qr_url = $1, qr_path = $2', [url, path]);
  if (!r.rowCount) throw new HttpError(503, 'Store is not set up yet. Run: npm run owner:seed');
  if (old) await storage.removePublic(old.qr_path);
  res.status(201).json({ url });
}));

// Payment screenshot (buyer): private bucket, only the owner can open it later
router.post('/proof', requireRole('buyer'), asyncHandler(async (req, res) => {
  const { dataUrl } = parse(body, req.body);
  const path = await storage.uploadPrivate(`proofs/${req.user.id}`, dataUrl);
  res.status(201).json({ path });
}));

module.exports = router;
