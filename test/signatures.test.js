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
const { signatureHtml, signatureText } = require('../public/js/signature.js');

test('signature layouts escape what you type and drop unsafe links', () => {
  const s = { name: 'Ann <b>', title: 'Owner', website: 'javascript:alert(1)', instagram: 'instagram.com/ann', photo: '/u/abc', style: 'photo', color: '#1d4ed8' };
  const h = signatureHtml(s, 'https://getrilly.com');
  assert.match(h, /Ann &lt;b&gt;/);
  assert.doesNotMatch(h, /javascript:/);
  assert.match(h, /https:\/\/instagram\.com\/ann/);
  assert.match(h, /src="https:\/\/getrilly\.com\/u\/abc"/);
  for (const style of ['classic', 'card', 'minimal']) assert.match(signatureHtml({ ...s, style }), /Ann/);
  assert.match(signatureText(s), /Instagram: https:\/\/instagram\.com\/ann/);
});

test('saved signatures go into sent emails', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Sig', email: 'sig@example.com', password: 'password123', workspace: 'Sig Co' });
  const saved = (await c('PUT', '/api/account/signatures', { list: [{ name: 'Sig Smith', title: 'Owner', phone: '555-0100', style: 'card' }, { id: 'short', name: 'Sig', style: 'minimal' }], default: 'short' })).body;
  assert.equal(saved.list.length, 2);
  assert.equal(saved.default, 'short');
  assert.equal((await c('PUT', '/api/account/signatures', { list: [{ title: 'no name' }] })).body.list.length, 0); // a signature needs a name
  await c('PUT', '/api/account/signatures', saved);
  await c('POST', '/api/contacts', { email: 'reader@example.com', first_name: 'Rae' });
  const { id } = (await c('POST', '/api/broadcasts', { subject: 'Hello', body: `Hi {{first_name}},\n\nNews.\n\n{{signature:${saved.list[0].id}}}` })).body;
  await c('POST', `/api/broadcasts/${id}/send`);
  const sent = (await c('GET', '/api/outbox')).body.find((m) => m.subject === 'Hello');
  assert.match(sent.body, /—\nSig Smith\nOwner\n555-0100/);
  assert.doesNotMatch(sent.body, /\{\{signature/);
});
