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

test('the kind of business sets starting follow-ups, the deals board and visible sections', async () => {
  const c = client();
  assert.equal((await c('POST', '/api/auth/signup', { name: 'Pat', email: 'pat@example.com', password: 'password123', workspace: 'Pat Plumbing', business_type: 'services' })).status, 201);
  let me = (await c('GET', '/api/me')).body;
  assert.equal(me.account.business_type, 'services');
  assert.equal(me.account.people_word, 'clients');
  assert.deepEqual(me.account.hidden_sections, []);
  assert.ok((await c('GET', '/api/workflows')).body.some((w) => w.name === 'Inquiry follow-up'));
  const pipes = (await c('GET', '/api/pipelines')).body;
  assert.equal(pipes.length, 1);
  const board = (await c('GET', `/api/pipelines/${pipes[0].id}`)).body;
  assert.deepEqual(board.stages.map((s) => s.name), ['New inquiry', 'Quote sent', 'Booked', 'Done']);

  // A restaurant sub-account: no deals board, deals and products hidden.
  const r = (await c('POST', '/api/accounts', { name: 'Corner Cafe', business_type: 'local', switch: true })).body;
  me = (await c('GET', '/api/me')).body;
  assert.equal(me.account.id, r.id);
  assert.deepEqual(me.account.hidden_sections, ['pipelines', 'products']);
  assert.equal((await c('GET', '/api/pipelines')).body.length, 0);
  assert.equal((await c('GET', '/api/workflows')).body.length, 4);

  // The owner can show a section again; unknown names are ignored.
  await c('PUT', '/api/account/business', { hidden_sections: ['products', 'nonsense'] });
  me = (await c('GET', '/api/me')).body;
  assert.deepEqual(me.account.hidden_sections, ['products']);
  assert.equal((await c('PUT', '/api/account/business', { business_type: 'spaceship' })).status, 200);
  assert.equal((await c('GET', '/api/me')).body.account.business_type, '');
});

test('duplicating a funnel copies its pages, links, purpose and follow-ups, as a draft', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Dee', email: 'dup@example.com', password: 'password123', workspace: 'Dup Co' });
  const f = (await c('POST', '/api/funnels', { name: 'Guide', template: 'optin' })).body;
  await c('PUT', `/api/funnels/${f.id}`, { purpose: 'leads' });
  const src = (await c('GET', `/api/funnels/${f.id}`)).body;
  const r = await c('POST', `/api/funnels/${f.id}/duplicate`, { name: 'Guide v2' });
  assert.equal(r.status, 201);
  const copy = (await c('GET', `/api/funnels/${r.body.id}`)).body;
  assert.equal(copy.name, 'Guide v2');
  assert.equal(copy.status, 'draft');
  assert.equal(copy.purpose, 'leads');
  assert.notEqual(copy.slug, src.slug);
  assert.deepEqual(copy.steps.map((s) => [s.name, s.slug]), src.steps.map((s) => [s.name, s.slug]));
  assert.ok(copy.steps.every((s) => !src.steps.some((o) => o.id === s.id))); // new pages, not shared
  const entry = copy.steps.find((s) => s.id === copy.entry_step_id);
  assert.equal(entry.name, src.steps.find((s) => s.id === src.entry_step_id).name);
  assert.ok(copy.steps.find((s) => s.id === entry.next_step_id)); // links point inside the copy
  assert.equal(copy.workflows.length, src.workflows.length);
  assert.ok(copy.workflows.every((w) => w.status === 'draft' && w.name.startsWith('Guide v2: ')));
  // Editing the copy leaves the original alone.
  await c('PUT', `/api/steps/${entry.id}`, { name: 'Changed', blocks: [], settings: {} });
  assert.notEqual((await c('GET', `/api/funnels/${f.id}`)).body.steps.find((s) => s.id === src.entry_step_id).name, 'Changed');
  const other = client();
  await other('POST', '/api/auth/signup', { name: 'O', email: 'dup-other@example.com', password: 'password123', workspace: 'Other' });
  assert.equal((await other('POST', `/api/funnels/${f.id}/duplicate`, {})).status, 404);
});

test('email designer: drafts are editable, tests do not count, preview text and audience count work', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Eve Owner', email: 'eve-owner@example.com', password: 'password123', workspace: 'Eve Co' });
  await c('POST', '/api/contacts', { email: 'a1@example.com', first_name: 'Ann', tags: 'vip' });
  await c('POST', '/api/contacts', { email: 'a2@example.com', first_name: 'Bo' });
  assert.equal((await c('GET', '/api/broadcasts/audience')).body.count, 2);
  assert.equal((await c('GET', '/api/broadcasts/audience?tag=vip')).body.count, 1);
  const { id } = (await c('POST', '/api/broadcasts', { subject: 'Hi {{first_name|there}}', body: 'Hello', tag: 'vip', preheader: 'Quick news' })).body;
  assert.equal((await c('PUT', `/api/broadcasts/${id}`, { subject: 'Hello {{first_name|there}}', body: 'Updated', tag: 'vip', preheader: 'Fresh news' })).status, 200);
  const t = (await c('POST', '/api/broadcasts/test', { subject: 'Hello {{first_name|there}}', body: 'Updated', preheader: 'x' })).body;
  assert.equal(t.to, 'eve-owner@example.com');
  assert.equal((await c('POST', `/api/broadcasts/${id}/send`)).body.sent, 1);
  const b = (await c('GET', `/api/broadcasts/${id}`)).body;
  assert.deepEqual([b.status, b.sent_count, b.preheader, b.opened, b.clicked], ['sent', 1, 'Fresh news', 0, 0]);
  const out = (await c('GET', '/api/outbox')).body.map((m) => m.subject).sort();
  assert.deepEqual(out, ['Hello Ann', '[Test] Hello Eve']); // the test went only to the owner, and isn't counted
  assert.equal((await c('PUT', `/api/broadcasts/${id}`, { subject: 'x', body: 'y' })).status, 409); // sent ones are locked
});
