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

test('duplicating a funnel copies its pages, links, purpose and follow-ups, as a draft', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Dee', email: 'dup@example.com', password: 'password123', workspace: 'Dup Co' });
  const f = (await c('POST', '/api/funnels', { name: 'Guide', template: 'optin' })).body;
  await c('PUT', `/api/funnels/${f.id}`, { purpose: 'leads' });
  const src = (await c('GET', `/api/funnels/${f.id}`)).body;
  const r = await c('POST', `/api/funnels/${f.id}/duplicate`, { name: 'Guide v2' });
  assert.equal(r.status, 201);
  const copy = (await c('GET', `/api/funnels/${r.body.id}`)).body;
  assert.equal(copy.name, 'Guide v2');
  assert.equal(copy.status, 'draft');
  assert.equal(copy.purpose, 'leads');
  assert.notEqual(copy.slug, src.slug);
  assert.deepEqual(copy.steps.map((s) => [s.name, s.slug]), src.steps.map((s) => [s.name, s.slug]));
  assert.ok(copy.steps.every((s) => !src.steps.some((o) => o.id === s.id))); // new pages, not shared
  const entry = copy.steps.find((s) => s.id === copy.entry_step_id);
  assert.equal(entry.name, src.steps.find((s) => s.id === src.entry_step_id).name);
  assert.ok(copy.steps.find((s) => s.id === entry.next_step_id)); // links point inside the copy
  assert.equal(copy.workflows.length, src.workflows.length);
  assert.ok(copy.workflows.every((w) => w.status === 'draft' && w.name.startsWith('Guide v2: ')));
  // Editing the copy leaves the original alone.
  await c('PUT', `/api/steps/${entry.id}`, { name: 'Changed', blocks: [], settings: {} });
  assert.notEqual((await c('GET', `/api/funnels/${f.id}`)).body.steps.find((s) => s.id === src.entry_step_id).name, 'Changed');
  const other = client();
  await other('POST', '/api/auth/signup', { name: 'O', email: 'dup-other@example.com', password: 'password123', workspace: 'Other' });
  assert.equal((await other('POST', `/api/funnels/${f.id}/duplicate`, {})).status, 404);
});

test('email designer: drafts are editable, tests do not count, preview text and audience count work', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Eve Owner', email: 'eve-owner@example.com', password: 'password123', workspace: 'Eve Co' });
  await c('POST', '/api/contacts', { email: 'a1@example.com', first_name: 'Ann', tags: 'vip' });
  await c('POST', '/api/contacts', { email: 'a2@example.com', first_name: 'Bo' });
  assert.equal((await c('GET', '/api/broadcasts/audience')).body.count, 2);
  assert.equal((await c('GET', '/api/broadcasts/audience?tag=vip')).body.count, 1);
  const { id } = (await c('POST', '/api/broadcasts', { subject: 'Hi {{first_name|there}}', body: 'Hello', tag: 'vip', preheader: 'Quick news' })).body;
  assert.equal((await c('PUT', `/api/broadcasts/${id}`, { subject: 'Hello {{first_name|there}}', body: 'Updated', tag: 'vip', preheader: 'Fresh news' })).status, 200);
  const t = (await c('POST', '/api/broadcasts/test', { subject: 'Hello {{first_name|there}}', body: 'Updated', preheader: 'x' })).body;
  assert.equal(t.to, 'eve-owner@example.com');
  assert.equal((await c('POST', `/api/broadcasts/${id}/send`)).body.sent, 1);
  const b = (await c('GET', `/api/broadcasts/${id}`)).body;
  assert.deepEqual([b.status, b.sent_count, b.preheader, b.opened, b.clicked], ['sent', 1, 'Fresh news', 0, 0]);
  const out = (await c('GET', '/api/outbox')).body.map((m) => m.subject).sort();
  assert.deepEqual(out, ['Hello Ann', '[Test] Hello Eve']); // the test went only to the owner, and isn't counted
  assert.equal((await c('PUT', `/api/broadcasts/${id}`, { subject: 'x', body: 'y' })).status, 409); // sent ones are locked
});

test('segments from email behaviour: clicked, opened-no-click, no engagement, per-email; send to a segment; save as tag', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Sid Owner', email: 'seg-owner@example.com', password: 'password123', workspace: 'Seg Co' });
  for (const [e, n] of [['clicker@example.com', 'Cleo'], ['opener@example.com', 'Otto'], ['quiet@example.com', ''], ['never@example.com', 'Nev']]) {
    await c('POST', '/api/contacts', { email: e, first_name: n });
  }
  const { id } = (await c('POST', '/api/broadcasts', { subject: 'Hi {{first_name}}', body: 'Hello {{first_name}}, see https://example.com/guide' })).body;
  // Send to the "Never emailed" segment (all four, at this point).
  await c('PUT', `/api/broadcasts/${id}`, { subject: 'Hi {{first_name}}', body: 'Hello {{first_name}}, see https://example.com/guide', segment: 'never_emailed' });
  assert.equal((await c('GET', '/api/broadcasts/audience?segment=never_emailed')).body.count, 4);
  await c('POST', `/api/broadcasts/${id}/send`);
  const mail = (await c('GET', '/api/outbox')).body;
  // No name → a sensible default, never "Hi ,".
  assert.equal(mail.find((m) => m.to_email === 'quiet@example.com').subject, 'Hi there');
  const token = (to) => app.messaging.sign(mail.find((m) => m.to_email === to).id);
  await fetch(`${base}/t/o/${token('clicker@example.com')}.gif`);
  await fetch(`${base}/t/c/${token('clicker@example.com')}?u=${encodeURIComponent('https://example.com/guide')}`, { redirect: 'manual' });
  await fetch(`${base}/t/o/${token('opener@example.com')}.gif`);

  const segs = Object.fromEntries((await c('GET', '/api/segments')).body.map((s) => [s.key, s]));
  const who = async (key) => (await c('GET', `/api/contacts?segment=${encodeURIComponent(key)}`)).body.map((p) => p.email).sort();
  assert.deepEqual(await who('clicked'), ['clicker@example.com']);
  assert.deepEqual(await who('opened_no_click'), ['opener@example.com']);
  assert.deepEqual(await who('engaged'), ['clicker@example.com', 'opener@example.com']);
  assert.deepEqual(await who('never_emailed'), []);
  assert.deepEqual(await who(`bc_noopen:${id}`), ['never@example.com', 'quiet@example.com']);
  assert.deepEqual(await who(`bc_click:${id}`), ['clicker@example.com']);
  assert.equal(segs.clicked.count, 1);
  assert.ok(segs[`bc_noopen:${id}`].label.startsWith('Didn’t open'));
  // "No engagement" needs emails older than 2 days, so it's empty right after a send.
  assert.deepEqual(await who('unengaged'), []);
  // Save a segment as a tag.
  const t = (await c('POST', '/api/segments/tag', { segment: `bc_noopen:${id}`, tag: 'Resend-Spring' })).body;
  assert.deepEqual(t, { tagged: 2, total: 2 });
  assert.deepEqual((await c('GET', '/api/contacts?tag=resend-spring')).body.map((p) => p.email).sort(), ['never@example.com', 'quiet@example.com']);
  assert.equal((await c('POST', '/api/segments/tag', { segment: 'bogus', tag: 'x' })).status, 400);
});

test('lead magnet: the file or link on a form is emailed the moment someone signs up', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Lou', email: 'lou@example.com', password: 'password123', workspace: 'Lou Co' });
  const f = (await c('POST', '/api/funnels', { name: 'Guide', template: 'optin' })).body;
  const step = (await c('GET', `/api/funnels/${f.id}`)).body.steps[0];
  const blocks = step.blocks.map((b) => (b.type === 'form' ? { ...b, deliverUrl: 'https://example.com/care-guide.pdf', deliverName: 'the typewriter care guide' } : b));
  await c('PUT', `/api/steps/${step.id}`, { name: step.name, blocks, settings: step.settings });
  const funnel = (await c('GET', `/api/funnels/${f.id}`)).body;
  const form = blocks.find((b) => b.type === 'form');
  const r = await fetch(`${base}/f/${funnel.slug}/${step.slug}/optin`, { method: 'POST', redirect: 'manual', headers: { cookie: '', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ block: form.id, email: 'reader@example.com', first_name: 'Rae' }) });
  assert.ok([303, 404].includes(r.status)); // drafts aren't public; publish first
  const pub = await c('POST', `/api/funnels/${f.id}/publish`);
  assert.equal(pub.status, 200);
  const sent = await fetch(`${base}/f/${funnel.slug}/${step.slug}/optin`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ block: form.id, email: 'reader@example.com', first_name: 'Rae' }) });
  assert.equal(sent.status, 303);
  const m = (await c('GET', '/api/outbox')).body.find((x) => x.to_email === 'reader@example.com');
  assert.equal(m.subject, 'Here’s the typewriter care guide');
  assert.match(m.body, /Hi Rae,[\s\S]*https:\/\/example\.com\/care-guide\.pdf/);
});

test('imports from other tools: quoted tags, do-not-disturb kept unsubscribed', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Ivy', email: 'ivy@example.com', password: 'password123', workspace: 'Ivy Co' });
  const r = (await c('POST', '/api/import/people', { source: 'import', tag: 'from-mailchimp', rows: [
    { email: 'a@example.com', first_name: 'A', tags: '"VIP","Spring Fair"' },
    { email: 'b@example.com', first_name: 'B', tags: 'customer; repair', unsubscribed: 'true' },
    { email: 'c@example.com', first_name: 'C', unsubscribed: 'false' },
    { email: 'd@example.com', first_name: 'D', unsubscribed: 'cleaned' },
  ] })).body;
  assert.deepEqual(r, { created: 4, updated: 0, skipped: 0, unsubscribed: 2 });
  const people = Object.fromEntries((await c('GET', '/api/contacts')).body.map((p) => [p.email, p]));
  assert.deepEqual(people['a@example.com'].tags.sort(), ['from-mailchimp', 'spring fair', 'vip']);
  assert.deepEqual([people['b@example.com'].unsubscribed, people['c@example.com'].unsubscribed, people['d@example.com'].unsubscribed], [true, false, true]);
  assert.deepEqual(people['b@example.com'].tags.sort(), ['customer', 'from-mailchimp', 'repair']);
});

test('lead source tracking: first-touch source on visits, people and sales; per-funnel report', async () => {
  const { classify } = require('../src/attribution');
  assert.equal(classify({ query: { utm_source: 'fb', utm_campaign: 'spring' } }).source, 'Facebook');
  assert.equal(classify({ referrer: 'https://l.instagram.com/x' }).source, 'Instagram');
  assert.equal(classify({ referrer: 'https://www.google.com/search?q=x' }).source, 'Google');
  assert.equal(classify({ referrer: 'https://getrilly.com/f/a', ownHosts: ['getrilly.com'] }).source, 'Direct');
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Sal', email: 'sal@example.com', password: 'password123', workspace: 'Sal Co' });
  const f = (await c('POST', '/api/funnels', { name: 'Guide', template: 'optin' })).body;
  assert.equal((await c('POST', `/api/funnels/${f.id}/publish`)).status, 200);
  const funnel = (await c('GET', `/api/funnels/${f.id}`)).body;
  const step = funnel.steps.find((s) => s.id === funnel.entry_step_id);
  const form = step.blocks.find((b) => b.type === 'form');
  // A visitor from a Facebook ad: the page sets the cookie, the sign-up carries it.
  const visit = await fetch(`${base}/f/${funnel.slug}?utm_source=facebook&utm_campaign=spring-sale`);
  const cookie = visit.headers.get('set-cookie').split(';')[0];
  assert.match(cookie, /^rl_src=/);
  await fetch(`${base}/f/${funnel.slug}/${step.slug}/optin`, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ block: form.id, email: 'fan@example.com', first_name: 'Fan' }) });
  // A visitor from Google who doesn't sign up.
  await fetch(`${base}/f/${funnel.slug}`, { headers: { referer: 'https://www.google.com/' } });
  const fan = (await c('GET', '/api/contacts?q=fan@example.com')).body[0];
  assert.deepEqual([fan.came_from.source, fan.came_from.campaign], ['Facebook', 'spring-sale']);
  const rows = Object.fromEntries((await c('GET', `/api/funnels/${f.id}/sources`)).body.map((r) => [r.source, r]));
  assert.deepEqual([rows.Facebook.visitors, rows.Facebook.leads, rows.Facebook.rate], [1, 1, 100]);
  assert.deepEqual([rows.Google.visitors, rows.Google.leads], [1, 0]);
});

test('send later: a scheduled email goes out when its time comes, and can be cancelled', async () => {
  process.env.ALLOW_TIME_TRAVEL = '1';
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Sky', email: 'sky@example.com', password: 'password123', workspace: 'Sky Co' });
  await c('POST', '/api/contacts', { email: 'reader1@example.com', first_name: 'Rex' });
  const { id } = (await c('POST', '/api/broadcasts', { subject: 'Hi {{first_name}}', body: 'Spring news' })).body;
  assert.equal((await c('POST', `/api/broadcasts/${id}/schedule`, { at: '2001-01-01T00:00:00Z' })).status, 400);
  const at = new Date(Date.now() + 3 * 3600e3).toISOString();
  assert.equal((await c('POST', `/api/broadcasts/${id}/schedule`, { at })).status, 200);
  assert.equal((await c('GET', `/api/broadcasts/${id}`)).body.status, 'scheduled');
  assert.equal((await c('POST', '/api/jobs/run', { now: new Date(Date.now() + 3600e3).toISOString() })).body.scheduled_sent, 0);
  assert.equal((await c('POST', '/api/jobs/run', { now: new Date(Date.now() + 4 * 3600e3).toISOString() })).body.scheduled_sent, 1);
  assert.equal((await c('GET', `/api/broadcasts/${id}`)).body.status, 'sent');
  // Cancelled before its time: back to a draft, nothing sent.
  const two = (await c('POST', '/api/broadcasts', { subject: 'Later', body: 'x' })).body.id;
  await c('POST', `/api/broadcasts/${two}/schedule`, { at });
  await c('POST', `/api/broadcasts/${two}/unschedule`);
  assert.equal((await c('POST', '/api/jobs/run', { now: new Date(Date.now() + 4 * 3600e3).toISOString() })).body.scheduled_sent, 0);
  assert.equal((await c('GET', `/api/broadcasts/${two}`)).body.status, 'draft');
});
