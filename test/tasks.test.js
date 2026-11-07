// Tasks and Today: to-dos, workflow follow-ups, and what needs a look today.
process.env.ALLOW_SIGNUPS = '1';
process.env.ALLOW_TIME_TRAVEL = '1';
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

test('tasks: add, tick, due later, per person; Today shows what needs you', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Tia', email: 'tia@example.com', password: 'password123', workspace: 'Tia Tutors', business_type: 'services' });
  const p = (await c('POST', '/api/contacts', { email: 'sam@example.com', first_name: 'Sam' })).body;
  assert.equal((await c('POST', '/api/tasks', { title: '' })).status, 400);
  const t1 = (await c('POST', '/api/tasks', { title: 'Call Sam about the quote', contact_id: p.id })).body;
  assert.equal(t1.person.name, 'Sam');
  const later = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
  await c('POST', '/api/tasks', { title: 'Order business cards', due: later });

  let today = (await c('GET', '/api/today')).body;
  assert.deepEqual(today.tasks.map((t) => t.title), ['Call Sam about the quote']);
  assert.equal(today.later, 1);
  assert.deepEqual(today.leads.map((l) => l.name), ['Sam']);

  assert.equal((await c('PUT', `/api/tasks/${t1.id}`, { done: true })).body.done, true);
  today = (await c('GET', '/api/today')).body;
  assert.equal(today.tasks.length, 0);
  assert.equal((await c('GET', `/api/tasks?contact_id=${p.id}`)).body[0].done, true, 'recently done stays visible on their page');

  // Another business can't see or touch them.
  const o = client();
  await o('POST', '/api/auth/signup', { name: 'Oz', email: 'oz-tasks@example.com', password: 'password123', workspace: 'Oz', business_type: 'services' });
  assert.equal((await o('GET', '/api/tasks')).body.length, 0);
  assert.equal((await o('PUT', `/api/tasks/${t1.id}`, { done: false })).status, 404);
  assert.equal((await o('POST', '/api/tasks', { title: 'x', contact_id: p.id })).status, 404);
  await o('DELETE', `/api/tasks/${t1.id}`);
  assert.equal((await c('GET', '/api/tasks')).body.length, 2);
});

test('a workflow follow-up step lands on Today', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Wes', email: 'wes-tasks@example.com', password: 'password123', workspace: 'Wes', business_type: 'services' });
  const { id } = (await c('POST', '/api/workflows', { template: 'blank', name: 'VIP' })).body;
  const g = (await c('GET', `/api/workflows/${id}`)).body.graph;
  g.nodes[g.root].config = { event: 'tag_added', tag: 'vip' };
  g.nodes.n1 = { type: 'notify', config: { message: 'Send a thank-you card' } };
  g.nodes[g.root].next = 'n1';
  await c('PUT', `/api/workflows/${id}`, { graph: g });
  await c('PUT', `/api/workflows/${id}/status`, { status: 'active' });
  await c('POST', '/api/contacts', { email: 'vip@example.com', first_name: 'Vi', tags: 'vip' });
  await c('POST', '/api/jobs/run', {});
  const today = (await c('GET', '/api/today')).body;
  assert.deepEqual(today.tasks.map((t) => [t.title, t.source]), [['Follow up with Vi: Send a thank-you card', 'follow-up']]);
});
