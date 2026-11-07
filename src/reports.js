// Monthly results report for one business, for its owner and the clients they
// choose: last month's numbers next to the month before, in plain words, under
// the agency's own brand when it has one. Sent on the 1st when switched on.
const mailer = require('./mailer');
const { rillyEmail, rillyText } = require('./emailhtml');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const monthKey = (d) => d.toISOString().slice(0, 7);
const monthStart = (y, m) => new Date(Date.UTC(y, m, 1));
// The last full month before `now`, and the one before it.
function lastMonth(now = new Date()) {
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  return { start: monthStart(y, m - 1), end: monthStart(y, m), prevStart: monthStart(y, m - 2) };
}
const monthName = (d) => d.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const money = (cents, cur = 'usd') => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur.toUpperCase(), minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);

function createReports({ getDb, HttpError, publicBase }) {
  const db = () => getDb();

  async function numbers(accountId, a, b) {
    const one = async (sql, ...args) => Number(Object.values(await db().get(sql, ...args) || { n: 0 })[0]) || 0;
    const A = a.toISOString(), B = b.toISOString();
    return {
      visitors: await one("SELECT COUNT(*)::int AS n FROM page_events WHERE account_id = ? AND type = 'view' AND created_at >= ? AND created_at < ?", accountId, A, B),
      leads: await one('SELECT COUNT(*)::int AS n FROM contacts WHERE account_id = ? AND created_at >= ? AND created_at < ?', accountId, A, B),
      customers: await one(`SELECT COUNT(*)::int AS n FROM (SELECT contact_id, MIN(paid_at) AS first FROM orders WHERE account_id = ? AND status = 'paid' AND mode <> 'test' AND contact_id IS NOT NULL GROUP BY contact_id) x
        WHERE first >= ? AND first < ?`, accountId, A, B),
      revenue: await one("SELECT COALESCE(SUM(amount_cents), 0)::bigint AS n FROM orders WHERE account_id = ? AND status = 'paid' AND mode <> 'test' AND paid_at >= ? AND paid_at < ?", accountId, A, B),
      bookings: await one("SELECT COUNT(*)::int AS n FROM bookings WHERE account_id = ? AND created_at >= ? AND created_at < ? AND status <> 'cancelled'", accountId, A, B),
      emails: await one("SELECT COUNT(*)::int AS n FROM email_log WHERE account_id = ? AND contact_id IS NOT NULL AND status <> 'failed' AND created_at >= ? AND created_at < ?", accountId, A, B),
      opened: await one('SELECT COUNT(*)::int AS n FROM email_log WHERE account_id = ? AND contact_id IS NOT NULL AND opened_at IS NOT NULL AND created_at >= ? AND created_at < ?', accountId, A, B),
      sources: await db().all(`SELECT source, COUNT(*)::int AS n FROM page_events WHERE account_id = ? AND type IN ('optin', 'sale') AND source <> '' AND created_at >= ? AND created_at < ?
        GROUP BY source ORDER BY COUNT(*) DESC LIMIT 3`, accountId, A, B),
    };
  }

  // The agency brand that applies to a business: its owner's, when they set one.
  async function brandFor(accountId) {
    const o = await db().get(`SELECT u.brand_name, u.brand_logo, u.brand_color FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.account_id = ? AND m.role = 'owner' AND (u.brand_name <> '' OR u.brand_logo <> '') ORDER BY u.id LIMIT 1`, accountId).catch(() => null);
    return o ? { name: o.brand_name || '', logo: o.brand_logo || '', color: o.brand_color || '' } : null;
  }

  async function build(accountId, now = new Date()) {
    const account = await db().get('SELECT id, name FROM accounts WHERE id = ?', accountId);
    const { start, end, prevStart } = lastMonth(now);
    const [cur, prev] = await Promise.all([numbers(accountId, start, end), numbers(accountId, prevStart, start)]);
    const cents = (v) => money(v, account.currency || 'usd');
    const change = (a, b, fmt = String) => (b ? (a === b ? 'same as the month before' : `${a > b ? 'up' : 'down'} from ${fmt(b)}`) : a ? 'new this month' : '');
    const rows = [
      ['Visitors', String(cur.visitors), change(cur.visitors, prev.visitors)],
      ['New leads', String(cur.leads), change(cur.leads, prev.leads)],
      ['New customers', String(cur.customers), change(cur.customers, prev.customers)],
      ['Revenue', cents(cur.revenue), change(cur.revenue, prev.revenue, cents)],
      ...(cur.bookings || prev.bookings ? [['Bookings', String(cur.bookings), change(cur.bookings, prev.bookings)]] : []),
      ...(cur.emails ? [['Emails sent', String(cur.emails), cur.emails >= 10 ? `${Math.round((cur.opened / cur.emails) * 100)}% opened` : '']] : []),
    ];
    const lines = [];
    const rate = cur.visitors >= 20 ? Math.round(((cur.leads + cur.customers) / cur.visitors) * 1000) / 10 : null;
    if (rate !== null) lines.push(`${rate}% of visitors became a lead or a customer.`);
    if (cur.sources.length && cur.sources[0].source !== 'Direct') lines.push(`Most new people came from ${cur.sources[0].source}.`);
    if (cur.leads > prev.leads && prev.leads) lines.push(`${cur.leads - prev.leads} more new leads than the month before.`);
    if (!cur.visitors && !cur.leads) lines.push('A quiet month. A short email to past customers or a post with a link to your page usually brings people back.');
    const brand = await brandFor(accountId);
    const title = `${account.name}: ${monthName(start)}`;
    const blocks = [
      { p: `Here’s how ${account.name} did in ${monthName(start)}, compared with the month before.` },
      { rows },
      ...(lines.length ? [{ h: 'In short' }, { list: lines.map((l) => [l]) }] : []),
      { button: ['See the full dashboard', `${publicBase()}/#/`] },
    ];
    const footer = brand?.name ? `Prepared by ${brand.name}.` : '';
    return { title, subject: `${account.name}: your results for ${monthName(start)}`, preheader: `${cur.leads} new leads, ${cur.customers} new customers, ${cents(cur.revenue)} in sales.`,
      blocks, footer, brand, month: monthKey(start), numbers: { cur, prev } };
  }

  const render = (r) => ({
    html: rillyEmail({ base: publicBase(), title: r.title, preheader: r.preheader, blocks: r.blocks, footer: r.footer, brand: r.brand }),
    text: rillyText({ title: r.title, blocks: r.blocks, footer: r.footer }),
  });

  async function send(accountId, to, now = new Date()) {
    const r = await build(accountId, now);
    const { html, text } = render(r);
    for (const email of to) {
      await mailer.sendEmail({ ...mailer.senderFor({ name: r.brand?.name || 'Rilly' }), to: email, subject: r.subject, text, html });
    }
    await db().run('UPDATE accounts SET report_sent_month = ? WHERE id = ?', r.month, accountId);
    return r;
  }

  // On the 1st (or the first run after it), every business that asked for it.
  async function sendDue(now = new Date()) {
    const { start } = lastMonth(now);
    const due = await db().all("SELECT id, report_to FROM accounts WHERE report_monthly = 1 AND report_to <> '' AND report_sent_month <> ?", monthKey(start)).catch(() => []);
    let sent = 0;
    for (const a of due) {
      const to = a.report_to.split(',').map((x) => x.trim()).filter((x) => EMAIL_RE.test(x));
      if (!to.length) continue;
      try { await send(a.id, to, now); sent++; } catch (e) { console.error('report:', e.message); }
    }
    return { reports: sent };
  }

  function register(api) {
    api.get('/report', async (req, res) => {
      const a = await db().get('SELECT report_to, report_monthly FROM accounts WHERE id = ?', req.accountId);
      const r = await build(req.accountId);
      res.json({ to: a.report_to || '', monthly: Boolean(a.report_monthly), month: r.month, preview: render(r).html });
    });
    api.put('/report', async (req, res) => {
      const to = String(req.body?.to || '').split(/[,\s;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
      const bad = to.find((x) => !EMAIL_RE.test(x));
      if (bad) throw new HttpError(400, `Check this email: ${bad}`);
      if (to.length > 10) throw new HttpError(400, 'Up to 10 people');
      const monthly = Boolean(req.body?.monthly);
      if (monthly && !to.length) throw new HttpError(400, 'Add at least one email to send it to');
      await db().run('UPDATE accounts SET report_to = ?, report_monthly = ? WHERE id = ?', to.join(', '), monthly ? 1 : 0, req.accountId);
      res.json({ ok: true, to: to.join(', '), monthly });
    });
    api.post('/report/send', async (req, res) => {
      const a = await db().get('SELECT report_to FROM accounts WHERE id = ?', req.accountId);
      const to = String(a.report_to || '').split(',').map((x) => x.trim()).filter((x) => EMAIL_RE.test(x));
      if (!to.length) throw new HttpError(400, 'Add who it goes to first');
      await send(req.accountId, to);
      res.json({ ok: true, sent: to.length });
    });
  }

  return { register, sendDue, build, brandFor, lastMonth };
}

module.exports = { createReports, lastMonth };
