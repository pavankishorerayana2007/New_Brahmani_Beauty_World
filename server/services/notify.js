/** `db` is the pool or a transaction client (both have .query). */
async function notify(db, userId, title, message, goto = null) {
  await db.query('insert into notifications (user_id, title, message, goto) values ($1,$2,$3,$4)', [
    userId, title, message, goto,
  ]);
}
module.exports = { notify };
