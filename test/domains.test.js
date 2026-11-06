// Sending from the business's own domain: add it, show DNS records, verify, use it as From.
process.env.ALLOW_SIGNUPS = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../src/app');
const { ownAddress } = require('../src/domains');
const mailer = require('../src/mailer');

let app, server, base, fake, status = 'not_started';
const calls = [];
before(async () => {
  fake = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => {
      calls.push(`${req.method} ${req.url}`);
      res.setHeader('content-type', 'application/json');
      const dom = { id: 'd_1', name: 'bakery.com', status, records: [{ record: 'DKIM', type: 'TXT', name: 'resend._domainkey', value: 'p=MIGf', ttl: 'Auto', status }] };
      if (req.method === 'POST' && req.url === '/domains') return res.end(JSON.stringify(dom));
      if (req.method === 'POST' && req.url === '/domains/d_1/verify') { status = 'verified'; return res.end('{}'); }
      if (req.url === '/domains/d_1') return res.end(JSON.stringify(dom));
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise((r) => fake.listen(0, r));
  process.env.RESEND_API_BASE = `http://localhost:${fake.address().port}`;
  process.env.RESEND_API_KEY = 're_test';
  app = createApp(process.env.TEST_DATABASE_URL ? {} : { dbPath: ':memory:' });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});
after(async () => { server.close(); fake.close(); await app.close(); delete process.env.RESEND_API_BASE; delete process.env.RESEND_API_KEY; });
function client() {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
}

test('add a domain, add its records, verify, then send from it', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Bea', email: 'bea@gmail.com', password: 'password123', workspace: 'Bea’s Bakery', business_type: 'local' });
  assert.equal((await c('GET', '/api/account/sending-domain')).body.available, true);
  assert.equal((await c('POST', '/api/account/sending-domain', { domain: 'gmail.com' })).status, 400, 'free email services refused');
  assert.equal((await c('POST', '/api/account/sending-domain', { domain: 'not a domain' })).status, 400);

  const r = await c('POST', '/api/account/sending-domain', { domain: 'https://www.Bakery.com/', local: 'orders' });
  assert.equal(r.body.domain, 'bakery.com');
  assert.equal(r.body.address, 'orders@bakery.com');
  assert.equal(r.body.records[0].name, 'resend._domainkey');
  assert.notEqual(r.body.status, 'verified');

  const acct = async () => app.getDb().get("SELECT * FROM accounts WHERE name = 'Bea’s Bakery'");
  assert.equal(ownAddress(await acct()), null, 'not used until verified');
  const v = await c('POST', '/api/account/sending-domain/verify');
  assert.equal(v.body.status, 'verified');
  assert.equal(ownAddress(await acct()), 'orders@bakery.com');

  // With real sending on, the From is the business's own address and replies go to the owner.
  process.env.SMTP_HOST = 'smtp.example.com';
  try {
    const s = mailer.senderFor({ name: 'Bea’s Bakery', replyTo: 'bea@gmail.com', own: ownAddress(await acct()) });
    assert.equal(s.from, '"Bea’s Bakery" <orders@bakery.com>');
    assert.equal(s.replyTo, 'bea@gmail.com');
  } finally { delete process.env.SMTP_HOST; }

  assert.equal((await c('DELETE', '/api/account/sending-domain')).status, 200);
  assert.equal(ownAddress(await acct()), null);
});
