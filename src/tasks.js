// Tasks and Today: the short list of things to do now. Your own to-dos (with or
// without a person attached), follow-ups that workflows flag, and what needs a
// look today: overdue invoices, new leads, today's bookings and unread messages.

// Used by workflows: a "follow up with" step also lands on the list.
async function addTask(db, accountId, { contactId = null, title, dueAt = new Date(), source = 'you' }) {
  return db.get('INSERT INTO tasks (account_id, contact_id, title, due_at, source) VALUES (?, ?, ?, ?, ?) RETURNING id',
    accountId, contactId, String(title).trim().slice(0, 300), dueAt.toISOString(), source);
}

const segments = require('./segments');

function registerTasks(api, { getDb, HttpError, id }) {
  const db = () => getDb();
  const out = (t) => ({ ...t, done: Boolean(t.done_at), person: t.contact_id ? { id: t.contact_id, name: [t.first_name, t.last_name].filter(Boolean).join(' ') || t.email || '' } : null });
  const SELECT = `SELECT t.*, c.first_name, c.last_name, c.email FROM tasks t LEFT JOIN contacts c ON c.id = t.contact_id`;
  // "2026-11-09" means the end of that day; empty means now.
  const dueOf = (v) => {
    if (!v) return new Date();
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? `${v}T17:00:00` : v);
    if (Number.isNaN(d.getTime())) throw new HttpError(400, 'Check the date');
    return d;
  };
  const own = async (contactId, accountId) => {
    if (!contactId) return null;
    const c = await db().get('SELECT id FROM contacts WHERE id = ? AND account_id = ?', id(contactId), accountId);
    if (!c) throw new HttpError(404, 'Person not found');
    return c.id;
  };

  api.get('/tasks', async (req, res) => {
    const person = req.query.contact_id ? id(req.query.contact_id) : null;
    const rows = await db().all(`${SELECT} WHERE t.account_id = ? ${person ? 'AND t.contact_id = ?' : ''}
      AND (t.done_at IS NULL OR t.done_at > now() - interval '7 days') ORDER BY (t.done_at IS NOT NULL), t.due_at LIMIT 200`, ...[req.accountId, ...(person ? [person] : [])]);
    res.json(rows.map(out));
  });
  api.post('/tasks', async (req, res) => {
    const title = String(req.body?.title || '').trim();
    if (!title) throw new HttpError(400, 'What needs doing?');
    const contactId = await own(req.body.contact_id, req.accountId);
    const r = await addTask(db(), req.accountId, { contactId, title, dueAt: dueOf(req.body.due) });
    res.status(201).json(out(await db().get(`${SELECT} WHERE t.id = ?`, r.id)));
  });
  api.put('/tasks/:id', async (req, res) => {
    const t = await db().get('SELECT * FROM tasks WHERE id = ? AND account_id = ?', id(req.params.id), req.accountId);
    if (!t) throw new HttpError(404, 'Task not found');
    const b = req.body || {};
    if (b.done !== undefined) await db().run(`UPDATE tasks SET done_at = ${b.done ? 'now()' : 'NULL'} WHERE id = ?`, t.id);
    if (b.title !== undefined && String(b.title).trim()) await db().run('UPDATE tasks SET title = ? WHERE id = ?', String(b.title).trim().slice(0, 300), t.id);
    if (b.due !== undefined) await db().run('UPDATE tasks SET due_at = ? WHERE id = ?', dueOf(b.due).toISOString(), t.id);
    res.json(out(await db().get(`${SELECT} WHERE t.id = ?`, t.id)));
  });
  api.delete('/tasks/:id', async (req, res) => {
    await db().run('DELETE FROM tasks WHERE id = ? AND account_id = ?', id(req.params.id), req.accountId);
    res.json({ ok: true });
  });

  // Today: what needs you now. Each list is short; the counts say if there's more.
  api.get('/today', async (req, res) => {
    const a = req.accountId, d = db();
    const [tasks, later, invoices, leads, bookings, unread, reviews] = await Promise.all([
      d.all(`${SELECT} WHERE t.account_id = ? AND t.done_at IS NULL AND t.due_at < date_trunc('day', now()) + interval '1 day' ORDER BY t.due_at LIMIT 20`, a),
      d.get(`SELECT COUNT(*)::int AS n FROM tasks WHERE account_id = ? AND done_at IS NULL AND due_at >= date_trunc('day', now()) + interval '1 day'`, a),
      d.all(`SELECT id, number, title, total_cents, currency, due_date, client_name, client_email FROM invoices
        WHERE account_id = ? AND kind = 'invoice' AND status = 'sent' AND due_date IS NOT NULL AND due_date < CURRENT_DATE ORDER BY due_date LIMIT 10`, a),
      d.all(`SELECT id, first_name, last_name, email, created_at, entry FROM contacts WHERE account_id = ? AND created_at > now() - interval '24 hours' ORDER BY created_at DESC LIMIT 10`, a),
      d.all(`SELECT b.id, b.starts_at, b.name AS first_name, '' AS last_name, b.email, b.contact_id FROM bookings b
        WHERE b.account_id = ? AND b.status = 'confirmed' AND b.starts_at >= now() - interval '1 hour' AND b.starts_at < date_trunc('day', now()) + interval '1 day' ORDER BY b.starts_at LIMIT 10`, a),
      d.get("SELECT COUNT(DISTINCT contact_id)::int AS n FROM messages WHERE account_id = ? AND direction = 'in' AND read_at IS NULL", a),
      d.get('SELECT COUNT(*)::int AS n FROM testimonials WHERE account_id = ? AND approved = 0 AND shareable = 1', a),
    ]);
    const name = (p) => [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email || 'Someone';
    // Customers ready for the next step up the offer ladder.
    const ready = [];
    for (const s of await segments.ladder(d, a)) {
      const key = `next:${s.from.id}:${s.to.id}`;
      const n = (await segments.members(d, a, key, { emailable: true })).length;
      if (n) ready.push({ key, count: n, product: s.to.name, from: s.from.name });
    }
    res.json({
      tasks: tasks.map(out), later: later.n,
      invoices: invoices.map((i) => ({ ...i, who: i.client_name || i.client_email || '' })),
      leads: leads.map((p) => ({ id: p.id, name: name(p), entry: p.entry || '', created_at: p.created_at })),
      bookings: bookings.map((b) => ({ id: b.id, starts_at: b.starts_at, contact_id: b.contact_id, name: name(b) })),
      unread: unread.n, reviews: reviews.n, ready: ready.sort((x, y) => y.count - x.count).slice(0, 3),
    });
  });
}

module.exports = { addTask, registerTasks };
