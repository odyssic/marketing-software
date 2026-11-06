// Rilly's own plans: trial, subscribe, lock when the trial ends, webhook changes.
process.env.ALLOW_SIGNUPS = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { createApp } = require('../src/app');

let app, server, base, fake, uid = 0, product = null, extra = 0;
before(async () => {
  fake = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.method === 'POST' && req.url === '/v1/checkout/sessions') {
        assert.match(decodeURIComponent(body), /mode=subscription/);
        assert.match(decodeURIComponent(body), /unit_amount\]=2900/);
        return res.end(JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' }));
      }
      if (req.url.startsWith('/v1/checkout/sessions/cs_1')) return res.end(JSON.stringify({ id: 'cs_1', status: 'complete', client_reference_id: String(uid), customer: 'cus_1', subscription: 'sub_1' }));
      if (req.url === '/v1/billing_portal/sessions') return res.end(JSON.stringify({ url: 'https://billing.stripe.test/p' }));
      // Extra businesses: one product, one subscription item whose quantity follows the count.
      if (req.url === '/v1/products/rilly_extra_business') { if (product) return res.end(JSON.stringify({ id: product })); res.statusCode = 404; return res.end(JSON.stringify({ error: { message: 'No such product' } })); }
      if (req.method === 'POST' && req.url === '/v1/products') { product = 'rilly_extra_business'; return res.end(JSON.stringify({ id: product })); }
      if (req.url === '/v1/subscriptions/sub_1') return res.end(JSON.stringify({ id: 'sub_1', items: { data: extra ? [{ id: 'si_x', quantity: extra, price: { product: 'rilly_extra_business' } }] : [] } }));
      if (req.method === 'POST' && req.url === '/v1/subscription_items') { extra = Number(new URLSearchParams(body).get('quantity')); return res.end('{}'); }
      if (req.method === 'POST' && req.url === '/v1/subscription_items/si_x') { extra = Number(new URLSearchParams(body).get('quantity')); return res.end('{}'); }
      if (req.method === 'DELETE' && req.url === '/v1/subscription_items/si_x') { extra = 0; return res.end('{}'); }
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise((r) => fake.listen(0, r));
  process.env.STRIPE_API_BASE = `http://localhost:${fake.address().port}`;
  process.env.RILLY_STRIPE_KEY = 'sk_test_rilly';
  process.env.RILLY_STRIPE_WEBHOOK_SECRET = 'whsec_rilly';
  app = createApp(process.env.TEST_DATABASE_URL ? {} : { dbPath: ':memory:' });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});
after(async () => {
  server.close(); fake.close(); await app.close();
  for (const k of ['STRIPE_API_BASE', 'RILLY_STRIPE_KEY', 'RILLY_STRIPE_WEBHOOK_SECRET']) delete process.env[k];
});
function client() {
  let cookie = '';
  return async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, { method, headers: { cookie, 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : body && JSON.stringify(body) });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: res.status, body: (res.headers.get('content-type') || '').includes('json') ? await res.json() : await res.text() };
  };
}
const signed = (payload) => {
  const t = Math.floor(Date.now() / 1000);
  return { 'stripe-signature': `t=${t},v1=${crypto.createHmac('sha256', 'whsec_rilly').update(`${t}.${payload}`).digest('hex')}` };
};

test('trial, lock, subscribe, cancel', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Bo', email: 'bo@example.com', password: 'password123', workspace: 'Bo', business_type: 'shop' });
  let me = (await c('GET', '/api/me')).body;
  uid = me.user.id;
  assert.equal(me.billing.status, 'trialing');
  assert.equal(me.billing.daysLeft, 14);
  assert.equal(me.billing.locked, false);
  assert.equal((await c('POST', '/api/contacts', { email: 'x@example.com' })).status < 400, true);

  // Trial over: reading works, changes wait for a plan.
  await app.getDb().run("UPDATE users SET trial_ends_at = now() - interval '1 day' WHERE id = ?", uid);
  me = (await c('GET', '/api/me')).body;
  assert.equal(me.billing.locked, true);
  assert.equal((await c('GET', '/api/contacts')).status, 200);
  assert.equal((await c('POST', '/api/contacts', { email: 'y@example.com' })).status, 402);

  const co = await c('POST', '/api/billing/checkout');
  assert.equal(co.body.url, 'https://checkout.stripe.test/cs_1');
  assert.equal((await c('POST', '/api/billing/confirm', { session_id: 'cs_1' })).body.ok, true);
  me = (await c('GET', '/api/me')).body;
  assert.equal(me.billing.status, 'active');
  assert.equal(me.billing.locked, false);
  assert.equal((await c('POST', '/api/contacts', { email: 'z@example.com' })).status < 400, true);
  assert.equal((await c('POST', '/api/billing/portal')).body.url, 'https://billing.stripe.test/p');

  // Each business after the first adds a line to the subscription; deleting one takes it off.
  const until = async (n) => { for (let i = 0; i < 50 && extra !== n; i++) await new Promise((r) => setTimeout(r, 20)); return extra; };
  const b2 = (await c('POST', '/api/accounts', { name: 'Second shop' })).body.id;
  assert.equal(await until(1), 1);
  await c('POST', '/api/accounts', { name: 'Third shop' });
  assert.equal(await until(2), 2);
  await c('DELETE', `/api/accounts/${b2}`, { confirm: 'Second shop' });
  assert.equal(await until(1), 1);
  assert.equal((await c('GET', '/api/billing')).body.businesses, 2);

  // Cancelled in Stripe: locked again.
  const ev = JSON.stringify({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', status: 'canceled' } } });
  assert.equal((await c('POST', '/stripe/rilly', ev, signed(ev))).status, 200);
  assert.equal((await c('POST', '/stripe/rilly', ev, { 'stripe-signature': 't=1,v1=bad' })).status, 400);
  me = (await c('GET', '/api/me')).body;
  assert.equal(me.billing.status, 'canceled');
  assert.equal(me.billing.locked, true);
});
