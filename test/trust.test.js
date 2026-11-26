process.env.ALLOW_SIGNUPS = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { segments, costCents, spamCheck, warmupAllowance } = require('../src/trust');

let app, server, base;
before(async () => {
  app = createApp(process.env.TEST_DATABASE_URL ? {} : { dbPath: ':memory:' });
  server = app.listen(0); await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});
after(async () => { server.close(); await app.close(); });
function client() {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, body: type.includes('json') ? await res.json() : await res.text() };
  };
}
const setup = async (email) => { const c = client(); assert.equal((await c('POST', '/api/auth/signup', { name: 'Tr', email, password: 'password123' })).status, 201); return c; };

test('what a text costs: parts of 160 (70 with emoji), shown before sending', () => {
  assert.equal(segments('Hi'), 1); assert.equal(segments('x'.repeat(160)), 1); assert.equal(segments('x'.repeat(161)), 2);
  assert.equal(segments('Hi 👋'), 1); assert.equal(segments('👋'.repeat(71)), 2);
  assert.ok(costCents('Hi') > 0.5 && costCents('Hi') < 3);
});

test('spam check and the new-domain warm-up', () => {
  assert.ok(spamCheck('ACT NOW!!! FREE MONEY', 'click here').length >= 3);
  assert.deepEqual(spamCheck('Your order has shipped', 'It arrives Friday.'), []);
  const day = (n) => ({ send_domain: 'x.com', send_domain_status: 'verified', send_domain_verified_at: new Date(Date.now() - n * 864e5).toISOString() });
  assert.equal(warmupAllowance(day(0)), 50); assert.equal(warmupAllowance(day(3)), 400); assert.equal(warmupAllowance(day(20)), Infinity);
  assert.equal(warmupAllowance({ send_domain: '' }), Infinity, 'Rilly’s own address has no warm-up');
});

test('texting limit, estimate and the "ready to apply?" checklist', async () => {
  const c = await setup('tr-sms@example.com');
  const u = (await c('GET', '/api/account/sms-usage')).body;
  assert.equal(u.used_cents, 0); assert.equal(u.cap_cents, 5000, 'a $50 limit unless changed');
  assert.equal((await c('PUT', '/api/account/sms-cap', { cap: -1 })).status, 400);
  assert.equal((await c('PUT', '/api/account/sms-cap', { cap: 20 })).body.cap_cents, 2000);
  const e = (await c('POST', '/api/sms/estimate', { body: 'x'.repeat(200), people: 100 })).body;
  assert.equal(e.segments, 2); assert.ok(e.total_cents > 150 && e.total_cents < 400);
  const t = (await c('GET', '/api/account/texting')).body;
  assert.ok(t.ready.some((r) => /Legal business name/.test(r.text) && !r.ok));
  await c('PUT', '/api/account/texting', { brand: { legal_name: 'Tr LLC', ein: '12-3456789', sample: 'Hi, Tr here' } });
  const t2 = (await c('GET', '/api/account/texting')).body;
  assert.ok(t2.ready.find((r) => /Legal/.test(r.text)).ok);
  assert.ok(!t2.ready.find((r) => /opt out/.test(r.text)).ok, 'a sample without STOP is flagged');
});

test('email health without a domain explains, and never blocks', async () => {
  const c = await setup('tr-eh@example.com');
  const h = (await c('GET', '/api/account/email-health')).body;
  assert.ok(h.checks.some((x) => /Rilly’s address/.test(x.title)));
  assert.equal(h.good, true);
  assert.ok((await c('POST', '/api/email/spam-check', { subject: 'WIN NOW!!!' })).body.warnings.length);
});

test('daily watchdog finds a buy button whose product is gone; status page answers', async () => {
  const c = await setup('tr-watch@example.com');
  const { id: pid } = (await c('POST', '/api/products', { name: 'Guide', price: '20' })).body;
  const { id } = (await c('POST', '/api/funnels', { name: 'Shop', template: 'blank' })).body;
  const f = (await c('GET', `/api/funnels/${id}`)).body;
  await c('PUT', `/api/steps/${f.steps[0].id}`, { blocks: [{ id: 'p', type: 'pricing', productId: pid }, { id: 'f', type: 'form' }] });
  const prev = process.env.PREFLIGHT_PROMISES; process.env.PREFLIGHT_PROMISES = 'off';
  assert.equal((await c('POST', `/api/funnels/${id}/publish`)).status, 200);
  process.env.PREFLIGHT_PROMISES = prev;
  let w = (await c('POST', '/api/account/watchdog/run')).body;
  assert.equal(w.pages, 1); assert.deepEqual(w.problems, []);
  await c('DELETE', `/api/products/${pid}`);
  w = (await c('POST', '/api/account/watchdog/run')).body;
  assert.match(w.problems[0], /deleted/);
  assert.match((await c('GET', '/api/account/watchdog')).body.problems[0], /deleted/);
  const s = await fetch(`${base}/status?format=json`).then((r) => r.json());
  assert.ok(s.parts.some((p) => /checkout/.test(p.name) && p.ok));
});

test('cancel and pause are refused politely when there is no subscription', async () => {
  const c = await setup('tr-bill@example.com');
  assert.equal((await c('POST', '/api/billing/cancel')).status, 400);
  assert.equal((await c('POST', '/api/billing/pause', { months: 1 })).status, 400);
});

test('show on phones or computers only; the editor shows both, labelled', () => {
  const { renderPage } = require('../src/render');
  const blocks = [{ id: 'a', type: 'heading', text: 'Short', device: 'phone' }, { id: 'b', type: 'heading', text: 'Longer headline', device: 'computer' }, { id: 'c', type: 'text', text: 'x' }];
  const live = renderPage({ title: 'x', blocks });
  assert.match(live, /<div data-bi="0" class="only-phone">/); assert.match(live, /<div data-bi="1" class="only-desk">/); assert.match(live, /<div data-bi="2">/);
  assert.match(live, /\.only-phone\{display:none!important\}/);
  const pv = renderPage({ title: 'x', blocks, preview: true });
  assert.match(pv, /content:"Phones only"/); assert.doesNotMatch(pv, /only-phone\{display:none/);
});

test('help: a question is kept with the screen it came from, and always gets an answer', async () => {
  const c = await setup('tr-help@example.com');
  assert.equal((await c('POST', '/api/help', { question: '' })).status, 400);
  const r = (await c('POST', '/api/help', { question: 'How do I add a thank-you page?', page: '#/flows', errors: '' })).body;
  assert.match(r.answer, /real person|thank/i);
});
