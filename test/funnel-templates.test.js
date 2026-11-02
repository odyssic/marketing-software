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
  return async (method, path, body, { form } = {}) => {
    const res = await fetch(base + path, {
      method, redirect: 'manual',
      headers: { cookie, 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
      body: form ? new URLSearchParams(form) : body && JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : await res.text() };
  };
}
async function setup(email) {
  const c = client();
  assert.equal((await c('POST', '/api/auth/signup', { name: 'Tem Plate', email, password: 'password123', workspace: 'Glow Studio' })).status, 201);
  return c;
}
// Submits the first form on a funnel's entry page like a visitor would.
async function submit(c, funnelId, fields) {
  const f = (await c('GET', `/api/funnels/${funnelId}`)).body;
  const entry = f.steps.find((s) => s.id === f.entry_step_id);
  const block = entry.blocks.find((b) => b.type === 'form');
  return fetch(`${base}/f/${f.slug}/${entry.slug}/optin`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ block: block.id, ...fields }) });
}
const turnOn = async (c, ids) => { for (const id of ids) assert.equal((await c('PUT', `/api/workflows/${id}/status`, { status: 'active' })).status, 200); };

test('templates list their pages and bundled follow-ups', async () => {
  const c = await setup('tpl-list@example.com');
  const t = (await c('GET', '/api/templates')).body;
  const by = Object.fromEntries(t.map((x) => [x.key, x]));
  assert.deepEqual(by.optin.workflows, ['New lead welcome series']);
  assert.deepEqual(by.newsletter.workflows, ['Newsletter welcome']);
  assert.deepEqual(by.consult.workflows, ['Inquiry follow-up']);
  assert.deepEqual(by.blank.workflows, []);
  assert.ok(t.every((x) => x.description && x.pages >= 1));
});

test('consultation funnel: the request is logged with its message, the person gets a reply, the owner is told', async () => {
  const c = await setup('tpl-consult@example.com');
  const r = (await c('POST', '/api/funnels', { name: 'Free consult', template: 'consult' })).body;
  assert.equal((await c('POST', `/api/funnels/${r.id}/publish`)).status, 200);
  assert.equal(r.workflows.length, 1);
  const f = (await c('GET', `/api/funnels/${r.id}`)).body;
  assert.deepEqual(f.workflows.map((w) => [w.name, w.status]), [['Free consult: Inquiry follow-up', 'draft']]);
  await turnOn(c, r.workflows);

  const res = await submit(c, r.id, { email: 'client@example.com', first_name: 'Cara', phone: '555-0100', message: 'Need a kitchen redesign' });
  assert.equal(res.status, 303);
  const person = (await c('GET', '/api/contacts')).body[0];
  assert.equal(person.stage, 'lead');
  assert.ok(person.tags.includes('consult-request'));
  const page = (await c('GET', `/api/people/${person.id}`)).body;
  assert.equal(page.events[0].type, 'inquiry');
  assert.equal(page.events[0].meta.note, 'Need a kitchen redesign');

  await c('POST', '/api/jobs/run');
  const mail = (await c('GET', '/api/outbox')).body;
  assert.equal(mail.find((m) => m.to_email === 'client@example.com').subject, 'We got your request, Cara');
  const note = mail.find((m) => m.to_email === 'tpl-consult@example.com');
  assert.match(note.subject, /Follow up with Cara/);
  // And the dashboard shows them as waiting.
  const tiles = (await c('GET', '/api/tiles?ids=inquiries')).body;
  assert.equal(tiles.inquiries.data.people[0].name, 'Cara');
});

test('newsletter funnel subscribes people; a lead magnet workflow only fires for its own funnel', async () => {
  const c = await setup('tpl-news@example.com');
  const news = (await c('POST', '/api/funnels', { name: 'Letter', template: 'newsletter' })).body;
  const guide = (await c('POST', '/api/funnels', { name: 'Guide', template: 'optin' })).body;
  const other = (await c('POST', '/api/funnels', { name: 'Other', template: 'blank' })).body;
  for (const f of [news, guide]) assert.equal((await c('POST', `/api/funnels/${f.id}/publish`)).status, 200);
  assert.equal(other.workflows.length, 0);
  await turnOn(c, [...news.workflows]);
  // The welcome series has placeholder copy but no blocking problems, so it can go live too.
  await turnOn(c, guide.workflows);

  await submit(c, news.id, { email: 'reader@example.com', first_name: 'Rae' });
  await submit(c, news.id, { email: 'reader@example.com', first_name: 'Rae' }); // twice: still one subscription
  const reader = (await c('GET', '/api/contacts')).body.find((p) => p.email === 'reader@example.com');
  const page = (await c('GET', `/api/people/${reader.id}`)).body;
  assert.equal(page.subscriptions.length, 1);
  assert.equal(page.subscriptions[0].product, 'Newsletter');
  assert.equal(page.events.filter((e) => e.type === 'subscribe').length, 1);

  await submit(c, guide.id, { email: 'guide@example.com', first_name: 'Gil' });
  await c('POST', '/api/jobs/run');
  const subjects = (await c('GET', '/api/outbox')).body.map((m) => `${m.to_email}: ${m.subject}`).sort();
  assert.deepEqual(subjects, ['guide@example.com: Welcome, Gil! Here’s what you asked for', 'reader@example.com: You’re on the list!']);
  // The newsletter reader didn't get the lead-magnet welcome (different funnel).
});
