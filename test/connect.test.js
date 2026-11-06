// One-click setup: Log in with Stripe (Connect) and Get a number (Twilio).
process.env.ALLOW_SIGNUPS = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../src/app');

let app, server, base, fake;
const calls = [];
const ENV = {
  TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tok', STRIPE_CONNECT_CLIENT_ID: 'ca_test', RILLY_STRIPE_KEY: 'sk_test_platform',
};
before(async () => {
  fake = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => {
      calls.push(`${req.method} ${req.url.split('?')[0]} ${body}`);
      res.setHeader('content-type', 'application/json');
      const u = req.url;
      if (u.startsWith('/2010-04-01/Accounts/AC1/AvailablePhoneNumbers/US/Local.json')) {
        assert.match(u, /AreaCode=503/);
        return res.end(JSON.stringify({ available_phone_numbers: [{ phone_number: '+15035550111', friendly_name: '(503) 555-0111', locality: 'Portland', region: 'OR' }] }));
      }
      if (u === '/2010-04-01/Accounts/AC1/IncomingPhoneNumbers.json') return res.end(JSON.stringify({ sid: 'PN1', phone_number: new URLSearchParams(body).get('PhoneNumber') }));
      if (req.method === 'DELETE') { res.statusCode = 204; return res.end(); }
      if (u === '/oauth/token') {
        assert.equal(req.headers.authorization, 'Bearer sk_test_platform');
        return res.end(JSON.stringify({ access_token: 'sk_test_connected', stripe_user_id: 'acct_123' }));
      }
      if (u === '/v1/account') return res.end(JSON.stringify({ settings: { dashboard: { display_name: 'Bea' } } }));
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise((r) => fake.listen(0, r));
  const f = `http://localhost:${fake.address().port}`;
  Object.assign(process.env, ENV, { TWILIO_API_BASE: f, STRIPE_CONNECT_BASE: f, STRIPE_API_BASE: f });
  app = createApp(process.env.TEST_DATABASE_URL ? {} : { dbPath: ':memory:' });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});
after(async () => {
  server.close(); fake.close(); await app.close();
  for (const k of [...Object.keys(ENV), 'TWILIO_API_BASE', 'STRIPE_CONNECT_BASE', 'STRIPE_API_BASE']) delete process.env[k];
});
function client() {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(base + path, { method, redirect: 'manual', headers: { cookie, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: res.status, location: res.headers.get('location'), body: (res.headers.get('content-type') || '').includes('json') ? await res.json() : await res.text() };
  };
}

test('get a number: search an area code, buy one pointed at Rilly', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Ty', email: 'ty@example.com', password: 'password123', business_type: 'services' });
  const list = await c('GET', '/api/account/texting/numbers?area=503');
  assert.equal(list.body[0].place, 'Portland, OR');
  const r = await c('POST', '/api/account/texting/numbers', { phone: list.body[0].phone });
  assert.equal(r.body.sms_number, '+15035550111');
  const buy = calls.find((x) => x.includes('IncomingPhoneNumbers.json'));
  assert.match(decodeURIComponent(buy), /SmsUrl=.*\/hooks\/sms/);
  assert.match(decodeURIComponent(buy), /VoiceUrl=.*\/hooks\/voice/);
  assert.equal((await c('GET', '/api/account/texting')).body.sms_number, '+15035550111');
});

test('log in with Stripe: the key arrives on its own', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Bea', email: 'bea@example.com', password: 'password123', business_type: 'shop' });
  assert.equal((await c('GET', '/api/me')).body.payments.canLogin, true);
  const { url } = (await c('POST', '/api/account/stripe/connect')).body;
  const state = new URL(url).searchParams.get('state');
  assert.match(url, /client_id=ca_test/);
  // A made-up state is refused.
  assert.equal((await c('GET', `/stripe/connect?code=x&state=${state.split('.')[0]}.forged0000000000000000000`)).status, 400);
  const back = await c('GET', `/stripe/connect?code=ac_1&state=${encodeURIComponent(state)}`);
  assert.equal(back.status, 303);
  assert.equal(back.location, '/#/settings?stripe=connected');
  const me = (await c('GET', '/api/me')).body;
  assert.equal(me.payments.connected, true);
  assert.equal(me.payments.keyHint, '…cted');
});
