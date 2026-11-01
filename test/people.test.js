process.env.ALLOW_SIGNUPS = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
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
  return async (method, path, body, { raw } = {}) => {
    const res = await fetch(base + path, { method, redirect: 'manual', headers: { cookie, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    if (raw) return { status: res.status, headers: res.headers, buf: Buffer.from(await res.arrayBuffer()) };
    const type = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : await res.text() };
  };
}
async function signup(email, extra = {}) {
  const c = client();
  const r = await c('POST', '/api/auth/signup', { name: 'Sam Owner', email, ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return c;
}

test('single owner: first sign-up owns the app, then sign-up closes; email links sign in once', async () => {
  // This file's server shares one database, so check the gate with the env switch.
  const owner = await signup('owner-solo@example.com'); // no password: email links only
  delete process.env.ALLOW_SIGNUPS;
  try {
    const status = (await client()('GET', '/api/auth/status')).body;
    assert.equal(status.hasOwner, true);
    assert.equal(status.signupOpen, false);
    const r = await client()('POST', '/api/auth/signup', { name: 'Intruder', email: 'x@example.com', password: 'password123' });
    assert.equal(r.status, 403);
  } finally { process.env.ALLOW_SIGNUPS = '1'; }

  // No password was set, so password login fails.
  assert.equal((await client()('POST', '/api/auth/login', { email: 'owner-solo@example.com', password: 'anything1' })).status, 401);

  // Unknown emails get the same answer and no link.
  const unknown = await client()('POST', '/api/auth/magic', { email: 'nobody@example.com' });
  assert.deepEqual(unknown.body, { ok: true });

  const c = client();
  const r = await c('POST', '/api/auth/magic', { email: 'Owner-Solo@example.com' });
  assert.equal(r.status, 200);
  const path = new URL(r.body.devLink).pathname;
  const login = await c('GET', path);
  assert.equal(login.status, 303);
  assert.equal(login.headers.get('location'), '/#/');
  assert.equal((await c('GET', '/api/me')).body.user.email, 'owner-solo@example.com');
  // Used links don't work twice.
  assert.equal((await client()('GET', path)).status, 400);
  assert.equal((await client()('GET', '/auth/magic/not-a-token')).status, 400);
  await owner('POST', '/api/auth/logout');
});

test('CSV import: 1,000 people in well under 30 seconds, merged by email, idempotent', async () => {
  const c = await signup('import@example.com', { password: 'password123' });
  const rows = Array.from({ length: 1000 }, (_, i) => ({
    email: `person${i}@example.com`, name: `Person Number${i}`, city: 'Austin', tags: i % 2 ? 'podcast' : '',
  }));
  rows.push({ email: 'PERSON5@example.com', first_name: 'Five' }); // same person, different case
  rows.push({ email: 'not-an-email' });
  const t0 = Date.now();
  const r = (await c('POST', '/api/import/people', { rows, source: 'podcast', tag: 'imported' })).body;
  const ms = Date.now() - t0;
  assert.deepEqual(r, { created: 1000, updated: 1, skipped: 1 });
  assert.ok(ms < 30000, `took ${ms}ms`);

  const people = (await c('GET', '/api/contacts?q=person5%40')).body;
  assert.equal(people.length, 1);
  assert.equal(people[0].first_name, 'Five'); // newer non-empty value wins
  assert.equal(people[0].last_name, 'Number5'); // blanks don't erase
  assert.equal(people[0].source, 'podcast');
  assert.equal(people[0].stage, 'audience');
  assert.ok(people[0].tags.includes('imported'));
  const again = (await c('POST', '/api/import/people', { rows: rows.slice(0, 10) })).body;
  assert.deepEqual(again, { created: 0, updated: 10, skipped: 0 });
  assert.equal((await c('GET', '/api/contacts?q=%40example.com')).body.length, 1000);
});

test('orders import groups line items, dedupes by order id, and sets stages from purchases', async () => {
  const c = await signup('orders@example.com', { password: 'password123' });
  const orders = [
    { order_id: '1001', email: 'ann@example.com', name: 'Ann Lee', date: '2026-09-01', total: '$64.00', items: [{ name: 'Mug', qty: 2, price: '12' }, { name: 'Tea', qty: 1, price: '40' }], address1: '1 Main St', city: 'Austin', postal: '78701' },
    { order_id: '1002', email: 'ann@example.com', date: '2026-10-01', items: [{ name: 'Tea', qty: 1, price: '40' }] },
    { order_id: '1003', email: 'bo@example.com', name: 'Bo Diaz', date: '2026-10-05', total: '25' },
    { order_id: '1004' }, // nobody
  ];
  const r = (await c('POST', '/api/import/orders', { orders, source: 'store' })).body;
  assert.deepEqual(r, { created: 3, duplicates: 0, skipped: 1, people: 2 });
  assert.equal((await c('POST', '/api/import/orders', { orders, source: 'store' })).body.duplicates, 3);

  const [bo, ann] = (await c('GET', '/api/contacts')).body;
  assert.equal(ann.stage, 'regular'); // two purchases
  assert.equal(bo.stage, 'customer');
  assert.equal(ann.address1, '1 Main St');

  const page = (await c('GET', `/api/people/${ann.id}`)).body;
  assert.equal(page.totals.orders, 2);
  assert.equal(page.totals.spent_cents, 10400);
  assert.deepEqual(page.orders.map((o) => o.amount_cents), [4000, 6400]);
  assert.deepEqual(page.orders[1].items, [{ name: 'Mug', qty: 2, price_cents: 1200 }, { name: 'Tea', qty: 1, price_cents: 4000 }]);
  assert.equal(page.orders[1].product_name, '2 × Mug, Tea');
  // Timeline in date order, newest first, with the right dates.
  assert.deepEqual(page.events.map((e) => [e.type, String(e.occurred_at).slice(0, 10) || new Date(e.occurred_at).toISOString().slice(0, 10)]).map(([t]) => t), ['purchase', 'purchase']);
  assert.ok(new Date(page.events[0].occurred_at) > new Date(page.events[1].occurred_at));
  assert.equal(page.events[0].source, 'store');
});

test('subscribers import, people without email, manual events, subscriptions and stage changes', async () => {
  const c = await signup('subs@example.com', { password: 'password123' });
  const r = (await c('POST', '/api/import/subscribers', {
    format: 'print', product: 'Field Notes',
    rows: [
      { name: 'Paper Pat', address1: '9 Elm', city: 'Reno', region: 'NV', postal: '89501' }, // no email
      { email: 'eve@example.com', name: 'Eve Ng', format: 'email' },
      { email: 'eve@example.com', format: 'email' }, // already subscribed
      {},
    ],
  })).body;
  assert.deepEqual(r, { created: 2, existing: 1, skipped: 1 });
  const all = (await c('GET', '/api/contacts')).body;
  const pat = all.find((p) => p.first_name === 'Paper');
  const eve = all.find((p) => p.email === 'eve@example.com');
  assert.equal(pat.email, '');
  assert.equal(pat.stage, 'lead');
  assert.ok(pat.tags.includes('print-subscriber'));

  let page = (await c('GET', `/api/people/${pat.id}`)).body;
  assert.equal(page.subscriptions[0].format, 'print');
  assert.equal(page.subscriptions[0].product, 'Field Notes');

  // Manual inquiry, then a purchase → customer; active subscription + purchase → regular.
  const newbie = (await c('POST', '/api/contacts', { email: 'new@example.com' })).body;
  assert.equal(newbie.stage, 'audience');
  assert.equal((await c('POST', `/api/people/${newbie.id}/events`, { type: 'inquiry', note: 'Asked about wholesale' })).status, 201);
  assert.equal((await c('POST', `/api/people/${newbie.id}/events`, { type: 'purchase' })).status, 400);
  page = (await c('GET', `/api/people/${newbie.id}`)).body;
  assert.equal(page.stage, 'lead');
  assert.equal(page.events[0].meta.note, 'Asked about wholesale');

  await c('POST', '/api/import/orders', { orders: [{ order_id: 'A1', email: 'eve@example.com', total: 30 }] });
  assert.equal((await c('GET', `/api/people/${eve.id}`)).body.stage, 'regular');
  const sub = (await c('GET', `/api/people/${eve.id}`)).body.subscriptions[0];
  assert.equal((await c('PUT', `/api/subscriptions/${sub.id}`, { status: 'cancelled' })).status, 200);
  page = (await c('GET', `/api/people/${eve.id}`)).body;
  assert.equal(page.stage, 'customer');
  assert.equal(page.events[0].type, 'unsubscribe');

  // Print needs an address.
  assert.equal((await c('POST', `/api/people/${newbie.id}/subscriptions`, { format: 'print' })).status, 400);
  assert.equal((await c('POST', `/api/people/${newbie.id}/subscriptions`, { format: 'email' })).status, 201);

  // Stage filter.
  assert.deepEqual((await c('GET', '/api/contacts?stage=customer')).body.map((p) => p.email), ['eve@example.com']);
  // Another workspace can't see the person.
  const other = await signup('other-subs@example.com', { password: 'password123' });
  assert.equal((await other('GET', `/api/people/${pat.id}`)).status, 404);
  assert.equal((await other('POST', `/api/people/${pat.id}/events`, { type: 'note' })).status, 404);
  assert.equal((await other('PUT', `/api/subscriptions/${sub.id}`, { status: 'active' })).status, 404);
});

test('full export: JSON and a ZIP of every table as CSV, without payment secrets', async () => {
  const c = await signup('export@example.com', { password: 'password123' });
  await c('PUT', '/api/account/stripe', { secretKey: 'sk_test_secret123' });
  await c('POST', '/api/import/orders', { orders: [{ order_id: 'X', email: 'buyer@example.com', name: 'Buyer, "The" One', total: 10 }] });
  const json = await c('GET', '/api/export.json');
  assert.equal(json.status, 200);
  assert.match(json.headers.get('content-disposition'), /attachment; filename="?export-[\d-]+\.json/);
  const data = typeof json.body === 'string' ? JSON.parse(json.body) : json.body;
  assert.equal(data.people.length, 1);
  assert.equal(data.orders.length, 1);
  assert.equal(data.events.length, 1);
  assert.equal(data.settings.stripe_secret_key, undefined);
  assert.ok(!JSON.stringify(data).includes('sk_test_secret123'));

  const z = await c('GET', '/api/export.zip', undefined, { raw: true });
  assert.equal(z.status, 200);
  const files = unzip(z.buf);
  for (const name of ['settings.csv', 'people.csv', 'events.csv', 'orders.csv', 'subscriptions.csv', 'campaigns.csv', 'funnels.csv', 'deals.csv']) {
    assert.ok(name in files, `${name} missing`);
  }
  assert.match(files['people.csv'], /buyer@example\.com/);
  assert.match(files['people.csv'], /"Buyer,"/); // quoted cell with a comma
  assert.ok(!files['settings.csv'].includes('sk_test_secret123'));
});

// Reads a stored (uncompressed) ZIP and checks each file's CRC.
function unzip(buf) {
  const files = {};
  let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const crc = buf.readUInt32LE(i + 14), size = buf.readUInt32LE(i + 18), nameLen = buf.readUInt16LE(i + 26), extra = buf.readUInt16LE(i + 28);
    const name = buf.subarray(i + 30, i + 30 + nameLen).toString();
    const data = buf.subarray(i + 30 + nameLen + extra, i + 30 + nameLen + extra + size);
    assert.equal(zlib.crc32 ? zlib.crc32(data) : crc, crc, `${name} CRC`);
    files[name] = data.toString();
    i += 30 + nameLen + extra + size;
  }
  assert.equal(buf.readUInt32LE(i), 0x02014b50);
  return files;
}
