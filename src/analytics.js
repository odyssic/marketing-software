// Site analytics in one place (the Analytics page): visits, sign-ups, sales and
// clicks for a period against the one before it, a chart, and ranked lists of
// traffic sources, pages, clicks and devices. Everything comes from what live
// pages record (page_events, page_clicks, page_reach); drafts never count.
'use strict';

const DAY = 864e5;
const RANGES = { '7d': 7, '30d': 30, '90d': 90, '12m': 365 };

// What kind of device a visit came from, by its browser's description.
function deviceOf(ua = '') {
  const s = String(ua);
  if (/bot|crawl|spider|slurp|preview|headless|monitor|curl|wget|python|scrapy/i.test(s)) return 'bot';
  if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(s)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android|BlackBerry|Opera Mini|IEMobile/i.test(s)) return 'phone';
  return s ? 'computer' : '';
}

function registerAnalytics(api, { getDb, formatMoney }) {
  const db = () => getDb();

  api.get('/analytics', async (req, res) => {
    const acct = req.accountId;
    const range = RANGES[req.query.range] ? req.query.range : '30d';
    const days = RANGES[range];
    const now = new Date();
    // Whole days: the period starts at midnight (UTC), so the first day isn't a sliver.
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const start = new Date(today - (days - 1) * DAY), prevStart = new Date(start.getTime() - days * DAY);
    const unit = days <= 31 ? 'day' : days <= 120 ? 'week' : 'month';
    const iso = (d) => d.toISOString();

    // Headline numbers for [a, b).
    const totals = async (a, b) => {
      const ev = await db().get(`SELECT COUNT(*) FILTER (WHERE type = 'view')::int AS visits,
          COUNT(*) FILTER (WHERE type = 'optin')::int AS signups, COUNT(*) FILTER (WHERE type = 'sale')::int AS sales
        FROM page_events WHERE account_id = ? AND created_at >= ? AND created_at < ?`, acct, iso(a), iso(b));
      // Money taken on the pages, in the currency most of it came in.
      const money = await db().get(`SELECT currency, COALESCE(SUM(amount_cents), 0)::bigint AS cents FROM orders
        WHERE account_id = ? AND funnel_id IS NOT NULL AND status = 'paid' AND mode <> 'test' AND paid_at >= ? AND paid_at < ?
        GROUP BY currency ORDER BY cents DESC LIMIT 1`, acct, iso(a), iso(b)) || { cents: 0, currency: 'usd' };
      const cl = await db().get('SELECT COUNT(*)::int AS n FROM page_clicks WHERE account_id = ? AND created_at >= ? AND created_at < ?', acct, iso(a), iso(b));
      const conversion = ev.visits ? (ev.signups + ev.sales) / ev.visits : null;
      return { visits: ev.visits, signups: ev.signups, sales: ev.sales, revenue: Number(money.cents), currency: money.currency || 'usd', clicks: cl.n, conversion };
    };
    const [cur, prev] = await Promise.all([totals(start, now), totals(prevStart, start)]);

    // The chart: each bucket of the period, with the same bucket one period earlier.
    const bucket = (d) => { const x = new Date(d); if (unit === 'month') return `${x.getUTCFullYear()}-${x.getUTCMonth()}`; const day = Math.floor(x.getTime() / DAY); return unit === 'week' ? Math.floor(day / 7) : day; };
    const raw = await db().all(`SELECT type, created_at FROM page_events WHERE account_id = ? AND created_at >= ? AND type IN ('view', 'optin', 'sale')`, acct, iso(prevStart));
    const keys = [];
    for (let t = start.getTime(); t <= now.getTime(); t += DAY) { const k = bucket(t); if (!keys.includes(k)) keys.push(k); }
    const slots = keys.map((k) => ({ key: k, at: null, visits: 0, signups: 0, sales: 0, prevVisits: 0 }));
    const byKey = Object.fromEntries(slots.map((s) => [s.key, s]));
    for (let t = start.getTime(); t <= now.getTime(); t += DAY) { const s = byKey[bucket(t)]; if (!s.at) s.at = new Date(t).toISOString().slice(0, 10); }
    for (const r of raw) {
      const t = new Date(r.created_at).getTime();
      if (t >= start.getTime()) {
        const s = byKey[bucket(t)]; if (!s) continue;
        if (r.type === 'view') s.visits++; else if (r.type === 'optin') s.signups++; else s.sales++;
      } else if (r.type === 'view') {
        const s = byKey[bucket(t + days * DAY)]; if (s) s.prevVisits++;
      }
    }

    // Where visits came from, and how well each source turns into sign-ups and sales.
    const sources = (await db().all(`SELECT source, COUNT(*) FILTER (WHERE type = 'view')::int AS visits,
        COUNT(*) FILTER (WHERE type IN ('optin', 'sale'))::int AS conversions
      FROM page_events WHERE account_id = ? AND created_at >= ? GROUP BY source`, acct, iso(start)))
      .filter((r) => r.visits).sort((a, b) => b.visits - a.visits).slice(0, 8)
      .map((r) => ({ source: r.source || 'Direct', visits: r.visits, rate: r.visits ? r.conversions / r.visits : 0 }));

    // Pages: visits, conversion and how many read to the end.
    const pageRows = await db().all(`SELECT e.step_id, s.name AS page, f.name AS flow, f.id AS funnel_id, s.blocks,
        COUNT(*) FILTER (WHERE e.type = 'view')::int AS visits, COUNT(*) FILTER (WHERE e.type IN ('optin', 'sale'))::int AS conversions
      FROM page_events e JOIN funnel_steps s ON s.id = e.step_id JOIN funnels f ON f.id = e.funnel_id
      WHERE e.account_id = ? AND e.created_at >= ? GROUP BY e.step_id, s.name, f.name, f.id, s.blocks`, acct, iso(start));
    const reach = await db().all(`SELECT r.step_id, r.deepest, COUNT(*)::int AS n FROM page_reach r JOIN funnel_steps s ON s.id = r.step_id
      JOIN funnels f ON f.id = s.funnel_id WHERE f.account_id = ? AND r.created_at >= ? GROUP BY r.step_id, r.deepest`, acct, iso(start));
    const pages = pageRows.filter((r) => r.visits).sort((a, b) => b.visits - a.visits).slice(0, 10).map((r) => {
      const last = Math.max(0, (JSON.parse(r.blocks || '[]').length || 1) - 1);
      const mine = reach.filter((x) => x.step_id === r.step_id);
      const tracked = mine.reduce((t, x) => t + x.n, 0);
      const toEnd = mine.filter((x) => x.deepest >= last).reduce((t, x) => t + x.n, 0);
      return { step_id: r.step_id, funnel_id: r.funnel_id, page: r.page, flow: r.flow, visits: r.visits, rate: r.conversions / r.visits, readToEnd: tracked ? toEnd / tracked : null };
    });

    // The buttons and links people click most, as a share of that page's visits.
    const views = Object.fromEntries(pageRows.map((r) => [r.step_id, r.visits]));
    const clicks = (await db().all(`SELECT c.step_id, c.label, s.name AS page, COUNT(DISTINCT c.visit)::int AS people
      FROM page_clicks c JOIN funnel_steps s ON s.id = c.step_id WHERE c.account_id = ? AND c.created_at >= ?
      GROUP BY c.step_id, c.label, s.name ORDER BY people DESC LIMIT 10`, acct, iso(start)))
      .map((r) => ({ ...r, rate: views[r.step_id] ? Math.min(1, r.people / views[r.step_id]) : null }));

    // Phones, tablets and computers (recorded from the device each visit came from).
    const devices = (await db().all(`SELECT device, COUNT(*)::int AS visits FROM page_events
      WHERE account_id = ? AND type = 'view' AND created_at >= ? AND device IN ('phone', 'tablet', 'computer') GROUP BY device`, acct, iso(start)))
      .sort((a, b) => b.visits - a.visits);

    res.json({ range, days, unit, current: { ...cur, revenueLabel: formatMoney(cur.revenue, cur.currency) }, previous: prev, series: slots, sources, pages, clicks, devices });
  });
}

module.exports = { registerAnalytics, deviceOf };
