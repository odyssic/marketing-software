process.env.ALLOW_SIGNUPS = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

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
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: res.status, body: (res.headers.get('content-type') || '').includes('json') ? await res.json() : await res.text() };
  };
}

test('setup builds a booking page, saves hours and lists follow-ups; publishing makes it live', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Mo', email: 'mo@example.com', password: 'password123', workspace: 'x', business_type: 'coach' });
  assert.equal((await c('POST', '/api/setup/build', { business_type: 'coach' })).status, 400);
  const r = await c('POST', '/api/setup/build', { business_type: 'coach', name: 'Mo Fitness', offer: 'Personal training in Leeds', goal: 'booked', days: [1, 3], start: '08:00', end: '12:00', length: 60, tz: 'Europe/London' });
  assert.equal(r.status, 201);
  assert.equal(r.body.goal, 'booked');
  assert.equal(r.body.booking, true);
  assert.ok(Array.isArray(r.body.followups));
  // Only this page's own follow-ups: not the workspace's starter set (review, referral...).
  assert.ok(r.body.followups.every((w) => !/review|referral|win-back/i.test(w.name)));
  assert.ok(r.body.followups.every((f) => typeof f.ready === 'boolean'));
  const me = (await c('GET', '/api/me')).body.account;
  assert.equal(me.name, 'Mo Fitness');
  assert.equal(me.home_funnel_id, r.body.funnel_id);
  const s = (await c('GET', '/api/bookings')).body;
  assert.deepEqual((s.settings || s).days, [1, 3]);
  const f = (await c('GET', `/api/funnels/${r.body.funnel_id}`)).body;
  assert.equal(f.status, 'draft');
  assert.match(JSON.stringify(f.steps[0].blocks), /Mo Fitness|Personal training/);
  assert.equal((await c('POST', `/api/funnels/${r.body.funnel_id}/publish`)).status, 200);
});

test('setup can sell one thing: a product and a plain pricing page', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Jo', email: 'jo@example.com', password: 'password123', workspace: 'y', business_type: 'shop' });
  assert.equal((await c('POST', '/api/setup/build', { business_type: 'shop', name: 'Jo Candles', goal: 'sell', offer: 'Hand-poured soy candle' })).status, 400);
  const r = await c('POST', '/api/setup/build', { business_type: 'shop', name: 'Jo Candles', goal: 'sell', offer: 'Hand-poured soy candle', price: '24' });
  assert.equal(r.status, 201);
  const prods = (await c('GET', '/api/products')).body;
  assert.equal(prods[0].price_cents ?? Math.round(prods[0].price * 100), 2400);
  const f = (await c('GET', `/api/funnels/${r.body.funnel_id}`)).body;
  const pricing = f.steps[0].blocks.find((b) => b.type === 'pricing');
  assert.equal(pricing.productId, prods[0].id);
  assert.equal(pricing.features, '');
});
