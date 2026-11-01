// Quick health check for beginners: npm run check
require('dotenv').config();
const { Pool } = require('pg');
const ok = (m) => console.log('  OK    ' + m);
const bad = (m) => { console.log('  FAIL  ' + m); process.exitCode = 1; };

(async () => {
  console.log('\nChecking your setup...\n');
  for (const k of ['DATABASE_URL', 'JWT_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
    process.env[k] ? ok(`${k} is set`) : bad(`${k} is missing in .env`);
  }
  if ((process.env.JWT_SECRET || '').length < 32) bad('JWT_SECRET must be at least 32 characters');
  if (!process.env.DATABASE_URL) return;
  const url = process.env.DATABASE_URL;
  const pool = new Pool({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
  try {
    await pool.query('select 1'); ok('connected to the database');
    const t = await pool.query("select count(distinct table_name)::int as n from information_schema.tables where table_schema ='public' and table_name in ('users','products','orders','store')");
    t.rows[0].n === 4 ? ok('tables exist') : bad('tables missing -> run: npm run db:migrate');
    const o = await pool.query("select email from public.users where role = 'owner'");
    o.rowCount ? ok(`owner account exists (${o.rows[0].email})`) : bad('no owner yet -> run: npm run owner:seed');
  } catch (e) { bad('database: ' + e.message); } finally { await pool.end(); }
  console.log('');
})();
