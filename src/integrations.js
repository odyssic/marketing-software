// Integrations: outgoing webhooks (signed JSON POSTs when something happens)
// and a small public REST API under /api/v1 that uses API keys. Together they
// are what Zapier, Make and similar tools need: a webhook to start a Zap, and
// an API key to do things in Rilly.
//
// Webhooks are never sent while a request is running: events are written to
// webhook_deliveries and sent by the background job (app.runJobs), with retries.
const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const net = require('node:net');
const express = require('express');
const { EVENT_TYPES } = require('./people');

// Public event names, and the Rilly event types they come from.
const WEBHOOK_EVENTS = {
  'person.created': 'Someone new is added',
  'form.submitted': 'A form is sent (sign-up, inquiry or newsletter)',
  'order.paid': 'Someone buys',
  'booking.created': 'Someone books a time',
  'tag.added': 'Someone gets a tag',
  'contact.unsubscribed': 'Someone unsubscribes',
  'email.opened': 'An email is opened',
  'email.clicked': 'A link in an email is clicked',
};
const EVENT_MAP = { signup: 'form.submitted', inquiry: 'form.submitted', purchase: 'order.paid', booking: 'booking.created', unsubscribe: 'contact.unsubscribed', open: 'email.opened', click: 'email.clicked' };
// People added in bulk (imports) don't each fire "person.created".
const BULK_SOURCES = new Set(['import', 'store', 'etsy', 'paypal', 'stripe', 'newsletter', 'print']);
const FRESH_MS = 2 * 864e5; // older events (e.g. imported orders) are history, not news
const BACKOFF_MIN = [1, 5, 30, 120, 720]; // minutes after attempt 1..5; attempt 6 is the last
const MAX_ATTEMPTS = BACKOFF_MIN.length + 1;
const RATE_PER_MIN = Number(process.env.API_RATE_PER_MIN) || 120;
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);

// ---------- Address safety ----------
// Webhooks only go to public internet addresses: never this server, the cloud
// metadata service or a private network.
const blocked = new net.BlockList();
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]]) blocked.addSubnet(a, p, 'ipv4');
for (const [a, p] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96], ['2001:db8::', 32]]) blocked.addSubnet(a, p, 'ipv6');
function privateIp(ip) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return privateIp(mapped[1]);
  const type = net.isIP(ip);
  if (!type) return true;
  return blocked.check(ip, type === 4 ? 'ipv4' : 'ipv6');
}
const allowLocal = () => process.env.WEBHOOKS_ALLOW_LOCAL === '1';

// Returns a clean URL string or throws a plain message. With resolve=true the
// host name is looked up too, so a name pointing at a private address is refused.
async function checkWebhookUrl(raw, { resolve = true } = {}) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { throw new Error('Paste the full address, starting with https://'); }
  const local = allowLocal();
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw new Error('The address must start with https://');
  if (u.username || u.password) throw new Error('Leave the user name and password out of the address');
  if (u.href.length > 1000) throw new Error('That address is too long');
  if (local) return u.href;
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || /\.(localhost|local|internal|lan|home|corp)$/.test(host) || !host.includes('.') && !net.isIP(host)) {
    throw new Error('Webhooks can only go to public internet addresses');
  }
  if (net.isIP(host)) { if (privateIp(host)) throw new Error('Webhooks can only go to public internet addresses'); return u.href; }
  if (resolve) {
    let addrs;
    try { addrs = await dns.lookup(host, { all: true, verbatim: true }); } catch { throw new Error(`Couldn’t find ${host}. Check the address.`); }
    if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw new Error('Webhooks can only go to public internet addresses');
  }
  return u.href;
}

const signBody = (secret, ts, body) => crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');

function createIntegrations({ getDb, HttpError, id, people, workflows, parseTags, roleIn, publicBase }) {
  const db = () => getDb();

  // ---------- Payloads ----------
  const personPayload = (c) => c && ({
    id: c.id, email: c.email, first_name: c.first_name, last_name: c.last_name,
    name: [c.first_name, c.last_name].filter(Boolean).join(' '), phone: c.phone,
    tags: JSON.parse(c.tags || '[]'), stage: c.stage || '', source: c.source, unsubscribed: Boolean(c.unsubscribed),
    created_at: c.created_at instanceof Date ? c.created_at.toISOString() : c.created_at,
  });

  async function hooksFor(accountId, event) {
    const rows = await db().all('SELECT id, events FROM webhooks WHERE account_id = ? AND active = 1', accountId);
    return rows.filter((w) => JSON.parse(w.events || '[]').includes(event));
  }

  // Queues one event for every webhook that wants it. Never sends anything.
  async function enqueue(accountId, event, personId, data) {
    const hooks = await hooksFor(accountId, event);
    if (!hooks.length) return 0;
    const person = personId ? await db().get('SELECT * FROM contacts WHERE id = ? AND account_id = ?', personId, accountId) : null;
    const payload = JSON.stringify({ id: `evt_${crypto.randomUUID().replace(/-/g, '')}`, type: event, created_at: new Date().toISOString(),
      account_id: accountId, person: personPayload(person), data: data || {} });
    for (const h of hooks) {
      await db().run('INSERT INTO webhook_deliveries (account_id, webhook_id, event, payload) VALUES (?, ?, ?, ?)', accountId, h.id, event, payload);
    }
    return hooks.length;
  }

  // From people.logEvent (after the transaction commits).
  async function onEvent(accountId, e) {
    let event = EVENT_MAP[e.type];
    const m = e.meta || {};
    if (e.type === 'subscribe' && m.funnel_id && m.format !== 'sms') event = 'form.submitted';
    if (!event) return;
    if (e.occurred_at && Date.now() - new Date(e.occurred_at).getTime() > FRESH_MS) return;
    let data;
    if (event === 'form.submitted') {
      data = { kind: e.type === 'subscribe' ? 'newsletter' : e.type, form: m.funnel || '', pageflow_id: m.funnel_id || null, page_id: m.step_id || null,
        ...(e.type === 'inquiry' ? { message: m.note || '' } : {}), ...(e.type === 'subscribe' ? { newsletter: m.product || '' } : {}) };
    } else if (event === 'order.paid') {
      const o = m.order_id && await db().get('SELECT * FROM orders WHERE id = ? AND account_id = ?', m.order_id, accountId);
      data = { order_id: o?.id || m.order_id || null, product: o?.product_name || m.product || '', amount_cents: o?.amount_cents ?? null,
        currency: o?.currency || '', pageflow_id: m.funnel_id || null };
    } else if (event === 'booking.created') {
      data = { starts_at: m.starts_at || null, page: m.funnel || '', pageflow_id: m.funnel_id || null, note: m.note || '' };
    } else if (event === 'contact.unsubscribed') {
      data = { reason: m.reason || '' };
    } else {
      data = { subject: m.subject || '', campaign_id: m.campaign_id || null, follow_up_id: m.workflow_id || null };
    }
    await enqueue(accountId, event, e.person_id, data);
  }
  async function onTagsAdded(accountId, personId, tags) {
    for (const tag of tags) await enqueue(accountId, 'tag.added', personId, { tag });
  }
  async function onPersonCreated(accountId, personId, { source = '', entry = '' } = {}) {
    if (BULK_SOURCES.has(source)) return;
    await enqueue(accountId, 'person.created', personId, { source, came_in_through: entry });
  }
  // Errors here must never break the request that caused the event.
  const safe = (fn) => (...a) => fn(...a).catch((e) => console.error('webhook enqueue:', e.message));

  // ---------- Sending ----------
  async function send(hook, delivery) {
    const ts = Math.floor(Date.now() / 1000);
    const headers = { 'content-type': 'application/json', 'user-agent': 'Rilly-Webhooks/1', 'rilly-event': delivery.event,
      'rilly-delivery': String(delivery.id), 'rilly-signature': `t=${ts},v1=${signBody(hook.secret, ts, delivery.payload)}` };
    try {
      await checkWebhookUrl(hook.url);
      const res = await fetch(hook.url, { method: 'POST', headers, body: delivery.payload, redirect: 'manual', signal: AbortSignal.timeout(10e3) });
      await res.body?.cancel().catch(() => {});
      return { ok: res.status >= 200 && res.status < 300, status: res.status, error: res.status >= 300 ? `Answered ${res.status}` : '' };
    } catch (e) {
      return { ok: false, status: null, error: e.name === 'TimeoutError' ? 'No answer within 10 seconds' : str(e.cause?.code || e.message, 200) };
    }
  }

  async function record(hook, delivery, r, now) {
    const attempts = delivery.attempts + 1;
    const status = r.ok ? 'sent' : attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
    const next = new Date(now.getTime() + (BACKOFF_MIN[attempts - 1] || 0) * 60e3).toISOString();
    await db().run(`UPDATE webhook_deliveries SET status = ?, attempts = ?, response_status = ?, error = ?, next_at = ?,
      sent_at = CASE WHEN ? = 'sent' THEN now() ELSE sent_at END WHERE id = ?`, status, attempts, r.status, r.error, next, status, delivery.id);
    await db().run('UPDATE webhooks SET last_status = ?, last_error = ?, last_at = now() WHERE id = ?', r.status, r.error, hook.id);
    return status;
  }

  async function processDue(now = new Date()) {
    const lease = new Date(now.getTime() + 10 * 60e3).toISOString();
    // Claim due deliveries (a crashed run frees them after the lease).
    const due = await db().all(`UPDATE webhook_deliveries SET next_at = ? WHERE id IN (
        SELECT id FROM webhook_deliveries WHERE status = 'pending' AND next_at <= ? ORDER BY id LIMIT 50 FOR UPDATE SKIP LOCKED)
      RETURNING *`, lease, now.toISOString());
    let sent = 0, retried = 0;
    for (const d of due.sort((a, b) => a.id - b.id)) {
      const hook = await db().get('SELECT * FROM webhooks WHERE id = ?', d.webhook_id);
      if (!hook || !hook.active) { await db().run("UPDATE webhook_deliveries SET status = 'failed', error = 'Webhook turned off' WHERE id = ?", d.id); continue; }
      const st = await record(hook, d, await send(hook, d), now);
      if (st === 'sent') sent++; else retried++;
    }
    // Keep a month of history.
    await db().run("DELETE FROM webhook_deliveries WHERE status <> 'pending' AND created_at < ?", new Date(now.getTime() - 30 * 864e5).toISOString());
    return { webhooks_sent: sent, webhooks_retrying: retried };
  }

  // ---------- Settings → Integrations (signed-in owner) ----------
  const ownerOnly = async (req) => {
    if (await roleIn(req.user.id, req.accountId) !== 'owner') throw new HttpError(403, 'Only the business owner can change integrations');
  };
  const hookOut = (w) => ({ id: w.id, url: w.url, events: JSON.parse(w.events || '[]'), active: Boolean(w.active),
    last_status: w.last_status, last_error: w.last_error, last_at: w.last_at, created_at: w.created_at, secret_hint: `…${w.secret.slice(-4)}` });
  const cleanEvents = (list) => {
    const ev = [...new Set((Array.isArray(list) ? list : []).filter((e) => WEBHOOK_EVENTS[e]))];
    if (!ev.length) throw new HttpError(400, 'Pick at least one thing to send');
    return ev;
  };
  const cleanUrl = async (u) => { try { return await checkWebhookUrl(u); } catch (e) { throw new HttpError(400, e.message); } };
  const getHook = async (accountId, hookId) => {
    const w = await db().get('SELECT * FROM webhooks WHERE id = ? AND account_id = ?', id(hookId), accountId);
    if (!w) throw new HttpError(404, 'Webhook not found');
    return w;
  };
  const newSecret = () => `whsec_${crypto.randomBytes(24).toString('base64url')}`;

  function register(app, api) {
    api.get('/integrations', async (req, res) => {
      const hooks = await db().all('SELECT * FROM webhooks WHERE account_id = ? ORDER BY id', req.accountId);
      const keys = await db().all(`SELECT id, name, hint, created_at, last_used_at FROM api_keys
        WHERE account_id = ? AND revoked_at IS NULL ORDER BY id`, req.accountId);
      res.json({ webhooks: hooks.map(hookOut), keys, events: WEBHOOK_EVENTS, api_base: `${publicBase()}/api/v1`,
        can_manage: await roleIn(req.user.id, req.accountId) === 'owner' });
    });

    api.post('/integrations/webhooks', async (req, res) => {
      await ownerOnly(req);
      const url = await cleanUrl(req.body?.url);
      const events = cleanEvents(req.body?.events);
      const n = await db().get('SELECT COUNT(*)::int AS n FROM webhooks WHERE account_id = ?', req.accountId);
      if (n.n >= 20) throw new HttpError(400, 'You can have up to 20 webhooks');
      const secret = newSecret();
      const w = await db().get('INSERT INTO webhooks (account_id, url, events, secret) VALUES (?, ?, ?, ?) RETURNING *', req.accountId, url, JSON.stringify(events), secret);
      res.status(201).json({ ...hookOut(w), secret });
    });
    api.put('/integrations/webhooks/:id', async (req, res) => {
      await ownerOnly(req);
      const w = await getHook(req.accountId, req.params.id);
      const b = req.body || {};
      const url = b.url !== undefined ? await cleanUrl(b.url) : w.url;
      const events = b.events !== undefined ? JSON.stringify(cleanEvents(b.events)) : w.events;
      const active = b.active !== undefined ? Number(Boolean(b.active)) : w.active;
      res.json(hookOut(await db().get('UPDATE webhooks SET url = ?, events = ?, active = ? WHERE id = ? RETURNING *', url, events, active, w.id)));
    });
    api.post('/integrations/webhooks/:id/secret', async (req, res) => {
      await ownerOnly(req);
      const w = await getHook(req.accountId, req.params.id);
      const secret = newSecret();
      await db().run('UPDATE webhooks SET secret = ? WHERE id = ?', secret, w.id);
      res.json({ secret });
    });
    api.delete('/integrations/webhooks/:id', async (req, res) => {
      await ownerOnly(req);
      const w = await getHook(req.accountId, req.params.id);
      await db().run('DELETE FROM webhooks WHERE id = ?', w.id);
      res.json({ ok: true });
    });
    api.get('/integrations/webhooks/:id/deliveries', async (req, res) => {
      const w = await getHook(req.accountId, req.params.id);
      res.json(await db().all(`SELECT id, event, status, attempts, response_status, error, created_at, sent_at, next_at
        FROM webhook_deliveries WHERE webhook_id = ? ORDER BY id DESC LIMIT 25`, w.id));
    });
    // "Send test": a sample event, sent now so the owner sees the answer straight away.
    api.post('/integrations/webhooks/:id/test', async (req, res) => {
      await ownerOnly(req);
      const w = await getHook(req.accountId, req.params.id);
      const payload = JSON.stringify({ id: `evt_test_${crypto.randomBytes(8).toString('hex')}`, type: 'test.ping', created_at: new Date().toISOString(), account_id: req.accountId,
        person: { id: 0, email: 'sample@example.com', first_name: 'Sam', last_name: 'Sample', name: 'Sam Sample', phone: '', tags: ['sample'], stage: 'lead', source: 'manual', unsubscribed: false, created_at: new Date().toISOString() },
        data: { note: 'This is a test from Rilly.' } });
      const d = await db().get("INSERT INTO webhook_deliveries (account_id, webhook_id, event, payload, attempts) VALUES (?, ?, 'test.ping', ?, ?) RETURNING *",
        req.accountId, w.id, payload, MAX_ATTEMPTS - 1); // a test is tried once, never retried
      const r = await send(w, d);
      await record(w, d, r, new Date());
      res.json({ ok: r.ok, status: r.status, error: r.error });
    });

    api.post('/integrations/keys', async (req, res) => {
      await ownerOnly(req);
      const name = str(req.body?.name, 80) || 'API key';
      const n = await db().get('SELECT COUNT(*)::int AS n FROM api_keys WHERE account_id = ? AND revoked_at IS NULL', req.accountId);
      if (n.n >= 20) throw new HttpError(400, 'You can have up to 20 keys. Remove one you no longer use.');
      const key = `rilly_${crypto.randomBytes(24).toString('base64url')}`;
      const k = await db().get(`INSERT INTO api_keys (account_id, name, key_hash, hint, created_by) VALUES (?, ?, ?, ?, ?)
        RETURNING id, name, hint, created_at`, req.accountId, name, sha256(key), key.slice(-4), req.user.id);
      res.status(201).json({ ...k, key });
    });
    api.delete('/integrations/keys/:id', async (req, res) => {
      await ownerOnly(req);
      const k = await db().get('UPDATE api_keys SET revoked_at = now() WHERE id = ? AND account_id = ? AND revoked_at IS NULL RETURNING id', id(req.params.id), req.accountId);
      if (!k) throw new HttpError(404, 'Key not found');
      res.json({ ok: true });
    });

    app.use('/api/v1', publicApi());
  }

  // ---------- Public API: /api/v1 with Authorization: Bearer <key> ----------
  const windows = new Map(); // key id → { start, count }
  function rateLimit(keyId) {
    const now = Date.now();
    let w = windows.get(keyId);
    if (!w || now - w.start >= 60e3) { w = { start: now, count: 0 }; windows.set(keyId, w); }
    w.count++;
    if (windows.size > 5000) for (const [k, v] of windows) if (now - v.start >= 60e3) windows.delete(k);
    return w.count <= RATE_PER_MIN ? 0 : Math.ceil((w.start + 60e3 - now) / 1000);
  }
  const touched = new Map();

  function publicApi() {
    const v1 = express.Router();
    v1.use(express.json({ limit: '256kb' }));
    v1.use(async (req, res, next) => {
      const m = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') || '');
      if (!m) return res.status(401).json({ error: 'Add your API key as: Authorization: Bearer <key>' });
      const k = await db().get('SELECT id, account_id FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL', sha256(m[1]));
      if (!k) return res.status(401).json({ error: 'That API key isn’t valid (it may have been removed)' });
      const wait = rateLimit(k.id);
      if (wait) { res.set('Retry-After', String(wait)); return res.status(429).json({ error: `Too many requests. Try again in ${wait} seconds.` }); }
      if (!touched.has(k.id) || Date.now() - touched.get(k.id) > 60e3) {
        touched.set(k.id, Date.now());
        await db().run('UPDATE api_keys SET last_used_at = now() WHERE id = ?', k.id);
      }
      req.accountId = k.account_id; req.apiKeyId = k.id;
      next();
    });
    const person = async (accountId, personId) => {
      const c = await db().get('SELECT * FROM contacts WHERE id = ? AND account_id = ?', id(personId), accountId);
      if (!c) throw new HttpError(404, 'Person not found');
      return c;
    };
    const limitOf = (v) => Math.max(1, Math.min(100, Number(v) || 50));

    v1.get('/me', async (req, res) => {
      const a = await db().get('SELECT id, name FROM accounts WHERE id = ?', req.accountId);
      res.json({ account: a });
    });

    // People: newest first; ?search= (name or email), ?email=, ?tag=, ?limit=, ?before=<id> for the next page.
    v1.get('/people', async (req, res) => {
      const where = ['account_id = ?'], args = [req.accountId];
      if (req.query.email) { where.push('email = ?'); args.push(str(req.query.email, 200).toLowerCase()); }
      if (req.query.search) {
        where.push("(email ILIKE ? OR (first_name || ' ' || last_name) ILIKE ? OR phone ILIKE ?)");
        const q = `%${str(req.query.search, 100).replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
        args.push(q, q, q);
      }
      if (req.query.tag) { where.push('tags::jsonb @> ?::jsonb'); args.push(JSON.stringify([str(req.query.tag, 60).toLowerCase()])); }
      if (req.query.before) { where.push('id < ?'); args.push(id(req.query.before)); }
      const limit = limitOf(req.query.limit);
      const rows = await db().all(`SELECT * FROM contacts WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ${limit}`, ...args);
      res.json({ data: rows.map(personPayload), next_before: rows.length === limit ? rows[rows.length - 1].id : null });
    });
    v1.get('/people/:id', async (req, res) => res.json(personPayload(await person(req.accountId, req.params.id))));

    // Create or update by email. Tags are added (never removed); blanks never erase.
    v1.post('/people', async (req, res) => {
      const b = req.body || {};
      if (!str(b.email, 200)) throw new HttpError(400, 'email is required');
      const r = await people.upsertContact(db(), req.accountId, {
        email: b.email, first_name: str(b.first_name, 100), last_name: str(b.last_name, 100), name: str(b.name, 200),
        phone: str(b.phone, 40), tags: parseTags(b.tags), source: str(b.source, 40) || 'api', entry: str(b.entry || (b.source ? '' : 'Added through the API'), 160),
      });
      res.status(r.created ? 201 : 200).json({ created: r.created, person: personPayload(await person(req.accountId, r.id)) });
    });

    v1.post('/people/:id/tags', async (req, res) => {
      const c = await person(req.accountId, req.params.id);
      const before = JSON.parse(c.tags);
      const add = parseTags(req.body?.tags ?? req.body?.tag);
      if (!add.length) throw new HttpError(400, 'tags is required');
      const all = parseTags([...before, ...add]);
      await db().run('UPDATE contacts SET tags = ? WHERE id = ?', JSON.stringify(all), c.id);
      await people.tagsAdded(db(), req.accountId, c.id, all.filter((t) => !before.includes(t)));
      res.json(personPayload(await person(req.accountId, c.id)));
    });
    v1.delete('/people/:id/tags/:tag', async (req, res) => {
      const c = await person(req.accountId, req.params.id);
      const tag = String(req.params.tag).trim().toLowerCase();
      await db().run('UPDATE contacts SET tags = ? WHERE id = ?', JSON.stringify(JSON.parse(c.tags).filter((t) => t !== tag)), c.id);
      res.json(personPayload(await person(req.accountId, c.id)));
    });

    // A note (or another event type, e.g. "inquiry") on the person's timeline.
    v1.post('/people/:id/notes', async (req, res) => {
      const c = await person(req.accountId, req.params.id);
      const type = str(req.body?.type, 20) || 'note';
      if (!EVENT_TYPES.includes(type) || type === 'purchase') throw new HttpError(400, `type must be one of: ${EVENT_TYPES.filter((t) => t !== 'purchase').join(', ')}`);
      const note = str(req.body?.note ?? req.body?.text, 2000);
      if (type === 'note' && !note) throw new HttpError(400, 'note is required');
      const eventId = await people.logEvent(db(), req.accountId, { person_id: c.id, type, source: 'api', meta: note ? { note } : {} });
      res.status(201).json({ id: eventId, type, note });
    });

    v1.get('/products', async (req, res) => {
      const rows = await db().all('SELECT id, name, description, price_cents, currency, billing, tag, created_at FROM products WHERE account_id = ? ORDER BY id', req.accountId);
      res.json({ data: rows });
    });

    // Orders: ?since=<ISO date> (by paid or created time), ?status=paid (default) or all.
    v1.get('/orders', async (req, res) => {
      const where = ['account_id = ?'], args = [req.accountId];
      const status = str(req.query.status || 'paid', 20);
      if (status !== 'all') { where.push('status = ?'); args.push(status); }
      if (req.query.since) {
        const d = new Date(String(req.query.since));
        if (Number.isNaN(d.getTime())) throw new HttpError(400, 'since must be a date, e.g. 2026-01-31T00:00:00Z');
        where.push('COALESCE(paid_at, created_at) >= ?'); args.push(d.toISOString());
      }
      const limit = limitOf(req.query.limit);
      const rows = await db().all(`SELECT id, product_id, product_name, contact_id AS person_id, email, amount_cents, currency, status, source,
          created_at, paid_at FROM orders WHERE ${where.join(' AND ')} ORDER BY COALESCE(paid_at, created_at) DESC, id DESC LIMIT ${limit}`, ...args);
      res.json({ data: rows });
    });

    // Pageflows and websites, with the forms on their pages.
    v1.get('/forms', async (req, res) => {
      const fs = await db().all("SELECT id, name, slug, kind, status FROM funnels WHERE account_id = ? AND kind <> 'members' ORDER BY id", req.accountId);
      const steps = fs.length ? await db().all(`SELECT s.id, s.funnel_id, s.name, s.blocks FROM funnel_steps s JOIN funnels f ON f.id = s.funnel_id
        WHERE f.account_id = ? ORDER BY s.position, s.id`, req.accountId) : [];
      res.json({ data: fs.map((f) => ({ id: f.id, name: f.name, kind: f.kind === 'funnel' ? 'pageflow' : f.kind, live: f.status === 'live', url: `${publicBase()}/f/${f.slug}`,
        forms: steps.filter((s) => s.funnel_id === f.id).flatMap((s) => JSON.parse(s.blocks || '[]').filter((b) => b.type === 'form')
          .map((b) => ({ page_id: s.id, page: s.name, block_id: b.id || null, purpose: String(b.purpose || 'Sign up'), tag: b.tag || '' }))) })) });
    });

    v1.get('/follow-ups', async (req, res) => {
      const rows = await db().all('SELECT id, name, status, graph FROM workflows WHERE account_id = ? ORDER BY id', req.accountId);
      res.json({ data: rows.map((w) => { const g = JSON.parse(w.graph || '{}'); return { id: w.id, name: w.name, live: w.status === 'active', trigger: g.nodes?.[g.root]?.config?.event || 'manual' }; }) });
    });
    // Start a follow-up for one person (like "Add people" in the app). Body: { person_id } or { email }.
    v1.post('/follow-ups/:id/enroll', async (req, res) => {
      const w = await workflows.getWorkflow(req.accountId, req.params.id);
      const b = req.body || {};
      const c = b.person_id ? await person(req.accountId, b.person_id)
        : b.email ? await db().get('SELECT * FROM contacts WHERE account_id = ? AND email = ?', req.accountId, str(b.email, 200).toLowerCase()) : null;
      if (!c) throw new HttpError(404, 'Person not found (send person_id or email)');
      const added = await workflows.enroll(w, c.id, `manual:${new Date().toISOString().slice(0, 10)}`);
      res.json({ added, live: w.status === 'active', person_id: c.id });
    });

    v1.use((req, res) => res.status(404).json({ error: 'Not found. See Settings → Integrations → How to connect for the list.' }));
    return v1;
  }

  return { register, processDue, onEvent: safe(onEvent), onTagsAdded: safe(onTagsAdded), onPersonCreated: safe(onPersonCreated) };
}

module.exports = { createIntegrations, checkWebhookUrl, signBody, WEBHOOK_EVENTS, privateIp };
