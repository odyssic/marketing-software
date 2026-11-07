// Blog: posts written with email marks, published to readable, searchable pages.
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
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    const t = res.headers.get('content-type') || '';
    return { status: res.status, type: t, headers: res.headers, body: t.includes('json') ? await res.json() : await res.text() };
  };
}
const ld = (html) => JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
const BODY = 'Typewriters are back, and for good reason.\n\n## Why a typewriter\n\nNo notifications, no tabs. **Just you and the page.** Read [our guide](https://example.com/guide).\n\n![A green Olivetti](https://example.com/olivetti.jpg)\n\n[Shop the collection](https://example.com/shop)';

test('write, publish and read a post; drafts stay private', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Ada Lovelace', email: 'blog@example.com', password: 'password123', workspace: 'Classic Typewriter', business_type: 'shop' });
  const p = (await c('POST', '/api/blog', { title: 'Why typewriters are back in 2026' })).body;
  assert.equal(p.status, 'draft');
  assert.equal(p.author, 'Ada Lovelace', 'author defaults to the writer');
  assert.ok(p.slug.includes('typewriters'));
  const saved = (await c('PUT', `/api/blog/${p.id}`, { body: BODY, cover: 'https://example.com/cover.jpg', tags: 'Writing, typewriters' })).body;
  assert.equal(saved.tags, 'writing, typewriters');
  assert.equal((await c('PUT', `/api/blog/${p.id}`, { cover: 'javascript:alert(1)' })).status, 400);

  const list = (await c('GET', '/api/blog')).body;
  assert.equal(list.posts.length, 1);
  const blogPath = new URL(list.rilly).pathname; // /blog/<id>-classic-typewriter
  assert.match(blogPath, /^\/blog\/\d+-classic-typewriter$/);

  const v = client();
  assert.equal((await v('GET', `${blogPath}/${p.slug}`)).status, 404, 'drafts are not public');
  assert.doesNotMatch((await v('GET', `${blogPath}/`)).body, /Why typewriters/, 'drafts are not listed');
  const preview = await c('GET', `${blogPath}/${p.slug}`);
  assert.equal(preview.status, 200, 'the owner can preview a draft');
  assert.match(preview.body, /noindex/);

  // Search title for the post, from its own words.
  const sug = (await c('POST', `/api/blog/${p.id}/seo`)).body;
  assert.ok(sug.title && sug.description && sug.slug);

  const pub = (await c('POST', `/api/blog/${p.id}/publish`)).body;
  assert.equal(pub.status, 'published');
  assert.ok(pub.published_at && pub.seo_title && pub.seo_description, 'search details filled on publish');
  assert.equal(pub.summary, 'Typewriters are back, and for good reason. No notifications, no tabs. Just you and the page. Read our guide.');

  const page = await v('GET', `${blogPath}/${p.slug}`);
  assert.equal(page.status, 200);
  assert.match(page.body, /<h1>Why typewriters are back in 2026<\/h1>/);
  assert.match(page.body, /<h2[^>]*>Why a typewriter<\/h2>/, 'headings from ## marks');
  assert.match(page.body, /<b>Just you and the page.<\/b>/);
  assert.match(page.body, /<img src="https:\/\/example.com\/olivetti.jpg" alt="A green Olivetti"/);
  assert.match(page.body, /min read/);
  assert.match(page.body, new RegExp(`<link rel="canonical" href="[^"]*${blogPath}/${p.slug}">`));
  assert.match(page.body, /<meta property="og:type" content="article">/);
  assert.match(page.body, /<meta property="og:image" content="https:\/\/example.com\/cover.jpg">/);
  const post = ld(page.body);
  assert.equal(post['@type'], 'BlogPosting');
  assert.equal(post.headline, 'Why typewriters are back in 2026');
  assert.equal(post.author.name, 'Ada Lovelace');
  assert.equal(post.publisher.name, 'Classic Typewriter');
  assert.ok(post.datePublished && post.dateModified);
  assert.deepEqual(post.image, ['https://example.com/cover.jpg']);
  assert.doesNotMatch(page.body, /<script>alert/);

  await v('GET', `${blogPath}/${p.slug}`);
  assert.equal((await c('GET', `/api/blog/${p.id}`)).body.views, 2, 'each visit counts');

  const index = await v('GET', `${blogPath}/`);
  assert.match(index.body, /Why typewriters are back in 2026/);
  assert.equal(ld(index.body)['@type'], 'Blog');
  assert.equal((await v('GET', blogPath)).status, 301, 'the index lives at a trailing slash');

  const feed = await v('GET', `${blogPath}/feed.xml`);
  assert.match(feed.type, /rss\+xml/);
  assert.match(feed.body, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<rss version="2.0"/);
  assert.match(feed.body, /<item>\s*<title>Why typewriters are back in 2026<\/title>/);
  assert.match(feed.body, /<pubDate>[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4}/);
  assert.equal((feed.body.match(/<item>/g) || []).length, (feed.body.match(/<\/item>/g) || []).length);

  // A second post links back as "keep reading"; unpublishing hides it again.
  const p2 = (await c('POST', '/api/blog', { title: 'Caring for your ribbon' })).body;
  await c('PUT', `/api/blog/${p2.id}`, { body: 'Store it cool and dry.', tags: 'typewriters' });
  await c('POST', `/api/blog/${p2.id}/publish`);
  assert.match((await v('GET', `${blogPath}/${p2.slug}`)).body, /Keep reading[\s\S]*Why typewriters are back/);
  await c('POST', `/api/blog/${p2.id}/unpublish`);
  assert.equal((await v('GET', `${blogPath}/${p2.slug}`)).status, 404);
  assert.equal((await c('DELETE', `/api/blog/${p2.id}`)).status, 200);
  assert.equal((await c('GET', `/api/blog/${p2.id}`)).status, 404);

  // Another business can't touch these posts.
  const o = client();
  await o('POST', '/api/auth/signup', { name: 'Other', email: 'other-blog@example.com', password: 'password123', workspace: 'Other Co', business_type: 'shop' });
  assert.equal((await o('GET', `/api/blog/${p.id}`)).status, 404);
  assert.equal((await o('PUT', `/api/blog/${p.id}`, { title: 'Hacked' })).status, 404);
  assert.equal((await o('GET', '/api/blog')).body.posts.length, 0);
});

test('on a custom domain the blog lives at /blog, with posts in the sitemap, llms.txt and a lead page call to action', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Wren', email: 'wren-blog@example.com', password: 'password123', workspace: 'Wren Blog Studio', business_type: 'services' });
  const site = (await c('POST', '/api/websites', { name: 'Wren Blog Studio', template: 'studio' })).body;
  await c('POST', `/api/funnels/${site.id}/publish`);
  const acct = (await c('GET', '/api/me')).body.account.id;
  await app.getDb().run('UPDATE accounts SET domain = ?, home_funnel_id = ? WHERE id = ?', 'wrenblog.test', site.id, acct);
  const v = client();
  // Before anything is published, /blog is just another address on the site.
  assert.doesNotMatch((await v('GET', '/d/wrenblog.test/sitemap.xml')).body, /\/blog/);

  const p = (await c('POST', '/api/blog', { title: 'How we plan a brand in a week' })).body;
  await c('PUT', `/api/blog/${p.id}`, { body: 'It starts with one honest conversation.\n\n## Day one\n\nWe listen.' });
  await c('POST', `/api/blog/${p.id}/publish`);
  const draft = (await c('POST', '/api/blog', { title: 'Secret draft' })).body;

  const index = await v('GET', '/d/wrenblog.test/blog');
  assert.equal(index.status, 200);
  assert.match(index.body, /How we plan a brand in a week/);
  assert.match(index.body, /href="\/blog\/[a-z0-9-]+"/, 'post links stay on the domain');
  const page = await v('GET', `/d/wrenblog.test/blog/${p.slug}`);
  assert.equal(page.status, 200);
  assert.match(page.body, new RegExp(`<link rel="canonical" href="https://wrenblog.test/blog/${p.slug}">`));
  assert.equal(ld(page.body).url, `https://wrenblog.test/blog/${p.slug}`);
  assert.match(page.body, /class="cta"[\s\S]*href="\/"/, 'a call to action back to the home site');
  assert.equal((await v('GET', `/d/wrenblog.test/blog/${draft.slug}`)).status, 404);
  assert.match((await v('GET', '/d/wrenblog.test/blog/feed.xml')).body, /<link>https:\/\/wrenblog.test\/blog\/[a-z0-9-]+<\/link>/);

  const map = (await v('GET', '/d/wrenblog.test/sitemap.xml')).body;
  assert.match(map, /<loc>https:\/\/wrenblog.test\/blog<\/loc>/);
  assert.match(map, new RegExp(`<loc>https://wrenblog.test/blog/${p.slug}</loc><lastmod>`));
  assert.doesNotMatch(map, /secret/);
  assert.match(map, /<loc>https:\/\/wrenblog.test<\/loc>/, 'site pages still listed');
  const llms = (await v('GET', '/d/wrenblog.test/llms.txt')).body;
  assert.match(llms, new RegExp(`\\[How we plan a brand in a week\\]\\(https://wrenblog.test/blog/${p.slug}\\)`));

  // A lead page with a form becomes the call to action.
  const f = (await c('POST', '/api/funnels', { name: 'Guide', template: 'elegant_guide' })).body;
  await c('POST', `/api/funnels/${f.id}/publish`);
  f.slug = (await c('GET', `/api/funnels/${f.id}`)).body.slug;
  const withLead = (await v('GET', `/d/wrenblog.test/blog/${p.slug}`)).body;
  assert.match(withLead, new RegExp(`class="cta"[\\s\\S]*href="/${f.slug}"`));
});
