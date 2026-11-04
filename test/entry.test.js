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

test('people remember how they first came in', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'En', email: 'en@example.com', password: 'password123', workspace: 'En Co' });
  // By hand, with a note.
  const a = (await c('POST', '/api/contacts', { email: 'met@example.com', entry: 'Trade show' })).body;
  assert.equal((await c('GET', `/api/people/${a.id}`)).body.entry, 'Added by hand: Trade show');
  // Through a page's form: the pageflow and the page.
  const f = (await c('POST', '/api/funnels', { name: 'Glaze guide', template: 'optin' })).body;
  const funnel = (await c('GET', `/api/funnels/${f.id}`)).body;
  await c('POST', `/api/funnels/${f.id}/publish`);
  await fetch(`${base}/f/${funnel.slug}/${funnel.steps[0].slug}/optin?utm_source=instagram`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=page%40example.com&first_name=Pa' });
  const people = (await c('GET', '/api/contacts')).body;
  const p = people.find((x) => x.email === 'page@example.com');
  assert.equal(p.entry, `Glaze guide → ${funnel.steps[0].name}`);
  // A later sign-up elsewhere doesn't overwrite the first way in.
  await c('POST', '/api/contacts', { email: 'page@example.com', entry: 'Walk-in' });
  assert.equal((await c('GET', `/api/people/${p.id}`)).body.entry, `Glaze guide → ${funnel.steps[0].name}`);
  // Imports say so; the owner can correct it.
  await c('POST', '/api/import/people', { rows: [{ email: 'imp@example.com' }] });
  const imp = (await c('GET', '/api/contacts')).body.find((x) => x.email === 'imp@example.com');
  assert.match(imp.entry, /Imported/);
  await c('PUT', `/api/contacts/${imp.id}`, { entry: 'Old customer list' });
  assert.equal((await c('GET', `/api/people/${imp.id}`)).body.entry, 'Old customer list');
});
