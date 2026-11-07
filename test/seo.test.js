// Search and AI search: titles, descriptions, addresses, page markup and site files.
process.env.ALLOW_SIGNUPS = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const seo = require('../src/seo');

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
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    const t = res.headers.get('content-type') || '';
    return { status: res.status, type: t, body: t.includes('json') ? await res.json() : await res.text() };
  };
}

test('without AI: a title, description and address from the page’s own words', () => {
  const blocks = [{ type: 'hero', text: 'The Magnificent 7: classic typewriters worth owning', subtext: 'A short guide to seven machines that type like a dream, and what to pay for each. Yours free.' }, { type: 'form', buttonLabel: 'Send me the guide' }];
  const g = seo.ruleBased({ business: 'Classic Typewriter', pageName: 'Free guide', blocks, isHome: false });
  assert.ok(g.title.length <= 60, g.title);
  assert.match(g.title, /Magnificent 7/);
  assert.ok(g.description.length <= 158 && g.description.length >= 50, g.description);
  assert.equal(g.slug, 'magnificent-7-classic-typewriters-worth');
  assert.doesNotMatch(seo.ruleBased({ business: 'B', pageName: 'P', blocks: [{ type: 'hero', text: 'Hi {{first_name}} [your town]' }] }).title, /\{\{|\[/, 'no fill-in fields or placeholders');
});

test('publishing fills missing titles; pages carry canonical, sharing and structured data', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Se', email: 'se@example.com', password: 'password123', workspace: 'Classic Typewriter', business_type: 'shop' });
  const f = (await c('POST', '/api/funnels', { name: 'Guide', template: 'elegant_guide' })).body;
  const full = (await c('GET', `/api/funnels/${f.id}`)).body;
  const st = full.steps.find((s) => s.id === full.entry_step_id);
  const sug = (await c('POST', `/api/steps/${st.id}/seo`)).body;
  assert.ok(sug.title && sug.description && sug.slug);
  assert.equal(sug.live, false);

  await c('POST', `/api/funnels/${f.id}/publish`);
  const after = (await c('GET', `/api/funnels/${f.id}`)).body.steps.find((s) => s.id === st.id);
  assert.ok(after.settings.seoTitle, 'title filled on publish');
  assert.ok(after.settings.seoDescription, 'description filled on publish');

  const html = (await client()('GET', `/f/${full.slug}`)).body;
  assert.match(html, /<link rel="canonical" href="[^"]*\/f\/[^"]+">/);
  assert.match(html, /<meta property="og:title" content="[^"]+">/);
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(ld['@graph'][0]['@type'], 'WebPage');
  assert.equal(ld['@graph'][1].name, 'Classic Typewriter');
  assert.match((await client()('GET', `/f/${full.slug}?embed=1`)).body, /<meta name="robots" content="noindex">/, 'embedded copies stay out of search');
});

test('a custom domain gets a sitemap, robots rules and llms.txt', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Do', email: 'do@example.com', password: 'password123', workspace: 'Wren Studio', business_type: 'services' });
  const site = (await c('POST', '/api/websites', { name: 'Wren Studio', template: 'studio' })).body;
  await c('POST', `/api/funnels/${site.id}/publish`);
  const acct = (await c('GET', '/api/me')).body.account.id;
  await app.getDb().run('UPDATE accounts SET domain = ?, home_funnel_id = ? WHERE id = ?', 'wren.test', site.id, acct);
  const v = client();
  const map = await v('GET', '/d/wren.test/sitemap.xml');
  assert.match(map.type, /xml/);
  assert.match(map.body, /<loc>https:\/\/wren.test<\/loc>/);
  assert.match(map.body, /<loc>https:\/\/wren.test\/contact<\/loc>/);
  assert.match((await v('GET', '/d/wren.test/robots.txt')).body, /Sitemap: https:\/\/wren.test\/sitemap.xml/);
  const llms = (await v('GET', '/d/wren.test/llms.txt')).body;
  assert.match(llms, /^# Wren Studio/);
  assert.match(llms, /\(https:\/\/wren.test\/about\)/);
});
