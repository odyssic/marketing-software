process.env.ALLOW_SIGNUPS = '1';
process.env.ALLOW_TIME_TRAVEL = '1';
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
    return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : await res.text() };
  };
}
async function signup(email) {
  const c = client();
  assert.equal((await c('POST', '/api/auth/signup', { name: 'Wf Owner', email, password: 'password123', workspace: 'Wf Biz' })).status, 201);
  return c;
}
const inDays = (d) => new Date(Date.now() + d * 864e5).toISOString();
const daysAgo = (d) => inDays(-d);
const run = (c, now) => c('POST', '/api/jobs/run', now ? { now } : {});
const outbox = async (c) => (await c('GET', '/api/outbox')).body;

test('every workspace starts with the four standard follow-ups, switched off', async () => {
  const c = await signup('wf-seed@example.com');
  const list = (await c('GET', '/api/workflows')).body;
  assert.deepEqual(list.map((w) => [w.name, w.status, w.trigger]), [
    ['Post-purchase care tips', 'draft', 'purchase'], ['Review request', 'draft', 'purchase'],
    ['Referral ask', 'draft', 'purchase'], ['Win-back', 'draft', 'silent'],
  ]);
  assert.equal((await c('GET', '/api/workflows')).body.length, 4); // seeded once
  const t = (await c('GET', '/api/workflow-templates')).body;
  assert.ok(t.find((x) => x.key === 'welcome').emails >= 3);
});

test('welcome series: emails, waits and a yes/no branch run on one map', async () => {
  const c = await signup('wf-welcome@example.com');
  const { id } = (await c('POST', '/api/workflows', { template: 'welcome' })).body;
  let w = (await c('GET', `/api/workflows/${id}`)).body;
  assert.deepEqual(w.problems, []);
  assert.equal((await c('PUT', `/api/workflows/${id}/status`, { status: 'active' })).status, 200);

  // A fresh signup enrolls; an old one (e.g. imported history) doesn't.
  const ann = (await c('POST', '/api/contacts', { email: 'ann@example.com', first_name: 'Ann' })).body;
  const bo = (await c('POST', '/api/contacts', { email: 'bo@example.com', first_name: '' })).body;
  const old = (await c('POST', '/api/contacts', { email: 'old@example.com' })).body;
  await c('POST', `/api/people/${ann.id}/events`, { type: 'signup' });
  await c('POST', `/api/people/${bo.id}/events`, { type: 'signup' });
  await c('POST', `/api/people/${old.id}/events`, { type: 'signup', occurred_at: daysAgo(10) });
  await c('POST', `/api/people/${ann.id}/events`, { type: 'signup' }); // signing up twice doesn't re-enroll

  await run(c);
  let mail = await outbox(c);
  assert.equal(mail.length, 2);
  assert.ok(mail.every((m) => m.workflow_id === id));
  const annMail = mail.find((m) => m.to_email === 'ann@example.com');
  assert.equal(annMail.subject, 'Welcome, Ann! Here’s what you asked for');
  assert.equal(mail.find((m) => m.to_email === 'bo@example.com').subject, 'Welcome, friend! Here’s what you asked for');
  assert.match(annMail.body, /Hi Ann,/);
  assert.match(annMail.body, /Wf Biz/);
  assert.match(annMail.body, /Unsubscribe: http/);

  // Nothing more until the 2-day wait is over.
  await run(c, inDays(1));
  assert.equal((await outbox(c)).length, 2);
  await run(c, inDays(2.01));
  assert.equal((await outbox(c)).length, 4);

  // Bo buys before the condition; Ann doesn't.
  await c('POST', '/api/import/orders', { orders: [{ order_id: 'w1', email: 'bo@example.com', total: 20, date: new Date().toISOString() }] });
  await run(c, inDays(5.1));
  mail = await outbox(c);
  assert.equal(mail.length, 5);
  assert.equal(mail[0].to_email, 'ann@example.com');
  assert.equal(mail[0].subject, 'A little thank-you for you');
  const people = (await c('GET', '/api/contacts')).body;
  assert.ok(people.find((p) => p.email === 'bo@example.com').tags.includes('welcomed-buyer'));
  assert.ok(!people.find((p) => p.email === 'ann@example.com').tags.includes('welcomed-buyer'));

  // The map shows what happened at each step; both runs are finished.
  w = (await c('GET', `/api/workflows/${id}`)).body;
  const byType = (type) => Object.entries(w.graph.nodes).filter(([, n]) => n.type === type).map(([k]) => w.stats[k] || { at: 0, outcomes: {} });
  assert.deepEqual(byType('condition')[0].outcomes, { yes: 1, no: 1 });
  // 2 welcomes + 2 stories + 1 offer.
  assert.deepEqual(byType('email').map((s) => s.outcomes.sent || 0).sort(), [1, 2, 2]);
  const runs = (await c('GET', `/api/workflows/${id}/runs`)).body;
  assert.deepEqual(runs.map((r) => r.status), ['done', 'done']);
  const list = (await c('GET', '/api/workflows')).body.find((x) => x.id === id);
  assert.equal(list.emails_sent, 5);
});

test('tag trigger, manual enrolment, unsubscribed people are skipped, and owner notifications', async () => {
  const c = await signup('wf-tags@example.com');
  const { id } = (await c('POST', '/api/workflows', { template: 'blank', name: 'VIP' })).body;
  const w = (await c('GET', `/api/workflows/${id}`)).body;
  const g = w.graph;
  g.nodes[g.root].config = { event: 'tag_added', tag: 'VIP' };
  g.nodes.e1 = { type: 'email', config: { subject: 'Welcome to VIP, {{first_name|friend}}', body: 'Thanks!' } };
  g.nodes.n1 = { type: 'notify', config: { message: 'New VIP' } };
  g.nodes[g.root].next = 'e1';
  g.nodes.e1.next = 'n1';
  const saved = (await c('PUT', `/api/workflows/${id}`, { graph: g })).body;
  assert.equal(saved.graph.nodes[g.root].config.tag, 'vip');
  assert.equal((await c('PUT', `/api/workflows/${id}/status`, { status: 'active' })).status, 200);

  const p = (await c('POST', '/api/contacts', { email: 'v@example.com', first_name: 'Val' })).body;
  await c('PUT', `/api/contacts/${p.id}`, { tags: 'vip, other' });
  await c('POST', '/api/contacts', { email: 'imp@example.com', tags: 'vip' }); // tagged on create
  const u = (await c('POST', '/api/contacts', { email: 'unsub@example.com' })).body;
  await c('PUT', `/api/contacts/${u.id}`, { unsubscribed: true });
  const added = (await c('POST', `/api/workflows/${id}/enroll`, { person_ids: [u.id, 999999] })).body;
  assert.deepEqual(added, { added: 1, matched: 1, live: true });
  await run(c);
  const mail = await outbox(c);
  const toPeople = mail.filter((m) => m.contact_id);
  assert.deepEqual(toPeople.map((m) => m.to_email).sort(), ['imp@example.com', 'v@example.com']);
  assert.equal(toPeople.find((m) => m.to_email === 'v@example.com').subject, 'Welcome to VIP, Val');
  const notes = mail.filter((m) => !m.contact_id);
  assert.equal(notes.length, 3); // owner notified for each, including the unsubscribed person
  assert.match(notes[0].subject, /^Follow up with .* \(VIP\)$/);
  const st = (await c('GET', `/api/workflows/${id}`)).body.stats.e1.outcomes;
  assert.equal(st.skipped, 1);
});

test('win-back finds quiet customers; no click → personal follow-up reminder; opens and clicks are tracked', async () => {
  const c = await signup('wf-winback@example.com');
  await c('POST', '/api/import/orders', { orders: [
    { order_id: 'q1', email: 'quiet@example.com', name: 'Quinn Q', total: 50, date: daysAgo(200) },
    { order_id: 'q2', email: 'clicker@example.com', name: 'Cleo C', total: 50, date: daysAgo(220) },
    { order_id: 'q3', email: 'recent@example.com', total: 50, date: daysAgo(20) },
  ] });
  const wb = (await c('GET', '/api/workflows')).body.find((w) => w.name === 'Win-back');
  assert.equal((await c('PUT', `/api/workflows/${wb.id}/status`, { status: 'active' })).status, 200);
  await run(c);
  let mail = await outbox(c);
  assert.deepEqual(mail.map((m) => m.to_email).sort(), ['clicker@example.com', 'quiet@example.com']);
  await run(c); // no duplicate enrolment
  assert.equal((await outbox(c)).length, 2);

  // Cleo opens and clicks a link that's in the email.
  const cleo = mail.find((m) => m.to_email === 'clicker@example.com');
  const token = app.messaging.sign(cleo.id);
  const pixel = await fetch(`${base}/t/o/${token}.gif`);
  assert.equal(pixel.headers.get('content-type'), 'image/gif');
  const link = cleo.body.match(/https?:\/\/\S+/)[0]; // the unsubscribe link is a real link in the body
  const click = await fetch(`${base}/t/c/${token}?u=${encodeURIComponent(link)}`, { redirect: 'manual' });
  assert.equal(click.status, 302);
  assert.equal(click.headers.get('location'), link);
  // Not an open redirect: other URLs and forged tokens are refused.
  assert.equal((await fetch(`${base}/t/c/${token}?u=${encodeURIComponent('https://evil.example')}`, { redirect: 'manual' })).status, 400);
  assert.equal((await fetch(`${base}/t/c/${cleo.id}.0000000000000000?u=${encodeURIComponent(link)}`, { redirect: 'manual' })).status, 400);
  const cleoPage = (await c('GET', `/api/people/${cleo.contact_id}`)).body;
  assert.deepEqual(cleoPage.events.slice(0, 2).map((e) => e.type).sort(), ['click', 'open']);

  await run(c, inDays(14.1));
  mail = await outbox(c);
  const reminders = mail.filter((m) => !m.contact_id);
  assert.equal(reminders.length, 1);
  assert.match(reminders[0].subject, /Quinn Q/);
  const people = (await c('GET', '/api/contacts')).body;
  assert.ok(people.find((p) => p.email === 'clicker@example.com').tags.includes('won-back'));
});

test('graph validation, activation checks, deal step and workspace isolation', async () => {
  const c = await signup('wf-valid@example.com');
  const { id } = (await c('POST', '/api/workflows', { template: 'blank' })).body;
  const g = (await c('GET', `/api/workflows/${id}`)).body.graph;
  assert.equal((await c('PUT', `/api/workflows/${id}`, { graph: { root: 'x', nodes: {} } })).status, 400);
  assert.equal((await c('PUT', `/api/workflows/${id}`, { graph: { ...g, nodes: { ...g.nodes, [g.root]: { ...g.nodes[g.root], next: 'a' }, a: { type: 'sms', config: {} } } } })).status, 400);
  // The same step can't sit in two places.
  const loop = { root: g.root, nodes: { [g.root]: { type: 'trigger', config: {}, next: 'c' }, c: { type: 'condition', config: {}, yes: 'e', no: 'e' }, e: { type: 'email', config: {} } } };
  assert.equal((await c('PUT', `/api/workflows/${id}`, { graph: loop })).status, 400);
  // Empty steps and an unpicked pipeline block going live, in plain words.
  const draft = { root: g.root, nodes: { [g.root]: { type: 'trigger', config: { event: 'signup' }, next: 'e' }, e: { type: 'email', config: { subject: '', body: '' }, next: 'd' }, d: { type: 'deal', config: {} } } };
  const r = (await c('PUT', `/api/workflows/${id}`, { graph: draft })).body;
  assert.deepEqual(r.problems, ['Every email needs a subject and a message.', 'Pick a pipeline for the “Create deal” step.']);
  const act = await c('PUT', `/api/workflows/${id}/status`, { status: 'active' });
  assert.equal(act.status, 400);
  assert.match(act.body.error, /subject and a message/);

  // Fix it: a deal lands in the pipeline's first stage.
  const pipe = (await c('POST', '/api/pipelines', { name: 'Sales', stages: ['New', 'Won'] })).body.id;
  draft.nodes.e.config = { subject: 'Hi', body: 'Hello {{first_name|there}}' };
  draft.nodes.d.config = { pipeline_id: pipe, title: 'Follow up: {{name}}', value: 250 };
  await c('PUT', `/api/workflows/${id}`, { graph: draft });
  assert.equal((await c('PUT', `/api/workflows/${id}/status`, { status: 'active' })).status, 200);
  const p = (await c('POST', '/api/contacts', { email: 'deal@example.com', first_name: 'Dee', last_name: 'Al' })).body;
  await c('POST', `/api/people/${p.id}/events`, { type: 'signup' });
  await run(c);
  const board = (await c('GET', `/api/pipelines/${pipe}`)).body;
  assert.deepEqual(board.deals.map((d) => [d.title, d.value_cents, d.stage_id, d.contact_id]), [['Follow up: Dee Al', 25000, board.stages[0].id, p.id]]);
  // Live workflows can't be saved into a broken state.
  draft.nodes.e.config = { subject: '', body: '' };
  assert.equal((await c('PUT', `/api/workflows/${id}`, { graph: draft })).status, 400);

  const other = await signup('wf-other@example.com');
  assert.equal((await other('GET', `/api/workflows/${id}`)).status, 404);
  assert.equal((await other('PUT', `/api/workflows/${id}/status`, { status: 'paused' })).status, 404);
  assert.equal((await other('POST', `/api/workflows/${id}/enroll`, { person_ids: [p.id] })).status, 404);
  assert.equal((await other('DELETE', `/api/workflows/${id}`)).status, 404);
  assert.ok(!(await other('GET', '/api/workflows')).body.some((w) => w.id === id));
});
