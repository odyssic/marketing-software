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
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, body: type.includes('json') ? await res.json() : await res.text() };
  };
}

test('website templates: menu, footer, page links, contact inquiries, menu order, bundled workflow', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Web', email: 'web@example.com', password: 'password123' });
  const t = (await c('GET', '/api/website-templates')).body;
  assert.deepEqual(t.map((x) => x.key), ['coach', 'services', 'restaurant', 'shop', 'wellness']);
  assert.deepEqual(t.find((x) => x.key === 'services').pages, ['Home', 'Services', 'About', 'Reviews', 'Get a quote']);
  assert.equal((await c('POST', '/api/websites', { name: '' })).status, 400);

  const site = (await c('POST', '/api/websites', { name: 'Green Lawn Co', template: 'services' })).body;
  assert.equal(site.workflows.length, 1);
  assert.deepEqual((await c('GET', '/api/websites')).body.map((s) => [s.name, s.pages]), [['Green Lawn Co', 5]]);
  assert.deepEqual((await c('GET', '/api/funnels')).body, []); // websites aren't listed as funnels
  const pre = (await c('GET', `/api/funnels/${site.id}/preflight`)).body;
  assert.equal(pre.ready, true, JSON.stringify(pre.problems));
  await c('POST', `/api/funnels/${site.id}/publish`);
  const f = (await c('GET', `/api/funnels/${site.id}`)).body;

  const home = (await fetch(`${base}/f/${f.slug}`)).text ? await (await fetch(`${base}/f/${f.slug}`)).text() : '';
  assert.match(home, /<header class="site">[\s\S]*Green Lawn Co[\s\S]*href="\/f\/green-lawn-co\/services">Services<\/a>/);
  assert.match(home, /<a href="\/f\/green-lawn-co" aria-current="page">Home<\/a>/);
  assert.match(home, /href="\/f\/green-lawn-co\/quote">Get a free quote/); // page: link resolved
  assert.match(home, /<footer class="site">/);
  assert.match(home, /class="cards"/);

  // The quote form logs an inquiry with the message.
  const quote = f.steps.find((s) => s.slug === 'quote');
  const form = quote.blocks.find((b) => b.type === 'form');
  const r = await fetch(`${base}/f/${f.slug}/quote/optin`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ block: form.id, email: 'neighbor@example.com', first_name: 'Ned', message: 'Weekly mowing, half acre' }) });
  assert.ok([200, 303].includes(r.status));
  const ned = (await c('GET', '/api/contacts')).body[0];
  assert.equal((await c('GET', `/api/people/${ned.id}`)).body.events[0].meta.note, 'Weekly mowing, half acre');

  // Reorder the menu: Reviews first becomes the home page.
  const ids = f.steps.map((s) => s.id);
  const reviews = f.steps.find((s) => s.slug === 'reviews').id;
  await c('PUT', `/api/websites/${site.id}/order`, { ids: [reviews, ...ids.filter((x) => x !== reviews)] });
  assert.match(await (await fetch(`${base}/f/${f.slug}`)).text(), /What neighbors say/);
  // A broken page link blocks publishing.
  await c('PUT', `/api/steps/${reviews}`, { blocks: [{ id: 'x', type: 'button', label: 'Go', url: 'page:nowhere' }] });
  assert.equal((await c('GET', `/api/funnels/${site.id}/preflight`)).body.ready, false);
});
