const crypto = require('node:crypto');

const SESSION_DAYS = 30;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false; // signed up with email links only
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

async function createSession(db, req, res, userId, accountId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  await db.run('INSERT INTO sessions (token, user_id, account_id, expires_at) VALUES (?, ?, ?, ?)',
    token, userId, accountId, expires.toISOString());
  res.cookie('sid', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure, // true behind HTTPS (trust proxy reads X-Forwarded-Proto)
    expires,
  });
}

// Points the current session at another workspace (the caller checks membership).
async function switchAccount(db, req, accountId) {
  const token = parseCookies(req.headers.cookie).sid;
  await db.run('UPDATE sessions SET account_id = ? WHERE token = ?', accountId, token);
}

async function destroySession(db, req, res) {
  const token = parseCookies(req.headers.cookie).sid;
  if (token) await db.run('DELETE FROM sessions WHERE token = ?', token);
  res.clearCookie('sid');
}

// Attaches req.user and req.accountId, or responds 401.
function requireAuth(getDb) {
  return async (req, res, next) => {
    const token = parseCookies(req.headers.cookie).sid;
    const row = token && await getDb().get(`
      SELECT s.account_id, s.expires_at, u.id, u.email, u.name
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ?`, token);
    if (!row || new Date(row.expires_at) < new Date()) {
      return res.status(401).json({ error: 'Not signed in' });
    }
    req.user = { id: row.id, email: row.email, name: row.name };
    req.accountId = row.account_id;
    next();
  };
}

module.exports = { hashPassword, verifyPassword, createSession, destroySession, switchAccount, requireAuth, parseCookies };
