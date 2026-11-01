// The four growth levers, their metrics and health scores, all computed from
// the events table (plus subscriptions for continuity).
//
// Each metric is a function of an anchor time t, so the same query gives the
// current value (t = now), last month's (t = now - 30d) and the trailing
// 90-day baseline (the average at now - 30d, - 60d and - 90d).
const LEVERS = {
  lead: { label: 'Lead gen', color: '#0ea5e9', flow: ['audience', 'lead'], metric: 'New leads, last 30 days' },
  conversion: { label: 'Conversion', color: '#8b5cf6', flow: ['lead', 'customer'], metric: 'Leads who bought within 60 days' },
  upsell: { label: 'Upsell', color: '#f59e0b', flow: ['customer'], metric: 'Average order value' },
  continuity: { label: 'Continuity', color: '#10b981', flow: ['customer', 'regular'], metric: 'Active subscribers + repeat buyers' },
};
const LEVER_KEYS = Object.keys(LEVERS);
const LEAD_TYPES = "('signup', 'inquiry', 'subscribe')";
const DAY = 864e5;

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
// 50 = flat versus the baseline; each 10% better adds 10 points, each 10% worse subtracts 10.
function scoreFrom(cur, base) {
  if (cur === null || cur === undefined) return null;
  if (!base) return cur > 0 ? 60 : 50;
  return Math.round(clamp(50 + (cur / base - 1) * 100));
}
const avg = (xs) => { const v = xs.filter((x) => x !== null && x !== undefined); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const pctChange = (cur, prev) => (cur === null || prev === null || prev === undefined ? null : prev === 0 ? (cur > 0 ? null : 0) : Math.round(((cur - prev) / prev) * 100));

function createLevers({ getDb, formatMoney }) {
  const metrics = {
    async lead(a, t) {
      const r = await getDb().get(`SELECT COUNT(*)::int AS n FROM (SELECT person_id, MIN(occurred_at) AS first FROM events
        WHERE account_id = ? AND person_id IS NOT NULL AND type IN ${LEAD_TYPES} GROUP BY person_id) x
        WHERE first > ?::timestamptz - interval '30 days' AND first <= ?::timestamptz`, a, t, t);
      return { value: r.n, sample: r.n };
    },
    // Of people who became leads in the 60 days before t (and hadn't bought
    // before that), the share who made a first purchase within 60 days.
    async conversion(a, t) {
      const r = await getDb().get(`WITH leads AS (
          SELECT person_id, MIN(occurred_at) AS lead_at FROM events
          WHERE account_id = ? AND person_id IS NOT NULL AND type IN ${LEAD_TYPES} AND occurred_at <= ?::timestamptz GROUP BY person_id),
        buys AS (SELECT person_id, MIN(occurred_at) AS buy_at FROM events
          WHERE account_id = ? AND type = 'purchase' AND person_id IS NOT NULL AND occurred_at <= ?::timestamptz GROUP BY person_id)
        SELECT COUNT(*)::int AS cohort,
          COUNT(*) FILTER (WHERE b.buy_at IS NOT NULL AND b.buy_at <= l.lead_at + interval '60 days')::int AS converted
        FROM leads l LEFT JOIN buys b ON b.person_id = l.person_id
        WHERE l.lead_at > ?::timestamptz - interval '60 days' AND (b.buy_at IS NULL OR b.buy_at >= l.lead_at)`, a, t, a, t, t);
      return { value: r.cohort ? Math.round((r.converted / r.cohort) * 1000) / 10 : null, sample: r.cohort, converted: r.converted };
    },
    async upsell(a, t) {
      const r = await getDb().get(`SELECT COUNT(*)::int AS n, COALESCE(AVG(value_cents), 0)::float AS aov FROM events
        WHERE account_id = ? AND type = 'purchase' AND value_cents > 0
        AND occurred_at > ?::timestamptz - interval '30 days' AND occurred_at <= ?::timestamptz`, a, t, t);
      return { value: r.n ? Math.round(r.aov) : null, sample: r.n };
    },
    async continuity(a, t) {
      const r = await getDb().get(`WITH subs AS (
          SELECT person_id FROM subscriptions WHERE account_id = ? AND started_at <= ?::timestamptz
          AND (ended_at IS NULL OR ended_at > ?::timestamptz)),
        repeaters AS (SELECT person_id FROM events WHERE account_id = ? AND type = 'purchase' AND person_id IS NOT NULL
          AND occurred_at <= ?::timestamptz GROUP BY person_id
          HAVING COUNT(*) >= 2 AND MAX(occurred_at) > ?::timestamptz - interval '365 days')
        SELECT (SELECT COUNT(*) FROM (SELECT person_id FROM subs UNION SELECT person_id FROM repeaters) u)::int AS regulars,
          (SELECT COUNT(*) FROM subscriptions WHERE account_id = ? AND started_at <= ?::timestamptz - interval '30 days'
            AND (ended_at IS NULL OR ended_at > ?::timestamptz - interval '30 days'))::int AS subs_start,
          (SELECT COUNT(*) FROM subscriptions WHERE account_id = ? AND ended_at > ?::timestamptz - interval '30 days'
            AND ended_at <= ?::timestamptz AND started_at <= ?::timestamptz - interval '30 days')::int AS churned`,
      a, t, t, a, t, t, a, t, t, a, t, t, t);
      return { value: r.regulars, sample: r.regulars + r.subs_start, churn: r.subs_start ? Math.round((r.churned / r.subs_start) * 1000) / 10 : null };
    },
  };

  const valueLabel = (key, v) => {
    if (v === null || v === undefined) return '—';
    if (key === 'conversion') return `${v}%`;
    if (key === 'upsell') return formatMoney(v, 'usd');
    return String(v);
  };

  // Current value, 30-day change and health score for every lever.
  async function compute(accountId, now = new Date()) {
    const at = (days) => new Date(now.getTime() - days * DAY).toISOString();
    const out = {};
    for (const key of LEVER_KEYS) {
      const [cur, m30, m60, m90] = await Promise.all([0, 30, 60, 90].map((d) => metrics[key](accountId, at(d))));
      const baseline = avg([m30.value, m60.value, m90.value]);
      let score = scoreFrom(cur.value, baseline);
      if (key === 'continuity' && score !== null) {
        // Churn counts against the score the same way: 10% more churn than usual = -10.
        const baseChurn = avg([m30.churn, m60.churn, m90.churn]);
        if (cur.churn !== null) {
          const penalty = baseChurn ? (cur.churn / baseChurn - 1) * 100 : cur.churn;
          score = Math.round(clamp(score - clamp(penalty, -50, 50)));
        }
      }
      const enough = cur.sample > 0 || [m30, m60, m90].some((m) => m.sample > 0);
      const change = pctChange(cur.value, m30.value);
      out[key] = {
        key, ...LEVERS[key], value: cur.value, valueLabel: valueLabel(key, cur.value),
        previous: m30.value, previousLabel: valueLabel(key, m30.value), baseline,
        change, changeLabel: change === null ? (m30.value === null ? 'new this month' : '') : `${change > 0 ? '+' : ''}${change}% vs last 30 days`,
        score: enough ? score : null, enough, churn: cur.churn ?? null, sample: cur.sample,
      };
    }
    return out;
  }

  // The weekly move targets the pinned lever, or the one with the lowest health.
  function focusOf(levers, pinned) {
    if (pinned && levers[pinned]) return pinned;
    const scored = LEVER_KEYS.filter((k) => levers[k].score !== null);
    if (!scored.length) return 'lead';
    return scored.reduce((lo, k) => (levers[k].score < levers[lo].score ? k : lo), scored[0]);
  }

  return { compute, focusOf, metrics };
}

module.exports = { createLevers, LEVERS, LEVER_KEYS, scoreFrom };
