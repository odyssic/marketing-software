const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

let server, base;
before(async () => {
  server = createApp({ dbPath: ':memory:' }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

function client() {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(base + path, {
      method, redirect: 'manual',
      headers: { cookie, 'content-type': 'application/json' },
      body: body && JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, body: type.includes('json') ? await res.json() : await res.text() };
  };
}

async function seller(email) {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'S', email, password: 'password123' });
  return c;
}

test('upsell template builds a branching tree and pages route by it', async () => {
  const c = await seller('tree@example.com');
  const { body: { id } } = await c('POST', '/api/funnels', { name: 'Branchy', template: 'upsell' });
  const f = (await c('GET', `/api/funnels/${id}`)).body;
  const by = Object.fromEntries(f.steps.map((s) => [s.name, s]));
  assert.equal(f.entry_step_id, by['Sales page'].id);
  assert.equal(by['Sales page'].next_step_id, by.Upsell.id);
  assert.equal(by.Upsell.next_step_id, by['Thank you'].id);
  assert.equal(by.Upsell.no_step_id, by.Downsell.id);
  assert.equal(by['Thank you'].next_step_id, null);

  // The "No thanks" button (#no) on the upsell goes to the downsell.
  const html = (await client()('GET', `/f/${f.slug}/upgrade`)).body;
  assert.match(html, /href="\/f\/branchy\/lite">No thanks/);
});

test('map API: reconnect, move, change start page, reject bad links', async () => {
  const c = await seller('map@example.com');
  const { body: { id } } = await c('POST', '/api/funnels', { name: 'Mapped', template: 'optin' });
  const [optin, thanks] = (await c('GET', `/api/funnels/${id}`)).body.steps;

  // Drag from the opt-in's "no" exit into empty space → new connected page.
  const { body: { id: newId } } = await c('POST', `/api/funnels/${id}/steps`, { name: 'Bonus', from: optin.id, port: 'no', x: 500, y: 300 });
  let f = (await c('GET', `/api/funnels/${id}`)).body;
  assert.equal(f.steps.find((s) => s.id === optin.id).no_step_id, newId);
  assert.deepEqual([f.steps.find((s) => s.id === newId).x, f.steps.find((s) => s.id === newId).y], [500, 300]);

  assert.equal((await c('PUT', `/api/funnels/${id}/map`, { steps: [{ id: thanks.id, next_step_id: newId, x: 10 }], entry_step_id: thanks.id })).status, 200);
  f = (await c('GET', `/api/funnels/${id}`)).body;
  assert.equal(f.entry_step_id, thanks.id);
  assert.equal(f.steps.find((s) => s.id === thanks.id).next_step_id, newId);
  assert.match((await client()('GET', '/f/mapped')).body, /You are in!/, 'funnel link opens the start page');

  assert.equal((await c('PUT', `/api/funnels/${id}/map`, { steps: [{ id: optin.id, next_step_id: optin.id }] })).status, 400, 'no self-links');
  const other = await seller('other@example.com');
  const { body: { id: otherFunnel } } = await other('POST', '/api/funnels', { name: 'Other', template: 'blank' });
  const [otherStep] = (await other('GET', `/api/funnels/${otherFunnel}`)).body.steps;
  assert.equal((await c('PUT', `/api/funnels/${id}/map`, { steps: [{ id: optin.id, next_step_id: otherStep.id }] })).status, 400, 'no cross-funnel links');
  assert.equal((await c('PUT', `/api/funnels/${otherFunnel}/map`, { steps: [] })).status, 404, 'no editing others’ funnels');

  // Deleting the start page clears links to it and picks a new start.
  assert.equal((await c('DELETE', `/api/steps/${thanks.id}`)).status, 200);
  f = (await c('GET', `/api/funnels/${id}`)).body;
  assert.equal(f.entry_step_id, optin.id);
  assert.equal(f.steps.find((s) => s.id === optin.id).next_step_id, null);
});
