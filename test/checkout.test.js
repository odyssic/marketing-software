// Tests create several workspaces; the app is single-owner by default.
process.env.ALLOW_SIGNUPS = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');

// Fake Stripe API: records created sessions and reports them paid on retrieve.
const sessions = {};
const fakeStripe = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'POST' && req.url === '/v1/checkout/sessions') {
      const p = new URLSearchParams(body);
      const id = `cs_test_${Object.keys(sessions).length + 1}`;
      sessions[id] = { id, url: `https://checkout.stripe.test/${id}`, client_reference_id: p.get('client_reference_id'),
        mode: p.get('mode'), amount: p.get('line_items[0][price_data][unit_amount]'), payment_status: 'paid',
        customer_details: { email: 'buyer@example.com', name: 'Bea Buyer' } };
      return res.end(JSON.stringify(sessions[id]));
    }
    const m = req.url.match(/^\/v1\/checkout\/sessions\/(.+)$/);
    if (m && sessions[m[1]]) return res.end(JSON.stringify(sessions[m[1]]));
    res.statusCode = 404; res.end(JSON.stringify({ error: { message: 'No such session' } }));
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
after(async () => { server.close(); fakeStripe.close(); await app.close(); });

function client() {
  let cookie = '';
  return async (method, path, body, { form, headers = {} } = {}) => {
    const res = await fetch(base + path, {
      method, redirect: 'manual',
      headers: { cookie, 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json', ...headers },
      body: form ? new URLSearchParams(form) : typeof body === 'string' ? body : body && JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : await res.text() };
  };
}

async function setupSeller(email) {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Seller', email, password: 'password123' });
  const { body: { id: productId } } = await c('POST', '/api/products', { name: 'Lifetime Pass', price: '47', currency: 'usd', billing: 'one_time', tag: 'vip' });
  const { body: { id: funnelId } } = await c('POST', '/api/funnels', { name: `Shop ${email}`, template: 'pricing' });
  assert.equal((await c('POST', `/api/funnels/${funnelId}/publish`)).status, 200);
  const funnel = (await c('GET', `/api/funnels/${funnelId}`)).body;
  const block = funnel.steps[0].blocks.find((b) => b.type === 'pricing');
  assert.equal(block.productId, productId, 'pricing template picks the newest product');
  return { c, funnel, block, productId };
}

test('pricing page renders the product price and features', async () => {
  const { funnel } = await setupSeller('render@example.com');
  const html = (await client()('GET', `/f/${funnel.slug}`)).body;
  assert.match(html, /<sup>\$<\/sup>47/);
  assert.match(html, /one-time payment/);
  assert.match(html, /Unlimited funnels/);
  assert.match(html, /\/buy"/);
});

test('test-mode checkout (no Stripe key) completes an order', async () => {
  const { c, funnel, block } = await setupSeller('testmode@example.com');
  const v = client();
  const buy = await v('POST', `/f/${funnel.slug}/pricing/buy`, null, { form: { block: block.id } });
  assert.equal(buy.status, 303);
  const checkout = buy.headers.get('location');
  assert.match(checkout, /^\/checkout\/test\/\d+\/\w{24}$/);
  assert.equal((await v('GET', checkout.replace(/\w{24}$/, 'x'.repeat(24)))).status, 404, 'bad token rejected');
  const done = await v('POST', checkout, null, { form: { email: 'ann@example.com', name: 'Ann Lee' } });
  assert.equal(done.headers.get('location'), `/f/${funnel.slug}/thank-you`);
  const [order] = (await c('GET', '/api/orders')).body;
  assert.equal(order.status, 'paid');
  assert.equal(order.amountLabel, '$47');
  const [contact] = (await c('GET', '/api/contacts')).body;
  assert.deepEqual([contact.email, contact.first_name, contact.tags], ['ann@example.com', 'Ann', ['customer', 'vip']]);
  assert.equal((await c('GET', '/api/dashboard')).body.revenue30d[0].label, '$47');
});

test('Stripe checkout: redirect, verified confirmation, idempotent', async () => {
  const { c, funnel, block } = await setupSeller('stripe@example.com');
  assert.equal((await c('PUT', '/api/account/stripe', { secretKey: 'not-a-key' })).status, 400);
  assert.equal((await c('PUT', '/api/account/stripe', { secretKey: 'sk_test_abc123' })).status, 200);
  const me = (await c('GET', '/api/me')).body;
  assert.equal(me.payments.connected, true);
  assert.equal(JSON.stringify(me).includes('sk_test_abc123'), false, 'secret key never sent to browser');

  const v = client();
  const buy = await v('POST', `/f/${funnel.slug}/pricing/buy`, null, { form: { block: block.id } });
  assert.match(buy.headers.get('location'), /^https:\/\/checkout\.stripe\.test\/cs_test_/);
  const session = Object.values(sessions).at(-1);
  assert.equal(session.amount, '4700');
  assert.equal(session.mode, 'payment');

  const orderId = session.client_reference_id;
  // A different (valid) session can't be used to confirm this order.
  sessions.cs_other = { ...session, id: 'cs_other', client_reference_id: '999999' };
  assert.equal((await v('GET', `/checkout/success/${orderId}?session_id=cs_other`)).status, 402);

  const ok = await v('GET', `/checkout/success/${orderId}?session_id=${session.id}`);
  assert.equal(ok.headers.get('location'), `/f/${funnel.slug}/thank-you`);
  await v('GET', `/checkout/success/${orderId}?session_id=${session.id}`); // reload is harmless
  const orders = (await c('GET', '/api/orders')).body;
  assert.equal(orders.length, 1);
  assert.equal(orders[0].email, 'buyer@example.com');
  const funnelAfter = (await c('GET', `/api/funnels/${funnel.id}`)).body;
  assert.ok(funnelAfter, 'still readable');
});

test('Stripe webhook verifies signatures and fulfils the order', async () => {
  const { c, funnel, block } = await setupSeller('hook@example.com');
  await c('PUT', '/api/account/stripe', { secretKey: 'sk_test_hook', webhookSecret: 'whsec_testsecret' });
  const accountId = (await c('GET', '/api/me')).body.account.id;
  await client()('POST', `/f/${funnel.slug}/pricing/buy`, null, { form: { block: block.id } });
  const session = Object.values(sessions).at(-1);
  const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: session } });
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', 'whsec_testsecret').update(`${t}.${payload}`).digest('hex');
  const post = (s) => client()('POST', `/stripe/webhook/${accountId}`, payload, { headers: { 'stripe-signature': s } });

  assert.equal((await post(`t=${t},v1=${'0'.repeat(64)}`)).status, 400);
  assert.equal((await c('GET', '/api/orders')).body[0].status, 'pending');
  assert.equal((await post(`t=${t},v1=${sig}`)).status, 200);
  assert.equal((await c('GET', '/api/orders')).body[0].status, 'paid');
});
