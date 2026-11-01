const bcrypt = require('bcryptjs');

/**
 * Creates the single owner account (and the shop row) if it does not exist yet.
 * `db` = pool or client. Never creates a second owner (the database also forbids it).
 */
async function ensureOwner(db, { email, password, name, shopName, resetPassword = false }) {
  const { rows: [existing] } = await db.query("select * from users where role = 'owner'");
  if (existing) {
    if (existing.email !== email) {
      throw new Error(`An owner already exists (${existing.email}). Only one owner is allowed; OWNER_EMAIL must match it.`);
    }
    if (resetPassword) {
      await db.query('update users set password_hash = $1, token_version = token_version + 1, failed_logins = 0, locked_until = null where id = $2',
        [await bcrypt.hash(password, 12), existing.id]);
    }
    await db.query('insert into store (owner_id, shop_name) values ($1,$2) on conflict do nothing', [existing.id, shopName]);
    return { created: false, passwordReset: resetPassword, email };
  }
  const { rows: [taken] } = await db.query('select role from users where email = $1', [email]);
  if (taken) throw new Error(`${email} is already registered as a ${taken.role}. Use a different OWNER_EMAIL or remove that account first.`);
  const { rows: [u] } = await db.query(
    "insert into users (role, name, email, password_hash) values ('owner',$1,$2,$3) returning id",
    [name, email, await bcrypt.hash(password, 12)]);
  await db.query('insert into store (owner_id, shop_name) values ($1,$2)', [u.id, shopName]);
  return { created: true, email };
}

module.exports = { ensureOwner };
