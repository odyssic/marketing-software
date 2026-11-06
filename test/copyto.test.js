// Agencies: copy a flow into another business they run.
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
    return { status: res.status, body: await res.json() };
  };
}

test('copy a pageflow, with its follow-ups, into another business', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Ag', email: 'ag@example.com', password: 'password123', workspace: 'Agency', business_type: 'services' });
  const product = (await c('POST', '/api/products', { name: 'Kit', price: '49' })).body;
  const f = (await c('POST', '/api/funnels', { name: 'Kit launch', template: 'modern_sales' })).body;
  const steps = (await c('GET', `/api/funnels/${f.id}`)).body.steps;
  const checkout = steps.find((s) => s.slug === 'checkout');
  await c('PUT', `/api/steps/${checkout.id}`, { name: checkout.name, blocks: checkout.blocks.map((b) => (b.type === 'pricing' ? { ...b, productId: product.id } : b)) });
  const client2 = (await c('POST', '/api/accounts', { name: 'Client Bakery' })).body.id;

  const r = await c('POST', `/api/funnels/${f.id}/duplicate`, { name: 'Bakery launch', to_account: client2 });
  assert.equal(r.status, 201);
  assert.equal(r.body.account, client2);
  // Not in this business…
  assert.ok(!(await c('GET', '/api/funnels')).body.some((x) => x.name === 'Bakery launch'));
  // …but in the client's, with pages, follow-ups (off), and no link to the agency's product.
  await c('POST', `/api/accounts/${client2}/switch`);
  const copy = (await c('GET', `/api/funnels/${r.body.id}`)).body;
  assert.equal(copy.name, 'Bakery launch');
  assert.equal(copy.steps.length, 3);
  assert.equal(copy.steps.find((s) => s.slug === 'checkout').blocks.find((b) => b.type === 'pricing').productId, null);
  assert.ok(copy.workflows.length >= 1);
  assert.ok(copy.workflows.every((w) => w.status !== 'active'));
});

test('can’t copy into a business that isn’t yours', async () => {
  const me = client(), them = client();
  await me('POST', '/api/auth/signup', { name: 'M', email: 'm2@example.com', password: 'password123', business_type: 'shop' });
  await them('POST', '/api/auth/signup', { name: 'T', email: 't2@example.com', password: 'password123', business_type: 'shop' });
  const theirs = (await them('GET', '/api/me')).body.account.id;
  const f = (await me('POST', '/api/funnels', { name: 'Mine', template: 'optin' })).body;
  assert.equal((await me('POST', `/api/funnels/${f.id}/duplicate`, { to_account: theirs })).status, 404);
});
