const { ZodError } = require('zod');
const { HttpError } = require('../utils/httpError');

const notFound = (_req, res) => res.status(404).json({ error: 'Not found' });

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, fields: err.fields });
  if (err instanceof ZodError) return res.status(400).json({ error: err.issues[0].message });
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'That upload is too large' });
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request' });
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err && err.stack ? err.stack : err);
  res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
}

module.exports = { notFound, errorHandler };
