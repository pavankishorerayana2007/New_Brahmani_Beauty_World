// Creates the one and only owner account from environment variables.
//   npm run owner:seed                 -> create the owner (does nothing if it exists)
//   npm run owner:reset-password       -> set a new password for the existing owner
require('dotenv').config();
const { Pool } = require('pg');
const { ensureOwner } = require('../server/services/ownerSeed');

(async () => {
  const url = process.env.DATABASE_URL;
  const email = (process.env.OWNER_EMAIL || 'pavan@gmail.com').trim().toLowerCase();
  const password = process.env.OWNER_INITIAL_PASSWORD || '';
  const reset = process.argv.includes('--reset-password');
  if (!url) throw new Error('DATABASE_URL is missing in .env');
  if (password.length < 10 || password === 'CHOOSE_A_STRONG_PASSWORD') {
    throw new Error('Set OWNER_INITIAL_PASSWORD in .env to a strong password (10+ characters) first.');
  }
  const pool = new Pool({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
  try {
    const r = await ensureOwner(pool, {
      email, password, name: process.env.OWNER_NAME || 'Owner',
      shopName: process.env.SHOP_NAME || 'New Brahmani Beauty World', resetPassword: reset,
    });
    if (r.created) console.log(`Owner account created for ${email}.`);
    else if (r.passwordReset) console.log(`Owner password updated for ${email}.`);
    else console.log(`Owner ${email} already exists. Nothing changed. (Use "npm run owner:reset-password" to set a new password.)`);
    console.log('Now delete OWNER_INITIAL_PASSWORD from your .env file.');
  } finally {
    await pool.end();
  }
})().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1); });
