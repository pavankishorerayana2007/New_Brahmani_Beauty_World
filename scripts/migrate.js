// Applies database/migrations/*.sql in order (each file once). Usage: npm run db:migrate
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is missing in .env');
  const pool = new Pool({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
  const dir = path.join(__dirname, '..', 'database', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const client = await pool.connect();
  try {
    await client.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
    const done = new Set((await client.query('select name from schema_migrations')).rows.map((r) => r.name));
    for (const f of files) {
      if (done.has(f)) { console.log(`skip   ${f} (already applied)`); continue; }
      process.stdout.write(`apply  ${f} ... `);
      try {
        await client.query('begin');
        await client.query(fs.readFileSync(path.join(dir, f), 'utf8'));
        await client.query('insert into schema_migrations (name) values ($1)', [f]);
        await client.query('commit');
        console.log('ok');
      } catch (e) {
        await client.query('rollback');
        console.log('FAILED');
        throw new Error(`${f}: ${e.message}`);
      }
    }
    console.log('\nDatabase is up to date.');
  } finally {
    client.release();
    await pool.end();
  }
})().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1); });
