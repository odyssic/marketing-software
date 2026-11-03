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
const raw = async (method, path, { form, cookie } = {}) => {
  const res = await fetch(base + path, { method, redirect: 'manual', headers: { ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), ...(cookie ? { cookie } : {}) }, body: form && new URLSearchParams(form) });
  return { status: res.status, location: res.headers.get('location'), cookie: (res.headers.get('set-cookie') || '').split(';')[0], text: await res.text() };
};
const lastLink = async (c, email) => {
  const mail = (await c('GET', '/api/outbox')).body.find((m) => m.to_email === email && /\/m\/.+\/enter\//.test(m.body));
  return mail && mail.body.match(/https?:\/\/\S+\/m\/\S+\/enter\/\S+/)[0].replace(/^https?:\/\/[^/]+/, '');
};

test('a members area is locked until someone has access; the emailed link signs them in', async () => {
  process.env.PUBLIC_URL = base;
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Ola', email: 'ola@example.com', password: 'password123', workspace: 'Ola Pottery', business_type: 'coach' });
  const { id } = (await c('POST', '/api/members-areas', { name: 'Pottery Basics' })).body;
  const area = (await c('GET', `/api/funnels/${id}`)).body;
  assert.equal(area.kind, 'members');
  assert.deepEqual(area.steps.map((s) => s.name), ['Welcome', 'Lesson 1', 'Lesson 2', 'Downloads']);
  assert.equal((await c('POST', `/api/funnels/${id}/publish`)).status, 200);

  // A stranger sees the sign-in page, not the lesson.
  const locked = await raw('GET', `/f/${area.slug}/lesson-1`);
  assert.equal(locked.status, 401);
  assert.match(locked.text, /Members only/);
  assert.doesNotMatch(locked.text, /Lesson 1: \[Title\]/);
  // Asking with an email that has no access sends nothing (and says the same thing).
  assert.match((await raw('POST', `/m/${area.slug}/login`, { form: { email: 'nobody@example.com' } })).text, /If that email has access/);
  assert.equal(await lastLink(c, 'nobody@example.com'), undefined);

  // The owner adds a member: they get a link that signs them in.
  assert.equal((await c('POST', `/api/members-areas/${id}/members`, { email: 'Pia@Example.com', name: 'Pia Diaz' })).status, 201);
  const link = await lastLink(c, 'pia@example.com');
  assert.ok(link);
  const enter = await raw('GET', link);
  assert.equal(enter.status, 303);
  assert.match(enter.cookie, /^rm\d+=/);
  const open = await raw('GET', `/f/${area.slug}/lesson-1`, { cookie: enter.cookie });
  assert.equal(open.status, 200);
  assert.match(open.text, /Lesson 1: \[Title\]/);
  // A tampered link or cookie gets nowhere.
  assert.equal((await raw('GET', link.replace(/.$/, (ch) => (ch === 'a' ? 'b' : 'a')))).status, 401);
  assert.equal((await raw('GET', `/f/${area.slug}/lesson-1`, { cookie: enter.cookie.replace(/=(\d+)\./, '=999.') })).status, 401);

  // Removing them locks the door again; undo opens it.
  const pia = (await c('GET', `/api/members-areas/${id}/members`)).body.members[0];
  await c('DELETE', `/api/members-areas/${id}/members/${pia.id}`);
  assert.equal((await raw('GET', `/f/${area.slug}/lesson-1`, { cookie: enter.cookie })).status, 401);
  await c('POST', `/api/members-areas/${id}/members/${pia.id}/restore`);
  assert.equal((await raw('GET', `/f/${area.slug}/lesson-1`, { cookie: enter.cookie })).status, 200);
  // The owner can always look.
  assert.equal((await c('GET', `/f/${area.slug}/lesson-2`)).status, 200);
});

test('buying a linked product lets the buyer in', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Kai', email: 'kai@example.com', password: 'password123', workspace: 'Kai Course', business_type: 'coach' });
  const { id } = (await c('POST', '/api/members-areas', { name: 'Course' })).body;
  const prod = (await c('POST', '/api/products', { name: 'The course', price: 49 })).body;
  await c('PUT', `/api/members-areas/${id}/products`, { product_ids: [prod.id] });
  assert.equal((await c('GET', `/api/members-areas/${id}/members`)).body.products.find((p) => p.id === prod.id).linked, true);
  // A test-mode purchase through a pricing page.
  const f = (await c('POST', '/api/funnels', { name: 'Course sale', template: 'pricing' })).body;
  const funnel = (await c('GET', `/api/funnels/${f.id}`)).body;
  await c('POST', `/api/funnels/${f.id}/publish`);
  const buy = await raw('POST', `/f/${funnel.slug}/${funnel.steps[0].slug}/buy`, { form: { product: String(prod.id), email: 'buyer@example.com' } });
  assert.equal(buy.status, 303);
  await raw('POST', buy.location, { form: { email: 'buyer@example.com', name: 'Bea' } });
  const members = (await c('GET', `/api/members-areas/${id}/members`)).body.members;
  assert.deepEqual(members.map((m) => m.email), ['buyer@example.com']);
  assert.equal(members[0].source, 'purchase');
  assert.ok(await lastLink(c, 'buyer@example.com'));
});
