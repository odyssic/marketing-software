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

test('growing a list: a real reason to join (discount with a real code, free guide, or news), no placeholders', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Ty', email: 'ty-list@example.com', password: 'password123', workspace: 'z', business_type: 'shop' });
  const r = await c('POST', '/api/setup/build', { business_type: 'shop', name: 'Classic Typewriter', offer: 'Restored vintage typewriters, ready to write', goal: 'list', incentive: 'discount', percent: 15 });
  assert.equal(r.status, 201);
  assert.equal(r.body.coupon, 'WELCOME15');
  const f = (await c('GET', `/api/funnels/${r.body.funnel_id}`)).body;
  const [join, thanks] = f.steps;
  const hero = join.blocks.find((b) => b.type === 'hero');
  assert.equal(hero.text, '15% off your first order');
  assert.equal(join.blocks.find((b) => b.type === 'form').buttonLabel, 'Get my 15% off');
  assert.match(join.blocks.find((b) => b.type === 'bullets').items, /15% off your first order/);
  assert.match(join.blocks.at(-1).text, /About Classic Typewriter: Restored vintage typewriters/);
  assert.match(thanks.blocks.find((b) => b.type === 'text').text, /WELCOME15/);
  const words = f.steps.flatMap((st) => st.blocks.flatMap((x) => [x.text, x.subtext, x.items, x.buttonLabel, x.title])).filter(Boolean).join(' ');
  assert.doesNotMatch(words, /\[[^\]]{2,}\]/, 'no [placeholders]');
  const coupons = (await c('GET', '/api/coupons')).body;
  assert.ok(coupons.some((x) => x.code === 'WELCOME15'));

  const c2 = client();
  await c2('POST', '/api/auth/signup', { name: 'Gu', email: 'gu-list@example.com', password: 'password123', workspace: 'g', business_type: 'coach' });
  assert.equal((await c2('POST', '/api/setup/build', { business_type: 'coach', name: 'Gu', goal: 'list', incentive: 'guide' })).status, 400, 'a guide needs a name');
  const g = await c2('POST', '/api/setup/build', { business_type: 'coach', name: 'Gu Coaching', goal: 'list', incentive: 'guide', guide: 'The 5-minute morning reset' });
  assert.equal(g.body.guide_needs_file, true);
  const gf = (await c2('GET', `/api/funnels/${g.body.funnel_id}`)).body;
  assert.equal(gf.steps[0].blocks.find((b) => b.type === 'hero').text, 'The 5-minute morning reset');
  assert.equal(gf.steps[0].blocks.find((b) => b.type === 'form').deliverName, 'The 5-minute morning reset');
});
