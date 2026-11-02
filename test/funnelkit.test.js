process.env.ALLOW_SIGNUPS = '1';
process.env.LEAK_MIN_VISITS = '2';
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
  return async (method, path, body, { form } = {}) => {
    const res = await fetch(base + path, { method, redirect: 'manual',
      headers: { cookie, 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
      body: form ? new URLSearchParams(form) : body && JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : await res.text() };
  };
}
async function setup(email) {
  const c = client();
  assert.equal((await c('POST', '/api/auth/signup', { name: 'Fk', email, password: 'password123' })).status, 201);
  return c;
}

test('pre-flight blocks publishing with plain fixes; drafts are only visible to the owner', async () => {
  const c = await setup('fk-pre@example.com');
  const { id } = (await c('POST', '/api/funnels', { name: 'Launch', template: 'pricing' })).body; // no product yet
  const f = (await c('GET', `/api/funnels/${id}`)).body;
  assert.equal(f.status, 'draft');
  const [sales] = f.steps;
  await c('PUT', `/api/steps/${sales.id}`, { blocks: [...sales.blocks,
    { id: 'v', type: 'video', url: 'https://vimeo.com/123' },
    { id: 'btn', type: 'button', label: 'Read more', url: 'javascript:alert(1)' },
    { id: 'img', type: 'image', url: 'https://img.example/a.png', alt: '' }] });
  const pre = (await c('GET', `/api/funnels/${id}/preflight`)).body;
  assert.equal(pre.ready, false);
  const texts = pre.problems.map((p) => `${p.severity}: ${p.text}`);
  assert.ok(texts.includes('block: A buy button on “Pricing” has no product.'));
  assert.ok(texts.includes('block: The video link on “Pricing” isn’t a YouTube link.'));
  assert.ok(texts.includes('block: The “Read more” button on “Pricing” has a broken link.'));
  assert.ok(texts.includes('warn: An image on “Pricing” has no description (needed for screen readers).'));
  assert.ok(texts.includes('warn: Payments aren’t connected, so checkout runs in test mode and no one is charged.'));
  assert.ok(pre.problems.every((p) => p.fix?.label && p.fix?.href));
  const blocked = await c('POST', `/api/funnels/${id}/publish`);
  assert.equal(blocked.status, 400);
  assert.ok(blocked.body.problems.length);

  // Draft: the owner sees a preview banner, visitors get "not published", forms are closed.
  const slug = f.slug;
  assert.match((await c('GET', `/f/${slug}`)).body, /Draft preview/);
  const anon = client();
  assert.equal((await anon('GET', `/f/${slug}`)).status, 404);
  assert.equal((await anon('POST', `/f/${slug}/pricing/buy`, undefined, { form: { block: 'x' } })).status, 404);

  // Fix everything and publish.
  const prod = (await c('POST', '/api/products', { name: 'Course', price: 99, image_url: 'https://img.example/course.jpg' })).body;
  assert.equal((await c('POST', '/api/products', { name: 'Bad', price: 5, image_url: 'ftp://x' })).status, 400);
  const fixed = sales.blocks.map((b) => (b.type === 'pricing' ? { ...b, productId: prod.id } : b));
  await c('PUT', `/api/steps/${sales.id}`, { blocks: [...fixed, { id: 'img', type: 'image', url: 'https://img.example/a.png', alt: 'Course cover' }] });
  const ok = (await c('POST', `/api/funnels/${id}/publish`)).body;
  assert.equal(ok.status, 'live');
  const html = (await anon('GET', `/f/${slug}`)).body;
  assert.match(html, /class="pimg" src="https:\/\/img\.example\/course\.jpg"/);
  assert.ok(!html.includes('Draft preview'));
  await c('POST', `/api/funnels/${id}/unpublish`);
  assert.equal((await anon('GET', `/f/${slug}`)).status, 404);
});

test('version history: publish snapshots, autosave checkpoints, one-click restore (itself undoable)', async () => {
  const c = await setup('fk-ver@example.com');
  const { id } = (await c('POST', '/api/funnels', { name: 'Versions', template: 'optin' })).body;
  const [page] = (await c('GET', `/api/funnels/${id}`)).body.steps;
  await c('POST', `/api/funnels/${id}/publish`);
  await c('PUT', `/api/steps/${page.id}`, { blocks: [{ id: 'h', type: 'heading', text: 'Changed my mind' }] });
  let versions = (await c('GET', `/api/steps/${page.id}/versions`)).body;
  assert.deepEqual(versions.map((v) => v.reason), ['published']); // a checkpoint was just taken at publish
  const published = versions[0];
  assert.equal((await c('POST', `/api/steps/${page.id}/versions/${published.id}/restore`)).status, 200);
  let now = (await c('GET', `/api/steps/${page.id}`)).body;
  assert.equal(now.blocks[0].type, 'heading');
  assert.match(now.blocks[0].text, /free guide/i);
  versions = (await c('GET', `/api/steps/${page.id}/versions`)).body;
  assert.equal(versions[0].reason, 'before restore');
  await c('POST', `/api/steps/${page.id}/versions/${versions[0].id}/restore`); // undo the restore
  now = (await c('GET', `/api/steps/${page.id}`)).body;
  assert.equal(now.blocks[0].text, 'Changed my mind');
  const other = await setup('fk-ver-other@example.com');
  assert.equal((await other('GET', `/api/steps/${page.id}/versions`)).status, 404);
  assert.equal((await other('POST', `/api/steps/${page.id}/versions/${published.id}/restore`)).status, 404);
});

test('map metrics in plain words, lever colors, leakiest step with one suggested fix', async () => {
  const c = await setup('fk-flow@example.com');
  const { id } = (await c('POST', '/api/funnels', { name: 'Leaky', template: 'optin' })).body;
  await c('POST', `/api/funnels/${id}/publish`);
  const f = (await c('GET', `/api/funnels/${id}`)).body;
  const [optin, thanks] = f.steps;
  const form = optin.blocks.find((b) => b.type === 'form');
  for (let i = 0; i < 10; i++) await fetch(`${base}/f/${f.slug}`);
  for (let i = 0; i < 3; i++) await fetch(`${base}/f/${f.slug}/optin/optin`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ block: form.id, email: `v${i}@example.com` }) });
  const flow = (await c('GET', `/api/funnels/${id}/flow`)).body;
  assert.deepEqual(flow.levers, { [optin.id]: 'lead', [thanks.id]: 'continuity' });
  const e = flow.edges.find((x) => x.from === optin.id);
  assert.deepEqual([e.visitors, e.went_on, e.plain], [10, 3, '3 of every 10 go on']);
  assert.equal(flow.leak.step_id, optin.id);
  assert.match(flow.leak.suggestion, /Ask only for an email/);
});

test('order bump adds a second item to the same payment; testimonial block renders', async () => {
  const c = await setup('fk-bump@example.com');
  const main = (await c('POST', '/api/products', { name: 'Mug', price: 30 })).body;
  const bump = (await c('POST', '/api/products', { name: 'Coaster set', price: 12, description: 'Four cork coasters' })).body;
  const { id } = (await c('POST', '/api/funnels', { name: 'Bumpy', template: 'pricing' })).body;
  const f = (await c('GET', `/api/funnels/${id}`)).body;
  const [page] = f.steps;
  const pricing = page.blocks.find((b) => b.type === 'pricing');
  await c('PUT', `/api/steps/${page.id}`, { blocks: [{ ...pricing, productId: main.id, bumpProductId: bump.id, bumpLabel: 'Add matching coasters' },
    { id: 't', type: 'testimonial', quote: 'Best mug I own.', name: 'Ann', detail: 'Austin' }] });
  await c('POST', `/api/funnels/${id}/publish`);
  const html = (await client()('GET', `/f/${f.slug}`)).body;
  assert.match(html, /class="bump"[\s\S]*Add matching coasters[\s\S]*\$12/);
  assert.match(html, /<blockquote>“Best mug I own\.”<\/blockquote><figcaption>Ann · <span>Austin<\/span>/);

  const buy = await fetch(`${base}/f/${f.slug}/${page.slug}/buy`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ block: pricing.id, bump: '1' }) });
  assert.equal(buy.status, 303);
  const [order] = (await c('GET', '/api/orders')).body;
  assert.equal(order.amount_cents, 4200);
  assert.equal(order.product_name, 'Mug + Coaster set');
  // Without ticking the box, only the main product.
  await fetch(`${base}/f/${f.slug}/${page.slug}/buy`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ block: pricing.id }) });
  assert.equal((await c('GET', '/api/orders')).body[0].amount_cents, 3000);
});
