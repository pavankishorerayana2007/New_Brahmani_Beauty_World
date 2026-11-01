const { Pool, types } = require('pg');
const { env } = require('./env');

types.setTypeParser(20, (v) => parseInt(v, 10));    // bigint  -> number
types.setTypeParser(1700, (v) => parseFloat(v));    // numeric -> number
types.setTypeParser(1082, (v) => v);                // date    -> 'YYYY-MM-DD' string (no timezone shifts)

const local = /localhost|127\.0\.0\.1/.test(env.DATABASE_URL);
const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: local ? false : { rejectUnauthorized: false }, // Supabase requires TLS
  max: env.NODE_ENV === 'production' ? 3 : 10,         // serverless: keep connections few
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
});
pool.on('error', (e) => console.error('[pg] idle client error:', e.message));

const query = (text, params) => pool.query(text, params);

/** Run fn(client) inside a transaction. Rolls back on any error. */
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (e) {
    try { await client.query('rollback'); } catch { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, tx };
