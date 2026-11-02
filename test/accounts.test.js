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
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
}

test('sub-accounts: create, switch, isolated data, unlimited funnels, delete with confirmation', async () => {
  const c = client();
  assert.equal((await c('POST', '/api/auth/signup', { name: 'Ag Ency', email: 'agency@example.com', password: 'password123', workspace: 'My Agency' })).status, 201);
  const home = (await c('GET', '/api/me')).body.account.id;
  await c('POST', '/api/contacts', { email: 'home-person@example.com' });

  assert.equal((await c('POST', '/api/accounts', { name: ' ' })).status, 400);
  const bakery = (await c('POST', '/api/accounts', { name: 'Corner Bakery' })).body.id;
  const gym = (await c('POST', '/api/accounts', { name: 'Iron Gym', switch: true })).body.id;
  let me = (await c('GET', '/api/me')).body;
  assert.equal(me.account.id, gym); // switched on create
  assert.deepEqual(me.accounts.map((a) => a.name), ['Corner Bakery', 'Iron Gym', 'My Agency']);

  // Each workspace sees only its own data.
  assert.deepEqual((await c('GET', '/api/contacts')).body, []);
  for (let i = 0; i < 12; i++) assert.equal((await c('POST', '/api/funnels', { name: `Gym funnel ${i}`, template: 'optin' })).status, 201);
  assert.equal((await c('GET', '/api/funnels')).body.length, 12);
  await c('POST', `/api/accounts/${bakery}/switch`);
  assert.equal((await c('GET', '/api/me')).body.account.name, 'Corner Bakery');
  assert.deepEqual((await c('GET', '/api/funnels')).body, []);
  await c('POST', `/api/accounts/${home}/switch`);
  assert.deepEqual((await c('GET', '/api/contacts')).body.map((p) => p.email), ['home-person@example.com']);

  const list = (await c('GET', '/api/accounts')).body;
  assert.equal(list.current, home);
  assert.equal(list.accounts.find((a) => a.id === gym).funnels, 12);

  // Someone else can't switch into or delete these.
  const other = client();
  await other('POST', '/api/auth/signup', { name: 'Other', email: 'other-acct@example.com', password: 'password123' });
  assert.equal((await other('POST', `/api/accounts/${gym}/switch`)).status, 404);
  assert.equal((await other('DELETE', `/api/accounts/${gym}`, { confirm: 'Iron Gym' })).status, 404);
  assert.equal((await other('GET', '/api/me')).body.accounts.length, 1);

  // Delete needs the exact name; deleting the current one moves you to another.
  await c('POST', `/api/accounts/${gym}/switch`);
  assert.equal((await c('DELETE', `/api/accounts/${gym}`, { confirm: 'iron gym' })).status, 400);
  const del = (await c('DELETE', `/api/accounts/${gym}`, { confirm: 'Iron Gym' })).body;
  assert.equal(del.ok, true);
  me = (await c('GET', '/api/me')).body; // still signed in
  assert.equal(me.account.id, del.current);
  assert.ok(!me.accounts.some((a) => a.id === gym));
  await c('DELETE', `/api/accounts/${bakery}`, { confirm: 'Corner Bakery' });
  assert.equal((await c('DELETE', `/api/accounts/${home}`, { confirm: 'My Agency' })).status, 400); // only one left
});
