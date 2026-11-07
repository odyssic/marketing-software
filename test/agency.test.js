// Agency brand and the monthly client report.
process.env.ALLOW_SIGNUPS = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { rillyEmail } = require('../src/emailhtml');

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
    return { status: res.status, body: await res.json() };
  };
}

test('emails in the agency’s brand: their logo and name, their colour, no Rilly sign-off', () => {
  const html = rillyEmail({ base: 'https://x', title: 'Hi', blocks: [{ button: ['Go', 'https://x'] }], brand: { name: 'Brightside', logo: 'https://cdn/logo.png', color: '#aa3366' } });
  assert.match(html, /<img src="https:\/\/cdn\/logo.png"[^>]*alt="Brightside"/);
  assert.match(html, /#aa3366/);
  assert.doesNotMatch(html, /#1F7F78/);
  assert.doesNotMatch(html, /Rilly · Simple Marketing/);
  assert.match(rillyEmail({ base: 'https://x', title: 'Hi' }), /Rilly · Simple Marketing/, 'unchanged without a brand');
});

test('the agency brand shows for everyone in the businesses it owns', async () => {
  const ag = client();
  await ag('POST', '/api/auth/signup', { name: 'Ann', email: 'ann@brightside.com', password: 'password123', workspace: 'Client Cafe', business_type: 'local' });
  assert.equal((await ag('PUT', '/api/agency-brand', { name: 'Brightside', logo: 'javascript:alert(1)' })).status, 400);
  assert.equal((await ag('PUT', '/api/agency-brand', { name: 'Brightside', logo: 'https://cdn.example/logo.png', color: '#aa3366' })).status, 200);
  assert.deepEqual((await ag('GET', '/api/me')).body.brand, { name: 'Brightside', logo: 'https://cdn.example/logo.png', color: '#aa3366' });
  // An invited client sees it too.
  const token = (await ag('POST', '/api/team/invites', { email: 'cafe@owner.com' })).body.devLink.split('/invite/')[1];
  const cl = client();
  await cl('POST', `/api/invites/${token}/accept`, { name: 'Cafe Owner', password: 'cafepass123' });
  assert.equal((await cl('GET', '/api/me')).body.brand.name, 'Brightside');
});

test('monthly report: last month next to the month before, sent once on the 1st', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Ro', email: 'ro@example.com', password: 'password123', workspace: 'Rose Bakery', business_type: 'shop' });
  const db = app.getDb();
  const acct = (await c('GET', '/api/me')).body.account.id;
  const now = new Date(), y = now.getUTCFullYear(), m = now.getUTCMonth();
  const mid = (k) => new Date(Date.UTC(y, m + k, 15)).toISOString();
  for (let i = 0; i < 3; i++) await db.run("INSERT INTO contacts (account_id, email, created_at) VALUES (?, ?, ?)", acct, `l${i}@x.com`, mid(-1));
  await db.run("INSERT INTO contacts (account_id, email, created_at) VALUES (?, ?, ?)", acct, 'old@x.com', mid(-2));

  assert.equal((await c('PUT', '/api/report', { to: 'bad', monthly: true })).status, 400);
  assert.equal((await c('PUT', '/api/report', { to: '', monthly: true })).status, 400);
  assert.equal((await c('PUT', '/api/report', { to: 'Client@Rose.com, ro@example.com', monthly: true })).status, 200);
  const r = (await c('GET', '/api/report')).body;
  assert.equal(r.to, 'client@rose.com, ro@example.com');
  assert.match(r.preview, /New leads/);
  assert.match(r.preview, />3</);
  assert.match(r.preview, /up from 1/);

  const first = new Date(Date.UTC(y, m + 1, 1, 9));
  assert.equal((await app.runJobs(first)).reports, 1);
  assert.equal((await app.runJobs(new Date(first.getTime() + 3600e3))).reports, 0, 'once a month');
});
