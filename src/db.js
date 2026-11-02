// Database access. In production DATABASE_URL points at Supabase Postgres
// (through its connection pooler). Without it, PGlite (Postgres compiled to
// WebAssembly, running in-process) is used, so local development and tests
// run the exact same SQL with nothing to install.
//
// Queries use `?` placeholders and go through a small interface:
//   get(sql, ...params) → first row | undefined
//   all(sql, ...params) → rows
//   run(sql, ...params) → { changes }
//   tx(async (t) => ...) → runs the callback in a transaction; `t` has get/all/run
const path = require('node:path');
const crypto = require('node:crypto');
const { SCHEMA } = require('./schema');

const toPg = (sql) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };

function wrap(exec) {
  return {
    all: async (sql, ...params) => (await exec(toPg(sql), params)).rows,
    get: async (sql, ...params) => (await exec(toPg(sql), params)).rows[0],
    run: async (sql, ...params) => ({ changes: (await exec(toPg(sql), params)).count }),
  };
}

// Runs fn in a transaction. Work that must see committed data (e.g. starting
// workflows for new events) is queued with q.afterCommit(fn) and runs after.
async function runTx(begin, fn) {
  const after = [];
  const result = await begin((t) => {
    t.inTx = true;
    t.afterCommit = (f) => after.push(f);
    return fn(t);
  });
  for (const f of after) await f();
  return result;
}

function openPostgres(url) {
  const postgres = require('postgres');
  // prepare: false is required by the pooler's transaction mode.
  const sql = postgres(url, {
    prepare: false,
    max: Number(process.env.DB_POOL_MAX) || 3,
    idle_timeout: 20,
    connect_timeout: 10,
    connection: { search_path: 'app' },
  });
  const exec = (s) => async (text, params) => {
    const rows = await s.unsafe(text, params);
    return { rows, count: rows.count };
  };
  const db = wrap(exec(sql));
  db.tx = (fn) => runTx((cb) => sql.begin((t) => cb(wrap(exec(t)))), fn);
  db.close = () => sql.end();
  return db;
}

async function openPGlite(dir) {
  const { PGlite } = require('@electric-sql/pglite');
  const pg = new PGlite(dir);
  await pg.exec(SCHEMA);
  const exec = (s) => async (text, params) => {
    const r = await s.query(text, params);
    return { rows: r.rows, count: r.affectedRows ?? 0 };
  };
  const db = wrap(exec(pg));
  db.tx = (fn) => runTx((cb) => pg.transaction((t) => cb(wrap(exec(t)))), fn);
  db.close = () => pg.close();
  return db;
}

// dir: a PGlite data directory, or undefined for an in-memory database.
async function openDb({ url, dir } = {}) {
  return url ? openPostgres(url) : openPGlite(dir);
}

const defaultDir = () => process.env.DB_PATH || path.join(__dirname, '..', 'data', 'pglite');

// App secret used to sign unsubscribe links and test checkouts. Env var wins;
// otherwise one is generated on first boot and stored so links keep working.
async function appSecret(db) {
  if (process.env.APP_SECRET) return process.env.APP_SECRET;
  const row = await db.get("SELECT value FROM meta WHERE key = 'secret'");
  if (row) return row.value;
  await db.run("INSERT INTO meta (key, value) VALUES ('secret', ?) ON CONFLICT (key) DO NOTHING", crypto.randomBytes(32).toString('hex'));
  return (await db.get("SELECT value FROM meta WHERE key = 'secret'")).value;
}

module.exports = { openDb, appSecret, defaultDir };
