// Checkout extras: coupons, payment plans, free trials, the two-step
// abandoned-checkout sequence, and the upsell → downsell path.
process.env.ALLOW_SIGNUPS = '1';
process.env.ALLOW_TIME_TRAVEL = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { planEndsAt } = require('../src/checkout');

// Fake Stripe: records every checkout session's params and subscription updates.
const sessions = {};
const subUpdates = [];
const fakeStripe = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    const p = Object.fromEntries(new URLSearchParams(body));
    if (req.method === 'POST' && req.url === '/v1/checkout/sessions') {
      const id = `cs_${Object.keys(sessions).length + 1}`;
      sessions[id] = { id, url: `https://checkout.stripe.test/${id}`, client_reference_id: p.client_reference_id, payment_status: 'paid',
        params: p, subscription: p.mode === 'subscription' ? `sub_${id}` : null, customer_details: { email: 'buyer@example.com', name: 'Bea Buyer' } };
      return res.end(JSON.stringify(sessions[id]));
    }
    const m = req.url.match(/^\/v1\/checkout\/sessions\/([^?]+)/);
    if (m && sessions[m[1]]) return res.end(JSON.stringify(sessions[m[1]]));
    const s = req.url.match(/^\/v1\/subscriptions\/([^?]+)/);
    if (req.method === 'POST' && s) { subUpdates.push({ id: s[1], ...p }); return res.end(JSON.stringify({ id: s[1] })); }
    res.statusCode = 404; res.end(JSON.stringify({ error: { message: 'nope' } }));
  });
});

let app, server, base;
before(async () => {
  await new Promise((r) => fakeStripe.listen(0, r));
  process.env.STRIPE_API_BASE = `http://localhost:${fakeStripe.address().port}`;
  const { createApp } = require('../src/app');
  app = createApp(process.env.TEST_DATABASE_URL ? {} : { dbPath: ':memory:' });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});
after(async () => { server.close(); fakeStripe.close(); await app.close(); delete process.env.STRIPE_API_BASE; });

function client() {
  let cookie = '';
  return async (method, path, body, { form } = {}) => {
    const res = await fetch(base + path, {
      method, redirect: 'manual',
      headers: { cookie, 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
      body: form ? new URLSearchParams(form) : body && JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = [cookie, ...set.split(/,(?=\s*\w+=)/).map((x) => x.split(';')[0].trim())].filter(Boolean).join('; ');
    const type = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : await res.text() };
  };
}

async function owner(email) {
  const c = client();
  assert.equal((await c('POST', '/api/auth/signup', { name: 'Owner', email, password: 'password123' })).status, 201);
  return c;
}

// A published pricing page for a product.
async function shop(c, product) {
  const { body: { id: productId } } = await c('POST', '/api/products', { currency: 'usd', billing: 'one_time', ...product });
  const { body: { id: funnelId } } = await c('POST', '/api/funnels', { name: `Shop ${Math.random().toString(36).slice(2, 7)}`, template: 'pricing' });
  await c('POST', `/api/funnels/${funnelId}/publish`);
  const funnel = (await c('GET', `/api/funnels/${funnelId}`)).body;
  const step = funnel.steps[0];
  const block = step.blocks.find((b) => b.type === 'pricing');
  assert.equal(block.productId, productId);
  return { funnel, step, block, productId, buy: `/f/${funnel.slug}/${step.slug}/buy`, check: `/f/${funnel.slug}/${step.slug}/coupon` };
}

test('coupons: percent, fixed, expired, used up, wrong product; checked live and on the order', async () => {
  const c = await owner('coupons@example.com');
  const other = (await c('POST', '/api/products', { name: 'Other thing', price: 10 })).body;
  const s = await shop(c, { name: 'Course', price: 100 });
  const html0 = (await client()('GET', `/f/${s.funnel.slug}`)).body;
  assert.doesNotMatch(html0, /Have a code\?/, 'no code box until the business makes a code');

  assert.equal((await c('POST', '/api/coupons', { code: 'x', kind: 'percent', value: 10 })).status, 400);
  assert.equal((await c('POST', '/api/coupons', { code: 'BIG', kind: 'percent', value: 150 })).status, 400);
  assert.equal((await c('POST', '/api/coupons', { code: 'save20', kind: 'percent', value: 20 })).status, 201);
  assert.equal((await c('POST', '/api/coupons', { code: 'SAVE20', kind: 'percent', value: 5 })).body.error, 'You already have a code with that name');
  await c('POST', '/api/coupons', { code: 'TENOFF', kind: 'amount', value: '10' });
  await c('POST', '/api/coupons', { code: 'OLD', kind: 'percent', value: 50, expires: '2020-01-01' });
  const once = (await c('POST', '/api/coupons', { code: 'ONCE', kind: 'percent', value: 50, max_uses: 1 })).body;
  await c('POST', '/api/coupons', { code: 'OTHERONLY', kind: 'percent', value: 50, product_ids: [other.id] });

  const list = (await c('GET', '/api/coupons')).body;
  assert.deepEqual(list.map((x) => [x.code, x.label, x.status]).sort(), [['OLD', '50% off', 'expired'], ['ONCE', '50% off', 'active'],
    ['OTHERONLY', '50% off', 'active'], ['SAVE20', '20% off', 'active'], ['TENOFF', '$10 off', 'active']]);
  assert.match((await client()('GET', `/f/${s.funnel.slug}`)).body, /Have a code\?/);

  const v = client();
  const check = async (code) => (await v('GET', `${s.check}?block=${s.block.id}&code=${code}`)).body;
  assert.deepEqual(await check('save20'), { ok: true, message: 'SAVE20 applied: 20% off. You pay $80.' });
  assert.equal((await check('TENOFF')).message, 'TENOFF applied: $10 off. You pay $90.');
  assert.deepEqual(await check('OLD'), { ok: false, message: 'That code has expired.' });
  assert.equal((await check('NOPE')).message, 'That code isn’t valid.');
  assert.equal((await check('OTHERONLY')).message, 'That code doesn’t work for this product.');

  // Buying with a bad code says why and charges nothing.
  const bad = await v('POST', s.buy, null, { form: { block: s.block.id, email: 'a@example.com', coupon: 'OLD' } });
  assert.equal(bad.status, 400);
  assert.match(bad.body, /That code has expired/);
  assert.equal((await c('GET', '/api/orders')).body.length, 0);

  // Percent off in test mode: the order shows the discount; the code's use is counted once paid.
  const buyWith = async (code, email) => {
    const go = await v('POST', s.buy, null, { form: { block: s.block.id, email, coupon: code } });
    assert.equal(go.status, 303, code);
    const page = await v('GET', go.headers.get('location'));
    await v('POST', go.headers.get('location'), null, { form: { email } });
    return page.body;
  };
  assert.match(await buyWith('save20', 'p1@example.com'), /Code SAVE20: \$20 off\./);
  await buyWith('TENOFF', 'p2@example.com');
  await buyWith('ONCE', 'p3@example.com');
  const orders = (await c('GET', '/api/orders')).body;
  assert.deepEqual(orders.map((o) => [o.coupon_code, o.amount_cents, o.discount_cents, o.discountLabel, o.status]),
    [['ONCE', 5000, 5000, '$50', 'paid'], ['TENOFF', 9000, 1000, '$10', 'paid'], ['SAVE20', 8000, 2000, '$20', 'paid']]);
  assert.equal((await c('GET', '/api/coupons')).body.find((x) => x.id === once.id).uses, 1);
  // Max uses reached.
  assert.deepEqual(await check('ONCE'), { ok: false, message: 'That code has been used up.' });
  assert.equal((await v('POST', s.buy, null, { form: { block: s.block.id, coupon: 'ONCE' } })).status, 400);

  // Another business can't see, change or use these codes.
  const x = await owner('coupons-other@example.com');
  assert.deepEqual((await x('GET', '/api/coupons')).body, []);
  assert.equal((await x('PUT', `/api/coupons/${once.id}`, { code: 'MINE', kind: 'percent', value: 99 })).status, 404);
  await x('DELETE', `/api/coupons/${once.id}`);
  assert.equal((await c('GET', '/api/coupons')).body.length, 5);
});

test('coupons with Stripe: the discounted price goes to Checkout; 100% off needs no card', async () => {
  const c = await owner('coupons-stripe@example.com');
  await c('PUT', '/api/account/stripe', { secretKey: 'sk_test_abc123' });
  const s = await shop(c, { name: 'Workshop', price: 47 });
  await c('POST', '/api/coupons', { code: 'HALF', kind: 'percent', value: 50 });
  await c('POST', '/api/coupons', { code: 'FREE', kind: 'percent', value: 100 });
  await c('POST', '/api/coupons', { code: 'BIGOFF', kind: 'amount', value: 46.9 });
  const v = client();
  const go = await v('POST', s.buy, null, { form: { block: s.block.id, email: 'half@example.com', coupon: 'half' } });
  const sid = go.headers.get('location').split('/').pop();
  assert.equal(sessions[sid].params['line_items[0][price_data][unit_amount]'], '2350');
  assert.match(sessions[sid].params['line_items[0][price_data][product_data][description]'], /Code HALF applied/);
  const [order] = (await c('GET', '/api/orders')).body;
  await v('GET', `/checkout/success/${order.id}?session_id=${sid}`);
  assert.equal((await c('GET', '/api/coupons')).body.find((x) => x.code === 'HALF').uses, 1);

  // Never below Stripe's 50-cent minimum.
  const tiny = await v('POST', s.buy, null, { form: { block: s.block.id, email: 'tiny@example.com', coupon: 'BIGOFF' } });
  assert.equal(sessions[tiny.headers.get('location').split('/').pop()].params['line_items[0][price_data][unit_amount]'], '50');

  // Free: straight to the next page, order paid, no Stripe session.
  const before = Object.keys(sessions).length;
  const free = await v('POST', s.buy, null, { form: { block: s.block.id, email: 'free@example.com', coupon: 'FREE' } });
  assert.equal(free.status, 303);
  assert.equal(free.headers.get('location'), `/f/${s.funnel.slug}/thank-you`);
  assert.equal(Object.keys(sessions).length, before);
  const paid = (await c('GET', '/api/orders')).body.find((o) => o.email === 'free@example.com');
  assert.deepEqual([paid.status, paid.amount_cents, paid.discount_cents], ['paid', 0, 4700]);
});

test('payment plan: pricing card offers both; Stripe gets a monthly subscription that ends after the last part', async () => {
  const c = await owner('plans@example.com');
  assert.equal((await c('POST', '/api/products', { name: 'Bad plan', price: 99, plan_parts: 1 })).status, 400);
  const s = await shop(c, { name: 'Mastermind', price: 99, plan_parts: 3 });
  const html = (await client()('GET', `/f/${s.funnel.slug}`)).body;
  assert.match(html, /Pay in full <b>\$99<\/b>/);
  assert.match(html, /3 monthly payments of <b>\$33<\/b>/);

  // Test mode: simulated, the checkout says what happens next.
  const t = client();
  const go = await t('POST', s.buy, null, { form: { block: s.block.id, email: 'plan@example.com', plan: '1' } });
  const page = (await t('GET', go.headers.get('location'))).body;
  assert.match(page, /\$33/);
  assert.match(page, /Payment 1 of 3\. Then 2 more monthly payments\./);
  await t('POST', go.headers.get('location'), null, { form: { email: 'plan@example.com' } });
  const [testOrder] = (await c('GET', '/api/orders')).body;
  assert.deepEqual([testOrder.amount_cents, testOrder.plan_parts, testOrder.status, testOrder.mode], [3300, 3, 'paid', 'test']);

  // With Stripe.
  await c('PUT', '/api/account/stripe', { secretKey: 'sk_test_abc123' });
  const v = client();
  const sgo = await v('POST', s.buy, null, { form: { block: s.block.id, email: 'plan2@example.com', plan: '1' } });
  const sid = sgo.headers.get('location').split('/').pop();
  const p = sessions[sid].params;
  assert.equal(p.mode, 'subscription');
  assert.equal(p['line_items[0][price_data][unit_amount]'], '3300');
  assert.equal(p['line_items[0][price_data][recurring][interval]'], 'month');
  assert.equal(p['subscription_data[metadata][plan_parts]'], '3');
  assert.equal(p['line_items[0][price_data][product_data][name]'], 'Mastermind (3 monthly payments)');
  const order = (await c('GET', '/api/orders')).body[0];
  assert.deepEqual([order.amount_cents, order.plan_parts], [3300, 3]);
  await v('GET', `/checkout/success/${order.id}?session_id=${sid}`);
  await v('GET', `/checkout/success/${order.id}?session_id=${sid}`); // reload: no second update
  assert.equal(subUpdates.length, 1);
  assert.equal(subUpdates[0].id, `sub_${sid}`);
  assert.equal(subUpdates[0].proration_behavior, 'none');
  const ends = Number(subUpdates[0].cancel_at) * 1000;
  const expected = planEndsAt(3).getTime();
  assert.ok(Math.abs(ends - expected) < 60e3);
  // After the 3rd payment (2 months on) and well before a 4th (3 months on).
  assert.ok(ends > Date.now() + 61 * 864e5 && ends < Date.now() + 85 * 864e5);
  assert.equal((await c('GET', '/api/orders')).body[0].stripe_subscription, `sub_${sid}`);

  // Pay in full still a one-time payment.
  const full = await v('POST', s.buy, null, { form: { block: s.block.id, email: 'full@example.com' } });
  const fp = sessions[full.headers.get('location').split('/').pop()].params;
  assert.deepEqual([fp.mode, fp['line_items[0][price_data][unit_amount]']], ['payment', '9900']);
});

test('planEndsAt: lands between the last part and the next, even from the 31st', () => {
  const from = new Date('2026-01-31T10:00:00Z');
  assert.equal(planEndsAt(2, from).toISOString().slice(0, 10), '2026-03-07'); // after Feb 28, before Mar 31
  assert.equal(planEndsAt(3, from).toISOString().slice(0, 10), '2026-04-07'); // after Mar 31, before Apr 30
});

test('free trial: the card says it; Stripe gets trial_period_days', async () => {
  const c = await owner('trial@example.com');
  const s = await shop(c, { name: 'Club', price: 29, billing: 'monthly', trial_days: 14 });
  assert.match((await client()('GET', `/f/${s.funnel.slug}`)).body, /14 days free, then \$29\/month/);
  await c('PUT', '/api/account/stripe', { secretKey: 'sk_test_abc123' });
  const v = client();
  const go = await v('POST', s.buy, null, { form: { block: s.block.id, email: 'trial@example.com' } });
  const p = sessions[go.headers.get('location').split('/').pop()].params;
  assert.equal(p.mode, 'subscription');
  assert.equal(p['subscription_data[trial_period_days]'], '14');
  assert.equal(p['line_items[0][price_data][unit_amount]'], '2900');
  assert.equal(p['line_items[0][price_data][recurring][interval]'], 'month');
  const [order] = (await c('GET', '/api/orders')).body;
  assert.deepEqual([order.amount_cents, order.trial_days], [0, 14]); // nothing charged today
  // One-time products never get a trial.
  const one = (await c('POST', '/api/products', { name: 'Once', price: 5, billing: 'one_time', trial_days: 7 })).body;
  assert.equal((await c('GET', '/api/products')).body.find((x) => x.id === one.id).trial_days, 0);
});

test('abandoned checkout: an hour later, then a day later with the chosen code; stops when they buy or unsubscribe', async () => {
  const c = await owner('recover-seq@example.com');
  const s = await shop(c, { name: 'Bootcamp', price: 200 });
  const code = (await c('POST', '/api/coupons', { code: 'COMEBACK', kind: 'percent', value: 15 })).body;
  assert.equal((await c('PUT', '/api/account/recovery-coupon', { coupon_id: code.id })).status, 200);
  const start = Date.now();
  const at = (h) => ({ now: new Date(start + h * 3600e3).toISOString() });
  // Jobs run for every business; count only this shop's reminders.
  const reminders = async () => (await c('GET', '/api/outbox')).body.filter((m) => /Bootcamp/.test(m.subject)).length;
  const sentAfter = async (h) => { const n = await reminders(); await c('POST', '/api/jobs/run', at(h)); return (await reminders()) - n; };
  for (const email of ['walker@example.com', 'buyer-later@example.com', 'quiet@example.com']) {
    await client()('POST', s.buy, null, { form: { block: s.block.id, email } });
  }
  assert.equal(await sentAfter(0.5), 0);
  assert.equal(await sentAfter(1.5), 3);
  assert.equal(await sentAfter(2), 0);
  assert.equal(await sentAfter(23), 0); // not before a day

  // One buys after the first reminder; one unsubscribes.
  const b = client();
  const go = await b('POST', s.buy, null, { form: { block: s.block.id, email: 'buyer-later@example.com' } });
  await b('POST', go.headers.get('location'), null, { form: { email: 'buyer-later@example.com' } });
  const quiet = (await c('GET', '/api/contacts')).body.find((p) => p.email === 'quiet@example.com');
  await c('PUT', `/api/contacts/${quiet.id}`, { unsubscribed: true });

  assert.equal(await sentAfter(25), 1);
  assert.equal(await sentAfter(30), 0); // just two
  const mail = (await c('GET', '/api/outbox')).body;
  const second = mail.filter((m) => /% off your|Still thinking/.test(m.subject));
  assert.deepEqual(second.map((m) => [m.to_email, m.subject]), [['walker@example.com', '15% off your Bootcamp']]);
  assert.match(second[0].body, new RegExp(`/f/${s.funnel.slug}/${s.step.slug}\\?coupon=COMEBACK`));
  assert.match(second[0].body, /use the code COMEBACK for 15% off/);
  assert.equal(mail.filter((m) => m.to_email === 'buyer-later@example.com').length, 1);
  assert.equal(mail.filter((m) => m.to_email === 'quiet@example.com').length, 1);

  // The reminder link fills in the code on the card.
  assert.match((await client()('GET', `/f/${s.funnel.slug}/${s.step.slug}?coupon=COMEBACK`)).body, /new URLSearchParams\(location.search\)\.get\('coupon'\)/);

  // Without a code the second note still goes, without an offer; expired codes are left out.
  await c('PUT', '/api/coupons/' + code.id, { code: 'COMEBACK', kind: 'percent', value: 15, expires: '2020-01-01' });
  await client()('POST', s.buy, null, { form: { block: s.block.id, email: 'late@example.com' } });
  await c('POST', '/api/jobs/run', at(1.5));
  assert.equal(await sentAfter(25), 1);
  const late = (await c('GET', '/api/outbox')).body.filter((m) => m.to_email === 'late@example.com');
  assert.equal(late[0].subject, 'Still thinking about Bootcamp?');
  assert.doesNotMatch(late[0].body, /COMEBACK/);
});

test('upsell → downsell: "No thanks" leads to the lighter offer, which is one click too', async () => {
  const c = await owner('downsell@example.com');
  const main = (await c('POST', '/api/products', { name: 'Glaze kit', price: 49 })).body;
  const up = (await c('POST', '/api/products', { name: 'Pro brushes', price: 19 })).body;
  const lite = (await c('POST', '/api/products', { name: 'Starter brush', price: 7 })).body;
  const { id } = (await c('POST', '/api/funnels', { name: 'Kit downsell', template: 'upsell' })).body;
  const f = (await c('GET', `/api/funnels/${id}`)).body;
  const by = Object.fromEntries(f.steps.map((s) => [s.name, s]));
  for (const [nm, pid] of [['Sales page', main.id], ['Upsell', up.id], ['Downsell', lite.id]]) {
    await c('PUT', `/api/steps/${by[nm].id}`, { blocks: by[nm].blocks.map((b) => (b.type === 'pricing' ? { ...b, productId: pid } : b)) });
  }
  await c('POST', `/api/funnels/${id}/publish`);
  const buyer = client();
  const pricing = by['Sales page'].blocks.find((b) => b.type === 'pricing');
  const go = await buyer('POST', `/f/${f.slug}/offer/buy`, null, { form: { block: pricing.id, email: 'kit@example.com' } });
  const paid = await buyer('POST', go.headers.get('location'), null, { form: { email: 'kit@example.com' } });
  assert.equal(paid.headers.get('location'), `/f/${f.slug}/upgrade`);
  const upsell = (await buyer('GET', `/f/${f.slug}/upgrade`)).body;
  assert.match(upsell, new RegExp(`href="/f/${f.slug}/lite"[^>]*>No thanks, I’ll skip this`));
  const down = (await buyer('GET', `/f/${f.slug}/lite`)).body;
  assert.match(down, /\/lite\/oneclick"/);
  assert.match(down, new RegExp(`href="/f/${f.slug}/thank-you"[^>]*>No thanks<`));
  const liteBlock = by.Downsell.blocks.find((b) => b.type === 'pricing');
  const one = await buyer('POST', `/f/${f.slug}/lite/oneclick`, null, { form: { block: liteBlock.id } });
  assert.equal(one.headers.get('location'), `/f/${f.slug}/thank-you`);
  assert.deepEqual((await c('GET', '/api/orders')).body.map((o) => [o.product_name, o.amount_cents, o.status]),
    [['Starter brush', 700, 'paid'], ['Glaze kit', 4900, 'paid']]);
});
