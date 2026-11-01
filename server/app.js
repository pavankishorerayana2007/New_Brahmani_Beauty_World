const express = require('express');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const { env } = require('./config/env');
const sec = require('./middleware/security');
const { loadUser } = require('./middleware/auth');
const { notFound, errorHandler } = require('./middleware/error');

const app = express();
app.set('trust proxy', 1);          // behind Vercel's proxy: correct client IP for rate limits
app.disable('x-powered-by');

app.use(sec.securityHeaders());
if (env.NODE_ENV !== 'test') app.use(morgan(env.NODE_ENV === 'production' ? 'tiny' : 'dev'));

app.get('/api/health', (_req, res) => res.json({ ok: true, env: env.NODE_ENV }));

app.use('/api', sec.csrfGuard, sec.apiLimiter, cookieParser(), loadUser);

// image uploads need a bigger JSON limit than the rest of the API
app.use('/api/uploads', sec.uploadLimiter, express.json({ limit: '3mb' }), require('./routes/uploads'));
app.use('/api', express.json({ limit: '100kb' }));

app.use('/api/auth', sec.authLimiter, require('./routes/auth'));
app.use('/api', require('./routes'));
app.use('/api', notFound);
app.use(errorHandler);

module.exports = app;
