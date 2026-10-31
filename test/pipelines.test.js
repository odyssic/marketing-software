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
    const res = await fetch(base + path, {
      method, headers: { cookie, 'content-type': 'application/json' }, body: body && JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
}

async function signup(email) {
  const c = client();
  assert.equal((await c('POST', '/api/auth/signup', { name: 'Test User', email, password: 'password123' })).status, 201);
  return c;
}

const board = async (c, id) => (await c('GET', `/api/pipelines/${id}`)).body;
const column = (p, stageId) => p.deals.filter((d) => d.stage_id === stageId && d.status === 'open').map((d) => d.title);

test('pipeline board: deals move through stages and close as won or lost', async () => {
  const c = await signup('pipe@example.com');
  assert.deepEqual((await c('GET', '/api/pipelines')).body, []);

  assert.equal((await c('POST', '/api/pipelines', { name: 'Sales', stages: [] })).status, 400);
  const { body: { id } } = await c('POST', '/api/pipelines', { name: 'Sales', stages: ['New', 'Proposal', ' ', 'Negotiation'] });
  let p = await board(c, id);
  assert.deepEqual(p.stages.map((s) => s.name), ['New', 'Proposal', 'Negotiation']);
  const [s1, s2, s3] = p.stages.map((s) => s.id);

  // A new email becomes a contact; deals default to the first stage.
  const a = (await c('POST', '/api/deals', { pipeline_id: id, title: 'Acme site', value: '1200.50', contact_email: 'Ann@Acme.com', contact_name: 'Ann Lee' })).body;
  assert.equal(a.stage_id, s1);
  assert.equal(a.valueLabel, '$1,200.50');
  assert.equal(a.contact_email, 'ann@acme.com');
  assert.equal(a.contact_name, 'Ann Lee');
  const contacts = (await c('GET', '/api/contacts')).body;
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].source, 'deal');

  const b = (await c('POST', '/api/deals', { pipeline_id: id, title: 'Beta app', value: 800, contact_id: contacts[0].id })).body;
  const d = (await c('POST', '/api/deals', { pipeline_id: id, stage_id: s2, title: 'Delta audit', value: 300, currency: 'eur' })).body;
  assert.equal(b.contact_id, contacts[0].id);
  assert.equal((await c('POST', '/api/deals', { pipeline_id: id, title: '' })).status, 400);
  assert.equal((await c('POST', '/api/deals', { pipeline_id: id, title: 'x', value: -5 })).status, 400);

  // Drag Beta above Delta in the Proposal column.
  assert.equal((await c('PUT', `/api/deals/${b.id}/move`, { stage_id: s2, order: [b.id, d.id] })).status, 200);
  p = await board(c, id);
  assert.deepEqual(column(p, s1), ['Acme site']);
  assert.deepEqual(column(p, s2), ['Beta app', 'Delta audit']);
  // ...and back below it.
  await c('PUT', `/api/deals/${b.id}/move`, { stage_id: s2, order: [d.id, b.id] });
  assert.deepEqual(column(await board(c, id), s2), ['Delta audit', 'Beta app']);
  // Moving without an order puts it at the bottom.
  await c('PUT', `/api/deals/${a.id}/move`, { stage_id: s2 });
  assert.deepEqual(column(await board(c, id), s2), ['Delta audit', 'Beta app', 'Acme site']);

  // Summary and dashboard totals are per currency.
  let list = (await c('GET', '/api/pipelines')).body;
  assert.equal(list[0].open, 3);
  assert.deepEqual(list[0].openValue.map((t) => t.label), ['$2,000.50', '€300']);

  // Won keeps the stage, sets closed_at, and leaves the board.
  const won = (await c('PUT', `/api/deals/${a.id}`, { status: 'won' })).body;
  assert.equal(won.status, 'won');
  assert.ok(won.closed_at);
  assert.equal(won.stage_id, s2);
  assert.equal((await c('PUT', `/api/deals/${d.id}`, { status: 'lost' })).body.status, 'lost');
  assert.equal((await c('PUT', `/api/deals/${d.id}`, { status: 'maybe' })).status, 400);
  const dash = (await c('GET', '/api/dashboard')).body;
  assert.deepEqual(dash.pipeline, { open: 1, openValue: [{ currency: 'usd', cents: 80000, label: '$800' }], won30d: 1, wonValue30d: [{ currency: 'usd', cents: 120050, label: '$1,200.50' }] });

  // Reopening clears closed_at and puts it back at the bottom of its column.
  const reopened = (await c('PUT', `/api/deals/${a.id}`, { status: 'open' })).body;
  assert.equal(reopened.closed_at, null);
  assert.deepEqual(column(await board(c, id), s2), ['Beta app', 'Acme site']);

  // Editing details; an empty contact email unlinks the contact.
  const edited = (await c('PUT', `/api/deals/${b.id}`, { title: 'Beta app v2', value: '', contact_email: '', stage_id: s3, notes: 'Call Tuesday' })).body;
  assert.equal(edited.title, 'Beta app v2');
  assert.equal(edited.value_cents, 0);
  assert.equal(edited.contact_id, null);
  assert.equal(edited.stage_id, s3);
  assert.equal(edited.notes, 'Call Tuesday');

  // The contact's deals.
  const cd = (await c('GET', `/api/contacts/${contacts[0].id}/deals`)).body;
  assert.deepEqual(cd.map((x) => [x.title, x.pipeline_name, x.stage_name]), [['Acme site', 'Sales', 'Proposal']]);

  // Deleting the contact keeps the deal.
  await c('DELETE', `/api/contacts/${contacts[0].id}`);
  assert.equal((await board(c, id)).deals.find((x) => x.id === a.id).contact_id, null);
});

test('editing stages renames, reorders, adds and removes (deals in removed stages move to the first)', async () => {
  const c = await signup('stages@example.com');
  const { body: { id } } = await c('POST', '/api/pipelines', { name: 'P', stages: ['A', 'B', 'C'] });
  const [a, b, cc] = (await board(c, id)).stages;
  const d1 = (await c('POST', '/api/deals', { pipeline_id: id, stage_id: b.id, title: 'in B' })).body;
  await c('POST', '/api/deals', { pipeline_id: id, stage_id: cc.id, title: 'in C' });

  const r = await c('PUT', `/api/pipelines/${id}`, { name: 'Renamed', stages: [{ id: cc.id, name: 'C2' }, { name: 'New' }, { id: a.id, name: 'A' }] });
  assert.equal(r.status, 200);
  const p = await board(c, id);
  assert.equal(p.name, 'Renamed');
  assert.deepEqual(p.stages.map((s) => s.name), ['C2', 'New', 'A']);
  assert.deepEqual(column(p, cc.id), ['in C', 'in B']);
  assert.equal(p.deals.find((x) => x.id === d1.id).stage_id, cc.id);

  assert.equal((await c('PUT', `/api/pipelines/${id}`, { stages: [] })).status, 400);
  assert.equal((await c('PUT', `/api/pipelines/${id}`, { stages: [{ id: cc.id, name: 'x' }, { id: cc.id, name: 'y' }] })).status, 400);
  assert.equal((await c('PUT', `/api/pipelines/${id}`, { stages: [{ id: b.id, name: 'gone' }] })).status, 400);

  // A stage from another pipeline can't be used.
  const { body: { id: other } } = await c('POST', '/api/pipelines', { name: 'Other', stages: ['X'] });
  const x = (await board(c, other)).stages[0];
  assert.equal((await c('PUT', `/api/deals/${d1.id}/move`, { stage_id: x.id })).status, 400);
  assert.equal((await c('POST', '/api/deals', { pipeline_id: id, stage_id: x.id, title: 'nope' })).status, 400);

  // Deleting a pipeline deletes its deals.
  assert.equal((await c('DELETE', `/api/pipelines/${id}`)).status, 200);
  assert.equal((await c('GET', `/api/pipelines/${id}`)).status, 404);
  assert.equal((await c('GET', '/api/pipelines')).body.length, 1);
});

test('workspaces cannot see or touch each other’s pipelines and deals', async () => {
  const owner = await signup('owner-pipe@example.com');
  const intruder = await signup('intruder-pipe@example.com');
  const { body: { id } } = await owner('POST', '/api/pipelines', { name: 'Mine', stages: ['A'] });
  const deal = (await owner('POST', '/api/deals', { pipeline_id: id, title: 'Secret deal', value: 99 })).body;
  const theirContact = (await intruder('POST', '/api/contacts', { email: 'x@example.com' })).body;
  const stageId = (await board(owner, id)).stages[0].id;

  assert.deepEqual((await intruder('GET', '/api/pipelines')).body, []);
  assert.equal((await intruder('GET', `/api/pipelines/${id}`)).status, 404);
  assert.equal((await intruder('PUT', `/api/pipelines/${id}`, { name: 'Hacked' })).status, 404);
  assert.equal((await intruder('DELETE', `/api/pipelines/${id}`)).status, 404);
  assert.equal((await intruder('POST', '/api/deals', { pipeline_id: id, title: 'x' })).status, 404);
  assert.equal((await intruder('PUT', `/api/deals/${deal.id}`, { title: 'Hacked' })).status, 404);
  assert.equal((await intruder('PUT', `/api/deals/${deal.id}/move`, { stage_id: stageId })).status, 404);
  await intruder('DELETE', `/api/deals/${deal.id}`);
  // Can't attach another workspace's contact either.
  assert.equal((await owner('PUT', `/api/deals/${deal.id}`, { contact_id: theirContact.id })).status, 400);

  const p = await board(owner, id);
  assert.equal(p.name, 'Mine');
  assert.deepEqual(p.deals.map((d) => d.title), ['Secret deal']);
});
