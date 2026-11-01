process.env.ALLOW_SIGNUPS = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { scoreFrom } = require('../src/levers');
const { defaultLayout, normalizeLayout, TILES } = require('../src/dashboard');

let app, server, base;
before(async () => {
  app = createApp(process.env.TEST_DATABASE_URL ? {} : { dbPath: ':memory:' });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});
after(async () => { server.close(); await app.close(); });

function client() {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
}
async function signup(email) {
  const c = client();
  assert.equal((await c('POST', '/api/auth/signup', { name: 'Lev Er', email, password: 'password123' })).status, 201);
  return c;
}
const daysAgo = (d) => new Date(Date.now() - d * 864e5).toISOString();

test('health score rule: 50 is flat, ±10 per 10%, clamped', () => {
  assert.equal(scoreFrom(10, 10), 50);
  assert.equal(scoreFrom(11, 10), 60);
  assert.equal(scoreFrom(9, 10), 40);
  assert.equal(scoreFrom(0, 10), 0);
  assert.equal(scoreFrom(30, 10), 100);
  assert.equal(scoreFrom(5, 0), 60);
  assert.equal(scoreFrom(0, 0), 50);
  assert.equal(scoreFrom(null, 10), null);
});

test('levers: empty workspace has no scores and focuses on lead gen; tiles show empty states', async () => {
  const c = await signup('empty-levers@example.com');
  const r = (await c('GET', '/api/levers')).body;
  for (const k of ['lead', 'conversion', 'upsell', 'continuity']) assert.equal(r.levers[k].score, null, k);
  assert.equal(r.focus, 'lead');
  const tiles = (await c('GET', `/api/tiles?lever=all&ids=${TILES.map((t) => t.id).join(',')},bogus`)).body;
  assert.deepEqual(Object.keys(tiles).sort(), TILES.map((t) => t.id).sort());
  for (const [id, t] of Object.entries(tiles)) {
    if (id === 'health') continue;
    assert.equal(t.data, null, id);
    assert.ok(t.empty_state, id);
  }
});

test('levers: metrics, 30-day change, health, focus and pinning from real events', async () => {
  const c = await signup('levers@example.com');
  const person = async (email, extra = {}) => (await c('POST', '/api/contacts', { email, ...extra })).body;
  const log = (p, type, days, extra = {}) => c('POST', `/api/people/${p.id}/events`, { type, occurred_at: daysAgo(days), ...extra });

  // Lead gen: 4 new leads in the last 30 days, 2 in each of the three months before.
  const recent = [];
  for (let i = 0; i < 4; i++) { const p = await person(`new${i}@example.com`); await log(p, 'signup', 5 + i); recent.push(p); }
  const older = [];
  for (const [n, d] of [[0, 40], [1, 45], [2, 70], [3, 75], [4, 100], [5, 105]]) { const p = await person(`old${n}@example.com`); await log(p, 'signup', d); older.push(p); }

  // Conversion: 2 of the 4 recent leads and 1 of the two 31-60-day leads buy after signing up.
  const orders = [
    { order_id: 'c1', email: 'new0@example.com', total: 50, date: daysAgo(2) },
    { order_id: 'c2', email: 'new1@example.com', total: 70, date: daysAgo(3) },
    { order_id: 'c3', email: 'old0@example.com', total: 40, date: daysAgo(35) },
    // A repeat buyer (continuity) with orders long ago and recently; never a lead.
    { order_id: 'r1', email: 'loyal@example.com', name: 'Loyal Lu', total: 30, date: daysAgo(200) },
    { order_id: 'r2', email: 'loyal@example.com', total: 30, date: daysAgo(150) },
  ];
  assert.equal((await c('POST', '/api/import/orders', { orders, source: 'store' })).body.created, 5);

  const r = (await c('GET', '/api/levers')).body;
  const { lead, conversion, upsell, continuity } = r.levers;
  assert.equal(lead.value, 4);
  assert.equal(lead.previous, 2);
  assert.equal(lead.baseline, 2);
  assert.equal(lead.change, 100);
  assert.equal(lead.score, 100); // twice the baseline, clamped
  // Leads in the last 60 days: 4 recent + 2 (40, 45 days) = 6; 3 bought → 50%.
  assert.equal(conversion.value, 50);
  assert.equal(conversion.valueLabel, '50%');
  // Upsell: orders in the last 30 days: $50, $70 → $60 AOV.
  assert.equal(upsell.value, 6000);
  assert.equal(upsell.valueLabel, '$60');
  // Continuity: Loyal (2 purchases within the year) is the only regular.
  assert.equal(continuity.value, 1);
  // Every scored lever has a 0-100 score; the weakest one is the focus.
  const scored = ['lead', 'conversion', 'upsell', 'continuity'].filter((k) => r.levers[k].score !== null);
  for (const k of scored) assert.ok(r.levers[k].score >= 0 && r.levers[k].score <= 100, k);
  const weakest = scored.reduce((lo, k) => (r.levers[k].score < r.levers[lo].score ? k : lo), scored[0]);
  assert.equal(r.focus, weakest);
  assert.notEqual(r.focus, 'lead');

  // Pinning overrides the weakest lever; unpinning restores it.
  assert.equal((await c('PUT', '/api/levers/pin', { lever: 'lead' })).status, 200);
  assert.equal((await c('GET', '/api/levers')).body.focus, 'lead');
  assert.equal((await c('PUT', '/api/levers/pin', { lever: 'nope' })).status, 400);
  await c('PUT', '/api/levers/pin', { lever: '' });
  assert.equal((await c('GET', '/api/levers')).body.focus, weakest);

  // Flow counts by stage.
  const flow = (await c('GET', '/api/levers')).body.flow;
  assert.deepEqual(flow, { audience: 0, lead: 7, customer: 3, regular: 1 });
});

test('tiles: revenue, inquiries waiting, sales by first source vs last touch', async () => {
  const c = await signup('tiles@example.com');
  await c('POST', '/api/import/people', { rows: [{ email: 'pod@example.com', name: 'Pod Person' }], source: 'podcast' });
  const pod = (await c('GET', '/api/contacts')).body[0];
  // Touched by the newsletter, then bought in the store.
  await c('POST', `/api/people/${pod.id}/events`, { type: 'click', source: 'newsletter', occurred_at: daysAgo(3) });
  await c('POST', '/api/import/orders', { source: 'store', orders: [
    // Dated a minute ago so they fall in "this month" whatever today's date is.
    { order_id: 's1', email: 'pod@example.com', total: 80, date: new Date(Date.now() - 60000).toISOString() },
    { order_id: 's2', email: 'direct@example.com', total: 20, date: new Date(Date.now() - 60000).toISOString() },
  ] });
  // Two inquiries: Ada's is 20 days old; Pod's was followed by a purchase.
  const asker = (await c('POST', '/api/contacts', { email: 'asker@example.com', first_name: 'Ada' })).body;
  await c('POST', `/api/people/${asker.id}/events`, { type: 'inquiry', occurred_at: daysAgo(20) });
  await c('POST', `/api/people/${pod.id}/events`, { type: 'inquiry', occurred_at: daysAgo(10) });

  const t = (await c('GET', '/api/tiles?lever=all&ids=revenue,inquiries,sources,flow')).body;
  assert.equal(t.revenue.data.value, '$100');
  assert.equal(t.revenue.data.bars.length, 8);
  assert.equal(t.revenue.data.bars.at(-1).value, '$100');
  // Pod bought after asking, so only Ada is still waiting.
  assert.deepEqual(t.inquiries.data.people.map((p) => [p.name, p.days]), [['Ada', 20]]);
  assert.equal(t.inquiries.data.sub, '1 older than 14 days');
  assert.deepEqual(t.sources.data.first.map((s) => [s.label, s.value]), [['podcast', '$80'], ['store', '$20']]);
  assert.deepEqual(t.sources.data.last.map((s) => [s.label, s.value]), [['newsletter', '$80'], ['store', '$20']]);
});

test('layouts: four tiles visible on a new install, saved per lever, normalized', async () => {
  const c = await signup('layouts@example.com');
  const all = (await c('GET', '/api/layouts/all')).body;
  assert.equal(all.saved, false);
  assert.equal(all.tiles.filter((t) => !t.hidden).length, 4);
  assert.deepEqual(all.tiles.filter((t) => !t.hidden).map((t) => t.tile_id), ['move', 'health', 'flow', 'revenue']);
  assert.equal(all.tiles.length, TILES.length);
  assert.equal((await c('GET', '/api/layouts/nope')).status, 404);

  // Reorder, hide, resize; only for 'conversion'.
  const tiles = (await c('GET', '/api/layouts/conversion')).body.tiles;
  const mine = [tiles[2], { ...tiles[0], width: 'half' }, { ...tiles[1], hidden: true }, ...tiles.slice(3), { tile_id: 'bogus' }];
  const saved = (await c('PUT', '/api/layouts/conversion', { tiles: mine })).body.tiles;
  assert.deepEqual(saved.slice(0, 3).map((t) => [t.tile_id, t.width, t.hidden]),
    [[tiles[2].tile_id, tiles[2].width, false], [tiles[0].tile_id, 'half', false], [tiles[1].tile_id, tiles[1].width, true]]);
  assert.ok(!saved.some((t) => t.tile_id === 'bogus'));
  const again = (await c('GET', '/api/layouts/conversion')).body;
  assert.equal(again.saved, true);
  assert.deepEqual(again.tiles, saved);
  assert.equal((await c('GET', '/api/layouts/all')).body.saved, false); // other levers untouched

  // A tile added in a later release shows up hidden in old layouts.
  const old = normalizeLayout([{ tile_id: 'flow', width: 'full', hidden: false }], 'all');
  assert.equal(old.length, TILES.length);
  assert.deepEqual(old[0], { tile_id: 'flow', width: 'full', hidden: false, order: 0 });
  assert.ok(old.slice(1).every((t) => t.hidden));
  assert.equal(defaultLayout('upsell').filter((t) => !t.hidden).length, 4);
});
