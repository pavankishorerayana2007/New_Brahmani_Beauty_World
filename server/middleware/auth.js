const jwt = require('jsonwebtoken');
const { env } = require('../config/env');
const { query } = require('../config/db');
const { HttpError } = require('../utils/httpError');

const COOKIE = 'nbbw_token';
const DAYS = 7;

const signSession = (user) =>
  jwt.sign({ sub: user.id, tv: user.token_version }, env.JWT_SECRET, { expiresIn: `${DAYS}d` });

const cookieOpts = () => ({
  httpOnly: true,                        // JavaScript in the page can never read it
  sameSite: 'lax',
  secure: env.NODE_ENV === 'production',
  path: '/',
});
const setSession = (res, user) => res.cookie(COOKIE, signSession(user), { ...cookieOpts(), maxAge: DAYS * 864e5 });
const clearSession = (res) => res.clearCookie(COOKIE, cookieOpts());

/** Loads req.user from the cookie. The role ALWAYS comes from the database, never the client. */
async function loadUser(req, _res, next) {
  const token = req.cookies && req.cookies[COOKIE];
  if (!token) return next();
  try {
    const p = jwt.verify(token, env.JWT_SECRET);
    if (p.purpose) return next();        // reset-tokens are not sessions
    const { rows } = await query('select * from users where id = $1', [p.sub]);
    const u = rows[0];
    if (u && u.token_version === p.tv) req.user = u;
  } catch { /* invalid or expired token = anonymous */ }
  next();
}

const requireAuth = (req, _res, next) =>
  req.user ? next() : next(new HttpError(401, 'Please log in to continue'));

const requireRole = (role) => (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'Please log in to continue'));
  if (req.user.role !== role) return next(new HttpError(403, 'Not allowed'));
  next();
};

module.exports = { loadUser, requireAuth, requireRole, setSession, clearSession };
