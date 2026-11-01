const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { env } = require('../config/env');
const { HttpError } = require('../utils/httpError');

// The UI uses inline onclick handlers (kept from the original design), so script
// *attributes* need 'unsafe-inline'. Script *files* are restricted to this origin.
const cspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  scriptSrcAttr: ["'unsafe-inline'"],
  styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  fontSrc: ["'self'", 'https://fonts.gstatic.com'],
  imgSrc: ["'self'", 'data:', 'blob:', 'https://*.supabase.co'],
  connectSrc: ["'self'"],
  objectSrc: ["'none'"],
  frameAncestors: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  upgradeInsecureRequests: env.NODE_ENV === 'production' ? [] : null,
};

const securityHeaders = () =>
  helmet({ contentSecurityPolicy: { useDefaults: true, directives: cspDirectives }, crossOriginEmbedderPolicy: false });

const hostOf = (u) => { try { return new URL(u).host; } catch { return null; } };

/**
 * CSRF defence for cookie auth: every state-changing API call must carry our custom
 * header (browsers will not add it on cross-site form posts) and a same-site Origin.
 */
function csrfGuard(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'nbbw') return next(new HttpError(403, 'Blocked request'));
  const origin = req.get('origin');
  if (origin) {
    const ok = [req.get('host'), hostOf(env.FRONTEND_URL)].includes(hostOf(origin));
    if (!ok) return next(new HttpError(403, 'Blocked request origin'));
  }
  next();
}

const limiter = (windowMin, max, message) =>
  rateLimit({
    windowMs: windowMin * 60 * 1000,
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: message }),
  });

const apiLimiter = limiter(15, 600, 'Too many requests. Please slow down and try again shortly.');
const authLimiter = limiter(15, 40, 'Too many attempts. Please wait a few minutes and try again.');
const uploadLimiter = limiter(15, 80, 'Too many uploads. Please try again shortly.');

module.exports = { securityHeaders, csrfGuard, apiLimiter, authLimiter, uploadLimiter };
