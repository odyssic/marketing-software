// Saved sections: save a block once, use it on many pages, change it everywhere.
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
    return { status: res.status, body: await res.json() };
  };
}

test('change a saved section once, every page follows', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Sy', email: 'sy@example.com', password: 'password123', business_type: 'coach' });
  const firstStep = async (template, name) => {
    const f = (await c('POST', '/api/funnels', { name, template })).body;
    return (await c('GET', `/api/funnels/${f.id}`)).body.steps[0];
  };
  const a = await firstStep('optin', 'Guide'), b = await firstStep('optin', 'Webinar');
  const hero = { type: 'hero', text: 'Clarity for founders', eyebrow: 'Coaching', background: '#0f5f5a', textColor: '#ffffff' };

  assert.equal((await c('POST', '/api/saved-blocks', { name: 'Form', block: { type: 'form' } })).status, 400, 'forms stay page-only');
  const saved = (await c('POST', '/api/saved-blocks', { name: 'Main header', block: { ...hero, id: 'x1' } })).body;
  assert.equal(saved.type, 'hero');
  assert.equal(saved.block.id, undefined, 'stored without the page’s block id');

  for (const s of [a, b]) await c('PUT', `/api/steps/${s.id}`, { name: s.name, blocks: [{ ...hero, id: `h${s.id}`, savedId: saved.id }, ...s.blocks] });
  assert.equal((await c('GET', '/api/saved-blocks')).body[0].pages, 2);

  const u = await c('PUT', `/api/saved-blocks/${saved.id}`, { block: { ...hero, text: 'Clarity, then momentum', type: 'text' } });
  assert.equal(u.body.pages, 2);
  for (const s of [a, b]) {
    const blocks = (await c('GET', `/api/steps/${s.id}`)).body.blocks;
    assert.equal(blocks[0].text, 'Clarity, then momentum');
    assert.equal(blocks[0].type, 'hero', 'the kind of block never changes');
    assert.equal(blocks[0].id, `h${s.id}`, 'each page keeps its own block id');
    assert.equal(blocks.length, s.blocks.length + 1, 'the rest of the page is untouched');
  }

  // Deleting it leaves the pages as they are, just unlinked.
  assert.equal((await c('DELETE', `/api/saved-blocks/${saved.id}`)).status, 200);
  const after = (await c('GET', `/api/steps/${a.id}`)).body.blocks[0];
  assert.equal(after.text, 'Clarity, then momentum');
  assert.equal(after.savedId, undefined);
});

test('another business can’t touch my saved sections', async () => {
  const me = client(), them = client();
  await me('POST', '/api/auth/signup', { name: 'A', email: 'a1@example.com', password: 'password123', business_type: 'shop' });
  await them('POST', '/api/auth/signup', { name: 'B', email: 'b1@example.com', password: 'password123', business_type: 'shop' });
  const s = (await me('POST', '/api/saved-blocks', { name: 'Quote', block: { type: 'text', text: 'Hi' } })).body;
  assert.equal((await them('PUT', `/api/saved-blocks/${s.id}`, { block: { type: 'text', text: 'Hacked' } })).status, 404);
  assert.equal((await them('DELETE', `/api/saved-blocks/${s.id}`)).status, 404);
  assert.deepEqual((await them('GET', '/api/saved-blocks')).body, []);
});
