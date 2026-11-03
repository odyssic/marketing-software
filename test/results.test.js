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
const { versus } = require('../src/results');

test('versus says better or worse in words', () => {
  assert.equal(versus(12, 8, (x) => `${x}%`), 'up from 8%');
  assert.equal(versus(3, 5), 'down from 5');
  assert.equal(versus(4, 4), 'the same as last week');
  assert.equal(versus(4, 0), 'up from none last week');
  assert.equal(versus(4, null), '');
});

test('the Monday digest opens with the week in plain English', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Ray', email: 'ray@example.com', password: 'password123', workspace: 'Ray Repairs', business_type: 'services' });
  const quiet = (await c('GET', '/api/digest/preview')).body.text;
  assert.match(quiet, /A quiet week/);

  const { funnel_id } = (await c('POST', '/api/setup/build', { business_type: 'services', name: 'Ray Repairs', goal: 'booked' })).body;
  const db = app.getDb();
  const f = await db.get('SELECT id, account_id, entry_step_id FROM funnels WHERE id = ?', funnel_id);
  const ago = (days) => new Date(Date.now() - days * 864e5).toISOString();
  const ev = async (n, type, days, source = '') => { for (let i = 0; i < n; i++) await db.run('INSERT INTO page_events (account_id, funnel_id, step_id, type, source, created_at) VALUES (?, ?, ?, ?, ?, ?)', f.account_id, f.id, f.entry_step_id, type, source, ago(days)); };
  await ev(50, 'view', 2); await ev(6, 'optin', 2, 'Instagram'); // this week: 12%
  await ev(50, 'view', 9); await ev(4, 'optin', 9); // last week: 8%
  for (const [i, d] of [[1, 1], [2, 2], [3, 3], [4, 10]]) await db.run('INSERT INTO contacts (account_id, email, created_at) VALUES (?, ?, ?)', f.account_id, `p${i}@example.com`, ago(d));
  await db.run("INSERT INTO orders (account_id, product_name, amount_cents, currency, mode, status, paid_at) VALUES (?, 'Fix', 12000, 'usd', 'stripe', 'paid', ?)", f.account_id, ago(1));
  await db.run("INSERT INTO orders (account_id, product_name, amount_cents, currency, mode, status, paid_at) VALUES (?, 'Fix', 8000, 'usd', 'stripe', 'paid', ?)", f.account_id, ago(8));
  await c('POST', '/api/invoices', { client_email: 'kim@example.com', items: [{ description: 'Boiler service', price: 90 }], send: true });

  const { text, subject } = (await c('GET', '/api/digest/preview')).body;
  assert.match(text, /THIS WEEK/);
  assert.match(text, /page turned 12% of visitors into bookings this week, up from 8%/);
  assert.match(text, /4 new people joined, up from 1\. Most came from Instagram\./);
  assert.match(text, /You took \$120 from 1 payment, up from \$80\./);
  assert.match(text, /\$90 is waiting on 1 invoice\./);
  assert.ok(text.indexOf('THIS WEEK') < text.indexOf('HOW EACH AREA IS DOING'));
  assert.ok(subject);
});
