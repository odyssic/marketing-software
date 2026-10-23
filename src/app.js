const express = require('express');
const crypto = require('node:crypto');
const path = require('node:path');
const { openDb, appSecret, defaultDir } = require('./db');
const auth = require('./auth');
const { renderPage, esc, formatMoney } = require('./render');
const { TEMPLATES } = require('./templates');
const mailer = require('./mailer');
const stripe = require('./stripe');

const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '')
  .trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60) || 'page';
const CURRENCIES = ['usd', 'eur', 'gbp', 'cad', 'aud'];
const BILLING = ['one_time', 'monthly', 'yearly'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const parseTags = (t) => [...new Set((Array.isArray(t) ? t : String(t || '').split(','))
  .map((x) => String(x).trim().toLowerCase()).filter(Boolean))];
const isUniqueViolation = (e) => e?.code === '23505';
const iso = (d) => (d instanceof Date ? d.toISOString() : d);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// dbPath: ':memory:' for a throwaway in-process database (tests), a directory
// for a local PGlite database, or omitted to use DATABASE_URL when set.
function createApp({ dbPath } = {}) {
  let db, secret, ready;
  const dbOptions = dbPath === ':memory:' ? {} : dbPath ? { dir: dbPath }
    : process.env.DATABASE_URL ? { url: process.env.DATABASE_URL } : { dir: defaultDir() };
  // Connect lazily on the first request, and retry on the next one if it failed
  // (a serverless instance shouldn't stay broken after one bad connection).
  const init = () => (ready ??= (async () => {
    db = await openDb(dbOptions);
    secret = await appSecret(db);
  })().catch((e) => { ready = null; throw e; }));

  const app = express();
  app.set('trust proxy', true);
  app.disable('x-powered-by');
  app.use(async (req, res, next) => { try { await init(); next(); } catch (e) { next(e); } });

  const baseUrl = (req) => process.env.PUBLIC_URL || `${req.protocol}://${req.host}`; // req.host honours X-Forwarded-Host
  const unsubToken = (contactId) => `${contactId}.${crypto.createHmac('sha256', secret).update(`unsub:${contactId}`).digest('hex').slice(0, 24)}`;
  const orderToken = (orderId) => crypto.createHmac('sha256', secret).update(`order:${orderId}`).digest('hex').slice(0, 24);
  const id = (v) => (/^\d{1,9}$/.test(String(v)) ? Number(v) : -1);

  // ---------- helpers scoped to the signed-in workspace ----------
  // Helpers that may run inside a transaction take the query runner `q` first.
  const getFunnel = async (accountId, funnelId) => {
    const f = await db.get('SELECT * FROM funnels WHERE id = ? AND account_id = ?', id(funnelId), accountId);
    if (!f) throw new HttpError(404, 'Funnel not found');
    return f;
  };
  const getStep = async (accountId, stepId) => {
    const s = await db.get(`SELECT s.*, f.account_id, f.slug AS funnel_slug FROM funnel_steps s
      JOIN funnels f ON f.id = s.funnel_id WHERE s.id = ? AND f.account_id = ?`, id(stepId), accountId);
    if (!s) throw new HttpError(404, 'Page not found');
    return s;
  };
  const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const stepInFunnel = async (q, funnelId, stepId) => {
    const st = await q.get('SELECT * FROM funnel_steps WHERE id = ? AND funnel_id = ?', id(stepId), funnelId);
    if (!st) throw new HttpError(400, 'That page isn’t part of this funnel');
    return st;
  };
  const stepOut = (s) => ({ ...s, blocks: JSON.parse(s.blocks), settings: JSON.parse(s.settings) });
  const contactOut = (c) => ({ ...c, tags: JSON.parse(c.tags), unsubscribed: Boolean(c.unsubscribed) });
  const uniqueFunnelSlug = async (q, name) => {
    let slug = slugify(name);
    while (await q.get('SELECT 1 FROM funnels WHERE slug = ?', slug)) {
      slug = `${slugify(name).slice(0, 52)}-${crypto.randomBytes(3).toString('hex')}`;
    }
    return slug;
  };
  const uniqueStepSlug = async (q, funnelId, name, exceptId = 0) => {
    const base = slugify(name);
    let slug = base;
    for (let n = 2; await q.get('SELECT 1 FROM funnel_steps WHERE funnel_id = ? AND slug = ? AND id != ?', funnelId, slug, exceptId); n++) {
      slug = `${base}-${n}`;
    }
    return slug;
  };
  const insertStep = async (q, funnelId, step, position) => (await q.get(`INSERT INTO funnel_steps
      (funnel_id, name, slug, position, blocks, settings) VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
  funnelId, step.name, await uniqueStepSlug(q, funnelId, step.slug || step.name), position,
  JSON.stringify(step.blocks || []), JSON.stringify(step.settings || {}))).id;

  // Creates the contact or merges into an existing one (same email = same person).
  async function upsertContact(q, accountId, { email, first_name = '', last_name = '', phone = '', tags = [], source = 'manual' }) {
    email = String(email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'A valid email is required');
    const existing = await q.get('SELECT * FROM contacts WHERE account_id = ? AND email = ?', accountId, email);
    if (existing) {
      const merged = parseTags([...JSON.parse(existing.tags), ...parseTags(tags)]);
      await q.run(`UPDATE contacts SET tags = ?, first_name = COALESCE(NULLIF(?, ''), first_name),
        last_name = COALESCE(NULLIF(?, ''), last_name), phone = COALESCE(NULLIF(?, ''), phone) WHERE id = ?`,
      JSON.stringify(merged), String(first_name).trim(), String(last_name).trim(), String(phone).trim(), existing.id);
      return { id: existing.id, created: false };
    }
    const r = await q.get(`INSERT INTO contacts (account_id, email, first_name, last_name, phone, tags, source)
      VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`, accountId, email, String(first_name).trim(), String(last_name).trim(),
    String(phone).trim(), JSON.stringify(parseTags(tags)), source);
    return { id: r.id, created: true };
  }

  const productsMap = async (accountId) => Object.fromEntries(
    (await db.all('SELECT * FROM products WHERE account_id = ?', accountId)).map((p) => [p.id, p]),
  );
  // Public URL of the page a step's "yes" (next_step_id) or "no" exit leads to.
  const linkUrl = async (linkedId) => {
    const st = linkedId && await db.get(`SELECT s.slug, f.slug AS funnel_slug FROM funnel_steps s
      JOIN funnels f ON f.id = s.funnel_id WHERE s.id = ?`, linkedId);
    return st ? `/f/${st.funnel_slug}/${st.slug}` : null;
  };
  const stepAfter = async (stepId) => linkUrl((await db.get('SELECT next_step_id FROM funnel_steps WHERE id = ?', stepId))?.next_step_id);

  // Marks an order paid and adds the buyer to contacts, tagged as a customer.
  // Idempotent: the success redirect and the Stripe webhook can both call it.
  async function fulfilOrder(order, { email, name = '', sessionId } = {}) {
    await db.tx(async (t) => {
      const cur = await t.get('SELECT status FROM orders WHERE id = ? FOR UPDATE', order.id);
      if (cur.status === 'paid') return;
      const product = order.product_id && await t.get('SELECT * FROM products WHERE id = ?', order.product_id);
      const contact = await upsertContact(t, order.account_id, {
        email: email || order.email, first_name: name.split(' ')[0] || '',
        last_name: name.split(' ').slice(1).join(' '),
        tags: ['customer', ...parseTags(product?.tag)], source: `order: ${order.product_name}`,
      });
      await t.run(`UPDATE orders SET status = 'paid', paid_at = now(), contact_id = ?, email = ?,
        stripe_session_id = COALESCE(?, stripe_session_id) WHERE id = ?`,
      contact.id, String(email || order.email).toLowerCase(), sessionId ?? null, order.id);
      if (order.funnel_id && order.step_id) {
        await t.run("INSERT INTO page_events (account_id, funnel_id, step_id, type, contact_id) VALUES (?, ?, ?, 'sale', ?)",
          order.account_id, order.funnel_id, order.step_id, contact.id);
      }
    });
  }

  // ---------- API ----------
  const api = express.Router();
  api.use(express.json({ limit: '1mb' }));
  // Basic CSRF defence: state-changing API calls must be JSON, which a
  // cross-site HTML form cannot send.
  api.use((req, res, next) => {
    // Check the header, not req.is(): DELETEs have no body, and req.is() is null without one.
    if (req.method !== 'GET' && !String(req.get('content-type') || '').startsWith('application/json')) {
      return res.status(415).json({ error: 'Expected application/json' });
    }
    next();
  });

  api.get('/health', async (req, res) => {
    await db.get('SELECT 1');
    res.json({ ok: true, database: dbOptions.url ? 'postgres' : 'pglite' });
  });

  api.post('/auth/signup', async (req, res) => {
    const { name, password, workspace } = req.body || {};
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!name?.trim() || !EMAIL_RE.test(email)) throw new HttpError(400, 'Name and a valid email are required');
    if (!password || password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
    if (await db.get('SELECT 1 FROM users WHERE email = ?', email)) throw new HttpError(409, 'An account with this email already exists');
    let ids;
    try {
      ids = await db.tx(async (t) => {
        const u = await t.get('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?) RETURNING id',
          email, name.trim(), auth.hashPassword(password));
        const a = await t.get('INSERT INTO accounts (name, from_name, from_email) VALUES (?, ?, ?) RETURNING id',
          workspace?.trim() || `${name.trim()}'s business`, name.trim(), email);
        await t.run('INSERT INTO memberships (user_id, account_id) VALUES (?, ?)', u.id, a.id);
        return { userId: u.id, accountId: a.id };
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new HttpError(409, 'An account with this email already exists');
      throw e;
    }
    await auth.createSession(db, req, res, ids.userId, ids.accountId);
    res.status(201).json({ ok: true });
  });

  api.post('/auth/login', async (req, res) => {
    const { password } = req.body || {};
    const user = await db.get('SELECT * FROM users WHERE email = ?', String(req.body?.email || '').trim().toLowerCase());
    if (!user || !auth.verifyPassword(String(password || ''), user.password_hash)) {
      throw new HttpError(401, 'Wrong email or password');
    }
    const m = await db.get('SELECT account_id FROM memberships WHERE user_id = ? ORDER BY account_id LIMIT 1', user.id);
    await auth.createSession(db, req, res, user.id, m.account_id);
    res.json({ ok: true });
  });

  api.post('/auth/logout', async (req, res) => {
    await auth.destroySession(db, req, res);
    res.json({ ok: true });
  });

  api.use(auth.requireAuth(() => db));

  api.get('/me', async (req, res) => {
    const { stripe_secret_key: key, stripe_webhook_secret: whsec, ...account } = await db.get('SELECT * FROM accounts WHERE id = ?', req.accountId);
    res.json({
      user: req.user, account, emailLive: mailer.isLive(), baseUrl: baseUrl(req),
      payments: {
        connected: Boolean(key), testKey: key.startsWith('sk_test_') || key.startsWith('rk_test_'),
        keyHint: key ? `…${key.slice(-4)}` : '', webhookSecretSet: Boolean(whsec),
        webhookUrl: `${baseUrl(req)}/stripe/webhook/${req.accountId}`,
      },
    });
  });

  // Secrets are write-only: the browser never gets them back, only whether they're set.
  api.put('/account/stripe', async (req, res) => {
    const { secretKey, webhookSecret, disconnect } = req.body || {};
    if (disconnect) {
      await db.run("UPDATE accounts SET stripe_secret_key = '', stripe_webhook_secret = '' WHERE id = ?", req.accountId);
      return res.json({ ok: true });
    }
    if (secretKey) {
      if (!/^(sk|rk)_(test|live)_\w+$/.test(secretKey.trim())) {
        throw new HttpError(400, 'That doesn’t look like a Stripe secret key (it starts with sk_live_ or sk_test_)');
      }
      await db.run('UPDATE accounts SET stripe_secret_key = ? WHERE id = ?', secretKey.trim(), req.accountId);
    }
    if (webhookSecret) {
      if (!/^whsec_\w+$/.test(webhookSecret.trim())) throw new HttpError(400, 'Webhook signing secrets start with whsec_');
      await db.run('UPDATE accounts SET stripe_webhook_secret = ? WHERE id = ?', webhookSecret.trim(), req.accountId);
    }
    res.json({ ok: true });
  });

  api.put('/account', async (req, res) => {
    const { name, from_name, from_email } = req.body || {};
    if (!name?.trim()) throw new HttpError(400, 'Workspace name is required');
    if (from_email && !EMAIL_RE.test(from_email)) throw new HttpError(400, 'Sender email is not valid');
    await db.run('UPDATE accounts SET name = ?, from_name = ?, from_email = ? WHERE id = ?',
      name.trim(), from_name?.trim() || '', from_email?.trim() || '', req.accountId);
    res.json({ ok: true });
  });

  api.get('/dashboard', async (req, res) => {
    const a = req.accountId;
    const one = async (sql) => (await db.get(sql, a)).n;
    const [views, optins, daily, contacts, newContacts7d, funnels, revenue, emailsSent, recent] = await Promise.all([
      one("SELECT COUNT(*)::int AS n FROM page_events WHERE account_id = ? AND type = 'view' AND created_at >= now() - interval '30 days'"),
      one("SELECT COUNT(*)::int AS n FROM page_events WHERE account_id = ? AND type = 'optin' AND created_at >= now() - interval '30 days'"),
      db.all(`SELECT to_char(created_at, 'YYYY-MM-DD') AS day, COUNT(*)::int AS n FROM contacts
        WHERE account_id = ? AND created_at >= now() - interval '13 days' GROUP BY day`, a),
      one('SELECT COUNT(*)::int AS n FROM contacts WHERE account_id = ?'),
      one("SELECT COUNT(*)::int AS n FROM contacts WHERE account_id = ? AND created_at >= now() - interval '7 days'"),
      one('SELECT COUNT(*)::int AS n FROM funnels WHERE account_id = ?'),
      db.all(`SELECT currency, SUM(amount_cents)::int AS cents, COUNT(*)::int AS n FROM orders
        WHERE account_id = ? AND status = 'paid' AND paid_at >= now() - interval '30 days' GROUP BY currency ORDER BY cents DESC`, a),
      one("SELECT COUNT(*)::int AS n FROM email_log WHERE account_id = ? AND status IN ('sent', 'logged')"),
      db.all('SELECT * FROM contacts WHERE account_id = ? ORDER BY id DESC LIMIT 6', a),
    ]);
    res.json({
      contacts, newContacts7d, views30d: views, optins30d: optins,
      conversion: views ? Math.round((optins / views) * 1000) / 10 : 0,
      funnels, emailsSent, daily,
      revenue30d: revenue.map((r) => ({ ...r, label: formatMoney(r.cents, r.currency) })),
      recent: recent.map(contactOut),
    });
  });

  // Contacts
  api.get('/contacts', async (req, res) => {
    const q = `%${String(req.query.q || '').trim()}%`;
    const tag = String(req.query.tag || '').trim().toLowerCase();
    const rows = (await db.all(`SELECT * FROM contacts WHERE account_id = ?
      AND (email ILIKE ? OR first_name ILIKE ? OR last_name ILIKE ? OR phone ILIKE ?)
      ORDER BY id DESC LIMIT 1000`, req.accountId, q, q, q, q)).map(contactOut);
    res.json(tag ? rows.filter((c) => c.tags.includes(tag)) : rows);
  });

  api.get('/contacts/export.csv', async (req, res) => {
    const rows = (await db.all('SELECT * FROM contacts WHERE account_id = ? ORDER BY id', req.accountId)).map(contactOut);
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['email', 'first_name', 'last_name', 'phone', 'tags', 'source', 'unsubscribed', 'created_at'].join(',')];
    for (const c of rows) {
      lines.push([c.email, c.first_name, c.last_name, c.phone, c.tags.join(';'), c.source, c.unsubscribed, iso(c.created_at)].map(cell).join(','));
    }
    res.type('text/csv').attachment('contacts.csv').send(lines.join('\n'));
  });

  api.post('/contacts', async (req, res) => {
    const r = await upsertContact(db, req.accountId, { ...req.body, source: 'manual' });
    if (!r.created) throw new HttpError(409, 'A contact with this email already exists');
    res.status(201).json(contactOut(await db.get('SELECT * FROM contacts WHERE id = ?', r.id)));
  });

  api.post('/contacts/import', async (req, res) => {
    const rows = Array.isArray(req.body?.contacts) ? req.body.contacts : [];
    let created = 0, updated = 0, skipped = 0;
    await db.tx(async (t) => {
      for (const row of rows.slice(0, 10000)) {
        if (!EMAIL_RE.test(String(row.email || '').trim())) { skipped++; continue; }
        const r = await upsertContact(t, req.accountId, { ...row, tags: parseTags(row.tags), source: 'import' });
        r.created ? created++ : updated++;
      }
    });
    res.json({ created, updated, skipped });
  });

  api.put('/contacts/:id', async (req, res) => {
    const c = await db.get('SELECT * FROM contacts WHERE id = ? AND account_id = ?', id(req.params.id), req.accountId);
    if (!c) throw new HttpError(404, 'Contact not found');
    const b = req.body || {};
    const email = String(b.email ?? c.email).trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'A valid email is required');
    try {
      await db.run(`UPDATE contacts SET email = ?, first_name = ?, last_name = ?, phone = ?, tags = ?, unsubscribed = ?
        WHERE id = ?`, email, String(b.first_name ?? c.first_name).trim(), String(b.last_name ?? c.last_name).trim(),
      String(b.phone ?? c.phone).trim(), JSON.stringify(b.tags !== undefined ? parseTags(b.tags) : JSON.parse(c.tags)),
      b.unsubscribed !== undefined ? Number(Boolean(b.unsubscribed)) : c.unsubscribed, c.id);
    } catch (e) {
      if (isUniqueViolation(e)) throw new HttpError(409, 'Another contact already uses this email');
      throw e;
    }
    res.json(contactOut(await db.get('SELECT * FROM contacts WHERE id = ?', c.id)));
  });

  api.delete('/contacts/:id', async (req, res) => {
    await db.run('DELETE FROM contacts WHERE id = ? AND account_id = ?', id(req.params.id), req.accountId);
    res.json({ ok: true });
  });

  api.get('/tags', async (req, res) => {
    const counts = {};
    for (const { tags } of await db.all('SELECT tags FROM contacts WHERE account_id = ?', req.accountId)) {
      for (const t of JSON.parse(tags)) counts[t] = (counts[t] || 0) + 1;
    }
    res.json(Object.entries(counts).sort((x, y) => y[1] - x[1]).map(([tag, count]) => ({ tag, count })));
  });

  // Products & orders
  const productInput = (b) => {
    const name = String(b.name || '').trim();
    const price = Math.round(Number(b.price) * 100);
    if (!name) throw new HttpError(400, 'Give your product a name');
    if (!Number.isFinite(price) || price < 50) throw new HttpError(400, 'Price must be at least 0.50');
    const currency = CURRENCIES.includes(b.currency) ? b.currency : 'usd';
    const billing = BILLING.includes(b.billing) ? b.billing : 'one_time';
    return [name, String(b.description || '').trim(), price, currency, billing, parseTags(b.tag).join(',')];
  };
  const productOut = (p) => ({ ...p, price: p.price_cents / 100, priceLabel: formatMoney(p.price_cents, p.currency) });

  api.get('/products', async (req, res) => {
    res.json((await db.all(`SELECT p.*,
        (SELECT COUNT(*)::int FROM orders o WHERE o.product_id = p.id AND o.status = 'paid') AS sales
      FROM products p WHERE account_id = ? ORDER BY id DESC`, req.accountId)).map(productOut));
  });

  api.post('/products', async (req, res) => {
    const r = await db.get(`INSERT INTO products (account_id, name, description, price_cents, currency, billing, tag)
      VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`, req.accountId, ...productInput(req.body || {}));
    res.status(201).json({ id: r.id });
  });

  api.put('/products/:id', async (req, res) => {
    const r = await db.run(`UPDATE products SET name = ?, description = ?, price_cents = ?, currency = ?, billing = ?, tag = ?
      WHERE id = ? AND account_id = ?`, ...productInput(req.body || {}), id(req.params.id), req.accountId);
    if (!r.changes) throw new HttpError(404, 'Product not found');
    res.json({ ok: true });
  });

  api.delete('/products/:id', async (req, res) => {
    await db.run('DELETE FROM products WHERE id = ? AND account_id = ?', id(req.params.id), req.accountId);
    res.json({ ok: true });
  });

  api.get('/orders', async (req, res) => {
    res.json((await db.all(`SELECT o.*, f.name AS funnel_name FROM orders o LEFT JOIN funnels f ON f.id = o.funnel_id
      WHERE o.account_id = ? ORDER BY o.id DESC LIMIT 500`, req.accountId))
      .map((o) => ({ ...o, amountLabel: formatMoney(o.amount_cents, o.currency) })));
  });

  // Funnels
  api.get('/templates', (req, res) => {
    res.json(Object.entries(TEMPLATES).map(([key, t]) => ({ key, label: t.label })));
  });

  api.get('/funnels', async (req, res) => {
    res.json(await db.all(`SELECT f.*,
        (SELECT COUNT(*)::int FROM funnel_steps s WHERE s.funnel_id = f.id) AS steps,
        (SELECT COUNT(*)::int FROM page_events e WHERE e.funnel_id = f.id AND e.type = 'view') AS views,
        (SELECT COUNT(*)::int FROM page_events e WHERE e.funnel_id = f.id AND e.type = 'optin') AS optins
      FROM funnels f WHERE f.account_id = ? ORDER BY f.id DESC`, req.accountId));
  });

  api.post('/funnels', async (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) throw new HttpError(400, 'Give your funnel a name');
    const template = TEMPLATES[req.body?.template] || TEMPLATES.optin;
    const funnelId = await db.tx(async (t) => {
      const f = await t.get('INSERT INTO funnels (account_id, name, slug) VALUES (?, ?, ?) RETURNING id',
        req.accountId, name, await uniqueFunnelSlug(t, name));
      const newest = await t.get('SELECT id FROM products WHERE account_id = ? ORDER BY id DESC LIMIT 1', req.accountId);
      const steps = template.steps();
      const ids = [];
      for (const [i, s] of steps.entries()) {
        for (const b of s.blocks) if (b.type === 'pricing' && newest) b.productId = newest.id;
        ids.push(await insertStep(t, f.id, s, i));
      }
      const idOf = (key) => (key == null ? null : ids[steps.findIndex((s) => s.key === key)] ?? null);
      for (const [i, s] of steps.entries()) {
        const next = 'next' in s ? idOf(s.next) : ids[i + 1] ?? null;
        await t.run('UPDATE funnel_steps SET next_step_id = ?, no_step_id = ? WHERE id = ?', next, idOf(s.no), ids[i]);
      }
      await t.run('UPDATE funnels SET entry_step_id = ? WHERE id = ?', ids[0], f.id);
      return f.id;
    });
    res.status(201).json({ id: funnelId });
  });

  api.get('/funnels/:id', async (req, res) => {
    const f = await getFunnel(req.accountId, req.params.id);
    const steps = (await db.all(`SELECT s.*,
        (SELECT COUNT(*)::int FROM page_events e WHERE e.step_id = s.id AND e.type = 'view') AS views,
        (SELECT COUNT(*)::int FROM page_events e WHERE e.step_id = s.id AND e.type = 'optin') AS optins,
        (SELECT COUNT(*)::int FROM page_events e WHERE e.step_id = s.id AND e.type = 'sale') AS sales
      FROM funnel_steps s WHERE s.funnel_id = ? ORDER BY position`, f.id)).map(stepOut);
    res.json({ ...f, steps });
  });

  api.put('/funnels/:id', async (req, res) => {
    const f = await getFunnel(req.accountId, req.params.id);
    const name = String(req.body?.name ?? f.name).trim() || f.name;
    const slug = req.body?.slug !== undefined ? slugify(req.body.slug) : f.slug;
    if (slug !== f.slug && await db.get('SELECT 1 FROM funnels WHERE slug = ?', slug)) {
      throw new HttpError(409, 'That URL is already taken, try another');
    }
    await db.run('UPDATE funnels SET name = ?, slug = ? WHERE id = ?', name, slug, f.id);
    res.json({ ok: true, slug });
  });

  api.delete('/funnels/:id', async (req, res) => {
    const f = await getFunnel(req.accountId, req.params.id);
    await db.run('DELETE FROM funnels WHERE id = ?', f.id);
    res.json({ ok: true });
  });

  api.post('/funnels/:id/steps', async (req, res) => {
    const f = await getFunnel(req.accountId, req.params.id);
    const { from, port, x, y } = req.body || {};
    const name = String(req.body?.name || '').trim() || 'New page';
    const newId = await db.tx(async (t) => {
      const parent = from ? await stepInFunnel(t, f.id, from) : null;
      const pos = (await t.get('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM funnel_steps WHERE funnel_id = ?', f.id)).p;
      const stepId = await insertStep(t, f.id, { name, blocks: [], settings: {} }, pos);
      await t.run('UPDATE funnel_steps SET x = ?, y = ? WHERE id = ?', num(x), num(y), stepId);
      // Created by dragging out of a page's exit: connect it to that exit.
      if (parent) await t.run(`UPDATE funnel_steps SET ${port === 'no' ? 'no_step_id' : 'next_step_id'} = ? WHERE id = ?`, stepId, parent.id);
      if (!f.entry_step_id) await t.run('UPDATE funnels SET entry_step_id = ? WHERE id = ?', stepId, f.id);
      return stepId;
    });
    res.status(201).json({ id: newId });
  });

  // Saves the funnel map: card positions, the links between pages, and which
  // page visitors land on first. Everything is optional and applied together.
  api.put('/funnels/:id/map', async (req, res) => {
    const f = await getFunnel(req.accountId, req.params.id);
    const { entry_step_id, steps = [] } = req.body || {};
    await db.tx(async (t) => {
      const link = async (v, selfId) => {
        if (v === null) return null;
        if (Number(v) === selfId) throw new HttpError(400, 'A page can’t lead to itself');
        return (await stepInFunnel(t, f.id, v)).id;
      };
      if (entry_step_id !== undefined) {
        await t.run('UPDATE funnels SET entry_step_id = ? WHERE id = ?', (await stepInFunnel(t, f.id, entry_step_id)).id, f.id);
      }
      for (const st of Array.isArray(steps) ? steps : []) {
        const cur = await stepInFunnel(t, f.id, st.id);
        await t.run('UPDATE funnel_steps SET x = ?, y = ?, next_step_id = ?, no_step_id = ? WHERE id = ?',
          st.x !== undefined ? num(st.x) : cur.x, st.y !== undefined ? num(st.y) : cur.y,
          st.next_step_id !== undefined ? await link(st.next_step_id, cur.id) : cur.next_step_id,
          st.no_step_id !== undefined ? await link(st.no_step_id, cur.id) : cur.no_step_id, cur.id);
      }
    });
    res.json({ ok: true });
  });

  api.get('/steps/:id', async (req, res) => {
    const s = await getStep(req.accountId, req.params.id);
    const funnel = await db.get('SELECT id, name, slug FROM funnels WHERE id = ?', s.funnel_id);
    res.json({ ...stepOut(s), funnel });
  });

  api.put('/steps/:id', async (req, res) => {
    const s = await getStep(req.accountId, req.params.id);
    const b = req.body || {};
    const name = String(b.name ?? s.name).trim() || s.name;
    const slug = b.slug !== undefined ? await uniqueStepSlug(db, s.funnel_id, b.slug, s.id) : s.slug;
    const blocks = Array.isArray(b.blocks) ? b.blocks : JSON.parse(s.blocks);
    const settings = b.settings && typeof b.settings === 'object' ? b.settings : JSON.parse(s.settings);
    await db.run(`UPDATE funnel_steps SET name = ?, slug = ?, blocks = ?, settings = ?, updated_at = now()
      WHERE id = ?`, name, slug, JSON.stringify(blocks), JSON.stringify(settings), s.id);
    res.json({ ok: true, slug });
  });

  api.delete('/steps/:id', async (req, res) => {
    const s = await getStep(req.accountId, req.params.id);
    await db.tx(async (t) => {
      await t.run('UPDATE funnel_steps SET next_step_id = NULL WHERE next_step_id = ?', s.id);
      await t.run('UPDATE funnel_steps SET no_step_id = NULL WHERE no_step_id = ?', s.id);
      await t.run('DELETE FROM funnel_steps WHERE id = ?', s.id);
      // If the start page was deleted, start at whichever page is left first.
      await t.run(`UPDATE funnels SET entry_step_id = (SELECT id FROM funnel_steps WHERE funnel_id = ? ORDER BY position LIMIT 1)
        WHERE id = ? AND entry_step_id = ?`, s.funnel_id, s.funnel_id, s.id);
    });
    res.json({ ok: true });
  });

  api.post('/preview', async (req, res) => {
    const { blocks, settings, name } = req.body || {};
    res.json({ html: renderPage({ title: name || 'Preview', blocks, settings, products: await productsMap(req.accountId), preview: true }) });
  });

  // Email broadcasts
  api.get('/broadcasts', async (req, res) => {
    res.json(await db.all('SELECT * FROM broadcasts WHERE account_id = ? ORDER BY id DESC', req.accountId));
  });

  api.post('/broadcasts', async (req, res) => {
    const { subject, body, tag } = req.body || {};
    if (!subject?.trim() || !body?.trim()) throw new HttpError(400, 'Subject and message are required');
    const r = await db.get('INSERT INTO broadcasts (account_id, subject, body, tag) VALUES (?, ?, ?, ?) RETURNING id',
      req.accountId, subject.trim(), body, String(tag || '').trim().toLowerCase());
    res.status(201).json({ id: r.id });
  });

  api.delete('/broadcasts/:id', async (req, res) => {
    await db.run("DELETE FROM broadcasts WHERE id = ? AND account_id = ? AND status = 'draft'", id(req.params.id), req.accountId);
    res.json({ ok: true });
  });

  api.post('/broadcasts/:id/send', async (req, res) => {
    // Claim the draft atomically so a double-click can't send it twice.
    const b = await db.get(`UPDATE broadcasts SET status = 'sending' WHERE id = ? AND account_id = ? AND status = 'draft'
      RETURNING *`, id(req.params.id), req.accountId);
    if (!b) {
      const exists = await db.get('SELECT 1 FROM broadcasts WHERE id = ? AND account_id = ?', id(req.params.id), req.accountId);
      throw exists ? new HttpError(409, 'This broadcast was already sent') : new HttpError(404, 'Broadcast not found');
    }
    const account = await db.get('SELECT * FROM accounts WHERE id = ?', req.accountId);
    const from = account.from_email ? `"${(account.from_name || account.name).replace(/"/g, '')}" <${account.from_email}>`
      : process.env.SMTP_FROM || 'no-reply@localhost';
    const recipients = (await db.all('SELECT * FROM contacts WHERE account_id = ? AND unsubscribed = 0', req.accountId))
      .map(contactOut).filter((c) => !b.tag || c.tags.includes(b.tag));
    const log = (c, subject, text, status, error) => db.run(`INSERT INTO email_log
      (account_id, broadcast_id, contact_id, to_email, subject, body, status, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    req.accountId, b.id, c.id, c.email, subject, text, status, error);
    let sent = 0;
    for (const c of recipients) {
      const merge = (s) => s.replace(/\{\{\s*(first_name|last_name|email)\s*\}\}/g, (_, k) => c[k] || '');
      const subject = merge(b.subject);
      const text = `${merge(b.body)}\n\n--\nUnsubscribe: ${baseUrl(req)}/unsubscribe/${unsubToken(c.id)}`;
      try {
        const r = await mailer.sendEmail({ from, to: c.email, subject, text });
        await log(c, subject, text, r.status, null);
        sent++;
      } catch (e) {
        await log(c, subject, text, 'failed', e.message);
      }
    }
    await db.run("UPDATE broadcasts SET status = 'sent', sent_count = ?, sent_at = now() WHERE id = ?", sent, b.id);
    res.json({ sent, total: recipients.length });
  });

  api.get('/outbox', async (req, res) => {
    res.json(await db.all('SELECT * FROM email_log WHERE account_id = ? ORDER BY id DESC LIMIT 200', req.accountId));
  });

  api.use((req, res) => res.status(404).json({ error: 'Not found' }));
  app.use('/api', api);

  // ---------- Public funnel pages ----------
  const findPublicStep = async (funnelSlug, stepSlug) => {
    const funnel = await db.get('SELECT * FROM funnels WHERE slug = ?', funnelSlug);
    if (!funnel) return null;
    const step = stepSlug
      ? await db.get('SELECT * FROM funnel_steps WHERE funnel_id = ? AND slug = ?', funnel.id, stepSlug)
      : (funnel.entry_step_id && await db.get('SELECT * FROM funnel_steps WHERE id = ?', funnel.entry_step_id))
        || await db.get('SELECT * FROM funnel_steps WHERE funnel_id = ? ORDER BY position LIMIT 1', funnel.id);
    if (!step) return null;
    const [nextUrl, noUrl] = await Promise.all([linkUrl(step.next_step_id), linkUrl(step.no_step_id)]);
    return { funnel, step, nextUrl: nextUrl || '#', noUrl: noUrl || '#' };
  };

  const notFound = (res) => res.status(404).type('html').send('<!doctype html><title>Not found</title><p style="font:18px system-ui;text-align:center;margin-top:20vh">Page not found.</p>');

  app.get('/f/:funnel{/:step}', async (req, res) => {
    const found = await findPublicStep(req.params.funnel, req.params.step);
    if (!found) return notFound(res);
    const { funnel, step, nextUrl, noUrl } = found;
    const [products] = await Promise.all([
      productsMap(funnel.account_id),
      db.run("INSERT INTO page_events (account_id, funnel_id, step_id, type) VALUES (?, ?, ?, 'view')", funnel.account_id, funnel.id, step.id),
    ]);
    res.type('html').send(renderPage({
      title: step.name, blocks: JSON.parse(step.blocks), settings: JSON.parse(step.settings),
      nextUrl, noUrl, formAction: `/f/${funnel.slug}/${step.slug}/optin`, buyAction: `/f/${funnel.slug}/${step.slug}/buy`,
      products,
    }));
  });

  app.post('/f/:funnel/:step/optin', express.urlencoded({ extended: false, limit: '20kb' }), async (req, res) => {
    const found = await findPublicStep(req.params.funnel, req.params.step);
    if (!found) return notFound(res);
    const { funnel, step, nextUrl } = found;
    const back = `/f/${funnel.slug}/${step.slug}`;
    if (req.body.website) return res.redirect(303, nextUrl === '#' ? back : nextUrl); // honeypot: bots fill hidden field
    const block = JSON.parse(step.blocks).find((b) => b.type === 'form' && b.id === req.body.block)
      || JSON.parse(step.blocks).find((b) => b.type === 'form') || {};
    let contact;
    try {
      contact = await upsertContact(db, funnel.account_id, {
        email: req.body.email, first_name: String(req.body.first_name || ''), phone: String(req.body.phone || ''),
        tags: parseTags(block.tag), source: `funnel: ${funnel.name}`,
      });
    } catch (e) {
      if (e.status === 400) return res.status(400).type('html').send(`<!doctype html><p style="font:18px system-ui;text-align:center;margin-top:20vh">Please enter a valid email. <a href="${esc(back)}">Go back</a></p>`);
      throw e;
    }
    await db.run("INSERT INTO page_events (account_id, funnel_id, step_id, type, contact_id) VALUES (?, ?, ?, 'optin', ?)",
      funnel.account_id, funnel.id, step.id, contact.id);
    if (nextUrl !== '#') return res.redirect(303, nextUrl);
    res.type('html').send('<!doctype html><meta name="viewport" content="width=device-width"><p style="font:20px system-ui;text-align:center;margin-top:20vh">Thanks! You are subscribed.</p>');
  });

  // ---------- Checkout ----------
  const messagePage = (res, status, text, link) => res.status(status).type('html').send(
    `<!doctype html><meta name="viewport" content="width=device-width"><title>${esc(text)}</title>
    <p style="font:20px system-ui;text-align:center;margin-top:20vh;padding:0 20px">${esc(text)}${link ? `<br><br><a href="${esc(link)}">Go back</a>` : ''}</p>`);

  app.post('/f/:funnel/:step/buy', express.urlencoded({ extended: false, limit: '5kb' }), async (req, res) => {
    const found = await findPublicStep(req.params.funnel, req.params.step);
    if (!found) return notFound(res);
    const { funnel, step } = found;
    const back = `/f/${funnel.slug}/${step.slug}`;
    const block = JSON.parse(step.blocks).find((b) => b.type === 'pricing' && b.id === req.body.block);
    const product = block?.productId && await db.get('SELECT * FROM products WHERE id = ? AND account_id = ?',
      id(block.productId), funnel.account_id);
    if (!product) return messagePage(res, 404, 'This offer is no longer available.', back);
    const account = await db.get('SELECT stripe_secret_key FROM accounts WHERE id = ?', funnel.account_id);
    const { id: orderId } = await db.get(`INSERT INTO orders (account_id, product_id, product_name, amount_cents, currency, mode, funnel_id, step_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`, funnel.account_id, product.id, product.name, product.price_cents, product.currency,
    account.stripe_secret_key ? 'stripe' : 'test', funnel.id, step.id);
    if (!account.stripe_secret_key) return res.redirect(303, `/checkout/test/${orderId}/${orderToken(orderId)}`);
    try {
      const session = await stripe.createCheckoutSession(account.stripe_secret_key, {
        product, orderId,
        successUrl: `${baseUrl(req)}/checkout/success/${orderId}?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${baseUrl(req)}${back}`,
      });
      await db.run('UPDATE orders SET stripe_session_id = ? WHERE id = ?', session.id, orderId);
      res.redirect(303, session.url);
    } catch (e) {
      console.error('Stripe checkout failed:', e.message);
      messagePage(res, 502, 'Checkout is temporarily unavailable. Please try again in a moment.', back);
    }
  });

  // Buyer returns here from Stripe. We confirm the payment with Stripe
  // ourselves rather than trusting the URL.
  app.get('/checkout/success/:orderId', async (req, res) => {
    const order = await db.get('SELECT * FROM orders WHERE id = ?', id(req.params.orderId));
    if (!order || order.mode !== 'stripe') return notFound(res);
    if (order.status !== 'paid') {
      const account = await db.get('SELECT stripe_secret_key FROM accounts WHERE id = ?', order.account_id);
      try {
        const session = await stripe.retrieveCheckoutSession(account.stripe_secret_key, String(req.query.session_id || ''));
        if (String(session.client_reference_id) !== String(order.id) || !stripe.isPaid(session)) {
          return messagePage(res, 402, 'We couldn’t confirm your payment. If you were charged, please contact us.');
        }
        await fulfilOrder(order, { email: session.customer_details?.email, name: session.customer_details?.name || '', sessionId: session.id });
      } catch (e) {
        console.error('Stripe confirmation failed:', e.message);
        return messagePage(res, 502, 'We couldn’t confirm your payment yet. Please refresh this page in a moment.');
      }
    }
    const next = order.step_id && await stepAfter(order.step_id);
    if (next) return res.redirect(303, next);
    messagePage(res, 200, `Thank you! Your purchase of ${order.product_name} is confirmed.`);
  });

  // Test-mode checkout, used while a workspace hasn't connected Stripe. No
  // money moves; it lets you try the whole funnel end to end.
  const testOrder = async (req) => {
    const order = await db.get("SELECT * FROM orders WHERE id = ? AND mode = 'test'", id(req.params.orderId));
    const ok = order && req.params.token.length === 24
      && crypto.timingSafeEqual(Buffer.from(req.params.token), Buffer.from(orderToken(order.id)));
    return ok ? order : null;
  };
  app.get('/checkout/test/:orderId/:token', async (req, res) => {
    const order = await testOrder(req);
    if (!order) return notFound(res);
    res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Test checkout</title><style>body{font:16px system-ui;background:#f6f7fb;margin:0;display:grid;place-items:center;min-height:100vh;padding:20px;box-sizing:border-box}
.c{background:#fff;border-radius:14px;padding:28px;max-width:420px;width:100%;box-shadow:0 10px 30px rgba(0,0,0,.08)}
.t{background:#fef3c7;color:#92400e;padding:8px 12px;border-radius:8px;font-size:.85rem;margin-bottom:16px}
input,button{width:100%;padding:12px;border-radius:8px;font:inherit;box-sizing:border-box;margin-top:8px}input{border:1px solid #d1d5db}
button{background:#4f46e5;color:#fff;border:0;font-weight:600;cursor:pointer;margin-top:14px}.p{font-size:2rem;font-weight:800;margin:6px 0 14px}</style></head>
<body><form class="c" method="post"><div class="t"><b>Test mode.</b> Stripe isn’t connected for this business yet, so no card is charged.</div>
<div>${esc(order.product_name)}</div><div class="p">${esc(formatMoney(order.amount_cents, order.currency))}</div>
${order.status === 'paid' ? '<p>This order is already paid.</p>' : `<label>Name<input name="name" autocomplete="name"></label>
<label>Email<input name="email" type="email" required autocomplete="email"></label><button>Complete test purchase</button>`}</form></body></html>`);
  });
  app.post('/checkout/test/:orderId/:token', express.urlencoded({ extended: false, limit: '5kb' }), async (req, res) => {
    const order = await testOrder(req);
    if (!order) return notFound(res);
    if (!EMAIL_RE.test(String(req.body.email || '').trim())) return messagePage(res, 400, 'Please enter a valid email.', req.originalUrl);
    await fulfilOrder(order, { email: String(req.body.email).trim(), name: String(req.body.name || '').trim() });
    const next = order.step_id && await stepAfter(order.step_id);
    if (next) return res.redirect(303, next);
    messagePage(res, 200, `Thank you! Your purchase of ${order.product_name} is confirmed.`);
  });

  // Stripe webhook: catches payments where the buyer closed the tab before
  // being redirected back. One endpoint per workspace, each with its own secret.
  app.post('/stripe/webhook/:accountId', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
    const account = await db.get('SELECT id, stripe_webhook_secret FROM accounts WHERE id = ?', id(req.params.accountId));
    if (!account?.stripe_webhook_secret) return res.status(404).json({ error: 'Webhook not configured' });
    let event;
    try {
      event = stripe.verifyWebhook(req.body.toString('utf8'), req.get('stripe-signature'), account.stripe_webhook_secret);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) {
      const session = event.data.object;
      const order = await db.get('SELECT * FROM orders WHERE id = ? AND account_id = ?', id(session.client_reference_id), account.id);
      if (order && stripe.isPaid(session)) {
        await fulfilOrder(order, { email: session.customer_details?.email, name: session.customer_details?.name || '', sessionId: session.id });
      }
    }
    res.json({ received: true });
  });

  app.get('/unsubscribe/:token', async (req, res) => {
    const token = String(req.params.token);
    const [contactId] = token.split('.');
    const expected = /^\d{1,9}$/.test(contactId) ? unsubToken(contactId) : '';
    const valid = Boolean(expected) && token.length === expected.length
      && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
    if (valid) await db.run('UPDATE contacts SET unsubscribed = 1 WHERE id = ?', Number(contactId));
    res.type('html').send(`<!doctype html><meta name="viewport" content="width=device-width"><p style="font:20px system-ui;text-align:center;margin-top:20vh">${
      valid ? 'You have been unsubscribed.' : 'This unsubscribe link is invalid.'}</p>`);
  });

  // ---------- Dashboard SPA (on Netlify these files are served by the CDN instead) ----------
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

  app.use((err, req, res, next) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status === 500) console.error(err);
    if (res.headersSent) return next(err);
    if (req.path.startsWith('/api')) return res.status(status).json({ error: status === 500 ? 'Something went wrong' : err.message });
    res.status(status).send(status === 500 ? 'Something went wrong' : esc(err.message));
  });

  app.close = async () => { if (ready) { await ready; await db.close(); } };
  return app;
}

module.exports = { createApp };
