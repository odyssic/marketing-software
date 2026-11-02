// People and their events: one record per person across store, newsletter,
// podcast, funnels and inquiries, a timeline of everything that happened to
// them, CSV import (people, orders, subscribers) and a full data export.
const { zip } = require('./zip');

const STAGES = ['audience', 'lead', 'customer', 'regular'];
const EVENT_TYPES = ['signup', 'inquiry', 'purchase', 'subscribe', 'unsubscribe', 'open', 'click', 'listen', 'scan', 'visit', 'note'];
const SOURCES = ['store', 'newsletter', 'podcast', 'inquiry', 'funnel', 'etsy', 'paypal', 'stripe', 'print', 'social', 'referral', 'manual', 'import', 'deal', 'other'];
const ADDRESS = ['address1', 'address2', 'city', 'region', 'postal', 'country'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const iso = (d) => (d instanceof Date ? d.toISOString() : d);
const cleanSource = (s, fallback = 'manual') => {
  const v = String(s || '').trim().toLowerCase();
  return v ? v.slice(0, 40) : fallback;
};
// Accepts "49.95", "$1,200.00", 4995 (with cents=true) → integer cents.
const toCents = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
const toDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const splitName = (full) => {
  const [first = '', ...rest] = String(full || '').trim().split(/\s+/);
  return { first_name: first, last_name: rest.join(' ') };
};

function createPeople({ getDb, HttpError, parseTags, id, formatMoney }) {
  // Set later by the workflow engine: onEvent(accountId, event), onTagsAdded(accountId, personId, tags).
  const hooks = {};
  // Inside a transaction, hooks wait for the commit; otherwise they run now.
  const later = async (q, fn) => (q.inTx ? q.afterCommit(fn) : fn());
  // Stage rule (explainable, recomputed after every event):
  //   regular  = 2+ purchases, or an active subscription plus a purchase
  //   customer = 1 purchase
  //   lead     = signed up, asked, subscribed, opened or clicked
  //   audience = known to us, no action yet
  async function recomputeStages(q, personIds) {
    const ids = [...new Set(personIds.filter(Boolean))];
    if (!ids.length) return;
    await q.run(`UPDATE contacts c SET stage = CASE
        WHEN x.purchases >= 2 OR (x.purchases >= 1 AND x.active_subs > 0) THEN 'regular'
        WHEN x.purchases >= 1 THEN 'customer'
        WHEN x.lead_events > 0 OR x.active_subs > 0 THEN 'lead'
        ELSE 'audience' END
      FROM (SELECT p.id,
          (SELECT COUNT(*) FROM events e WHERE e.person_id = p.id AND e.type = 'purchase') AS purchases,
          (SELECT COUNT(*) FROM events e WHERE e.person_id = p.id AND e.type IN ('signup', 'inquiry', 'subscribe', 'open', 'click')) AS lead_events,
          (SELECT COUNT(*) FROM subscriptions s WHERE s.person_id = p.id AND s.status = 'active') AS active_subs
        FROM contacts p WHERE p.id IN (SELECT (jsonb_array_elements_text(?::jsonb))::int)) x
      WHERE c.id = x.id`, JSON.stringify(ids));
  }

  async function logEvent(q, accountId, { person_id = null, type, source = '', value_cents = 0, campaign_id = null, occurred_at = null, meta = {} }, { recompute = true } = {}) {
    const r = await q.get(`INSERT INTO events (account_id, person_id, type, source, value_cents, campaign_id, occurred_at, meta)
      VALUES (?, ?, ?, ?, ?, ?, COALESCE(?::timestamptz, now()), ?) RETURNING id`,
    accountId, person_id, type, cleanSource(source, ''), Math.max(0, Math.round(value_cents || 0)), campaign_id, occurred_at, JSON.stringify(meta || {}));
    if (recompute && person_id) await recomputeStages(q, [person_id]);
    if (person_id && hooks.onEvent) {
      const ev = { id: r.id, person_id, type, source, occurred_at, meta };
      await later(q, () => hooks.onEvent(accountId, ev).catch((e) => console.error('workflow trigger:', e.message)));
    }
    return r.id;
  }

  async function tagsAdded(q, accountId, personId, tags) {
    if (tags.length && hooks.onTagsAdded) await later(q, () => hooks.onTagsAdded(accountId, personId, tags).catch((e) => console.error('workflow tag trigger:', e.message)));
  }

  // Creates the person or merges into an existing one (same email = same person).
  // Without an email (e.g. a print-only subscriber) a new record is created.
  async function upsertContact(q, accountId, p) {
    const email = String(p.email || '').trim().toLowerCase();
    if (email && !EMAIL_RE.test(email)) throw new HttpError(400, 'A valid email is required');
    let { first_name = '', last_name = '' } = p;
    if (!first_name && !last_name && p.name) ({ first_name, last_name } = splitName(p.name));
    const fields = {
      first_name: String(first_name || '').trim(), last_name: String(last_name || '').trim(),
      phone: String(p.phone || '').trim(),
      ...Object.fromEntries(ADDRESS.map((k) => [k, String(p[k] || '').trim()])),
    };
    if (!email && !fields.first_name && !fields.last_name) throw new HttpError(400, 'A person needs an email or a name');
    const existing = email && await q.get('SELECT * FROM contacts WHERE account_id = ? AND email = ?', accountId, email);
    if (existing) {
      const merged = parseTags([...JSON.parse(existing.tags), ...parseTags(p.tags)]);
      const cols = Object.keys(fields);
      // Newer non-empty values win; blanks never erase what we know.
      await q.run(`UPDATE contacts SET tags = ?, ${cols.map((k) => `${k} = COALESCE(NULLIF(?, ''), ${k})`).join(', ')} WHERE id = ?`,
        JSON.stringify(merged), ...cols.map((k) => fields[k]), existing.id);
      await tagsAdded(q, accountId, existing.id, merged.filter((t) => !JSON.parse(existing.tags).includes(t)));
      return { id: existing.id, created: false };
    }
    const cols = Object.keys(fields);
    const r = await q.get(`INSERT INTO contacts (account_id, email, tags, source, ${cols.join(', ')})
      VALUES (?, ?, ?, ?, ${cols.map(() => '?').join(', ')}) RETURNING id`,
    accountId, email, JSON.stringify(parseTags(p.tags)), cleanSource(p.source), ...cols.map((k) => fields[k]));
    await tagsAdded(q, accountId, r.id, parseTags(p.tags));
    return { id: r.id, created: true };
  }

  const personOut = (c) => ({ ...c, tags: JSON.parse(c.tags), unsubscribed: Boolean(c.unsubscribed), name: [c.first_name, c.last_name].filter(Boolean).join(' ') });
  const eventOut = (e) => ({ ...e, meta: JSON.parse(e.meta || '{}'), valueLabel: e.value_cents ? formatMoney(e.value_cents, 'usd') : '' });
  const getPerson = async (accountId, personId) => {
    const c = await getDb().get('SELECT * FROM contacts WHERE id = ? AND account_id = ?', id(personId), accountId);
    if (!c) throw new HttpError(404, 'Person not found');
    return c;
  };

  // ---------- Imports ----------
  // Each import is idempotent: people merge by email, orders dedupe by
  // (source, order id), so re-importing the same file changes nothing.
  async function importPeople(accountId, rows, { source = 'import', tag = '' } = {}) {
    let created = 0, updated = 0, skipped = 0;
    const touched = [];
    await getDb().tx(async (t) => {
      for (const row of rows.slice(0, 5000)) {
        try {
          const r = await upsertContact(t, accountId, { ...row, tags: [...parseTags(row.tags), ...parseTags(tag)], source: row.source || source });
          r.created ? created++ : updated++;
          touched.push(r.id);
        } catch (e) { if (e.status === 400) skipped++; else throw e; }
      }
      await recomputeStages(t, touched);
    });
    return { created, updated, skipped };
  }

  async function importOrders(accountId, orders, { source = 'store' } = {}) {
    let created = 0, duplicates = 0, skipped = 0, people = 0;
    const touched = [];
    await getDb().tx(async (t) => {
      for (const o of orders.slice(0, 5000)) {
        const src = cleanSource(o.source || source, 'store');
        const items = (Array.isArray(o.items) ? o.items : []).map((i) => ({
          name: String(i.name || '').trim().slice(0, 200), qty: Math.max(1, Math.round(Number(i.qty) || 1)), price_cents: toCents(i.price),
        })).filter((i) => i.name);
        const total = o.total !== undefined && o.total !== '' ? toCents(o.total) : items.reduce((n, i) => n + i.qty * i.price_cents, 0);
        const externalId = String(o.order_id || '').trim().slice(0, 100) || null;
        if (!o.email && !o.name) { skipped++; continue; }
        if (externalId && await t.get('SELECT 1 FROM orders WHERE account_id = ? AND source = ? AND external_id = ?', accountId, src, externalId)) {
          duplicates++; continue;
        }
        let person;
        try {
          person = await upsertContact(t, accountId, { ...o, tags: ['customer', ...parseTags(o.tags)], source: src });
        } catch (e) { if (e.status === 400) { skipped++; continue; } throw e; }
        if (person.created) people++;
        const when = toDate(o.date);
        const name = items.map((i) => (i.qty > 1 ? `${i.qty} × ${i.name}` : i.name)).join(', ').slice(0, 300) || 'Order';
        const ord = await t.get(`INSERT INTO orders (account_id, product_name, contact_id, email, amount_cents, currency, status, mode, source, items, external_id, created_at, paid_at)
          VALUES (?, ?, ?, ?, ?, ?, 'paid', 'import', ?, ?, ?, COALESCE(?::timestamptz, now()), COALESCE(?::timestamptz, now())) RETURNING id`,
        accountId, name, person.id, String(o.email || '').trim().toLowerCase(), total, String(o.currency || 'usd').toLowerCase().slice(0, 3),
        src, JSON.stringify(items), externalId, when, when);
        await logEvent(t, accountId, { person_id: person.id, type: 'purchase', source: src, value_cents: total, occurred_at: when, meta: { order_id: ord.id, external_id: externalId, items: name } }, { recompute: false });
        touched.push(person.id);
        created++;
      }
      await recomputeStages(t, touched);
    });
    return { created, duplicates, skipped, people };
  }

  async function importSubscribers(accountId, rows, { product = 'Newsletter', format = 'email' } = {}) {
    let created = 0, existing = 0, skipped = 0;
    const touched = [];
    await getDb().tx(async (t) => {
      for (const row of rows.slice(0, 5000)) {
        const fmt = ['print', 'email'].includes(String(row.format || '').toLowerCase()) ? String(row.format).toLowerCase() : format;
        const prod = String(row.product || product).trim().slice(0, 100) || 'Newsletter';
        let person;
        try {
          person = await upsertContact(t, accountId, { ...row, tags: [`${fmt}-subscriber`, ...parseTags(row.tags)], source: row.source || (fmt === 'print' ? 'print' : 'newsletter') });
        } catch (e) { if (e.status === 400) { skipped++; continue; } throw e; }
        const status = ['active', 'paused', 'cancelled'].includes(String(row.status || '').toLowerCase()) ? String(row.status).toLowerCase() : 'active';
        if (await t.get('SELECT 1 FROM subscriptions WHERE person_id = ? AND product = ? AND format = ?', person.id, prod, fmt)) { existing++; continue; }
        const started = toDate(row.started_at);
        await t.run(`INSERT INTO subscriptions (account_id, person_id, product, format, status, started_at, ended_at)
          VALUES (?, ?, ?, ?, ?, COALESCE(?::timestamptz, now()), ?)`, accountId, person.id, prod, fmt, status, started,
        status === 'cancelled' ? toDate(row.ended_at) || new Date().toISOString() : null);
        await logEvent(t, accountId, { person_id: person.id, type: 'subscribe', source: fmt === 'print' ? 'print' : 'newsletter', occurred_at: started, meta: { product: prod, format: fmt } }, { recompute: false });
        touched.push(person.id);
        created++;
      }
      await recomputeStages(t, touched);
    });
    return { created, existing, skipped };
  }

  // Podcast hosts (e.g. Buzzsprout) export listens per episode per day or
  // month; each row becomes one anonymous listen event carrying its count.
  async function importListens(accountId, rows) {
    let created = 0, skipped = 0;
    await getDb().tx(async (t) => {
      for (const row of rows.slice(0, 5000)) {
        const count = Math.round(Number(String(row.listens ?? row.count ?? '').replace(/[^0-9.]/g, '')));
        const when = toDate(row.date);
        if (!count || !when) { skipped++; continue; }
        await logEvent(t, accountId, { type: 'listen', source: 'podcast', occurred_at: when, meta: { count, episode: String(row.episode || '').slice(0, 200) } }, { recompute: false });
        created++;
      }
    });
    return { created, skipped };
  }

  // ---------- Export ----------
  const EXPORT_TABLES = {
    people: 'SELECT * FROM contacts WHERE account_id = ? ORDER BY id',
    events: 'SELECT * FROM events WHERE account_id = ? ORDER BY id',
    orders: 'SELECT * FROM orders WHERE account_id = ? ORDER BY id',
    subscriptions: 'SELECT * FROM subscriptions WHERE account_id = ? ORDER BY id',
    campaigns: 'SELECT * FROM campaigns WHERE account_id = ? ORDER BY id',
    automations: 'SELECT * FROM automations WHERE account_id = ? ORDER BY id',
    layouts: 'SELECT * FROM layouts WHERE account_id = ? ORDER BY lever',
    products: 'SELECT * FROM products WHERE account_id = ? ORDER BY id',
    funnels: 'SELECT * FROM funnels WHERE account_id = ? ORDER BY id',
    funnel_steps: 'SELECT s.* FROM funnel_steps s JOIN funnels f ON f.id = s.funnel_id WHERE f.account_id = ? ORDER BY s.id',
    page_events: 'SELECT * FROM page_events WHERE account_id = ? ORDER BY id',
    pipelines: 'SELECT * FROM pipelines WHERE account_id = ? ORDER BY id',
    pipeline_stages: 'SELECT s.* FROM pipeline_stages s JOIN pipelines p ON p.id = s.pipeline_id WHERE p.account_id = ? ORDER BY s.id',
    deals: 'SELECT * FROM deals WHERE account_id = ? ORDER BY id',
    broadcasts: 'SELECT * FROM broadcasts WHERE account_id = ? ORDER BY id',
    email_log: 'SELECT * FROM email_log WHERE account_id = ? ORDER BY id',
  };
  async function exportAll(accountId) {
    const db = getDb();
    const out = {};
    for (const [name, sql] of Object.entries(EXPORT_TABLES)) out[name] = await db.all(sql, accountId);
    // Settings without payment secrets.
    const { stripe_secret_key: _k, stripe_webhook_secret: _w, ...settings } = await db.get('SELECT * FROM accounts WHERE id = ?', accountId);
    return { settings, ...out };
  }
  const csvCell = (v) => {
    if (v === null || v === undefined) return '';
    const s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const toCsv = (rows) => {
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    return [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n');
  };

  // ---------- Routes ----------
  function register(api) {
    api.get('/people/:id', async (req, res) => {
      const db = getDb();
      const c = await getPerson(req.accountId, req.params.id);
      const [events, orders, subscriptions, deals] = await Promise.all([
        db.all('SELECT * FROM events WHERE person_id = ? ORDER BY occurred_at DESC, id DESC LIMIT 1000', c.id),
        db.all('SELECT * FROM orders WHERE contact_id = ? ORDER BY created_at DESC', c.id),
        db.all('SELECT * FROM subscriptions WHERE person_id = ? ORDER BY started_at DESC', c.id),
        db.all(`SELECT d.*, p.name AS pipeline_name, s.name AS stage_name FROM deals d JOIN pipelines p ON p.id = d.pipeline_id
          JOIN pipeline_stages s ON s.id = d.stage_id WHERE d.contact_id = ? ORDER BY d.id DESC`, c.id),
      ]);
      res.json({
        ...personOut(c), events: events.map(eventOut),
        orders: orders.map((o) => ({ ...o, items: JSON.parse(o.items || '[]'), amountLabel: formatMoney(o.amount_cents, o.currency) })),
        subscriptions, deals: deals.map((d) => ({ ...d, valueLabel: formatMoney(d.value_cents, d.currency) })),
        totals: {
          spent_cents: orders.filter((o) => o.status === 'paid').reduce((n, o) => n + o.amount_cents, 0),
          orders: orders.filter((o) => o.status === 'paid').length,
        },
      });
    });

    // Log something by hand: an inquiry by phone, a podcast mention, a note.
    api.post('/people/:id/events', async (req, res) => {
      const c = await getPerson(req.accountId, req.params.id);
      const type = String(req.body?.type || '');
      if (!EVENT_TYPES.includes(type) || type === 'purchase') throw new HttpError(400, 'Pick what happened (purchases come from orders)');
      const note = String(req.body?.note || '').slice(0, 2000);
      const eventId = await logEvent(getDb(), req.accountId, {
        person_id: c.id, type, source: req.body?.source || 'manual', occurred_at: toDate(req.body?.occurred_at), meta: note ? { note } : {},
      });
      res.status(201).json({ id: eventId });
    });

    api.post('/people/:id/subscriptions', async (req, res) => {
      const c = await getPerson(req.accountId, req.params.id);
      const format = req.body?.format === 'print' ? 'print' : 'email';
      const product = String(req.body?.product || 'Newsletter').trim().slice(0, 100) || 'Newsletter';
      if (format === 'print' && !c.address1) throw new HttpError(400, 'Add a mailing address before starting a print subscription');
      await getDb().tx(async (t) => {
        await t.run('INSERT INTO subscriptions (account_id, person_id, product, format) VALUES (?, ?, ?, ?)', req.accountId, c.id, product, format);
        await logEvent(t, req.accountId, { person_id: c.id, type: 'subscribe', source: format === 'print' ? 'print' : 'newsletter', meta: { product, format } });
      });
      res.status(201).json({ ok: true });
    });

    api.put('/subscriptions/:id', async (req, res) => {
      const db = getDb();
      const s = await db.get('SELECT * FROM subscriptions WHERE id = ? AND account_id = ?', id(req.params.id), req.accountId);
      if (!s) throw new HttpError(404, 'Subscription not found');
      const status = String(req.body?.status || '');
      if (!['active', 'paused', 'cancelled'].includes(status)) throw new HttpError(400, 'Status must be active, paused or cancelled');
      await db.tx(async (t) => {
        await t.run(`UPDATE subscriptions SET status = ?, ended_at = ${status === 'cancelled' ? 'now()' : 'NULL'} WHERE id = ?`, status, s.id);
        if (status === 'cancelled' && s.status !== 'cancelled') {
          await logEvent(t, req.accountId, { person_id: s.person_id, type: 'unsubscribe', source: s.format === 'print' ? 'print' : 'newsletter', meta: { product: s.product, format: s.format } });
        } else await recomputeStages(t, [s.person_id]);
      });
      res.json({ ok: true });
    });

    api.post('/import/people', async (req, res) => {
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
      res.json(await importPeople(req.accountId, rows, { source: req.body?.source, tag: req.body?.tag }));
    });
    api.post('/import/orders', async (req, res) => {
      const orders = Array.isArray(req.body?.orders) ? req.body.orders : [];
      res.json(await importOrders(req.accountId, orders, { source: req.body?.source }));
    });
    api.post('/import/subscribers', async (req, res) => {
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
      res.json(await importSubscribers(req.accountId, rows, { product: req.body?.product, format: req.body?.format === 'print' ? 'print' : 'email' }));
    });

    api.post('/import/listens', async (req, res) => {
      res.json(await importListens(req.accountId, Array.isArray(req.body?.rows) ? req.body.rows : []));
    });

    api.get('/export.json', async (req, res) => {
      const data = await exportAll(req.accountId);
      res.attachment(`export-${new Date().toISOString().slice(0, 10)}.json`).type('application/json')
        .send(JSON.stringify({ exported_at: new Date().toISOString(), ...data }, (k, v) => (v instanceof Date ? v.toISOString() : v), 2));
    });
    api.get('/export.zip', async (req, res) => {
      const { settings, ...tables } = await exportAll(req.accountId);
      const files = [{ name: 'settings.csv', data: toCsv([settings]) },
        ...Object.entries(tables).map(([name, rows]) => ({ name: `${name}.csv`, data: toCsv(rows) }))];
      res.attachment(`export-${new Date().toISOString().slice(0, 10)}.zip`).type('application/zip').send(zip(files));
    });
  }

  return { hooks, tagsAdded, upsertContact, logEvent, recomputeStages, personOut, register, importPeople, importOrders, importSubscribers, importListens, exportAll, toCsv };
}

module.exports = { createPeople, STAGES, EVENT_TYPES, SOURCES, ADDRESS, toCents, toDate, splitName, iso };
