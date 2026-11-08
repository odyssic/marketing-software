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
// The weekly digest to the owner can land on a simulated day; these tests are about workflow mail.
const outbox = async (c) => (await c('GET', '/api/outbox')).body.filter((m) => !/^Your week/.test(m.subject));

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
  const reminders = mail.filter((m) => !m.contact_id && m.subject.startsWith('Follow up'));
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
  assert.equal((await c('PUT', `/api/workflows/${id}`, { graph: { ...g, nodes: { ...g.nodes, [g.root]: { ...g.nodes[g.root], next: 'a' }, a: { type: 'fax', config: {} } } } })).status, 400);
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

test('every step type does its job: the referral map plus tag, yes/no split and deal', async () => {
  const c = await signup('wf-all@example.com');
  const { id } = (await c('POST', '/api/workflows', { template: 'blank', name: 'Every step' })).body;
  const pipe = (await c('POST', '/api/pipelines', { name: 'Sales', stages: ['New', 'Won'] })).body.id;
  const g = (await c('GET', `/api/workflows/${id}`)).body.graph;
  const N = (type, config, more = {}) => ({ type, config, ...more });
  g.nodes[g.root] = N('trigger', { event: 'purchase' }, { next: 'w' });
  Object.assign(g.nodes, {
    w: N('wait', { days: 60 }, { next: 'e' }),
    e: N('email', { subject: 'Know someone who’d love this?', body: 'Hi {{first_name|there}}, thanks again.' }, { next: 's' }),
    s: N('subscribe', { product: 'Newsletter' }, { next: 'n' }),
    n: N('notify', { message: 'Welcome. Ask how the typewriter is going.' }, { next: 't' }),
    t: N('tag', { add: 'asked-referral', remove: 'new' }, { next: 'q' }),
    q: N('condition', { check: 'has_tag', value: 'vip' }, { yes: 'd', no: 'n2' }),
    d: N('deal', { pipeline_id: pipe, title: 'VIP: {{name}}', value: 500 }),
    n2: N('notify', { message: 'Not a VIP yet.' }),
  });
  const saved = (await c('PUT', `/api/workflows/${id}`, { graph: g })).body;
  assert.deepEqual(saved.problems, []);
  assert.equal((await c('GET', `/api/workflows/${id}`)).body.notifyTo, 'wf-all@example.com'); // the editor shows who "Notify me" emails
  assert.equal((await c('PUT', `/api/workflows/${id}/status`, { status: 'active' })).status, 200);

  const vip = (await c('POST', '/api/contacts', { email: 'vip@example.com', first_name: 'Vera', last_name: 'Ip', tags: 'vip, new' })).body;
  const reg = (await c('POST', '/api/contacts', { email: 'reg@example.com', first_name: 'Reg', tags: 'new' })).body;
  await c('POST', '/api/import/orders', { orders: [vip, reg].map((p, i) => ({ order_id: `A${i}`, email: p.email, total: '45.00', date: new Date().toISOString() })) });

  // Trigger: both enrolled and waiting; nothing sent yet.
  await run(c);
  assert.equal((await outbox(c)).length, 0);
  assert.equal((await c('GET', `/api/workflows/${id}`)).body.stats.w.at, 2);
  // Day 59: still waiting. Day 61: everything after the wait runs.
  await run(c, inDays(59));
  assert.equal((await outbox(c)).length, 0);
  await run(c, inDays(61));

  const mail = await outbox(c);
  const toPeople = mail.filter((m) => m.contact_id).map((m) => [m.to_email, m.subject]).sort();
  assert.deepEqual(toPeople, [['reg@example.com', 'Know someone who’d love this?'], ['vip@example.com', 'Know someone who’d love this?']]);
  const toOwner = mail.filter((m) => !m.contact_id);
  assert.ok(toOwner.every((m) => m.to_email === 'wf-all@example.com'));
  assert.equal(toOwner.filter((m) => /Ask how the typewriter/.test(m.body)).length, 2); // notify for both
  assert.equal(toOwner.filter((m) => /Not a VIP yet/.test(m.body)).length, 1); // "No" branch: Reg only
  assert.match(toOwner[0].subject, /^Follow up with (Vera Ip|Reg) \(Every step\)$/);

  const v = (await c('GET', `/api/people/${vip.id}`)).body, r = (await c('GET', `/api/people/${reg.id}`)).body;
  assert.deepEqual([v.subscriptions.length, r.subscriptions.length], [1, 1]); // subscribe
  assert.ok(v.tags.includes('asked-referral') && !v.tags.includes('new')); // tag add + remove
  assert.ok(r.tags.includes('asked-referral') && !r.tags.includes('new'));
  assert.deepEqual(v.deals.map((d) => [d.title, d.value_cents]), [['VIP: Vera Ip', 50000]]); // "Yes" branch → deal
  assert.equal(r.deals.length, 0);

  const st = (await c('GET', `/api/workflows/${id}`)).body.stats;
  assert.equal(st.w.at || 0, 0); // nobody left waiting
});

test('date triggers: birthdays (a week ahead), customer anniversaries and subscription renewals, once a year each', async () => {
  const c = await signup('wf-dates@example.com');
  const now = new Date('2027-03-10T12:00:00Z');
  const make = async (name, config) => {
    const { id } = (await c('POST', '/api/workflows', { template: 'blank', name })).body;
    const g = (await c('GET', `/api/workflows/${id}`)).body.graph;
    g.nodes[g.root].config = config;
    g.nodes.e1 = { type: 'email', config: { subject: `${name} for {{first_name|you}}`, body: 'Hello' } };
    g.nodes[g.root].next = 'e1';
    assert.equal((await c('PUT', `/api/workflows/${id}`, { graph: g })).status, 200);
    assert.equal((await c('PUT', `/api/workflows/${id}/status`, { status: 'active' })).status, 200);
  };
  await make('Birthday', { event: 'birthday', before: 7 });
  await make('Anniversary', { event: 'anniversary' });
  await make('Renewal', { event: 'renewal', before: 3 });

  const b = (await c('POST', '/api/contacts', { email: 'bday@example.com', first_name: 'Bea' })).body;
  assert.equal((await c('PUT', `/api/contacts/${b.id}`, { birthday: '1990-03-17' })).body.birthday, '03-17');
  const o = (await c('POST', '/api/contacts', { email: 'other@example.com' })).body;
  assert.equal((await c('PUT', `/api/contacts/${o.id}`, { birthday: 'July 4' })).body.birthday, '07-04');

  // A first purchase two years ago today, and a monthly subscription paid on Feb 13.
  await c('POST', '/api/import/orders', { orders: [{ order_id: 'a1', email: 'anniv@example.com', total: 20, date: '2025-03-10T09:00:00Z' }] });
  const acct = (await c('GET', '/api/me')).body.account.id;
  const db = app.getDb();
  const prod = await db.get("INSERT INTO products (account_id, name, price_cents, billing) VALUES (?, 'Club', 900, 'monthly') RETURNING id", acct);
  const sub = (await c('POST', '/api/contacts', { email: 'sub@example.com' })).body;
  await db.run("INSERT INTO orders (account_id, product_id, product_name, contact_id, email, amount_cents, currency, status, mode, paid_at) VALUES (?, ?, 'Club', ?, 'sub@example.com', 900, 'usd', 'paid', 'payment', ?)",
    acct, prod.id, sub.id, '2027-02-13T10:00:00Z');

  await run(c, now.toISOString());
  await run(c, new Date(now.getTime() + 3600e3).toISOString()); // no repeats the same day
  const mail = (await outbox(c)).filter((m) => m.contact_id);
  assert.deepEqual(mail.map((m) => `${m.to_email}: ${m.subject}`).sort(), [
    'anniv@example.com: Anniversary for you',
    'bday@example.com: Birthday for Bea',
    'sub@example.com: Renewal for you',
  ]);
});

test('split on what they did with the last email: clicked → yes path, didn’t → another email', async () => {
  const c = await signup('wf-split@example.com');
  const { id } = (await c('POST', '/api/workflows', { template: 'blank', name: 'Offer' })).body;
  const g = (await c('GET', `/api/workflows/${id}`)).body.graph;
  g.nodes[g.root].config = { event: 'tag_added', tag: 'offer' };
  g.nodes.e1 = { type: 'email', config: { subject: 'The offer', body: 'See it: https://example.com/offer' }, next: 'w1' };
  g.nodes.w1 = { type: 'wait', config: { days: 2, hours: 0 }, next: 's1' };
  g.nodes.s1 = { type: 'condition', config: { check: 'clicked_last' }, yes: 't1', no: 'e2' };
  g.nodes.t1 = { type: 'tag', config: { add: 'hot', remove: '' } };
  g.nodes.e2 = { type: 'email', config: { subject: 'Did you see it?', body: 'One more look' } };
  g.nodes[g.root].next = 'e1';
  assert.equal((await c('PUT', `/api/workflows/${id}`, { graph: g })).status, 200);
  assert.equal((await c('PUT', `/api/workflows/${id}/status`, { status: 'active' })).status, 200);
  const a = (await c('POST', '/api/contacts', { email: 'clicker@example.com', tags: 'offer' })).body;
  const b = (await c('POST', '/api/contacts', { email: 'ignorer@example.com', tags: 'offer' })).body;
  await run(c);
  const first = (await outbox(c)).find((m) => m.to_email === 'clicker@example.com');
  await app.getDb().run('UPDATE email_log SET clicked_at = now() WHERE id = ?', first.id);
  await run(c, inDays(2.1));
  const people = (await c('GET', '/api/contacts')).body;
  assert.ok(people.find((p) => p.id === a.id).tags.includes('hot'), 'clicked → yes path');
  assert.ok(!people.find((p) => p.id === b.id).tags.includes('hot'));
  const mail = await outbox(c);
  assert.deepEqual(mail.filter((m) => m.subject === 'Did you see it?').map((m) => m.to_email), ['ignorer@example.com'], 'didn’t click → no path');
});
