// Website chat: visitor starts a chat, it lands in the Inbox, replies show in the chat or go by email.
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
    return { status: res.status, headers: res.headers, body: (res.headers.get('content-type') || '').includes('json') ? await res.json() : await res.text() };
  };
}

test('website chat: off by default, then start, inbox, reply in chat, reply by email once they leave', async () => {
  const c = client(), v = client();
  await c('POST', '/api/auth/signup', { name: 'Cy', email: 'chat@example.com', password: 'password123', workspace: 'Cy Cycles', business_type: 'shop' });
  const acct = (await c('GET', '/api/me')).body.account.id;
  assert.deepEqual((await v('GET', `/chat/${acct}/config`)).body, { on: false });
  assert.equal((await v('POST', `/chat/${acct}/start`, { email: 'a@b.co', message: 'hi' })).status, 404);

  await c('PUT', '/api/account/chat', { on: true, greeting: 'Ask about bikes!' });
  const cfg = await v('GET', `/chat/${acct}/config`);
  assert.equal(cfg.headers.get('access-control-allow-origin'), '*');
  assert.equal(cfg.body.greeting, 'Ask about bikes!');
  assert.equal((await v('POST', `/chat/${acct}/start`, { email: 'nope', message: 'hi' })).status, 400);
  const s = (await v('POST', `/chat/${acct}/start`, { name: 'Pat Rider', email: 'pat@example.com', message: 'Do you fix e-bikes?' })).body;
  assert.ok(s.token);
  assert.deepEqual(s.messages.map((m) => [m.direction, m.body]), [['in', 'Do you fix e-bikes?']]);
  assert.equal((await v('GET', `/chat/${acct}/poll?token=1.aaaaaaaaaaaaaaaaaaaa`)).status, 401);

  // In the Inbox; the owner got a heads-up.
  const conv = (await c('GET', '/api/inbox')).body.conversations[0];
  assert.equal(conv.channel, 'chat');
  assert.equal(conv.first_name, 'Pat');
  const out = (await c('GET', '/api/outbox')).body;
  assert.ok(out.some((m) => /Website chat from Pat Rider/.test(m.subject)));

  // Reply while they're on the page: shows in the chat, no email.
  assert.equal((await c('POST', `/api/inbox/${conv.id}/reply`, { channel: 'chat', body: 'Yes we do!' })).body.status, 'sent');
  const p = (await v('GET', `/chat/${acct}/poll?token=${encodeURIComponent(s.token)}&after=${s.messages[0].id}`)).body;
  assert.deepEqual(p.messages.map((m) => [m.direction, m.body]), [['out', 'Yes we do!']]);

  // They've gone: the reply is emailed too.
  await app.getDb().run("UPDATE contacts SET chat_seen_at = now() - interval '1 hour' WHERE id = ?", conv.id);
  assert.equal((await c('POST', `/api/inbox/${conv.id}/reply`, { channel: 'chat', body: 'Bring it Tuesday.' })).body.status, 'emailed');
  const mail = (await c('GET', '/api/outbox')).body.find((m) => m.to_email === 'pat@example.com');
  assert.match(mail.subject, /Cy Cycles replied/);

  // A token for one business doesn't work for another.
  const o = client();
  await o('POST', '/api/auth/signup', { name: 'Oz', email: 'oz-chat@example.com', password: 'password123', workspace: 'Oz', business_type: 'shop' });
  const acct2 = (await o('GET', '/api/me')).body.account.id;
  await o('PUT', '/api/account/chat', { on: true });
  assert.equal((await v('GET', `/chat/${acct2}/poll?token=${encodeURIComponent(s.token)}`)).status, 401);
});

test('the chat bubble is added to published pages when chat is on', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Pa', email: 'chatpage@example.com', password: 'password123', workspace: 'Pa', business_type: 'services' });
  const f = (await c('POST', '/api/funnels', { name: 'Home', template: 'elegant_guide' })).body;
  await c('POST', `/api/funnels/${f.id}/publish`);
  const slug = (await c('GET', `/api/funnels/${f.id}`)).body.slug;
  assert.doesNotMatch((await client()('GET', `/f/${slug}`)).body, /data-rilly-chat/);
  await c('PUT', '/api/account/chat', { on: true });
  assert.match((await client()('GET', `/f/${slug}`)).body, /<script src="[^"]+\/chat\.js" data-rilly-chat="\d+" defer><\/script><\/body>/);
  assert.doesNotMatch((await client()('GET', `/f/${slug}?embed=1`)).body, /data-rilly-chat/);
});
