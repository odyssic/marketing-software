process.env.ALLOW_SIGNUPS = '1';
const SECRET = `whsec_${Buffer.from('test-secret-key-0123456789').toString('base64')}`;
process.env.EMAIL_WEBHOOK_SECRET = SECRET;
const crypto = require('node:crypto');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { verifySvix } = require('../src/bounces');

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
const sign = (body, id = 'msg_1', ts = Math.floor(Date.now() / 1000)) => {
  const sig = crypto.createHmac('sha256', Buffer.from(SECRET.slice(6), 'base64')).update(`${id}.${ts}.${body}`).digest('base64');
  return { 'svix-id': id, 'svix-timestamp': String(ts), 'svix-signature': `v1,${sig}` };
};
const hook = (payload, headers) => {
  const body = JSON.stringify(payload);
  return fetch(`${base}/hooks/email`, { method: 'POST', headers: { 'content-type': 'application/json', ...(headers || sign(body)) }, body });
};

test('signatures: only the provider can report bounces', () => {
  const body = '{"a":1}';
  const h = sign(body);
  assert.ok(verifySvix({ secret: SECRET, id: h['svix-id'], timestamp: h['svix-timestamp'], signature: h['svix-signature'], body }));
  assert.ok(!verifySvix({ secret: SECRET, id: h['svix-id'], timestamp: h['svix-timestamp'], signature: h['svix-signature'], body: '{"a":2}' }));
  const old = sign(body, 'msg_1', Math.floor(Date.now() / 1000) - 3600);
  assert.ok(!verifySvix({ secret: SECRET, id: old['svix-id'], timestamp: old['svix-timestamp'], signature: old['svix-signature'], body }));
});

test('a bounce stops email everywhere; a spam complaint unsubscribes from that business', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Bo', email: 'bo-owner@example.com', password: 'password123', workspace: 'Shop A' });
  const a1 = (await c('POST', '/api/contacts', { email: 'gone@example.com' })).body;
  const a2 = (await c('POST', '/api/contacts', { email: 'angry@example.com' })).body;
  const b = (await c('POST', '/api/accounts', { name: 'Shop B', switch: true })).body;
  const b1 = (await c('POST', '/api/contacts', { email: 'gone@example.com' })).body;
  const b2 = (await c('POST', '/api/contacts', { email: 'angry@example.com' })).body;
  // Shop B emails everyone, so it is the business the angry person complains about.
  const bc = (await c('POST', '/api/broadcasts', { subject: 'Hi', body: 'Hello' })).body;
  assert.equal((await c('POST', `/api/broadcasts/${bc.id}/send`)).status, 200);

  assert.equal((await hook({ type: 'email.bounced', data: { to: ['gone@example.com'] } }, { 'svix-id': 'x', 'svix-timestamp': '1', 'svix-signature': 'v1,bad' })).status, 401);
  const r = await (await hook({ type: 'email.bounced', data: { to: ['Gone@Example.com'] } })).json();
  assert.equal(r.stopped, 2);
  assert.equal((await hook({ type: 'email.delivered', data: { to: ['angry@example.com'] } })).status, 200);

  const person = async (id) => (await c('GET', `/api/people/${id}`)).body;
  assert.equal((await person(b1.id)).unsubscribed, true);
  assert.equal((await person(b2.id)).unsubscribed, false); // delivered ≠ complaint
  const ev = (await person(b1.id)).events.find((e) => e.type === 'unsubscribe');
  assert.equal(ev.meta.reason, 'Email bounced');
  const k = await (await hook({ type: 'email.complained', data: { to: ['angry@example.com'] } })).json();
  assert.deepEqual([k.kind, k.stopped], ['complained', 1]);
  assert.equal((await person(b2.id)).unsubscribed, true);
  assert.equal((await person(b2.id)).events.find((e) => e.type === 'unsubscribe').meta.reason, 'Marked as spam');
  // Back in Shop A: the bounce stopped them here too, the complaint did not.
  assert.equal((await c('POST', `/api/accounts/${(await c('GET', '/api/accounts')).body.accounts.find((x) => x.id !== b.id).id}/switch`)).status, 200);
  assert.equal((await person(a1.id)).unsubscribed, true);
  assert.equal((await person(a2.id)).unsubscribed, false);
});
