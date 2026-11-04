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

test('dashboard numbers: revenue vs last period, recurring, lifetime value, repeat rate', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Mo', email: 'mo-metrics@example.com', password: 'password123', workspace: 'Mo Shop' });
  const db = app.getDb();
  const acct = (await c('GET', '/api/me')).body.account.id;
  const ago = (d) => new Date(Date.now() - d * 864e5).toISOString();
  const person = async (email, d) => (await db.get('INSERT INTO contacts (account_id, email, created_at) VALUES (?, ?, ?) RETURNING id', acct, email, ago(d))).id;
  const monthly = (await db.get("INSERT INTO products (account_id, name, description, price_cents, currency, billing, tag, image_url) VALUES (?, 'Club', '', 2000, 'usd', 'monthly', '', '') RETURNING id", acct)).id;
  const order = (cid, cents, d, extra = {}) => db.run("INSERT INTO orders (account_id, product_name, amount_cents, currency, mode, status, paid_at, contact_id, product_id, attribution) VALUES (?, 'x', ?, 'usd', ?, 'paid', ?, ?, ?, ?)",
    acct, cents, extra.mode || 'stripe', ago(d), cid, extra.product || null, extra.src ? JSON.stringify({ source: extra.src }) : '');
  const a = await person('a@example.com', 5), b = await person('b@example.com', 10), z = await person('z@example.com', 40);
  await order(a, 5000, 3, { src: 'Instagram' }); await order(a, 3000, 1, { src: 'Instagram' });
  await order(b, 2000, 2, { product: monthly });
  await order(z, 4000, 35); // last period
  await order(b, 9999, 2, { mode: 'test' }); // test money doesn't count
  const m = (await c('GET', '/api/metrics?range=30d')).body;
  assert.equal(m.current.revenue, 10000);
  assert.equal(m.previous.revenue, 4000);
  assert.equal(m.current.orders, 3);
  assert.equal(m.current.newCustomers, 2);
  assert.equal(m.current.leads, 2);
  assert.equal(m.mrr, 2000);
  assert.equal(m.customers, 3);
  assert.equal(m.ltv, 14000 / 3);
  assert.equal(Math.round(m.repeatRate * 100), 33);
  assert.equal(m.testOrders, 1);
  assert.equal(m.series.length, 30);
  assert.equal(m.series.reduce((n, s) => n + s.revenue, 0), 10000);
  assert.equal(m.series.reduce((n, s) => n + s.prevRevenue, 0), 4000);
  assert.deepEqual(m.sources[0], { name: 'Instagram', cents: 8000 });
  const year = (await c('GET', '/api/metrics?range=12m')).body;
  assert.equal(year.unit, 'month');
  assert.equal(year.current.revenue, 14000);
});
