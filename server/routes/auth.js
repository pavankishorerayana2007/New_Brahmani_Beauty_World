const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = require('express').Router();
const { env } = require('../config/env');
const { query } = require('../config/db');
const { OTP, DUP_EMAIL } = require('../config/constants');
const { HttpError, asyncHandler } = require('../utils/httpError');
const { parse, z, email, password, mobile } = require('../middleware/validate');
const { setSession, clearSession } = require('../middleware/auth');
const mail = require('../services/mail');

const ROUNDS = 12;
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', ROUNDS); // equalises timing for unknown emails
const WRONG = 'Email or password is incorrect';
const hmac = (em, otp) => crypto.createHmac('sha256', env.JWT_SECRET).update(`${em}|${otp}`).digest('hex');
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// ---- Registration: ALWAYS creates a buyer. The role can never come from the request. ----
router.post('/register', asyncHandler(async (req, res) => {
  const b = parse(z.object({
    name: z.string().trim().min(2, 'Enter your name').max(100), email, mobile, password,
  }), req.body);
  if (b.email === env.OWNER_EMAIL) throw new HttpError(409, DUP_EMAIL); // owner email is reserved
  const hash = await bcrypt.hash(b.password, ROUNDS);
  try {
    const { rows } = await query(
      "insert into users (role, name, email, mobile, password_hash, last_login_at) values ('buyer',$1,$2,$3,$4, now()) returning *",
      [b.name, b.email, b.mobile, hash],
    );
    setSession(res, rows[0]);
    res.status(201).json({ ok: true });
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, DUP_EMAIL);
    throw e;
  }
}));

// ---- Login (buyer or owner: same endpoint, the database decides the role) ----
router.post('/login', asyncHandler(async (req, res) => {
  const b = parse(z.object({ email, password: z.string().min(1, 'Required').max(200) }), req.body);
  const { rows } = await query('select * from users where email = $1', [b.email]);
  const u = rows[0];
  if (u && u.locked_until && new Date(u.locked_until) > new Date()) {
    throw new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.');
  }
  const ok = await bcrypt.compare(b.password, u ? u.password_hash : DUMMY_HASH);
  if (!u || !ok) {
    if (u) {
      await query(
        `update users set failed_logins = case when failed_logins + 1 >= 5 then 0 else failed_logins + 1 end,
                          locked_until = case when failed_logins + 1 >= 5 then now() + interval '5 minutes' else locked_until end
         where id = $1`, [u.id]);
    }
    throw new HttpError(401, WRONG);
  }
  const upd = await query('update users set failed_logins = 0, locked_until = null, last_login_at = now() where id = $1 returning *', [u.id]);
  setSession(res, upd.rows[0]);
  res.json({ ok: true });
}));

router.post('/logout', (_req, res) => { clearSession(res); res.json({ ok: true }); });

// ---- Forgot password: email OTP -> short-lived reset token -> new password ----
router.post('/forgot', asyncHandler(async (req, res) => {
  const { email: em } = parse(z.object({ email }), req.body);
  if (!mail.isConfigured()) {
    throw new HttpError(503, 'Email delivery is not set up yet. The site owner must add the email (SMTP) settings (see README).');
  }
  const now = Date.now();
  const { rows: [r] } = await query('select * from password_resets where email = $1', [em]);
  if (r && now - new Date(r.last_sent_at).getTime() < OTP.COOLDOWN_SEC * 1000) {
    throw new HttpError(429, 'Please wait before requesting another OTP.');
  }
  const inWindow = r && now - new Date(r.window_start).getTime() < 36e5;
  const count = inWindow ? r.send_count : 0;
  if (count >= OTP.HOURLY) throw new HttpError(429, 'Too many OTP requests. Please try again in an hour.');

  const { rows: [u] } = await query('select id from users where email = $1', [em]);
  const otp = u ? String(crypto.randomInt(0, 1e6)).padStart(6, '0') : null;
  await query(
    `insert into password_resets (email, user_id, otp_hash, expires_at, attempts, dead, send_count, window_start, last_sent_at)
     values ($1,$2,$3, now() + make_interval(mins => $4::int), 0, $5, $6, $7, now())
     on conflict (email) do update set user_id = excluded.user_id, otp_hash = excluded.otp_hash,
       expires_at = excluded.expires_at, attempts = 0, dead = excluded.dead, send_count = excluded.send_count,
       window_start = excluded.window_start, last_sent_at = now()`,
    [em, u ? u.id : null, otp ? hmac(em, otp) : null, OTP.MINUTES, !u, count + 1, inWindow ? r.window_start : new Date()],
  );
  if (otp) {
    try { await mail.sendOtp(em, otp); }
    catch (e) { await query('update password_resets set dead = true where email = $1', [em]); throw e; }
  }
  res.json({ ok: true }); // same answer whether or not the email is registered
}));

router.post('/forgot/verify', asyncHandler(async (req, res) => {
  const b = parse(z.object({ email, otp: z.string().regex(/^\d{6}$/, 'Enter the 6-digit OTP') }), req.body);
  const { rows: [r] } = await query('select * from password_resets where email = $1', [b.email]);
  const bad = (m) => { throw new HttpError(400, m); };
  if (!r || r.dead || !r.otp_hash) bad('Incorrect or expired OTP. Please request a new one.');
  if (new Date(r.expires_at) < new Date()) {
    await query('update password_resets set dead = true where email = $1', [b.email]);
    bad('This OTP has expired. Please request a new one.');
  }
  if (r.attempts >= OTP.TRIES) {
    await query('update password_resets set dead = true where email = $1', [b.email]);
    bad('Too many incorrect attempts. Please request a new OTP.');
  }
  if (!same(r.otp_hash, hmac(b.email, b.otp))) {
    const att = r.attempts + 1;
    await query('update password_resets set attempts = $2, dead = $3 where email = $1', [b.email, att, att >= OTP.TRIES]);
    bad(att >= OTP.TRIES ? 'Incorrect OTP. Please request a new one.' : `Incorrect OTP. ${OTP.TRIES - att} attempt(s) left.`);
  }
  await query('update password_resets set dead = true, otp_hash = null where email = $1', [b.email]);
  const { rows: [u] } = await query('select id, token_version from users where id = $1', [r.user_id]);
  if (!u) bad('Incorrect or expired OTP. Please request a new one.');
  const token = jwt.sign({ purpose: 'reset', sub: u.id, email: b.email, tv: u.token_version }, env.JWT_SECRET, { expiresIn: '10m' });
  res.json({ token });
}));

router.post('/forgot/reset', asyncHandler(async (req, res) => {
  const b = parse(z.object({ email, token: z.string().min(10), password }), req.body);
  let p;
  try { p = jwt.verify(b.token, env.JWT_SECRET); } catch { throw new HttpError(400, 'Verification expired. Please start again.'); }
  if (p.purpose !== 'reset' || p.email !== b.email) throw new HttpError(400, 'Verification expired. Please start again.');
  const hash = await bcrypt.hash(b.password, ROUNDS);
  // token_version check makes the reset link single-use; the bump signs out every old session
  const r = await query(
    `update users set password_hash = $1, token_version = token_version + 1, failed_logins = 0, locked_until = null
     where id = $2 and email = $3 and token_version = $4 returning id`,
    [hash, p.sub, b.email, p.tv],
  );
  if (!r.rowCount) throw new HttpError(400, 'Could not reset the password. Please start again.');
  res.json({ ok: true });
}));

module.exports = router;
