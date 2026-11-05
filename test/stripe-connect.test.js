// Connecting Stripe with only the secret key: the key is checked and the webhook is made for them.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

let fake, calls = [];
before(async () => {
  fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      calls.push(`${req.method} ${req.url}`);
      res.setHeader('content-type', 'application/json');
      if (req.headers.authorization !== 'Bearer sk_test_good') { res.statusCode = 401; return res.end(JSON.stringify({ error: { message: 'Invalid API Key provided' } })); }
      if (req.url === '/v1/account') return res.end(JSON.stringify({ settings: { dashboard: { display_name: 'Mo Fitness' } } }));
      if (req.url.startsWith('/v1/webhook_endpoints?')) return res.end(JSON.stringify({ data: [{ id: 'we_old', url: 'https://example.com/stripe/webhook/1' }, { id: 'we_other', url: 'https://other.example/x' }] }));
      if (req.method === 'DELETE') return res.end('{}');
      if (req.method === 'POST' && req.url === '/v1/webhook_endpoints') {
        assert.match(body, /enabled_events/);
        return res.end(JSON.stringify({ id: 'we_new', secret: 'whsec_made' }));
      }
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise((r) => fake.listen(0, r));
  process.env.STRIPE_API_BASE = `http://localhost:${fake.address().port}`;
});
after(() => { fake.close(); delete process.env.STRIPE_API_BASE; });

test('a good key gets a fresh webhook, replacing only the old one at the same address', async () => {
  const { connect } = require('../src/stripe');
  calls = [];
  const r = await connect('sk_test_good', 'https://example.com/stripe/webhook/1');
  assert.deepEqual(r, { name: 'Mo Fitness', webhookSecret: 'whsec_made' });
  assert.ok(calls.includes('DELETE /v1/webhook_endpoints/we_old'));
  assert.ok(!calls.some((c) => c.includes('we_other')));
});

test('a wrong key is refused in plain words', async () => {
  const { connect } = require('../src/stripe');
  await assert.rejects(connect('sk_test_bad', 'https://example.com/stripe/webhook/1'), /didn’t accept that key/);
});

test('a local address skips the webhook but keeps the key', async () => {
  const { connect } = require('../src/stripe');
  const r = await connect('sk_test_good', 'http://localhost:3000/stripe/webhook/1');
  assert.equal(r.webhookSecret, null);
});
