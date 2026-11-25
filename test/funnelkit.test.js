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
    { id: 'v', type: 'video', url: 'https://example.com/my-video' },
    { id: 'btn', type: 'button', label: 'Read more', url: 'javascript:alert(1)' },
    { id: 'img', type: 'image', url: 'https://img.example/a.png', alt: '' }] });
  const pre = (await c('GET', `/api/funnels/${id}/preflight`)).body;
  assert.equal(pre.ready, false);
  const texts = pre.problems.map((p) => `${p.severity}: ${p.text}`);
  assert.ok(texts.includes('block: A buy button on “Pricing” has no product.'));
  assert.ok(texts.includes('block: The video link on “Pricing” isn’t a YouTube or Vimeo link.'));
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
  assert.equal(now.blocks[0].type, 'hero');
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
  const ann = (await c('POST', '/api/contacts', { email: 'ann@example.com', first_name: 'Ann' })).body;
  const t = (await c('POST', '/api/testimonials', { person_id: ann.id, quote: 'Best mug I own.', name: 'Ann', detail: 'Austin', consent: true })).body;
  await c('PUT', `/api/steps/${page.id}`, { blocks: [{ ...pricing, productId: main.id, bumpProductId: bump.id, bumpLabel: 'Add matching coasters' },
    { id: 't', type: 'testimonial', testimonialId: t.id }] });
  await c('POST', `/api/funnels/${id}/publish`);
  const html = (await client()('GET', `/f/${f.slug}`)).body;
  assert.match(html, /class="bump"[\s\S]*Add matching coasters[\s\S]*\$12/);
  assert.match(html, /<blockquote>Best mug I own\.<\/blockquote>[\s\S]*?<b>Ann<\/b><span>Austin<\/span>/);

  const buy = await fetch(`${base}/f/${f.slug}/${page.slug}/buy`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ block: pricing.id, bump: '1' }) });
  assert.equal(buy.status, 303);
  const [order] = (await c('GET', '/api/orders')).body;
  assert.equal(order.amount_cents, 4200);
  assert.equal(order.product_name, 'Mug + Coaster set');
  // Without ticking the box, only the main product.
  await fetch(`${base}/f/${f.slug}/${page.slug}/buy`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ block: pricing.id }) });
  assert.equal((await c('GET', '/api/orders')).body[0].amount_cents, 3000);
});

test('a page that promises a free guide needs the file before it can go live', async () => {
  const prev = process.env.PREFLIGHT_PROMISES;
  process.env.PREFLIGHT_PROMISES = 'on';
  try {
    const c = await setup('fk-promise@example.com');
    const { id } = (await c('POST', '/api/funnels', { name: 'Guide', template: 'optin' })).body;
    let pre = (await c('GET', `/api/funnels/${id}/preflight`)).body;
    assert.equal(pre.ready, false);
    const p = pre.problems.find((x) => /no file to send/.test(x.text));
    assert.ok(p, 'flags the missing guide');
    assert.match(p.fix.href, /#\/editor\/\d+/);
    const f = (await c('GET', `/api/funnels/${id}`)).body;
    const s = f.steps[0];
    await c('PUT', `/api/steps/${s.id}`, { blocks: s.blocks.map((b) => (b.type === 'form' ? { ...b, deliverUrl: 'https://files.example/guide.pdf' } : b)) });
    pre = (await c('GET', `/api/funnels/${id}/preflight`)).body;
    assert.ok(!pre.problems.some((x) => /no file to send/.test(x.text)));
  } finally { process.env.PREFLIGHT_PROMISES = prev; }
});

test('testimonials carry a photo and title; a row shows the chosen ones in order', async () => {
  const c = await setup('fk-testi@example.com');
  const a = (await c('POST', '/api/testimonials', { quote: 'First words.', name: 'Ann B.', consent: true })).body;
  const b = (await c('POST', '/api/testimonials', { quote: 'Second words.', name: 'Bo C.', detail: 'Owner, Bloom', consent: true, photo: 'javascript:alert(1)' })).body;
  assert.equal(b.photo, '', 'only real image links are kept');
  const u = (await c('PUT', `/api/testimonials/${a.id}`, { detail: 'Chef', photo: 'https://img.example/ann.jpg' })).body;
  assert.equal(u.detail, 'Chef'); assert.equal(u.photo, 'https://img.example/ann.jpg'); assert.equal(u.quote, 'First words.');
  const { id } = (await c('POST', '/api/funnels', { name: 'Proof', template: 'blank' })).body;
  const f = (await c('GET', `/api/funnels/${id}`)).body;
  await c('PUT', `/api/steps/${f.steps[0].id}`, { blocks: [{ id: 'r', type: 'reviews', limit: 2, pick: [b.id, a.id] }] });
  assert.equal((await c('POST', `/api/funnels/${id}/publish`)).status, 200);
  const html = await (await fetch(`${base}/f/${f.slug}`)).text();
  assert.match(html, /class="tcards n2"/);
  assert.ok(html.indexOf('Second words.') < html.indexOf('First words.'), 'in the order chosen');
  assert.match(html, /<img class="tc-ph" src="https:\/\/img\.example\/ann\.jpg"/);
  assert.match(html, /<b>Bo C\.<\/b><span>Owner, Bloom<\/span>/);
});

test('click tracking: live pages record clicks and how far visits read; the editor gets the numbers', async () => {
  const c = await setup('fk-clicks@example.com');
  const { id } = (await c('POST', '/api/funnels', { name: 'Clicky', template: 'optin' })).body;
  const f = (await c('GET', `/api/funnels/${id}`)).body;
  const s = f.steps[0];
  const t = (body) => fetch(`${base}/f/${f.slug}/${s.slug}/t`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  // Drafts don't count.
  assert.equal((await t({ k: 'c', l: 'Send me the guide', b: 1, v: 'aaa' })).status, 204);
  assert.equal((await c('GET', `/api/steps/${s.id}/clicks`)).body.clicks.length, 0);
  assert.equal((await c('POST', `/api/funnels/${id}/publish`)).status, 200);
  const html = await (await fetch(`${base}/f/${f.slug}`)).text();
  assert.match(html, /rilly_click/);
  assert.match(html, /data-bi="0"/);
  await fetch(`${base}/f/${f.slug}`); // a second view
  await t({ k: 'c', l: 'Send me the guide', b: 1, v: 'aaa' });
  await t({ k: 'c', l: 'Send me the guide', b: 1, v: 'aaa' });
  await t({ k: 'c', l: '  Send   me the guide ', b: 1, v: 'bbb' });
  await t({ k: 'r', b: 3, v: 'aaa' }); await t({ k: 'r', b: 1, v: 'aaa' }); await t({ k: 'r', b: 1, v: 'bbb' });
  await t({ k: 'c', l: '', b: 1, v: 'ccc' }); await t({ k: 'x', v: 'ddd' }); // ignored
  const st = (await c('GET', `/api/steps/${s.id}/clicks`)).body;
  assert.equal(st.views, 2);
  assert.deepEqual(st.clicks.map((x) => [x.block, x.label, x.clicks, x.people]), [[1, 'Send me the guide', 3, 2]]);
  assert.equal(st.tracked, 2);
  assert.deepEqual(st.reached.slice(0, 4), [2, 2, 1, 1], 'the deepest point each visit reached counts once');
  // Another business can't read them.
  const other = await setup('fk-clicks2@example.com');
  assert.equal((await other('GET', `/api/steps/${s.id}/clicks`)).status, 404);
});

test('analytics: visits, sign-ups and clicks against the period before; sources, pages, clicks and devices; robots are not visits', async () => {
  const c = await setup('fk-analytics@example.com');
  const { id } = (await c('POST', '/api/funnels', { name: 'Shop', template: 'optin' })).body;
  const f = (await c('GET', `/api/funnels/${id}`)).body;
  assert.equal((await c('POST', `/api/funnels/${id}/publish`)).status, 200);
  const phone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148';
  await fetch(`${base}/f/${f.slug}`, { headers: { 'user-agent': phone } });
  await fetch(`${base}/f/${f.slug}`, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/120' } });
  await fetch(`${base}/f/${f.slug}`, { headers: { 'user-agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)' } });
  const s = f.steps[0];
  await fetch(`${base}/f/${f.slug}/${s.slug}/t`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ k: 'c', l: 'Send me the guide', b: 1, v: 'x1' }) });
  const a = (await c('GET', '/api/analytics?range=7d')).body;
  assert.equal(a.current.visits, 2, 'the robot is not a visit');
  assert.equal(a.current.clicks, 1);
  assert.equal(a.previous.visits, 0);
  assert.equal(a.series.length, 7, 'one point per day');
  assert.equal(a.series.reduce((t, x) => t + x.visits, 0), 2);
  assert.deepEqual(a.devices.map((d) => d.device).sort(), ['computer', 'phone']);
  assert.equal(a.pages[0].step_id, s.id); assert.equal(a.pages[0].visits, 2);
  assert.equal(a.clicks[0].label, 'Send me the guide'); assert.equal(a.clicks[0].rate, 0.5);
  assert.equal(a.sources[0].source, 'Direct');
  assert.equal((await c('GET', '/api/analytics?range=bogus')).body.range, '30d');
});

test('products shelf: cards for the chosen products, each buy button orders its own product, and only those', async () => {
  const c = await setup('fk-shelf@example.com');
  const a = (await c('POST', '/api/products', { name: 'Smith Corona', price: '495', currency: 'usd', billing: 'one_time' })).body;
  const g = (await c('POST', '/api/products', { name: 'Field Guide', price: '19.95', currency: 'usd', billing: 'one_time' })).body;
  const h = (await c('POST', '/api/products', { name: 'Hidden', price: '5', currency: 'usd', billing: 'one_time' })).body;
  const { id } = (await c('POST', '/api/funnels', { name: 'Shelf', template: 'blank' })).body;
  const f = (await c('GET', `/api/funnels/${id}`)).body;
  const s = f.steps[0];
  await c('PUT', `/api/steps/${s.id}`, { blocks: [{ id: 'shelf', type: 'products', title: 'Shop', pick: [g.id, a.id], button: 'Buy now' }] });
  assert.equal((await c('POST', `/api/funnels/${id}/publish`)).status, 200);
  const html = await (await fetch(`${base}/f/${f.slug}`)).text();
  assert.ok(html.indexOf('Field Guide') < html.indexOf('Smith Corona'), 'in the order chosen');
  assert.doesNotMatch(html, /Hidden/);
  assert.match(html, /\$19\.95/);
  const buy = (pid) => fetch(`${base}/f/${f.slug}/${s.slug}/buy`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ block: 'shelf', product: String(pid) }) });
  assert.equal((await buy(g.id)).status, 303);
  assert.equal((await buy(h.id)).status, 404, 'not on this shelf');
  const orders = (await c('GET', '/api/orders')).body;
  assert.deepEqual(orders.map((o) => [o.product_name, o.amount_cents]), [['Field Guide', 1995]]);
});

test('a product page in one click: filled in from the product, linked from the shop shelf once live', async () => {
  const c = await setup('fk-prodpage@example.com');
  const p = (await c('POST', '/api/products', { name: 'Antinet "Field" Book', price: '19.95', currency: 'usd', billing: 'one_time', description: 'The 594-page hardcover.', image_url: 'https://img.example/book.jpg' })).body;
  const r = await c('POST', `/api/products/${p.id}/page`);
  assert.equal(r.status, 201);
  assert.equal((await c('POST', `/api/products/${p.id}/page`)).body.id, r.body.id, 'a second click opens the same page');
  const f = (await c('GET', `/api/funnels/${r.body.id}`)).body;
  const blocks = f.steps[0].blocks;
  const hero = blocks.find((b) => b.type === 'hero');
  assert.equal(hero.text, 'Antinet "Field" Book');
  assert.equal(hero.image, 'https://img.example/book.jpg');
  assert.equal(hero.subtext, 'The 594-page hardcover.');
  assert.equal(blocks.find((b) => b.type === 'pricing').productId, p.id);
  assert.equal(f.steps[0].settings.font, 'penpal');
  assert.ok(blocks.some((b) => b.type === 'letter') && blocks.some((b) => b.type === 'cards' && b.style === 'pastel stack'));
  // A shelf elsewhere links to the page once it's live.
  const shop = (await c('POST', '/api/funnels', { name: 'Shop', template: 'blank' })).body;
  const sf = (await c('GET', `/api/funnels/${shop.id}`)).body;
  await c('PUT', `/api/steps/${sf.steps[0].id}`, { blocks: [{ id: 's', type: 'products', pick: [], button: 'Buy now' }] });
  await c('POST', `/api/funnels/${shop.id}/publish`);
  assert.doesNotMatch(await (await fetch(`${base}/f/${sf.slug}`)).text(), /See details/, 'not while its page is a draft');
  const pre = await c('POST', `/api/funnels/${f.id}/publish`);
  assert.equal(pre.status, 200, JSON.stringify(pre.body));
  assert.match(await (await fetch(`${base}/f/${sf.slug}`)).text(), new RegExp(`href="/f/${f.slug}">See details`));
});

test('prestige site: photo banner, tiles, events (past dates hidden), logos, quote slider, motion and phone button', async () => {
  const c = await setup('fk-prestige@example.com');
  await c('POST', '/api/testimonials', { quote: 'Worth every minute.', name: 'Ann B.', consent: true });
  await c('POST', '/api/testimonials', { quote: 'Paid for itself.', name: 'Bo C.', consent: true });
  const site = (await c('POST', '/api/websites', { name: 'Jordan Reyes', template: 'personal' })).body;
  const f = (await c('GET', `/api/funnels/${site.id}`)).body;
  assert.deepEqual(f.steps.map((s) => s.slug), ['home', 'about', 'events', 'contact']);
  const home = f.steps[0];
  assert.equal(home.settings.font, 'prestige'); assert.equal(home.settings.motion, true);
  const blocks = home.blocks.map((b) => (b.type === 'events' ? { ...b, items: 'Mar 14 2099 | Austin, TX | Offer Lab Live | #\nJan 3 2001 | Old Town | Long gone | #\nSpring | Online | Date to come | #' }
    : b.type === 'logos' ? { ...b, logo0: '/u/a.png', logo1: 'javascript:x' } : b.type === 'tiles' ? { ...b, img0: 'https://img.example/t.jpg' } : b));
  await c('PUT', `/api/steps/${home.id}`, { blocks });
  assert.equal((await c('POST', `/api/funnels/${site.id}/publish`)).status, 200);
  const html = await (await fetch(`${base}/f/${f.slug}`)).text();
  assert.match(html, /class="hphoto first no-img"/);
  assert.match(html, /class="hp-sig"/);
  assert.match(html, /<div class="tiles n3"><div class="tile"><img src="https:\/\/img\.example\/t\.jpg"/);
  assert.match(html, /<span>MAR<\/span><b>14<\/b>/); assert.match(html, /Offer Lab Live/);
  assert.ok(!html.includes('Long gone'), 'a date with a year that has passed is hidden');
  assert.match(html, /ev-free[^>]*>Spring</);
  assert.match(html, /<div class="logos gray"><img src="\/u\/a\.png"[^>]*><\/div>/, 'a bad link is left out');
  assert.match(html, /class="rslide"/); assert.match(html, /rs-next/); assert.match(html, /\.rs-track'\)/);
  assert.match(html, /IntersectionObserver/); assert.match(html, /prefers-reduced-motion/);
  assert.match(html, /sticky-cta/);
  assert.match(html, /url\(\/fonts\/montserrat-700i\.woff2\)/);
  // The editor preview shows past dates (marked) and never runs the motion.
  const pv = (await c('POST', '/api/preview', { blocks, settings: home.settings, name: 'Home' })).body.html;
  assert.match(pv, /Long gone/); assert.match(pv, /Past: hidden from visitors/);
  assert.ok(!pv.includes('IntersectionObserver(function'), 'no motion in the editor');
  assert.match(pv, /data-pickphoto="img1"/, 'an empty tile is a photo box for its own slot');
});

test('a flow can have a domain of its own: the whole domain is that flow, www or not; addresses can’t be shared', async () => {
  const c = await setup('fk-flowdomain@example.com');
  const { id } = (await c('POST', '/api/funnels', { name: 'Field Guide', template: 'optin' })).body;
  const f = (await c('GET', `/api/funnels/${id}`)).body;
  assert.equal((await c('PUT', `/api/funnels/${id}/domain`, { domain: 'nope' })).status, 400);
  const r = (await c('PUT', `/api/funnels/${id}/domain`, { domain: 'https://FieldGuide.test/' })).body;
  assert.equal(r.domain, 'fieldguide.test'); assert.equal(r.connected, 'manual', 'without a Netlify token it’s one step by hand');
  assert.equal((await fetch(`${base}/d/fieldguide.test/`)).status, 404, 'nothing shows until it’s published');
  await c('PUT', `/api/steps/${f.steps[0].id}`, { settings: { ...f.steps[0].settings, seoTitle: 'Field guide', seoDescription: 'Free field guide' } });
  const prev = process.env.PREFLIGHT_PROMISES; process.env.PREFLIGHT_PROMISES = 'off';
  const pub = await c('POST', `/api/funnels/${id}/publish`);
  process.env.PREFLIGHT_PROMISES = prev;
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  for (const host of ['fieldguide.test', 'www.fieldguide.test']) {
    const home = await fetch(`${base}/d/${host}/`);
    assert.equal(home.status, 200, host);
    const html = await home.text();
    assert.match(html, /<link rel="canonical" href="https:\/\/fieldguide\.test"/);
  }
  const second = f.steps.find((s) => s.id !== f.entry_step_id);
  assert.equal((await fetch(`${base}/d/fieldguide.test/${second.slug}`)).status, 200, 'its other pages sit at /their-name');
  assert.match(await (await fetch(`${base}/d/fieldguide.test/sitemap.xml`)).text(), /<loc>https:\/\/fieldguide\.test\/<\/loc>/);
  // Nobody else (and no business) can take it, in either form.
  const other = await setup('fk-flowdomain2@example.com');
  assert.equal((await other('PUT', '/api/account/domain', { domain: 'www.fieldguide.test' })).status, 409);
  const o = (await other('POST', '/api/funnels', { name: 'Copy', template: 'optin' })).body;
  assert.equal((await other('PUT', `/api/funnels/${o.id}/domain`, { domain: 'fieldguide.test' })).status, 409);
  // Taking it off: the domain stops showing it.
  assert.equal((await c('PUT', `/api/funnels/${id}/domain`, { domain: '' })).body.domain, null);
  assert.equal((await fetch(`${base}/d/fieldguide.test/`)).status, 404);
});

test('editorial launch: letter reveal, pinned steps, bento tiles, orbit and an honest note under reviews', async () => {
  const c = await setup('fk-editorial@example.com');
  await c('POST', '/api/testimonials', { quote: 'Worth every penny.', name: 'Priya S.', consent: true });
  const { id } = (await c('POST', '/api/funnels', { name: 'Launch', template: 'editorial_launch' })).body;
  const f = (await c('GET', `/api/funnels/${id}`)).body;
  const s = f.steps[0];
  assert.equal(s.settings.font, 'editorial');
  const blocks = s.blocks.map((b) => (b.type === 'reveal' ? { ...b, image: "/u/sea'(1).jpg", letter: 'tea' } : b.type === 'steps' ? { ...b, img0: '/u/a.jpg' } : b));
  await c('PUT', `/api/steps/${s.id}`, { blocks });
  const prev = process.env.PREFLIGHT_PROMISES; process.env.PREFLIGHT_PROMISES = 'off';
  assert.equal((await c('POST', `/api/funnels/${id}/publish`)).status, 200);
  process.env.PREFLIGHT_PROMISES = prev;
  const html = await (await fetch(`${base}/f/${f.slug}`)).text();
  assert.match(html, /<div class="rvl-letter" aria-hidden="true">t<\/div>/, 'one letter');
  assert.match(html, /--rv-img:url\(&#39;\/u\/sea%27%281%29\.jpg&#39;\)/, 'the picture address can’t break out of the style');
  assert.match(html, /class="stp"/); assert.match(html, /<div class="stp-pic on"><img src="\/u\/a\.jpg"/);
  assert.match(html, /class="bento n6"/); assert.match(html, /class="orb-i" style="--a:60\.0deg;--r:36"/);
  assert.match(html, /<p class="rv-note">Shared with each customer’s permission\.<\/p>/);
  assert.match(html, /REVEAL|\.rvl'\)/); assert.match(html, /stp-item/);
  assert.match(html, /url\(\/fonts\/newsreader-300\.woff2\)/);
});

test('a limited offer counts real sales, then the price really changes (or it sells out)', async () => {
  const c = await setup('fk-offer@example.com');
  assert.equal((await c('POST', '/api/products', { name: 'Guide', price: '20', offer_limit: 2, offer_after: '15' })).status, 400, 'the regular price must be higher');
  const { id: pid } = (await c('POST', '/api/products', { name: 'Field Guide', price: '20', offer_limit: 2, offer_after: '30', offer_label: 'Founder price' })).body;
  const { id: sid } = (await c('POST', '/api/products', { name: 'Signed copy', price: '50', offer_limit: 1 })).body;
  const { id } = (await c('POST', '/api/funnels', { name: 'Shop', template: 'blank' })).body;
  const f = (await c('GET', `/api/funnels/${id}`)).body;
  await c('PUT', `/api/steps/${f.steps[0].id}`, { blocks: [{ id: 'p1', type: 'pricing', productId: pid, buttonLabel: 'Buy' }, { id: 'sh', type: 'products', pick: [sid] }] });
  const prev = process.env.PREFLIGHT_PROMISES; process.env.PREFLIGHT_PROMISES = 'off';
  assert.equal((await c('POST', `/api/funnels/${id}/publish`)).status, 200);
  process.env.PREFLIGHT_PROMISES = prev;
  const page = () => fetch(`${base}/f/${f.slug}`).then((r) => r.text());
  let html = await page();
  assert.match(html, /<b>Founder price<\/b><span>0 of 2 claimed<\/span>/); assert.match(html, /Then \$30\. 2 left at this price\./);
  assert.match(html, /<div class="was">\$30<\/div>/);
  const buy = async (form) => {
    const r = await fetch(`${base}/f/${f.slug}/${f.steps[0].slug}/buy`, { method: 'POST', redirect: 'manual', body: new URLSearchParams(form) });
    if (r.status !== 303) return r;
    const loc = r.headers.get('location');
    const amount = (await (await fetch(base + loc)).text()).match(/\$\d+(\.\d\d)?/)?.[0].replace('.00', '');
    await fetch(base + loc, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ email: `b${Math.random()}@ex.com` }) });
    return { status: 303, amount };
  };
  assert.equal((await buy({ block: 'p1' })).amount, '$20');
  assert.match(await page(), /1 of 2 claimed/);
  assert.equal((await buy({ block: 'p1' })).amount, '$20');
  html = await page();
  assert.doesNotMatch(html, /Founder price/, 'once it’s over, no counter');
  assert.match(html, /<sup>\$<\/sup>30/, 'the regular price shows');
  assert.equal((await buy({ block: 'p1' })).amount, '$30', 'and is what they pay');
  // No regular price: it sells out, on the page and at the till.
  assert.match(html, /0 of 1 claimed/);
  assert.equal((await buy({ block: 'sh', product: String(sid) })).status, 303);
  html = await page();
  assert.match(html, /<b>Sold out<\/b><small>All 1 were claimed\.<\/small>/);
  const r = await buy({ block: 'sh', product: String(sid) });
  assert.equal(r.status, 410); assert.match(await r.text(), /sold out/);
  assert.equal((await c('GET', '/api/products')).body.find((p) => p.id === sid).claimed, 1);
});

test('block motion: chosen per block, played on the live page, never hiding anything in the editor', async () => {
  const { renderPage } = require('../src/render');
  const blocks = [{ id: 'h', type: 'heading', text: 'Hi', anim: 'left', animSpeed: 'quick' }, { id: 'c', type: 'cards', items: 'A | a\nB | b', anim: 'pop', animOut: 'fade', animLoop: 'tilt' },
    { id: 't', type: 'text', text: 'x', anim: '"><script>', animLoop: 'bogus' }];
  const live = renderPage({ title: 'x', blocks, trackAction: '/t' });
  assert.match(live, /<div data-bi="0" data-anim="left" data-speed="quick">/);
  assert.match(live, /<div data-bi="1" data-anim="pop" data-out="fade" data-loop="tilt">/);
  assert.match(live, /<div data-bi="2">/, 'only known motions get through');
  assert.match(live, /IntersectionObserver/); assert.match(live, /prefers-reduced-motion: reduce/);
  const pv = renderPage({ title: 'x', blocks, preview: true });
  assert.match(pv, /d\.ff!=='play'/); assert.doesNotMatch(pv, /classList\.add\('an-pre'\)\}\)/, 'the editor never hides blocks on load');
  assert.doesNotMatch(renderPage({ title: 'x', blocks: [{ id: 'h', type: 'heading', text: 'Hi' }] }), /data-anim|an-pre/, 'no motion, no script');
});
