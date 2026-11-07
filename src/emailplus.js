// Email marketing extras: saved templates, subject-line A/B tests and a full
// report per email (who opened, which links got clicked, unsubscribes, bounces).
function registerEmailPlus(api, { getDb, HttpError, id }) {
  const db = () => getDb();

  // ---------- Templates: save a good email, start the next one from it ----------
  api.get('/email-templates', async (req, res) => {
    res.json(await db().all('SELECT id, name, subject, preheader, body, created_at FROM email_templates WHERE account_id = ? ORDER BY name, id', req.accountId));
  });
  api.post('/email-templates', async (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 80);
    const body = String(req.body?.body || '').slice(0, 50000);
    if (!name) throw new HttpError(400, 'Name the template');
    if (!body.trim()) throw new HttpError(400, 'Write the message first');
    const r = await db().get('INSERT INTO email_templates (account_id, name, subject, preheader, body) VALUES (?, ?, ?, ?, ?) RETURNING id',
      req.accountId, name, String(req.body?.subject || '').slice(0, 300), String(req.body?.preheader || '').slice(0, 200), body);
    res.status(201).json({ id: r.id, name });
  });
  api.delete('/email-templates/:id', async (req, res) => {
    await db().run('DELETE FROM email_templates WHERE id = ? AND account_id = ?', id(req.params.id), req.accountId);
    res.json({ ok: true });
  });

  // ---------- The report for one email ----------
  const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s; };
  api.get('/broadcasts/:id/report.csv', async (req, res) => {
    const b = await db().get('SELECT id, subject FROM broadcasts WHERE id = ? AND account_id = ?', id(req.params.id), req.accountId);
    if (!b) throw new HttpError(404, 'Email not found');
    const rows = await db().all(`SELECT e.to_email, e.subject, e.status, e.ab_variant, e.created_at, e.opened_at, e.clicked_at, c.first_name, c.last_name,
        (SELECT string_agg(DISTINCT k.url, ' ') FROM email_clicks k WHERE k.email_id = e.id) AS links
      FROM email_log e LEFT JOIN contacts c ON c.id = e.contact_id WHERE e.broadcast_id = ? ORDER BY e.id`, b.id);
    const head = ['Email', 'First name', 'Last name', 'Subject', 'Version', 'Status', 'Sent', 'Opened', 'Clicked', 'Links clicked'];
    const lines = [head, ...rows.map((r) => [r.to_email, r.first_name, r.last_name, r.subject, (r.ab_variant || '').toUpperCase(), r.status, r.created_at, r.opened_at || '', r.clicked_at || '', r.links || ''])];
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="email-${b.id}-report.csv"` });
    res.send(`\ufeff${lines.map((l) => l.map(csvCell).join(',')).join('\r\n')}`);
  });
  api.get('/broadcasts/:id/report', async (req, res) => {
    const b = await db().get('SELECT * FROM broadcasts WHERE id = ? AND account_id = ?', id(req.params.id), req.accountId);
    if (!b) throw new HttpError(404, 'Email not found');
    const rows = await db().all(`SELECT e.id, e.contact_id, e.to_email, e.status, e.opened_at, e.clicked_at, e.ab_variant, e.subject,
        c.first_name, c.last_name FROM email_log e LEFT JOIN contacts c ON c.id = e.contact_id WHERE e.broadcast_id = ? ORDER BY e.id`, b.id);
    const sent = rows.filter((r) => ['sent', 'logged', 'bounced'].includes(r.status)).length;
    const bounced = rows.filter((r) => r.status === 'bounced').length;
    const failed = rows.filter((r) => r.status === 'failed').length;
    const opened = rows.filter((r) => r.opened_at).length, clicked = rows.filter((r) => r.clicked_at).length;
    const ids = rows.map((r) => r.contact_id).filter(Boolean);
    // Unsubscribes from people who got this email, in the week after it went out.
    const unsub = b.sent_at && ids.length ? (await db().get(`SELECT COUNT(DISTINCT person_id)::int AS n FROM events WHERE account_id = ? AND type = 'unsubscribe'
      AND occurred_at >= ? AND occurred_at < ? AND person_id IN (${ids.map(() => '?').join(',')})`, req.accountId, b.sent_at, new Date(new Date(b.sent_at).getTime() + 7 * 864e5).toISOString(), ...ids)).n : 0;
    const links = await db().all(`SELECT k.url, COUNT(*)::int AS clicks, COUNT(DISTINCT k.email_id)::int AS people FROM email_clicks k
      JOIN email_log e ON e.id = k.email_id WHERE e.broadcast_id = ? GROUP BY k.url ORDER BY COUNT(*) DESC LIMIT 20`, b.id);
    const variant = (v) => { const r = rows.filter((x) => x.ab_variant === v); return { subject: r[0]?.subject || '', sent: r.length, opened: r.filter((x) => x.opened_at).length, clicked: r.filter((x) => x.clicked_at).length }; };
    res.json({
      id: b.id, subject: b.subject, status: b.status, sent_at: b.sent_at,
      totals: { sent, delivered: sent - bounced, bounced, failed, opened, clicked, unsubscribed: unsub },
      ab: b.subject_b ? { a: variant('a'), b: variant('b'), winner: b.ab_winner || '', ends_at: b.ab_ends_at } : null,
      links,
      people: rows.slice(0, 2000).map((r) => ({ name: [r.first_name, r.last_name].filter(Boolean).join(' '), email: r.to_email, contact_id: r.contact_id,
        status: r.status === 'bounced' ? 'bounced' : r.status === 'failed' ? 'failed' : r.clicked_at ? 'clicked' : r.opened_at ? 'opened' : 'sent' })),
    });
  });
}

// Subject test: a slice of the audience gets A or B; the rest get the winner later.
function splitForTest(recipients, pct) {
  const list = [...recipients];
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  // Small lists: everyone is in the test, half and half.
  if (list.length < 40) { const h = Math.ceil(list.length / 2); return { a: list.slice(0, h), b: list.slice(h), rest: [] }; }
  const each = Math.max(10, Math.round((list.length * Math.min(50, Math.max(10, pct))) / 200));
  return { a: list.slice(0, each), b: list.slice(each, 2 * each), rest: list.slice(2 * each) };
}
// More opens wins (by rate); a tie keeps A.
function pickWinner(a, b) {
  const rate = (x) => (x.sent ? x.opened / x.sent : 0);
  return rate(b) > rate(a) ? 'b' : 'a';
}

module.exports = { registerEmailPlus, splitForTest, pickWinner };
