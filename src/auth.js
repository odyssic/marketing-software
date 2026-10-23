const crypto = require('node:crypto');

const SESSION_DAYS = 30;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, Buffer.from(salt, 'hex'), 64);
  return crypto.timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function createSession(db, res, userId, accountId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  db.prepare('INSERT INTO sessions (token, user_id, account_id, expires_at) VALUES (?, ?, ?, ?)')
    .run(token, userId, accountId, expires.toISOString());
  res.cookie('sid', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires,
  });
}

function destroySession(db, req, res) {
  const token = parseCookies(req.headers.cookie).sid;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.clearCookie('sid');
}

// Attaches req.user and req.accountId, or responds 401.
function requireAuth(db) {
  return (req, res, next) => {
    const token = parseCookies(req.headers.cookie).sid;
    const row = token && db.prepare(`
      SELECT s.account_id, s.expires_at, u.id, u.email, u.name
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ?`).get(token);
    if (!row || new Date(row.expires_at) < new Date()) {
      return res.status(401).json({ error: 'Not signed in' });
    }
    req.user = { id: row.id, email: row.email, name: row.name };
    req.accountId = row.account_id;
    next();
  };
}

module.exports = { hashPassword, verifyPassword, createSession, destroySession, requireAuth, parseCookies };
