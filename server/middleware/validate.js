const { z } = require('zod');
const { HttpError } = require('../utils/httpError');

/** Validate data against a zod schema; throws a 400 with a friendly message. */
function parse(schema, data) {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const fields = {};
  for (const i of r.error.issues) fields[i.path.join('.') || '_'] = i.message;
  const first = r.error.issues[0];
  const where = first.path.length ? `${first.path.join('.')}: ` : '';
  throw new HttpError(400, first.message === 'Required' ? `${where}is required` : `${where}${first.message}`, fields);
}

const email = z.string().trim().toLowerCase().email('Enter a valid email').max(254);
const password = z.string().min(8, 'Password must be at least 8 characters').max(72, 'Password is too long');
const mobile = z.string().trim().regex(/^\d{10}$/, 'Enter 10 digits');
const flag = z.preprocess((v) => !!v, z.boolean());

const location = z.object({
  a: z.string().trim().min(8, 'Enter the full address (8+ characters)').max(300),
  c: z.string().trim().min(1, 'City is required').max(100),
  p: z.string().trim().regex(/^\d{6}$/, 'Enter a 6-digit PIN code'),
  lat: z.number().min(-90).max(90).nullish(),
  lng: z.number().min(-180).max(180).nullish(),
  gps: flag.optional(),
});

module.exports = { parse, z, email, password, mobile, flag, location };
