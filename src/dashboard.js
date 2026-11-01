// Dashboard tiles and per-lever layouts.
//
// Every tile has the same contract, so a new tile is one entry in TILES:
//   { id, title, levers (where it shows by default), default_width ('half' | 'full'),
//     query(ctx) → data the tile renders, empty_state (one line when there's no data) }
const { LEVER_KEYS } = require('./levers');

const LAYOUT_KEYS = ['all', ...LEVER_KEYS];
const weeksBack = 8;

const TILES = [
  { id: 'move', title: 'This week’s move', levers: ['all', ...LEVER_KEYS], default_width: 'full',
    empty_state: 'Your first move appears once there’s some activity to learn from.',
    query: async (ctx) => ctx.weeklyMove?.(ctx.lever) ?? null },
  { id: 'health', title: 'Lever health', levers: ['all'], default_width: 'full',
    empty_state: 'Health scores appear once you have a few weeks of activity.',
    query: async (ctx) => ({ levers: await ctx.levers(), focus: await ctx.focus() }) },
  { id: 'flow', title: 'Audience flow', levers: ['all', ...LEVER_KEYS], default_width: 'full',
    empty_state: 'Import people or orders to see your flow.',
    query: async ({ db, a }) => {
      const rows = await db.all('SELECT stage, COUNT(*)::int AS n FROM contacts WHERE account_id = ? GROUP BY stage', a);
      const counts = Object.fromEntries(['audience', 'lead', 'customer', 'regular'].map((s) => [s, rows.find((r) => r.stage === s)?.n || 0]));
      return Object.values(counts).some(Boolean) ? counts : null;
    } },
  { id: 'revenue', title: 'Revenue this month', levers: ['all', 'conversion', 'upsell'], default_width: 'half',
    empty_state: 'No sales yet this month.',
    query: async ({ db, a, money }) => {
      const r = await db.get(`SELECT
          COALESCE(SUM(value_cents) FILTER (WHERE occurred_at >= date_trunc('month', now())), 0)::int AS cur,
          COUNT(*) FILTER (WHERE occurred_at >= date_trunc('month', now()))::int AS orders,
          COALESCE(SUM(value_cents) FILTER (WHERE occurred_at >= date_trunc('month', now()) - interval '1 month'
            AND occurred_at < now() - interval '1 month'), 0)::int AS prev
        FROM events WHERE account_id = ? AND type = 'purchase'`, a);
      const bars = await weekly(db, a, "type = 'purchase'", 'SUM(value_cents)');
      if (!r.cur && !r.prev && !bars.some((b) => b.n)) return null;
      return { value: money(r.cur), sub: `${r.orders} order${r.orders === 1 ? '' : 's'}`, change: change(r.cur, r.prev, 'same point last month'), bars: bars.map((b) => ({ ...b, value: money(b.n) })) };
    } },
  { id: 'subscribers', title: 'Subscribers', levers: ['all', 'continuity'], default_width: 'half',
    empty_state: 'No newsletter subscribers yet. Import your list from People.',
    query: async ({ db, a }) => {
      const r = await db.get(`SELECT COUNT(*) FILTER (WHERE status = 'active' AND format = 'email')::int AS email,
          COUNT(*) FILTER (WHERE status = 'active' AND format = 'print')::int AS print,
          COUNT(*) FILTER (WHERE started_at >= now() - interval '30 days')::int AS added,
          COUNT(*) FILTER (WHERE ended_at >= now() - interval '30 days')::int AS ended
        FROM subscriptions WHERE account_id = ?`, a);
      const total = r.email + r.print;
      if (!total && !r.ended) return null;
      return { value: String(total), sub: `${r.added} joined, ${r.ended} left in 30 days`, bars: [{ label: 'Email', n: r.email }, { label: 'Print', n: r.print }] };
    } },
  { id: 'inquiries', title: 'Inquiries waiting', levers: ['all', 'conversion'], default_width: 'half',
    empty_state: 'No one is waiting on you. 🎉',
    query: async ({ db, a }) => {
      const rows = await inquiriesWaiting(db, a);
      if (!rows.length) return null;
      const old = rows.filter((r) => r.days >= 14).length;
      return { value: String(rows.length), sub: old ? `${old} older than 14 days` : 'all within 2 weeks', warn: old > 0,
        people: rows.slice(0, 3).map((r) => ({ id: r.id, name: r.name, days: r.days })) };
    } },
  { id: 'listens', title: 'Podcast listens', levers: ['all', 'lead'], default_width: 'half',
    empty_state: 'Import listens from your podcast host (People → Import CSV → Podcast listens).',
    query: async ({ db, a }) => {
      const sumExpr = "SUM(GREATEST(COALESCE((meta::jsonb->>'count')::int, 1), 1))";
      const r = await db.get(`SELECT COALESCE(${sumExpr} FILTER (WHERE occurred_at > now() - interval '30 days'), 0)::int AS cur,
          COALESCE(${sumExpr} FILTER (WHERE occurred_at > now() - interval '60 days' AND occurred_at <= now() - interval '30 days'), 0)::int AS prev
        FROM events WHERE account_id = ? AND type = 'listen'`, a);
      const bars = await weekly(db, a, "type = 'listen'", sumExpr);
      if (!r.cur && !r.prev && !bars.some((b) => b.n)) return null;
      return { value: String(r.cur), sub: 'last 30 days', change: change(r.cur, r.prev, 'previous 30 days'), bars };
    } },
  { id: 'sources', title: 'Sales by source', levers: ['all', 'lead', 'conversion'], default_width: 'half',
    empty_state: 'Sales split by where buyers came from once you have orders.',
    query: async ({ db, a, money }) => {
      const s = await salesBySource(db, a);
      if (!s.first.length) return null;
      const fmt = (rows) => rows.map((r) => ({ label: r.source || 'unknown', n: r.cents, value: money(r.cents) }));
      return { first: fmt(s.first), last: fmt(s.last) };
    } },
  { id: 'signups', title: 'New people', levers: ['lead'], default_width: 'half',
    empty_state: 'New people per week show here.',
    query: async ({ db, a }) => {
      const bars = await weekly(db, a, null, 'COUNT(*)', 'contacts', 'created_at');
      const total = bars.reduce((n, b) => n + b.n, 0);
      return total ? { value: String(bars.at(-1).n), sub: 'this week', bars } : null;
    } },
  { id: 'funnels', title: 'Funnels', levers: ['lead', 'conversion'], default_width: 'half',
    empty_state: 'Build a funnel to see visitors and signups here.',
    query: async ({ db, a }) => {
      const rows = await db.all(`SELECT f.id, f.name,
          (SELECT COUNT(*)::int FROM page_events e WHERE e.funnel_id = f.id AND e.type = 'view' AND e.created_at > now() - interval '30 days') AS views,
          (SELECT COUNT(*)::int FROM page_events e WHERE e.funnel_id = f.id AND e.type = 'optin' AND e.created_at > now() - interval '30 days') AS optins
        FROM funnels f WHERE f.account_id = ? ORDER BY views DESC, f.id DESC LIMIT 4`, a);
      return rows.length ? { bars: rows.map((r) => ({ label: r.name, n: r.views, value: `${r.views} visits · ${r.optins} signups`, href: `#/funnels/${r.id}` })) } : null;
    } },
  { id: 'pipeline', title: 'Open deals', levers: ['conversion'], default_width: 'half',
    empty_state: 'Track bigger sales as deals in Pipelines.',
    query: async ({ db, a, money }) => {
      const r = await db.get("SELECT COUNT(*)::int AS n, COALESCE(SUM(value_cents), 0)::int AS cents FROM deals WHERE account_id = ? AND status = 'open'", a);
      return r.n ? { value: money(r.cents), sub: `${r.n} open deal${r.n === 1 ? '' : 's'}` } : null;
    } },
];
const TILE_IDS = TILES.map((t) => t.id);

function change(cur, prev, vs) {
  if (!prev) return cur ? { text: `new vs ${vs}`, dir: 'up' } : null;
  const pct = Math.round(((cur - prev) / prev) * 100);
  return { text: `${pct > 0 ? '+' : ''}${pct}% vs ${vs}`, dir: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat' };
}

// Totals for the last 8 weeks (oldest first), from events unless told otherwise.
async function weekly(db, a, where, agg, table = 'events', col = 'occurred_at') {
  const rows = await db.all(`SELECT FLOOR(EXTRACT(EPOCH FROM (now() - ${col})) / 604800)::int AS w, COALESCE(${agg}, 0)::int AS n
    FROM ${table} WHERE account_id = ? ${where ? `AND ${where}` : ''} AND ${col} > now() - interval '${weeksBack} weeks' GROUP BY w`, a);
  return Array.from({ length: weeksBack }, (_, i) => {
    const w = weeksBack - 1 - i;
    return { label: w === 0 ? 'this week' : `${w}w ago`, n: rows.find((r) => r.w === w)?.n || 0 };
  });
}

// People whose latest inquiry has had no purchase or reply logged since.
async function inquiriesWaiting(db, a) {
  return (await db.all(`SELECT c.id, TRIM(c.first_name || ' ' || c.last_name) AS name, c.email, i.at,
      FLOOR(EXTRACT(EPOCH FROM (now() - i.at)) / 86400)::int AS days
    FROM (SELECT person_id, MAX(occurred_at) AS at FROM events WHERE account_id = ? AND type = 'inquiry' GROUP BY person_id) i
    JOIN contacts c ON c.id = i.person_id
    WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.person_id = i.person_id AND e.occurred_at > i.at
      AND (e.type = 'purchase' OR (e.type = 'note' AND e.meta::jsonb->>'reply' = 'true')))
    AND NOT EXISTS (SELECT 1 FROM campaigns cp WHERE cp.account_id = ? AND cp.status = 'sent' AND cp.sent_at > i.at
      AND cp.audience::jsonb @> to_jsonb(i.person_id))
    ORDER BY i.at ASC`, a, a)).map((r) => ({ ...r, name: r.name || r.email }));
}

// Revenue by the buyer's first source, or by the last touch before each purchase
// (the most recent non-purchase event's source, else the purchase's own source).
async function salesBySource(db, a) {
  const first = await db.all(`SELECT c.source, SUM(e.value_cents)::int AS cents FROM events e JOIN contacts c ON c.id = e.person_id
    WHERE e.account_id = ? AND e.type = 'purchase' AND e.value_cents > 0 GROUP BY c.source ORDER BY cents DESC`, a);
  const last = await db.all(`SELECT COALESCE((SELECT t.source FROM events t WHERE t.person_id = e.person_id AND t.type <> 'purchase'
        AND t.source <> '' AND t.occurred_at <= e.occurred_at ORDER BY t.occurred_at DESC, t.id DESC LIMIT 1), e.source) AS source,
      SUM(e.value_cents)::int AS cents
    FROM events e WHERE e.account_id = ? AND e.type = 'purchase' AND e.value_cents > 0 GROUP BY 1 ORDER BY cents DESC`, a);
  return { first, last };
}

// A new install starts with four tiles visible; the rest wait in the tray.
function defaultLayout(lever) {
  const mine = TILES.filter((t) => t.levers.includes(lever));
  const rest = TILES.filter((t) => !t.levers.includes(lever));
  return [...mine, ...rest].map((t, i) => ({ tile_id: t.id, order: i, width: t.default_width, hidden: i >= 4 }));
}
// Keeps a saved layout valid as tiles are added later.
function normalizeLayout(saved, lever) {
  const known = (Array.isArray(saved) ? saved : []).filter((t) => TILE_IDS.includes(t?.tile_id));
  const seen = new Set();
  const list = known.filter((t) => !seen.has(t.tile_id) && seen.add(t.tile_id)).map((t) => ({
    tile_id: t.tile_id, width: t.width === 'full' ? 'full' : 'half', hidden: Boolean(t.hidden),
  }));
  for (const t of defaultLayout(lever)) if (!seen.has(t.tile_id)) list.push({ ...t, hidden: true });
  return list.map((t, i) => ({ ...t, order: i }));
}

function registerDashboard(api, { getDb, HttpError, leversFor, weeklyMove, formatMoney, getAccount }) {
  const money = (c) => formatMoney(c || 0, 'usd');

  api.get('/levers', async (req, res) => {
    const levers = await leversFor(req.accountId);
    const account = await getAccount(req.accountId);
    const flow = await TILES.find((t) => t.id === 'flow').query({ db: getDb(), a: req.accountId });
    res.json({ levers, focus: levers.focus, pinned: account.pinned_lever || '', flow });
  });

  api.put('/levers/pin', async (req, res) => {
    const lever = String(req.body?.lever || '');
    if (lever && !LEVER_KEYS.includes(lever)) throw new HttpError(400, 'Unknown lever');
    await getDb().run('UPDATE accounts SET pinned_lever = ? WHERE id = ?', lever, req.accountId);
    res.json({ ok: true });
  });

  api.get('/layouts/:lever', async (req, res) => {
    const lever = req.params.lever;
    if (!LAYOUT_KEYS.includes(lever)) throw new HttpError(404, 'Unknown lever');
    const row = await getDb().get('SELECT tiles FROM layouts WHERE account_id = ? AND lever = ?', req.accountId, lever);
    res.json({
      lever, saved: Boolean(row), tiles: row ? normalizeLayout(JSON.parse(row.tiles), lever) : defaultLayout(lever),
      catalog: TILES.map(({ id, title, levers, default_width, empty_state }) => ({ id, title, levers, default_width, empty_state })),
    });
  });

  api.put('/layouts/:lever', async (req, res) => {
    const lever = req.params.lever;
    if (!LAYOUT_KEYS.includes(lever)) throw new HttpError(404, 'Unknown lever');
    const tiles = normalizeLayout(req.body?.tiles, lever);
    await getDb().run(`INSERT INTO layouts (account_id, lever, tiles) VALUES (?, ?, ?)
      ON CONFLICT (account_id, lever) DO UPDATE SET tiles = EXCLUDED.tiles`, req.accountId, lever, JSON.stringify(tiles));
    res.json({ ok: true, tiles });
  });

  // Data for the visible tiles: GET /api/tiles?lever=all&ids=move,flow,revenue
  api.get('/tiles', async (req, res) => {
    const lever = LAYOUT_KEYS.includes(req.query.lever) ? req.query.lever : 'all';
    const ids = String(req.query.ids || '').split(',').filter((x) => TILE_IDS.includes(x));
    let leverCache;
    const ctx = {
      db: getDb(), a: req.accountId, lever, money,
      levers: async () => (leverCache ??= await leversFor(req.accountId)),
      focus: async () => (leverCache ??= await leversFor(req.accountId)).focus,
      weeklyMove: weeklyMove && ((lv) => weeklyMove(req.accountId, lv)),
    };
    const out = {};
    for (const tileId of ids) {
      const tile = TILES.find((t) => t.id === tileId);
      try { out[tileId] = { data: await tile.query(ctx), empty_state: tile.empty_state }; } catch (e) {
        console.error(`tile ${tileId}:`, e.message);
        out[tileId] = { data: null, empty_state: tile.empty_state, error: 'Couldn’t load this tile' };
      }
    }
    res.json(out);
  });
}

module.exports = { registerDashboard, TILES, TILE_IDS, defaultLayout, normalizeLayout, inquiriesWaiting, salesBySource, LAYOUT_KEYS };
