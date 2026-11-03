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
