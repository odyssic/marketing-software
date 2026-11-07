// The offer ladder: customers ready for the next offer show up on Today and as an email audience.
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

test('ready for the next offer: bought, a while ago, active lately, not bought the next one', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'La', email: 'ladder@example.com', password: 'password123', workspace: 'Ladder Co', business_type: 'services' });
  const guide = (await c('POST', '/api/products', { name: 'Guide', price: 19, currency: 'usd', billing: 'one_time' })).body;
  const course = (await c('POST', '/api/products', { name: 'Course', price: 199, currency: 'usd', billing: 'one_time' })).body;
  const club = (await c('POST', '/api/products', { name: 'Club', price: 9, currency: 'usd', billing: 'monthly' })).body;
  const db = app.getDb();
  const acct = (await c('GET', '/api/me')).body.account.id;
  const person = async (email, { bought = [], active = true }) => {
    const p = (await c('POST', '/api/contacts', { email, first_name: email.split('@')[0] })).body;
    for (const [prod, daysAgo] of bought) {
      await db.run("INSERT INTO orders (account_id, product_id, product_name, contact_id, email, amount_cents, currency, status, mode, paid_at) VALUES (?, ?, 'x', ?, ?, 100, 'usd', 'paid', 'payment', now() - (? || ' days')::interval)",
        acct, prod.id, p.id, email, String(daysAgo));
    }
    await db.run("INSERT INTO events (account_id, person_id, type, occurred_at) VALUES (?, ?, 'click', now() - (? || ' days')::interval)", acct, p.id, active ? '3' : '100');
    return p;
  };
  await person('ready@example.com', { bought: [[guide, 20]] });
  await person('toosoon@example.com', { bought: [[guide, 2]] });
  await person('quiet@example.com', { bought: [[guide, 20]], active: false });
  await person('already@example.com', { bought: [[guide, 30], [course, 10]] });

  // Guide → Club (Club is $108 a year, above $19) unless the owner chooses.
  let today = (await c('GET', '/api/today')).body;
  assert.deepEqual(today.ready.map((r) => [r.from, r.product, r.count]), [['Guide', 'Club', 2]]); // "already" bought the course, not the club
  await c('PUT', `/api/products/${guide.id}`, { name: 'Guide', price: 19, currency: 'usd', billing: 'one_time', next_product_id: course.id });
  today = (await c('GET', '/api/today')).body;
  assert.deepEqual(today.ready.map((r) => [r.product, r.count]), [['Course', 1]]);
  const seg = (await c('GET', '/api/segments')).body.find((s) => s.key === today.ready[0].key);
  assert.equal(seg.label, 'Ready for Course');
  assert.equal((await c('GET', `/api/broadcasts/audience?segment=${encodeURIComponent(seg.key)}`)).body.count, 1);
  assert.ok(club.id);
});
