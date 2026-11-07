// Email extras: subject A/B test, per-link clicks, the report, templates.
process.env.ALLOW_SIGNUPS = '1';
process.env.ALLOW_TIME_TRAVEL = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { splitForTest, pickWinner } = require('../src/emailplus');

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
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, body: type.includes('json') ? await res.json() : await res.text(), type };
  };
}

test('split: slices for A and B, the rest waits; small lists split in half', () => {
  const big = splitForTest(Array.from({ length: 200 }, (_, i) => i), 20);
  assert.equal(big.a.length, 20); assert.equal(big.b.length, 20); assert.equal(big.rest.length, 160);
  assert.equal(new Set([...big.a, ...big.b, ...big.rest]).size, 200, 'nobody twice');
  const small = splitForTest([1, 2, 3, 4, 5], 20);
  assert.equal(small.rest.length, 0); assert.equal(small.a.length + small.b.length, 5);
  assert.equal(pickWinner({ sent: 10, opened: 2 }, { sent: 10, opened: 5 }), 'b');
  assert.equal(pickWinner({ sent: 10, opened: 3 }, { sent: 10, opened: 3 }), 'a', 'a tie keeps A');
});

test('subject test sends the winner to everyone else; the report counts it all', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Em', email: 'em@example.com', password: 'password123', business_type: 'shop' });
  const db = app.getDb();
  const acct = (await c('GET', '/api/me')).body.account.id;
  for (let i = 0; i < 60; i++) await db.run('INSERT INTO contacts (account_id, email, first_name) VALUES (?, ?, ?)', acct, `r${i}@x.com`, `R${i}`);

  const b = (await c('POST', '/api/broadcasts', { subject: 'Plain subject', subject_b: 'Curious subject?', ab_pct: 20, ab_hours: 2, body: 'Hi\n\n[Read it](https://example.com/read)\n\nhttps://example.com/shop' })).body;
  const sent = (await c('POST', `/api/broadcasts/${b.id}/send`)).body;
  assert.equal(sent.testing, true);
  assert.equal(sent.sent, 20, 'at least 10 people per subject');
  assert.equal((await c('GET', `/api/broadcasts/${b.id}`)).body.status, 'testing');

  // B gets opened more, and a link is clicked twice.
  const bRows = await db.all("SELECT id FROM email_log WHERE broadcast_id = ? AND ab_variant = 'b'", b.id);
  await db.run(`UPDATE email_log SET opened_at = now() WHERE id IN (${bRows.slice(0, 4).map((r) => r.id).join(',')})`);
  const { sign } = app.messaging || {};
  void sign;
  await db.run('INSERT INTO email_clicks (email_id, url) VALUES (?, ?), (?, ?)', bRows[0].id, 'https://example.com/read', bRows[1].id, 'https://example.com/read');

  // Not yet: the winner waits for the test time.
  await c('POST', '/api/jobs/run', { now: new Date(Date.now() + 3600e3).toISOString() });
  assert.equal((await c('GET', `/api/broadcasts/${b.id}`)).body.status, 'testing');
  await c('POST', '/api/jobs/run', { now: new Date(Date.now() + 3 * 3600e3).toISOString() });
  const done = (await c('GET', `/api/broadcasts/${b.id}`)).body;
  assert.equal(done.status, 'sent');
  assert.equal(done.ab_winner, 'b');
  const rest = await db.all("SELECT subject FROM email_log WHERE broadcast_id = ? ORDER BY id DESC LIMIT 40", b.id);
  assert.ok(rest.every((r) => r.subject === 'Curious subject?'), 'everyone else got B');
  assert.equal((await db.get('SELECT COUNT(DISTINCT contact_id)::int AS n FROM email_log WHERE broadcast_id = ?', b.id)).n, 60, 'each person once');

  const rep = (await c('GET', `/api/broadcasts/${b.id}/report`)).body;
  assert.equal(rep.totals.sent, 60);
  assert.equal(rep.totals.opened, 4);
  assert.equal(rep.ab.winner, 'b');
  assert.deepEqual(rep.links[0], { url: 'https://example.com/read', clicks: 2, people: 2 });
  const csv = await c('GET', `/api/broadcasts/${b.id}/report.csv`);
  assert.match(csv.type, /text\/csv/);
  assert.equal(csv.body.trim().split('\r\n').length, 61);
});

test('templates: save, list, delete, only your own', async () => {
  const c = client(), other = client();
  await c('POST', '/api/auth/signup', { name: 'T', email: 't3@example.com', password: 'password123', business_type: 'shop' });
  await other('POST', '/api/auth/signup', { name: 'O', email: 'o3@example.com', password: 'password123', business_type: 'shop' });
  const t = (await c('POST', '/api/email-templates', { name: 'Newsletter', subject: 'News', body: '## This month\n\nHi' })).body;
  assert.equal((await c('GET', '/api/email-templates')).body[0].name, 'Newsletter');
  assert.deepEqual((await other('GET', '/api/email-templates')).body, []);
  await other('DELETE', `/api/email-templates/${t.id}`);
  assert.equal((await c('GET', '/api/email-templates')).body.length, 1, 'someone else can’t delete it');
  await c('DELETE', `/api/email-templates/${t.id}`);
  assert.deepEqual((await c('GET', '/api/email-templates')).body, []);
});
