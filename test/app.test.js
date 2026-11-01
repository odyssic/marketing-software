// Tests create several workspaces; the app is single-owner by default.
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

// Minimal client that keeps the session cookie between calls.
function client() {
  let cookie = '';
  return async (method, path, body, { form } = {}) => {
    const res = await fetch(base + path, {
      method,
      redirect: 'manual',
      headers: {
        cookie,
        'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json',
      },
      body: form ? new URLSearchParams(form) : body && JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : await res.text() };
  };
}

async function signup(email) {
  const c = client();
  const r = await c('POST', '/api/auth/signup', { name: 'Test User', email, password: 'password123', workspace: 'Acme' });
  assert.equal(r.status, 201);
  return c;
}

test('full funnel → contact → broadcast → unsubscribe flow', async () => {
  const c = await signup('owner@example.com');
  assert.equal((await c('GET', '/api/me')).body.account.name, 'Acme');

  const { body: { id: funnelId } } = await c('POST', '/api/funnels', { name: 'Free Guide', template: 'optin' });
  const funnel = (await c('GET', `/api/funnels/${funnelId}`)).body;
  assert.equal(funnel.slug, 'free-guide');
  assert.equal(funnel.steps.length, 2);

  // Visitor views the public page and opts in.
  const visitor = client();
  const page = await visitor('GET', '/f/free-guide');
  assert.equal(page.status, 200);
  assert.match(page.body, /Send me the guide/);
  const optin = await visitor('POST', '/f/free-guide/optin/optin', null, { form: { email: 'Lead@Example.com', first_name: 'Ada' } });
  assert.equal(optin.status, 303);
  assert.equal(optin.headers.get('location'), '/f/free-guide/thank-you');

  const contacts = (await c('GET', '/api/contacts')).body;
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].email, 'lead@example.com');
  assert.deepEqual(contacts[0].tags, ['lead']);

  const dash = (await c('GET', '/api/dashboard')).body;
  assert.equal(dash.views30d, 1);
  assert.equal(dash.optins30d, 1);
  assert.equal(dash.conversion, 100);

  // Broadcast to the "lead" tag (dev mode: logged to outbox).
  const { body: { id: bId } } = await c('POST', '/api/broadcasts', { subject: 'Hi {{first_name}}', body: 'Welcome!', tag: 'lead' });
  const sent = (await c('POST', `/api/broadcasts/${bId}/send`)).body;
  assert.deepEqual(sent, { sent: 1, total: 1 });
  assert.equal((await c('POST', `/api/broadcasts/${bId}/send`)).status, 409);
  const [mail] = (await c('GET', '/api/outbox')).body;
  assert.equal(mail.subject, 'Hi Ada');

  // Unsubscribe link works, and a tampered one does not.
  const link = mail.body.match(/\/unsubscribe\/\S+/)[0];
  assert.match((await visitor('GET', link.slice(0, -1) + 'x')).body, /invalid/);
  assert.match((await visitor('GET', link)).body, /unsubscribed/);
  assert.equal((await c('GET', '/api/contacts')).body[0].unsubscribed, true);
});

test('workspaces cannot see each other’s data', async () => {
  const a = await signup('a@example.com');
  const b = await signup('b@example.com');
  const { body: { id } } = await a('POST', '/api/funnels', { name: 'Private', template: 'blank' });
  await a('POST', '/api/contacts', { email: 'secret@example.com' });
  assert.equal((await b('GET', `/api/funnels/${id}`)).status, 404);
  assert.equal((await b('GET', '/api/contacts')).body.length, 0);
});

test('auth and validation', async () => {
  const c = client();
  assert.equal((await c('GET', '/api/contacts')).status, 401);
  assert.equal((await c('POST', '/api/auth/signup', { name: 'X', email: 'bad', password: 'password123' })).status, 400);
  await signup('dupe@example.com');
  assert.equal((await c('POST', '/api/auth/signup', { name: 'X', email: 'dupe@example.com', password: 'password123' })).status, 409);
  assert.equal((await c('POST', '/api/auth/login', { email: 'dupe@example.com', password: 'wrong' })).status, 401);
  assert.equal((await c('POST', '/api/auth/login', { email: 'dupe@example.com', password: 'password123' })).status, 200);
  // Non-JSON writes are rejected (CSRF guard).
  assert.equal((await c('POST', '/api/contacts', null, { form: { email: 'x@y.z' } })).status, 415);
});

test('page renderer escapes user content', async () => {
  const c = await signup('xss@example.com');
  const { body: { id } } = await c('POST', '/api/funnels', { name: 'XSS', template: 'blank' });
  const [step] = (await c('GET', `/api/funnels/${id}`)).body.steps;
  await c('PUT', `/api/steps/${step.id}`, { blocks: [
    { id: '1', type: 'heading', text: '<script>alert(1)</script>' },
    { id: '2', type: 'button', label: 'x', url: 'javascript:alert(1)' },
  ] });
  const html = (await client()('GET', '/f/xss')).body;
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /javascript:/);
});

test('deletes work from the dashboard (no request body)', async () => {
  const c = await signup('deleter@example.com');
  const { body: contact } = await c('POST', '/api/contacts', { email: 'gone@example.com' });
  assert.equal((await c('DELETE', `/api/contacts/${contact.id}`)).status, 200);
  assert.equal((await c('GET', '/api/contacts')).body.length, 0);
});
