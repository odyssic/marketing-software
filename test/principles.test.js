process.env.ALLOW_SIGNUPS = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { renderPage } = require('../src/render');
const { SITE_TEMPLATES } = require('../src/sites');
const { TEMPLATES } = require('../src/templates');

let app, server, base;
before(async () => {
  app = createApp({ dbPath: ':memory:' });
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
const post = (path, form) => fetch(base + path, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) });

test('no invented social proof: templates hold no quotes; testimonials are real, permitted, approved records', async () => {
  // No template, website or funnel, carries a made-up testimonial.
  for (const t of [...Object.values(SITE_TEMPLATES), ...Object.values(TEMPLATES)]) {
    for (const st of t.steps()) for (const b of st.blocks) assert.ok(!(b.type === 'testimonial' && b.quote), `${st.name} has an invented quote`);
  }
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Pat', email: 'pat@example.com', password: 'password123', workspace: 'Pat’s Pottery' });
  assert.equal((await c('POST', '/api/testimonials', { quote: 'Great!', name: 'Anon' })).status, 400); // needs consent
  const site = (await c('POST', '/api/websites', { name: 'Pat’s Pottery', template: 'services' })).body;
  await c('POST', `/api/funnels/${site.id}/publish`);
  const f = (await c('GET', `/api/funnels/${site.id}`)).body;
  const reviewsPage = f.steps.find((s) => s.slug === 'reviews');
  assert.doesNotMatch(await (await fetch(`${base}/f/${f.slug}/reviews`)).text(), /<blockquote>/); // nothing to show yet
  const form = reviewsPage.blocks.find((b) => b.type === 'form');
  await post(`/f/${f.slug}/reviews/optin`, { block: form.id, email: 'rae@example.com', first_name: 'Rae', message: 'Lovely work, on time.', share: '1' });
  await post(`/f/${f.slug}/reviews/optin`, { block: form.id, email: 'priv@example.com', first_name: 'Priv', message: 'Keep this private.' });
  const list = (await c('GET', '/api/testimonials')).body;
  assert.deepEqual(list.map((t) => [t.name, t.quote, t.approved, t.source]), [['Rae', 'Lovely work, on time.', false, 'review form']]);
  assert.doesNotMatch(await (await fetch(`${base}/f/${f.slug}/reviews`)).text(), /Lovely work/); // waits for approval
  await c('PUT', `/api/testimonials/${list[0].id}`, { approved: true });
  assert.match(await (await fetch(`${base}/f/${f.slug}/reviews`)).text(), /<blockquote>“Lovely work, on time\.”<\/blockquote>/);
  // A testimonial block typed in by hand (not a record) renders nothing.
  assert.doesNotMatch(renderPage({ title: 't', blocks: [{ type: 'testimonial', quote: 'Fake praise', name: 'X' }] }), /Fake praise/);
});

test('forms start with name and email; SMS consent appears and is recorded only when SMS is added', async () => {
  const plain = renderPage({ title: 't', blocks: [{ id: 'f', type: 'form', collectName: true }] });
  assert.match(plain, /name="first_name"/);
  assert.match(plain, /name="email"/);
  assert.doesNotMatch(plain, /name="phone"|Msg &amp; data|name="sms_consent"/);
  const sms = renderPage({ title: 't', business: 'Pat’s Pottery', blocks: [{ id: 'f', type: 'form', collectName: true, smsOptIn: true }] });
  assert.match(sms, /name="phone"[^>]*required/);
  assert.match(sms, /name="sms_consent" value="1">(?![^<]*checked)/);
  assert.match(sms, /text me updates from Pat’s Pottery\. Msg &amp; data rates may apply[\s\S]*Reply STOP to opt out/);
  for (const t of Object.values(SITE_TEMPLATES)) for (const st of t.steps()) for (const b of st.blocks) if (b.type === 'form') assert.ok(!b.collectPhone && !b.smsOptIn, `${st.name} asks for a phone by default`);

  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Sam', email: 'sam-sms@example.com', password: 'password123' });
  const { id } = (await c('POST', '/api/funnels', { name: 'Texts', template: 'optin' })).body;
  const f = (await c('GET', `/api/funnels/${id}`)).body;
  const page = f.steps[0];
  const form = page.blocks.find((b) => b.type === 'form');
  await c('PUT', `/api/steps/${page.id}`, { blocks: page.blocks.map((b) => (b.type === 'form' ? { ...b, smsOptIn: true } : b)) });
  await c('POST', `/api/funnels/${id}/publish`);
  await post(`/f/${f.slug}/optin/optin`, { block: form.id, email: 'yes@example.com', phone: '555-0100', sms_consent: '1' });
  await post(`/f/${f.slug}/optin/optin`, { block: form.id, email: 'no@example.com', phone: '555-0101' });
  const people = (await c('GET', '/api/contacts')).body;
  assert.ok(people.find((p) => p.email === 'yes@example.com').sms_consent_at);
  assert.equal(people.find((p) => p.email === 'no@example.com').sms_consent_at, null);
  const yes = (await c('GET', `/api/people/${people.find((p) => p.email === 'yes@example.com').id}`)).body;
  assert.match(yes.events.find((e) => e.meta.format === 'sms').meta.consent, /Reply STOP to opt out/);
});

test('one place for pages: website and funnel pages together', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Pg', email: 'pages@example.com', password: 'password123' });
  await c('POST', '/api/websites', { name: 'Cafe', template: 'restaurant' });
  await c('POST', '/api/funnels', { name: 'Coupon', template: 'optin' });
  const pages = (await c('GET', '/api/pages')).body;
  assert.deepEqual([...new Set(pages.map((p) => p.kind))].sort(), ['funnel', 'website']);
  assert.equal(pages.length, 4 + 2);
  assert.ok(pages.every((p) => p.address.startsWith('/f/') && p.funnel_name));
});
