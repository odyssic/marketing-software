// Business numbers for the dashboard: revenue, recurring revenue, customers,
// leads, conversion, average order, lifetime value and repeat rate, for a chosen
// timeframe compared with the one before it, plus the series behind the charts.
// Test-mode orders (no real money) are left out.
const DAY = 864e5;
const RANGES = { '7d': 7, '30d': 30, '90d': 90, '12m': 365, all: null };
const NICE_SOURCE = { funnel: 'Your pages', invoice: 'Invoices', import: 'Imported', store: 'Store', stripe: 'Stripe', paypal: 'PayPal', etsy: 'Etsy', manual: 'Added by hand', booking: 'Bookings' };

function registerMetrics(api, { getDb }) {
  const db = () => getDb();

  api.get('/metrics', async (req, res) => {
    const range = RANGES[req.query.range] !== undefined ? req.query.range : '30d';
    const now = new Date();
    const acct = req.accountId;
    const PAID = "status = 'paid' AND mode <> 'test' AND paid_at IS NOT NULL";
    let days = RANGES[range];
    if (days === null) {
      // "All time" starts at the first sale or the first person, whichever came first.
      const first = await db().get(`SELECT LEAST((SELECT MIN(paid_at) FROM orders WHERE account_id = ? AND ${PAID}), (SELECT MIN(created_at) FROM contacts WHERE account_id = ?)) AS t`, acct, acct);
      days = Math.max(30, Math.ceil((now - new Date(first?.t || now)) / DAY) + 1);
    }
    const start = new Date(now.getTime() - days * DAY), prevStart = new Date(start.getTime() - days * DAY);
    const unit = days <= 31 ? 'day' : days <= 120 ? 'week' : 'month';

    // Headline numbers for a window [a, b).
    const window = async (a, b) => {
      const o = await db().get(`SELECT COALESCE(SUM(amount_cents), 0)::bigint AS revenue, COUNT(*)::int AS orders
        FROM orders WHERE account_id = ? AND ${PAID} AND paid_at >= ? AND paid_at < ?`, acct, a.toISOString(), b.toISOString());
      const leads = (await db().get('SELECT COUNT(*)::int AS n FROM contacts WHERE account_id = ? AND created_at >= ? AND created_at < ?', acct, a.toISOString(), b.toISOString())).n;
      const newCustomers = (await db().get(`SELECT COUNT(*)::int AS n FROM (SELECT contact_id, MIN(paid_at) AS first FROM orders
        WHERE account_id = ? AND ${PAID} AND contact_id IS NOT NULL GROUP BY contact_id) x WHERE first >= ? AND first < ?`, acct, a.toISOString(), b.toISOString())).n;
      // Of the people who joined in the window, how many have bought (so far).
      const converted = (await db().get(`SELECT COUNT(DISTINCT c.id)::int AS n FROM contacts c JOIN orders o ON o.contact_id = c.id AND o.status = 'paid' AND o.mode <> 'test'
        WHERE c.account_id = ? AND c.created_at >= ? AND c.created_at < ?`, acct, a.toISOString(), b.toISOString())).n;
      return { revenue: Number(o.revenue), orders: o.orders, leads, newCustomers, conversion: leads ? converted / leads : null, aov: o.orders ? Number(o.revenue) / o.orders : null };
    };
    const [cur, prev] = await Promise.all([window(start, now), window(prevStart, start)]);

    // Lifetime value and repeat rate look at every customer ever.
    const life = await db().get(`SELECT COUNT(*)::int AS customers, COALESCE(SUM(total), 0)::bigint AS revenue, COUNT(*) FILTER (WHERE n >= 2)::int AS repeaters
      FROM (SELECT contact_id, SUM(amount_cents) AS total, COUNT(*) AS n FROM orders WHERE account_id = ? AND ${PAID} AND contact_id IS NOT NULL GROUP BY contact_id) x`, acct);

    // Recurring revenue, per month: each customer's current monthly or yearly plan.
    const rec = await db().get(`SELECT COALESCE(SUM(CASE WHEN p.billing = 'monthly' THEN o.amount_cents ELSE o.amount_cents / 12.0 END), 0)::bigint AS mrr, COUNT(*)::int AS subscribers FROM (
        SELECT DISTINCT ON (o.contact_id, o.product_id) o.* FROM orders o WHERE o.account_id = ? AND o.status = 'paid' AND o.mode <> 'test' AND o.contact_id IS NOT NULL ORDER BY o.contact_id, o.product_id, o.paid_at DESC
      ) o JOIN products p ON p.id = o.product_id
      WHERE (p.billing = 'monthly' AND o.paid_at > ?) OR (p.billing = 'yearly' AND o.paid_at > ?)`, acct, new Date(now - 35 * DAY).toISOString(), new Date(now - 366 * DAY).toISOString());

    // Chart series: one bucket per day/week/month, gaps filled with zero, previous period aligned.
    const bucket = (d) => {
      const t = new Date(d);
      if (unit === 'month') return t.toISOString().slice(0, 7);
      // Days and weeks count from the start of the window, so the previous period lines up exactly.
      return `i${Math.floor((t - start) / (unit === 'day' ? DAY : 7 * DAY))}`;
    };
    const buckets = [];
    if (unit === 'month') {
      const c = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
      while (c <= now) { buckets.push({ key: c.toISOString().slice(0, 7), label: c.toISOString().slice(0, 7) }); c.setUTCMonth(c.getUTCMonth() + 1); }
    } else {
      const step = unit === 'day' ? DAY : 7 * DAY;
      for (let t = start.getTime(), i = 0; t < now.getTime(); t += step, i++) buckets.push({ key: `i${i}`, label: new Date(Math.min(t + step - 1, now.getTime())).toISOString().slice(0, 10) });
    }
    const rows = async (a, b, shift = 0) => {
      const orders = await db().all(`SELECT paid_at, amount_cents FROM orders WHERE account_id = ? AND ${PAID} AND paid_at >= ? AND paid_at < ?`, acct, a.toISOString(), b.toISOString());
      const people = await db().all('SELECT created_at FROM contacts WHERE account_id = ? AND created_at >= ? AND created_at < ?', acct, a.toISOString(), b.toISOString());
      const firsts = await db().all(`SELECT first FROM (SELECT MIN(paid_at) AS first FROM orders WHERE account_id = ? AND ${PAID} AND contact_id IS NOT NULL GROUP BY contact_id) x WHERE first >= ? AND first < ?`, acct, a.toISOString(), b.toISOString());
      const m = {};
      const add = (d, k, v) => { const key = bucket(new Date(new Date(d).getTime() + shift)); (m[key] = m[key] || { revenue: 0, leads: 0, customers: 0 })[k] += v; };
      orders.forEach((o) => add(o.paid_at, 'revenue', Number(o.amount_cents)));
      people.forEach((p) => add(p.created_at, 'leads', 1));
      firsts.forEach((f) => add(f.first, 'customers', 1));
      return m;
    };
    const [now_, before] = await Promise.all([rows(start, now), rows(prevStart, start, unit === 'month' ? 0 : days * DAY)]);
    // For monthly buckets, the previous period is the same months a year/period earlier: align by position.
    let prevByIndex = null;
    if (unit === 'month') {
      const pm = await rows(prevStart, start);
      const pbuckets = [];
      const c = new Date(Date.UTC(prevStart.getUTCFullYear(), prevStart.getUTCMonth(), 1));
      while (c < start) { pbuckets.push(c.toISOString().slice(0, 7)); c.setUTCMonth(c.getUTCMonth() + 1); }
      prevByIndex = pbuckets.slice(-buckets.length).map((k) => pm[k]?.revenue || 0);
    }
    const series = buckets.map((b, i) => ({ label: b.label, revenue: now_[b.key]?.revenue || 0, leads: now_[b.key]?.leads || 0, customers: now_[b.key]?.customers || 0,
      prevRevenue: prevByIndex ? prevByIndex[i] || 0 : before[b.key]?.revenue || 0 }));

    // Where the money and the people came from, in the window.
    const src = await db().all(`SELECT COALESCE(NULLIF(attribution, ''), '') AS attribution, source, amount_cents FROM orders WHERE account_id = ? AND ${PAID} AND paid_at >= ?`, acct, start.toISOString());
    const bySource = {};
    for (const o of src) {
      let s = '';
      try { s = JSON.parse(o.attribution || 'null')?.source || ''; } catch { /* plain */ }
      const name = s || NICE_SOURCE[o.source] || o.source || 'Other';
      bySource[name] = (bySource[name] || 0) + Number(o.amount_cents);
    }
    const sources = Object.entries(bySource).sort((a, b) => b[1] - a[1]);
    const top = sources.slice(0, 5).map(([name, cents]) => ({ name, cents }));
    if (sources.length > 5) top.push({ name: 'Other', cents: sources.slice(5).reduce((n, [, c]) => n + c, 0) });

    const testOrders = (await db().get("SELECT COUNT(*)::int AS n FROM orders WHERE account_id = ? AND status = 'paid' AND mode = 'test' AND paid_at >= ?", acct, start.toISOString())).n;
    const currency = (await db().get("SELECT currency FROM orders WHERE account_id = ? AND status = 'paid' ORDER BY id DESC LIMIT 1", acct))?.currency || 'usd';
    res.json({
      range, days, unit, currency, testOrders,
      current: cur, previous: prev,
      mrr: Number(rec.mrr), subscribers: rec.subscribers,
      ltv: life.customers ? Number(life.revenue) / life.customers : null, customers: life.customers,
      repeatRate: life.customers ? life.repeaters / life.customers : null,
      series, sources: top,
    });
  });
}

module.exports = { registerMetrics, RANGES };
