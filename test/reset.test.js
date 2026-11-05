// Forgot password: emailed link, new password, signed out everywhere else.
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
    const res = await fetch(base + path, { method, redirect: 'manual', headers: { cookie, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: res.status, body: (res.headers.get('content-type') || '').includes('json') ? await res.json() : await res.text() };
  };
}

test('reset a forgotten password by email', async () => {
  const owner = client();
  await owner('POST', '/api/auth/signup', { name: 'Ana Ruiz', email: 'ana@example.com', password: 'oldpassword1', workspace: 'Ana', business_type: 'coach' });
  assert.equal((await owner('GET', '/api/me')).status, 200);

  const c = client();
  // Same answer for unknown emails, so it can't be used to find accounts.
  const unknown = await c('POST', '/api/auth/reset', { email: 'nobody@example.com' });
  assert.deepEqual(unknown.body, { ok: true });
  const r = await c('POST', '/api/auth/reset', { email: 'Ana@Example.com' });
  const token = r.body.devLink.split('/reset/')[1];
  assert.ok(token);

  // A reset link can't be used as a sign-in link.
  assert.equal((await c('GET', `/auth/magic/${token}`)).status, 400);
  assert.equal((await c('POST', '/api/auth/reset/confirm', { token, password: 'short' })).status, 400);
  const ok = await c('POST', '/api/auth/reset/confirm', { token, password: 'newpassword2' });
  assert.equal(ok.status, 200);
  assert.equal((await c('GET', '/api/me')).status, 200, 'signed in after the reset');
  assert.equal((await owner('GET', '/api/me')).status, 401, 'other sessions are signed out');

  // Works once.
  assert.equal((await c('POST', '/api/auth/reset/confirm', { token, password: 'another-one3' })).status, 400);
  const d = client();
  assert.equal((await d('POST', '/api/auth/login', { email: 'ana@example.com', password: 'oldpassword1' })).status, 401);
  assert.equal((await d('POST', '/api/auth/login', { email: 'ana@example.com', password: 'newpassword2' })).status, 200);
});
