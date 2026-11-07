// Each business's short name for its customer pages: /my/ann-bakes instead of
// /my/38, so addresses can't be guessed by counting. Made from the business
// name the first time it's needed; the owner can change it in Settings.
'use strict';

const RESERVED = new Set(['api', 'admin', 'app', 'login', 'logout', 'my', 'new', 'settings', 'rilly', 'help', 'support', 'www']);
const clean = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
const valid = (h) => /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(h) && !/^\d+$/.test(h) && !RESERVED.has(h);

async function handleOf(db, accountId) {
  const a = await db.get('SELECT id, name, handle FROM accounts WHERE id = ?', accountId);
  if (!a) return '';
  if (a.handle) return a.handle;
  let base = clean(a.name);
  if (!valid(base)) base = `shop-${clean(a.name).slice(0, 20) || 'home'}`.replace(/-+$/, '');
  if (!valid(base)) base = 'shop';
  for (let n = 1; n < 500; n++) {
    const h = n === 1 ? base : `${base.slice(0, 36)}-${n}`;
    if (!valid(h)) continue;
    // Only set it if nobody else took it in the meantime.
    const r = await db.get("UPDATE accounts SET handle = ? WHERE id = ? AND handle = '' AND NOT EXISTS (SELECT 1 FROM accounts WHERE handle = ?) RETURNING handle", h, a.id, h);
    if (r) return r.handle;
    const now = await db.get('SELECT handle FROM accounts WHERE id = ?', a.id);
    if (now.handle) return now.handle;
  }
  throw new Error('Could not pick a short name');
}

// The account behind /my/<raw>. Numbers only work behind a signed link (allowId),
// so old emailed sign-in links keep working without making addresses guessable.
async function accountByHandle(db, raw, { allowId = false, columns = 'id, name, from_name, brand_color, handle' } = {}) {
  const s = String(raw || '').toLowerCase();
  if (/^\d{1,9}$/.test(s)) {
    if (!allowId) return null;
    const a = await db.get(`SELECT ${columns} FROM accounts WHERE id = ?`, Number(s));
    if (a && !a.handle) a.handle = await handleOf(db, a.id);
    return a;
  }
  return valid(s) ? db.get(`SELECT ${columns} FROM accounts WHERE handle = ?`, s) : null;
}

module.exports = { handleOf, accountByHandle, valid: valid, cleanHandle: clean };
