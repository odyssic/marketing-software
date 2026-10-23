const express = require('express');
const crypto = require('node:crypto');
const path = require('node:path');
const { openDb, transaction, appSecret } = require('./db');
const auth = require('./auth');
const { renderPage, esc } = require('./render');
const { TEMPLATES } = require('./templates');
const mailer = require('./mailer');

const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '')
  .trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60) || 'page';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const parseTags = (t) => [...new Set((Array.isArray(t) ? t : String(t || '').split(','))
  .map((x) => String(x).trim().toLowerCase()).filter(Boolean))];

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function createApp({ dbPath } = {}) {
  const db = openDb(dbPath);
  const secret = appSecret(db);
  const app = express();
  app.set('trust proxy', true);
  app.disable('x-powered-by');

  const baseUrl = (req) => process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  const unsubToken = (contactId) => `${contactId}.${crypto.createHmac('sha256', secret).update(`unsub:${contactId}`).digest('hex').slice(0, 24)}`;

  // ---------- helpers scoped to the signed-in workspace ----------
  const getFunnel = (accountId, id) => {
    const f = db.prepare('SELECT * FROM funnels WHERE id = ? AND account_id = ?').get(id, accountId);
    if (!f) throw new HttpError(404, 'Funnel not found');
    return f;
  };
  const getStep = (accountId, id) => {
    const s = db.prepare(`SELECT s.*, f.account_id, f.slug AS funnel_slug FROM funnel_steps s
      JOIN funnels f ON f.id = s.funnel_id WHERE s.id = ? AND f.account_id = ?`).get(id, accountId);
    if (!s) throw new HttpError(404, 'Page not found');
    return s;
  };
  const stepOut = (s) => ({ ...s, blocks: JSON.parse(s.blocks), settings: JSON.parse(s.settings) });
  const contactOut = (c) => ({ ...c, tags: JSON.parse(c.tags), unsubscribed: Boolean(c.unsubscribed) });
  const uniqueFunnelSlug = (name) => {
    let slug = slugify(name);
    while (db.prepare('SELECT 1 FROM funnels WHERE slug = ?').get(slug)) {
      slug = `${slugify(name).slice(0, 52)}-${crypto.randomBytes(3).toString('hex')}`;
    }
    return slug;
  };
  const uniqueStepSlug = (funnelId, name, exceptId = 0) => {
    const base = slugify(name);
    let slug = base;
    for (let n = 2; db.prepare('SELECT 1 FROM funnel_steps WHERE funnel_id = ? AND slug = ? AND id != ?').get(funnelId, slug, exceptId); n++) {
      slug = `${base}-${n}`;
    }
    return slug;
  };
  const insertStep = (funnelId, step, position) => db.prepare(`INSERT INTO funnel_steps
      (funnel_id, name, slug, position, blocks, settings) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(funnelId, step.name, uniqueStepSlug(funnelId, step.slug || step.name), position,
      JSON.stringify(step.blocks || []), JSON.stringify(step.settings || {}));

  // Creates the contact or merges into an existing one (same email = same person).
  function upsertContact(accountId, { email, first_name = '', last_name = '', phone = '', tags = [], source = 'manual' }) {
    email = String(email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'A valid email is required');
    const existing = db.prepare('SELECT * FROM contacts WHERE account_id = ? AND email = ?').get(accountId, email);
    if (existing) {
      const merged = parseTags([...JSON.parse(existing.tags), ...parseTags(tags)]);
      db.prepare(`UPDATE contacts SET tags = ?, first_name = COALESCE(NULLIF(?, ''), first_name),
        last_name = COALESCE(NULLIF(?, ''), last_name), phone = COALESCE(NULLIF(?, ''), phone) WHERE id = ?`)
        .run(JSON.stringify(merged), first_name.trim(), last_name.trim(), phone.trim(), existing.id);
      return { id: existing.id, created: false };
    }
    const r = db.prepare(`INSERT INTO contacts (account_id, email, first_name, last_name, phone, tags, source)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(accountId, email, first_name.trim(), last_name.trim(), phone.trim(),
      JSON.stringify(parseTags(tags)), source);
    return { id: Number(r.lastInsertRowid), created: true };
  }

  // ---------- API ----------
  const api = express.Router();
  api.use(express.json({ limit: '1mb' }));
  // Basic CSRF defence: state-changing API calls must be JSON, which a
  // cross-site HTML form cannot send.
  api.use((req, res, next) => {
    if (req.method !== 'GET' && !req.is('application/json')) {
      return res.status(415).json({ error: 'Expected application/json' });
    }
    next();
  });

  api.post('/auth/signup', (req, res) => {
    const { name, email, password, workspace } = req.body || {};
    if (!name?.trim() || !EMAIL_RE.test(email || '')) throw new HttpError(400, 'Name and a valid email are required');
    if (!password || password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'An account with this email already exists');
    const { userId, accountId } = transaction(db, () => {
      const u = db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)')
        .run(email.trim().toLowerCase(), name.trim(), auth.hashPassword(password));
      const a = db.prepare('INSERT INTO accounts (name, from_name, from_email) VALUES (?, ?, ?)')
        .run(workspace?.trim() || `${name.trim()}'s business`, name.trim(), email.trim().toLowerCase());
      db.prepare('INSERT INTO memberships (user_id, account_id) VALUES (?, ?)').run(u.lastInsertRowid, a.lastInsertRowid);
      return { userId: u.lastInsertRowid, accountId: a.lastInsertRowid };
    });
    auth.createSession(db, res, userId, accountId);
    res.status(201).json({ ok: true });
  });

  api.post('/auth/login', (req, res) => {
    const { email, password } = req.body || {};
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim());
    if (!user || !auth.verifyPassword(String(password || ''), user.password_hash)) {
      throw new HttpError(401, 'Wrong email or password');
    }
    const m = db.prepare('SELECT account_id FROM memberships WHERE user_id = ? ORDER BY account_id LIMIT 1').get(user.id);
    auth.createSession(db, res, user.id, m.account_id);
    res.json({ ok: true });
  });

  api.post('/auth/logout', (req, res) => {
    auth.destroySession(db, req, res);
    res.json({ ok: true });
  });

  api.use(auth.requireAuth(db));

  api.get('/me', (req, res) => {
    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.accountId);
    res.json({ user: req.user, account, emailLive: mailer.isLive(), baseUrl: baseUrl(req) });
  });

  api.put('/account', (req, res) => {
    const { name, from_name, from_email } = req.body || {};
    if (!name?.trim()) throw new HttpError(400, 'Workspace name is required');
    if (from_email && !EMAIL_RE.test(from_email)) throw new HttpError(400, 'Sender email is not valid');
    db.prepare('UPDATE accounts SET name = ?, from_name = ?, from_email = ? WHERE id = ?')
      .run(name.trim(), from_name?.trim() || '', from_email?.trim() || '', req.accountId);
    res.json({ ok: true });
  });

  api.get('/dashboard', (req, res) => {
    const a = req.accountId;
    const one = (sql, ...p) => Object.values(db.prepare(sql).get(a, ...p))[0];
    const views = one("SELECT COUNT(*) FROM page_events WHERE account_id = ? AND type = 'view' AND created_at >= datetime('now', '-30 days')");
    const optins = one("SELECT COUNT(*) FROM page_events WHERE account_id = ? AND type = 'optin' AND created_at >= datetime('now', '-30 days')");
    const daily = db.prepare(`SELECT date(created_at) AS day, COUNT(*) AS n FROM contacts
      WHERE account_id = ? AND created_at >= datetime('now', '-13 days') GROUP BY day`).all(a);
    res.json({
      contacts: one('SELECT COUNT(*) FROM contacts WHERE account_id = ?'),
      newContacts7d: one("SELECT COUNT(*) FROM contacts WHERE account_id = ? AND created_at >= datetime('now', '-7 days')"),
      views30d: views,
      optins30d: optins,
      conversion: views ? Math.round((optins / views) * 1000) / 10 : 0,
      funnels: one('SELECT COUNT(*) FROM funnels WHERE account_id = ?'),
      emailsSent: one("SELECT COUNT(*) FROM email_log WHERE account_id = ? AND status IN ('sent', 'logged')"),
      daily,
      recent: db.prepare('SELECT * FROM contacts WHERE account_id = ? ORDER BY id DESC LIMIT 6').all(a).map(contactOut),
    });
  });

  // Contacts
  api.get('/contacts', (req, res) => {
    const q = `%${String(req.query.q || '').trim()}%`;
    const tag = String(req.query.tag || '').trim().toLowerCase();
    const rows = db.prepare(`SELECT * FROM contacts WHERE account_id = ?
      AND (email LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR phone LIKE ?)
      ORDER BY id DESC LIMIT 1000`).all(req.accountId, q, q, q, q).map(contactOut);
    res.json(tag ? rows.filter((c) => c.tags.includes(tag)) : rows);
  });

  api.get('/contacts/export.csv', (req, res) => {
    const rows = db.prepare('SELECT * FROM contacts WHERE account_id = ? ORDER BY id').all(req.accountId).map(contactOut);
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['email', 'first_name', 'last_name', 'phone', 'tags', 'source', 'unsubscribed', 'created_at'].join(',')];
    for (const c of rows) {
      lines.push([c.email, c.first_name, c.last_name, c.phone, c.tags.join(';'), c.source, c.unsubscribed, c.created_at].map(cell).join(','));
    }
    res.type('text/csv').attachment('contacts.csv').send(lines.join('\n'));
  });

  api.post('/contacts', (req, res) => {
    const r = upsertContact(req.accountId, { ...req.body, source: 'manual' });
    if (!r.created) throw new HttpError(409, 'A contact with this email already exists');
    res.status(201).json(contactOut(db.prepare('SELECT * FROM contacts WHERE id = ?').get(r.id)));
  });

  api.post('/contacts/import', (req, res) => {
    const rows = Array.isArray(req.body?.contacts) ? req.body.contacts : [];
    let created = 0, updated = 0, skipped = 0;
    transaction(db, () => {
      for (const row of rows.slice(0, 10000)) {
        try {
          const r = upsertContact(req.accountId, { ...row, tags: parseTags(row.tags), source: 'import' });
          r.created ? created++ : updated++;
        } catch { skipped++; }
      }
    });
    res.json({ created, updated, skipped });
  });

  api.put('/contacts/:id', (req, res) => {
    const c = db.prepare('SELECT * FROM contacts WHERE id = ? AND account_id = ?').get(req.params.id, req.accountId);
    if (!c) throw new HttpError(404, 'Contact not found');
    const b = req.body || {};
    const email = String(b.email ?? c.email).trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'A valid email is required');
    try {
      db.prepare(`UPDATE contacts SET email = ?, first_name = ?, last_name = ?, phone = ?, tags = ?, unsubscribed = ?
        WHERE id = ?`).run(email, String(b.first_name ?? c.first_name).trim(), String(b.last_name ?? c.last_name).trim(),
        String(b.phone ?? c.phone).trim(), JSON.stringify(b.tags !== undefined ? parseTags(b.tags) : JSON.parse(c.tags)),
        b.unsubscribed !== undefined ? Number(Boolean(b.unsubscribed)) : c.unsubscribed, c.id);
    } catch (e) {
      if (/UNIQUE/.test(e.message)) throw new HttpError(409, 'Another contact already uses this email');
      throw e;
    }
    res.json(contactOut(db.prepare('SELECT * FROM contacts WHERE id = ?').get(c.id)));
  });

  api.delete('/contacts/:id', (req, res) => {
    db.prepare('DELETE FROM contacts WHERE id = ? AND account_id = ?').run(req.params.id, req.accountId);
    res.json({ ok: true });
  });

  api.get('/tags', (req, res) => {
    const counts = {};
    for (const { tags } of db.prepare('SELECT tags FROM contacts WHERE account_id = ?').all(req.accountId)) {
      for (const t of JSON.parse(tags)) counts[t] = (counts[t] || 0) + 1;
    }
    res.json(Object.entries(counts).sort((x, y) => y[1] - x[1]).map(([tag, count]) => ({ tag, count })));
  });

  // Funnels
  api.get('/templates', (req, res) => {
    res.json(Object.entries(TEMPLATES).map(([key, t]) => ({ key, label: t.label })));
  });

  api.get('/funnels', (req, res) => {
    res.json(db.prepare(`SELECT f.*,
        (SELECT COUNT(*) FROM funnel_steps s WHERE s.funnel_id = f.id) AS steps,
        (SELECT COUNT(*) FROM page_events e WHERE e.funnel_id = f.id AND e.type = 'view') AS views,
        (SELECT COUNT(*) FROM page_events e WHERE e.funnel_id = f.id AND e.type = 'optin') AS optins
      FROM funnels f WHERE f.account_id = ? ORDER BY f.id DESC`).all(req.accountId));
  });

  api.post('/funnels', (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) throw new HttpError(400, 'Give your funnel a name');
    const template = TEMPLATES[req.body?.template] || TEMPLATES.optin;
    const id = transaction(db, () => {
      const f = db.prepare('INSERT INTO funnels (account_id, name, slug) VALUES (?, ?, ?)')
        .run(req.accountId, name, uniqueFunnelSlug(name));
      template.steps().forEach((s, i) => insertStep(f.lastInsertRowid, s, i));
      return Number(f.lastInsertRowid);
    });
    res.status(201).json({ id });
  });

  api.get('/funnels/:id', (req, res) => {
    const f = getFunnel(req.accountId, req.params.id);
    const steps = db.prepare(`SELECT s.*,
        (SELECT COUNT(*) FROM page_events e WHERE e.step_id = s.id AND e.type = 'view') AS views,
        (SELECT COUNT(*) FROM page_events e WHERE e.step_id = s.id AND e.type = 'optin') AS optins
      FROM funnel_steps s WHERE s.funnel_id = ? ORDER BY position`).all(f.id).map(stepOut);
    res.json({ ...f, steps });
  });

  api.put('/funnels/:id', (req, res) => {
    const f = getFunnel(req.accountId, req.params.id);
    const name = String(req.body?.name ?? f.name).trim() || f.name;
    let slug = req.body?.slug !== undefined ? slugify(req.body.slug) : f.slug;
    if (slug !== f.slug && db.prepare('SELECT 1 FROM funnels WHERE slug = ?').get(slug)) {
      throw new HttpError(409, 'That URL is already taken, try another');
    }
    db.prepare('UPDATE funnels SET name = ?, slug = ? WHERE id = ?').run(name, slug, f.id);
    res.json({ ok: true, slug });
  });

  api.delete('/funnels/:id', (req, res) => {
    const f = getFunnel(req.accountId, req.params.id);
    db.prepare('DELETE FROM funnels WHERE id = ?').run(f.id);
    res.json({ ok: true });
  });

  api.post('/funnels/:id/steps', (req, res) => {
    const f = getFunnel(req.accountId, req.params.id);
    const name = String(req.body?.name || '').trim() || 'New page';
    const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM funnel_steps WHERE funnel_id = ?').get(f.id).p;
    const r = insertStep(f.id, { name, blocks: [], settings: {} }, pos);
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  });

  api.get('/steps/:id', (req, res) => {
    const s = getStep(req.accountId, req.params.id);
    const funnel = db.prepare('SELECT id, name, slug FROM funnels WHERE id = ?').get(s.funnel_id);
    res.json({ ...stepOut(s), funnel });
  });

  api.put('/steps/:id', (req, res) => {
    const s = getStep(req.accountId, req.params.id);
    const b = req.body || {};
    const name = String(b.name ?? s.name).trim() || s.name;
    const slug = b.slug !== undefined ? uniqueStepSlug(s.funnel_id, b.slug, s.id) : s.slug;
    const blocks = Array.isArray(b.blocks) ? b.blocks : JSON.parse(s.blocks);
    const settings = b.settings && typeof b.settings === 'object' ? b.settings : JSON.parse(s.settings);
    db.prepare(`UPDATE funnel_steps SET name = ?, slug = ?, blocks = ?, settings = ?, updated_at = datetime('now')
      WHERE id = ?`).run(name, slug, JSON.stringify(blocks), JSON.stringify(settings), s.id);
    res.json({ ok: true, slug });
  });

  api.post('/steps/:id/move', (req, res) => {
    const s = getStep(req.accountId, req.params.id);
    const steps = db.prepare('SELECT id FROM funnel_steps WHERE funnel_id = ? ORDER BY position').all(s.funnel_id).map((x) => x.id);
    const i = steps.indexOf(s.id);
    const j = req.body?.direction === 'up' ? i - 1 : i + 1;
    if (j >= 0 && j < steps.length) {
      [steps[i], steps[j]] = [steps[j], steps[i]];
      transaction(db, () => steps.forEach((id, pos) => db.prepare('UPDATE funnel_steps SET position = ? WHERE id = ?').run(pos, id)));
    }
    res.json({ ok: true });
  });

  api.delete('/steps/:id', (req, res) => {
    const s = getStep(req.accountId, req.params.id);
    db.prepare('DELETE FROM funnel_steps WHERE id = ?').run(s.id);
    res.json({ ok: true });
  });

  api.post('/preview', (req, res) => {
    const { blocks, settings, name } = req.body || {};
    res.json({ html: renderPage({ title: name || 'Preview', blocks, settings, preview: true }) });
  });

  // Email broadcasts
  api.get('/broadcasts', (req, res) => {
    res.json(db.prepare('SELECT * FROM broadcasts WHERE account_id = ? ORDER BY id DESC').all(req.accountId));
  });

  api.post('/broadcasts', (req, res) => {
    const { subject, body, tag } = req.body || {};
    if (!subject?.trim() || !body?.trim()) throw new HttpError(400, 'Subject and message are required');
    const r = db.prepare('INSERT INTO broadcasts (account_id, subject, body, tag) VALUES (?, ?, ?, ?)')
      .run(req.accountId, subject.trim(), body, String(tag || '').trim().toLowerCase());
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  });

  api.delete('/broadcasts/:id', (req, res) => {
    db.prepare("DELETE FROM broadcasts WHERE id = ? AND account_id = ? AND status = 'draft'").run(req.params.id, req.accountId);
    res.json({ ok: true });
  });

  api.post('/broadcasts/:id/send', async (req, res) => {
    const b = db.prepare('SELECT * FROM broadcasts WHERE id = ? AND account_id = ?').get(req.params.id, req.accountId);
    if (!b) throw new HttpError(404, 'Broadcast not found');
    if (b.status !== 'draft') throw new HttpError(409, 'This broadcast was already sent');
    db.prepare("UPDATE broadcasts SET status = 'sending' WHERE id = ?").run(b.id);
    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.accountId);
    const from = account.from_email ? `"${(account.from_name || account.name).replace(/"/g, '')}" <${account.from_email}>`
      : process.env.SMTP_FROM || 'no-reply@localhost';
    const recipients = db.prepare('SELECT * FROM contacts WHERE account_id = ? AND unsubscribed = 0').all(req.accountId)
      .map(contactOut).filter((c) => !b.tag || c.tags.includes(b.tag));
    const log = db.prepare(`INSERT INTO email_log (account_id, broadcast_id, contact_id, to_email, subject, body, status, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    let sent = 0;
    for (const c of recipients) {
      const merge = (s) => s.replace(/\{\{\s*(first_name|last_name|email)\s*\}\}/g, (_, k) => c[k] || '');
      const subject = merge(b.subject);
      const text = `${merge(b.body)}\n\n--\nUnsubscribe: ${baseUrl(req)}/unsubscribe/${unsubToken(c.id)}`;
      try {
        const r = await mailer.sendEmail({ from, to: c.email, subject, text });
        log.run(req.accountId, b.id, c.id, c.email, subject, text, r.status, null);
        sent++;
      } catch (e) {
        log.run(req.accountId, b.id, c.id, c.email, subject, text, 'failed', e.message);
      }
    }
    db.prepare("UPDATE broadcasts SET status = 'sent', sent_count = ?, sent_at = datetime('now') WHERE id = ?").run(sent, b.id);
    res.json({ sent, total: recipients.length });
  });

  api.get('/outbox', (req, res) => {
    res.json(db.prepare('SELECT * FROM email_log WHERE account_id = ? ORDER BY id DESC LIMIT 200').all(req.accountId));
  });

  api.use((req, res) => res.status(404).json({ error: 'Not found' }));
  app.use('/api', api);

  // ---------- Public funnel pages ----------
  const findPublicStep = (funnelSlug, stepSlug) => {
    const funnel = db.prepare('SELECT * FROM funnels WHERE slug = ?').get(funnelSlug);
    if (!funnel) return null;
    const steps = db.prepare('SELECT * FROM funnel_steps WHERE funnel_id = ? ORDER BY position').all(funnel.id);
    const idx = stepSlug ? steps.findIndex((s) => s.slug === stepSlug) : 0;
    if (idx < 0 || !steps[idx]) return null;
    const next = steps[idx + 1];
    return { funnel, step: steps[idx], nextUrl: next ? `/f/${funnel.slug}/${next.slug}` : '#' };
  };

  const notFound = (res) => res.status(404).type('html').send('<!doctype html><title>Not found</title><p style="font:18px system-ui;text-align:center;margin-top:20vh">Page not found.</p>');

  app.get('/f/:funnel{/:step}', (req, res) => {
    const found = findPublicStep(req.params.funnel, req.params.step);
    if (!found) return notFound(res);
    const { funnel, step, nextUrl } = found;
    db.prepare("INSERT INTO page_events (account_id, funnel_id, step_id, type) VALUES (?, ?, ?, 'view')")
      .run(funnel.account_id, funnel.id, step.id);
    res.type('html').send(renderPage({
      title: step.name, blocks: JSON.parse(step.blocks), settings: JSON.parse(step.settings),
      nextUrl, formAction: `/f/${funnel.slug}/${step.slug}/optin`,
    }));
  });

  app.post('/f/:funnel/:step/optin', express.urlencoded({ extended: false, limit: '20kb' }), (req, res) => {
    const found = findPublicStep(req.params.funnel, req.params.step);
    if (!found) return notFound(res);
    const { funnel, step, nextUrl } = found;
    const back = `/f/${funnel.slug}/${step.slug}`;
    if (req.body.website) return res.redirect(303, nextUrl === '#' ? back : nextUrl); // honeypot: bots fill hidden field
    const block = JSON.parse(step.blocks).find((b) => b.type === 'form' && b.id === req.body.block)
      || JSON.parse(step.blocks).find((b) => b.type === 'form') || {};
    let contact;
    try {
      contact = upsertContact(funnel.account_id, {
        email: req.body.email, first_name: String(req.body.first_name || ''), phone: String(req.body.phone || ''),
        tags: parseTags(block.tag), source: `funnel: ${funnel.name}`,
      });
    } catch (e) {
      if (e.status === 400) return res.status(400).type('html').send(`<!doctype html><p style="font:18px system-ui;text-align:center;margin-top:20vh">Please enter a valid email. <a href="${esc(back)}">Go back</a></p>`);
      throw e;
    }
    db.prepare("INSERT INTO page_events (account_id, funnel_id, step_id, type, contact_id) VALUES (?, ?, ?, 'optin', ?)")
      .run(funnel.account_id, funnel.id, step.id, contact.id);
    if (nextUrl !== '#') return res.redirect(303, nextUrl);
    res.type('html').send('<!doctype html><meta name="viewport" content="width=device-width"><p style="font:20px system-ui;text-align:center;margin-top:20vh">Thanks! You are subscribed.</p>');
  });

  app.get('/unsubscribe/:token', (req, res) => {
    const token = String(req.params.token);
    const [id] = token.split('.');
    const expected = /^\d+$/.test(id) ? unsubToken(id) : '';
    const valid = Boolean(expected) && token.length === expected.length
      && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
    if (valid) db.prepare('UPDATE contacts SET unsubscribed = 1 WHERE id = ?').run(id);
    res.type('html').send(`<!doctype html><meta name="viewport" content="width=device-width"><p style="font:20px system-ui;text-align:center;margin-top:20vh">${
      valid ? 'You have been unsubscribed.' : 'This unsubscribe link is invalid.'}</p>`);
  });

  // ---------- Dashboard SPA ----------
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

  app.use((err, req, res, next) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status === 500) console.error(err);
    if (res.headersSent) return next(err);
    if (req.path.startsWith('/api')) return res.status(status).json({ error: status === 500 ? 'Something went wrong' : err.message });
    res.status(status).send(status === 500 ? 'Something went wrong' : esc(err.message));
  });

  app.locals.db = db;
  return app;
}

module.exports = { createApp };
