require('dotenv').config();
const { z } = require('zod');

const str = (d = '') => z.string().default(d);
const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  FRONTEND_URL: str('http://localhost:5000'),
  DATABASE_URL: z.string().min(10, 'DATABASE_URL is required (Supabase connection string)'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be a random string of at least 32 characters'),
  OWNER_EMAIL: z.string().email().default('pavan@gmail.com').transform((s) => s.trim().toLowerCase()),
  OWNER_NAME: str('Owner'),
  SHOP_NAME: str('New Brahmani Beauty World'),
  SUPABASE_URL: str(),
  SUPABASE_SERVICE_ROLE_KEY: str(),
  SMTP_HOST: str(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: str(),
  SMTP_PASS: str(),
  SMTP_FROM: str(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid or missing environment variables:\n${lines}\nCopy .env.example to .env and fill it in.`);
}
module.exports = { env: parsed.data };
