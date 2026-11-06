// Invite a client or teammate into one business.
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

test('invite a client into one business; they can work there but not manage it', async () => {
  const owner = client();
  await owner('POST', '/api/auth/signup', { name: 'Ann Agency', email: 'ann@agency.com', password: 'password123', workspace: 'Agency HQ', business_type: 'services' });
  const bakery = (await owner('POST', '/api/accounts', { name: 'Bakery', switch: true })).body.id;
  assert.equal((await owner('GET', '/api/me')).body.role, 'owner');

  const inv = await owner('POST', '/api/team/invites', { email: 'Bo@Bakery.com' });
  assert.equal(inv.status, 201);
  const token = inv.body.devLink.split('/invite/')[1];
  assert.equal((await owner('POST', '/api/team/invites', { email: 'not-an-email' })).status, 400);

  // The client opens the link, picks a password and is in.
  const bo = client();
  const look = await bo('GET', `/api/invites/${token}`);
  assert.deepEqual(look.body, { business: 'Bakery', email: 'bo@bakery.com', hasAccount: false });
  assert.equal((await bo('POST', `/api/invites/${token}/accept`, { name: 'Bo', password: 'short' })).status, 400);
  assert.equal((await bo('POST', `/api/invites/${token}/accept`, { name: 'Bo Baker', password: 'bakerpass1' })).status, 200);
  const me = (await bo('GET', '/api/me')).body;
  assert.equal(me.account.id, bakery);
  assert.equal(me.role, 'member');
  assert.deepEqual(me.accounts.map((a) => a.name), ['Bakery'], 'only the business they were invited to');
  assert.equal((await bo('GET', `/api/invites/${token}`)).status, 404, 'an invite works once');

  // Members work in the business, but can't invite, remove or delete.
  assert.equal((await bo('POST', '/api/funnels', { name: 'Bread club', template: 'optin' })).status, 201);
  assert.equal((await bo('POST', '/api/team/invites', { email: 'x@y.com' })).status, 403);
  assert.equal((await bo('DELETE', `/api/accounts/${bakery}`, { confirm: 'Bakery' })).status, 403);
  const team = (await owner('GET', '/api/team')).body;
  assert.deepEqual(team.members.map((m) => [m.name, m.role]), [['Ann Agency', 'owner'], ['Bo Baker', 'member']]);

  // The owner removes them: access ends at once.
  const boId = team.members.find((m) => m.role === 'member').id;
  assert.equal((await owner('DELETE', `/api/team/members/${boId}`)).status, 200);
  assert.equal((await bo('GET', '/api/me')).status, 401);
});

test('someone who already has an account signs in first, and only the invited person can use it', async () => {
  const owner = client(), cy = client(), other = client();
  await owner('POST', '/api/auth/signup', { name: 'Ola', email: 'ola@x.com', password: 'password123', business_type: 'shop' });
  await cy('POST', '/api/auth/signup', { name: 'Cy', email: 'cy@x.com', password: 'password123', business_type: 'shop' });
  await other('POST', '/api/auth/signup', { name: 'Di', email: 'di@x.com', password: 'password123', business_type: 'shop' });
  const token = (await owner('POST', '/api/team/invites', { email: 'cy@x.com' })).body.devLink.split('/invite/')[1];
  assert.equal((await client()('POST', `/api/invites/${token}/accept`, { name: 'Imposter', password: 'password123' })).status, 409, 'can’t claim an existing account');
  assert.equal((await other('POST', `/api/invites/${token}/accept`)).status, 403, 'wrong person signed in');
  assert.equal((await cy('POST', `/api/invites/${token}/accept`)).status, 200);
  const me = (await cy('GET', '/api/me')).body;
  assert.equal(me.account.name, "Ola's business");
  assert.equal(me.accounts.length, 2, 'their own business plus the one they joined');
});
