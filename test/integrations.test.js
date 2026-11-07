// Integrations: API keys and the public /api/v1, and outgoing signed webhooks.
process.env.ALLOW_SIGNUPS = '1';
process.env.ALLOW_TIME_TRAVEL = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { createApp } = require('../src/app');
const { checkWebhookUrl, privateIp } = require('../src/integrations');

let app, server, base, receiver, recvUrl;
const got = []; // requests the test receiver saw
let answers = []; // status codes the receiver gives next (default 200)
before(async () => {
  app = createApp(process.env.TEST_DATABASE_URL ? {} : { dbPath: ':memory:' });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
  receiver = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => { got.push({ headers: req.headers, body }); res.statusCode = answers.shift() || 200; res.end('ok'); });
  });
  receiver.listen(0);
  await new Promise((r) => receiver.once('listening', r));
  recvUrl = `http://127.0.0.1:${receiver.address().port}/hook`;
});
after(async () => { server.close(); receiver.close(); await app.close(); });
function client() {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
}
const bearer = (key) => async (method, path, body) => {
  const res = await fetch(base + path, { method, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const runJobs = (c, ms = 0) => c('POST', '/api/jobs/run', { now: new Date(Date.now() + ms).toISOString() });
const withLocal = async (fn) => { process.env.WEBHOOKS_ALLOW_LOCAL = '1'; try { return await fn(); } finally { delete process.env.WEBHOOKS_ALLOW_LOCAL; } };
const verify = (secret, header, body) => {
  const { t, v1 } = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const want = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return v1 === want && Math.abs(Date.now() / 1000 - Number(t)) < 300;
};

test('API keys: created once, stored hashed, work as a bearer token, and stop working when removed', async () => {
  const a = client();
  await a('POST', '/api/auth/signup', { name: 'Kay', email: 'kay@example.com', password: 'password123', workspace: 'Kay Co' });
  const k = await a('POST', '/api/integrations/keys', { name: 'Zapier' });
  assert.equal(k.status, 201);
  assert.match(k.body.key, /^rilly_/);
  const row = await app.getDb().get('SELECT * FROM api_keys WHERE id = ?', k.body.id);
  assert.notEqual(row.key_hash, k.body.key, 'only a hash is kept');
  assert.ok(!JSON.stringify((await a('GET', '/api/integrations')).body).includes(k.body.key), 'never shown again');

  const api = bearer(k.body.key);
  assert.equal((await api('GET', '/api/v1/me')).body.account.name, 'Kay Co');
  assert.equal((await fetch(`${base}/api/v1/me`)).status, 401);
  assert.equal((await bearer('rilly_nope')('GET', '/api/v1/people')).status, 401);
  // A cookie alone doesn't open the public API.
  assert.equal((await a('GET', '/api/v1/people')).status, 401);
  assert.equal((await api('GET', '/api/v1/nothing')).status, 404);

  assert.equal((await a('DELETE', `/api/integrations/keys/${k.body.id}`)).status, 200);
  assert.equal((await api('GET', '/api/v1/me')).status, 401);
});

test('the API: upsert people by email, tags, notes, products, orders, forms, follow-ups; strictly one business', async () => {
  const a = client();
  await a('POST', '/api/auth/signup', { name: 'Ada', email: 'ada@example.com', password: 'password123', workspace: 'Ada Shop' });
  const keyA = (await a('POST', '/api/integrations/keys', { name: 'Make' })).body.key;
  const api = bearer(keyA);

  const made = await api('POST', '/api/v1/people', { email: 'Pat@Example.com', first_name: 'Pat', tags: 'vip, zapier', source: 'zapier' });
  assert.equal(made.status, 201);
  assert.equal(made.body.created, true);
  assert.deepEqual(made.body.person.tags, ['vip', 'zapier']);
  const upd = await api('POST', '/api/v1/people', { email: 'pat@example.com', last_name: 'Lee', phone: '555 0100', tags: ['buyer'] });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.person.id, made.body.person.id);
  assert.equal(upd.body.person.name, 'Pat Lee', 'blanks keep what we knew; new values fill in');
  assert.deepEqual(upd.body.person.tags, ['vip', 'zapier', 'buyer']);
  assert.equal((await api('POST', '/api/v1/people', { first_name: 'No email' })).status, 400);
  assert.equal((await api('POST', '/api/v1/people', { email: 'bad' })).body.error, 'A valid email is required');

  const pid = made.body.person.id;
  assert.deepEqual((await api('POST', `/api/v1/people/${pid}/tags`, { tags: ['gold'] })).body.tags, ['vip', 'zapier', 'buyer', 'gold']);
  assert.deepEqual((await api('DELETE', `/api/v1/people/${pid}/tags/zapier`)).body.tags, ['vip', 'buyer', 'gold']);
  assert.equal((await api('GET', '/api/v1/people?tag=gold')).body.data.length, 1);
  assert.equal((await api('GET', '/api/v1/people?search=lee')).body.data[0].email, 'pat@example.com');
  assert.equal((await api('GET', '/api/v1/people?email=nobody@example.com')).body.data.length, 0);
  assert.equal((await api('POST', `/api/v1/people/${pid}/notes`, { note: 'Called from Zapier' })).status, 201);
  const timeline = (await a('GET', `/api/people/${pid}`)).body;
  assert.ok(JSON.stringify(timeline).includes('Called from Zapier'));

  await a('POST', '/api/products', { name: 'Mug', price: '20', currency: 'usd', billing: 'one_time' });
  assert.equal((await api('GET', '/api/v1/products')).body.data[0].name, 'Mug');
  assert.deepEqual((await api('GET', '/api/v1/orders?since=2020-01-01')).body.data, []);
  assert.equal((await api('GET', '/api/v1/orders?since=whenever')).status, 400);
  await a('POST', '/api/funnels', { name: 'Free guide', template: 'optin' });
  const forms = (await api('GET', '/api/v1/forms')).body.data;
  assert.equal(forms[0].name, 'Free guide');
  assert.ok(forms[0].forms.length >= 1, 'lists the forms on its pages');

  // Start a follow-up for a person by email.
  const wf = (await a('POST', '/api/workflows', { name: 'Welcome', template: 'blank' })).body;
  const w = (await a('GET', `/api/workflows/${wf.id}`)).body;
  const root = w.graph.root;
  await a('PUT', `/api/workflows/${wf.id}`, { graph: { root, nodes: { [root]: { type: 'trigger', config: { event: 'manual' }, next: 'n2' }, n2: { type: 'wait', config: { days: 1 } } } } });
  const list = (await api('GET', '/api/v1/follow-ups')).body.data;
  assert.ok(list.some((x) => x.id === wf.id));
  const en = await api('POST', `/api/v1/follow-ups/${wf.id}/enroll`, { email: 'pat@example.com' });
  assert.equal(en.status, 200);
  assert.equal(en.body.added, true);
  assert.equal((await api('POST', `/api/v1/follow-ups/${wf.id}/enroll`, { email: 'ghost@example.com' })).status, 404);

  // Another business can't see or change any of it.
  const b = client();
  await b('POST', '/api/auth/signup', { name: 'Bea', email: 'bea@example.com', password: 'password123', workspace: 'Bea Co' });
  const apiB = bearer((await b('POST', '/api/integrations/keys', {})).body.key);
  assert.equal((await apiB('GET', '/api/v1/people')).body.data.length, 0);
  assert.equal((await apiB('GET', `/api/v1/people/${pid}`)).status, 404);
  assert.equal((await apiB('POST', `/api/v1/people/${pid}/tags`, { tags: 'x' })).status, 404);
  assert.equal((await apiB('POST', `/api/v1/people/${pid}/notes`, { note: 'x' })).status, 404);
  assert.equal((await apiB('POST', `/api/v1/follow-ups/${wf.id}/enroll`, { person_id: pid })).status, 404);
  assert.deepEqual((await apiB('GET', '/api/v1/products')).body.data, []);
  assert.deepEqual((await apiB('GET', '/api/v1/forms')).body.data, []);
  // Same email in B is a different person.
  const inB = await apiB('POST', '/api/v1/people', { email: 'pat@example.com' });
  assert.equal(inB.status, 201);
  assert.notEqual(inB.body.person.id, pid);
  // B can't remove A's key either.
  const aKeyId = (await a('GET', '/api/integrations')).body.keys[0].id;
  assert.equal((await b('DELETE', `/api/integrations/keys/${aKeyId}`)).status, 404);
  assert.equal((await api('GET', '/api/v1/me')).status, 200);
});

test('webhooks: queued on real events (not sent inline), signed, retried after a 500, logged', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Web', email: 'web@example.com', password: 'password123', workspace: 'Web Co' });
  const hook = await withLocal(() => c('POST', '/api/integrations/webhooks', { url: recvUrl, events: ['form.submitted', 'tag.added', 'person.created'] }));
  assert.equal(hook.status, 201, JSON.stringify(hook.body));
  assert.match(hook.body.secret, /^whsec_/);
  assert.ok(!JSON.stringify((await c('GET', '/api/integrations')).body).includes(hook.body.secret), 'secret shown once');

  // A real form opt-in on a published page.
  const f = (await c('POST', '/api/funnels', { name: 'Glaze guide', template: 'optin' })).body;
  const funnel = (await c('GET', `/api/funnels/${f.id}`)).body;
  await c('POST', `/api/funnels/${f.id}/publish`);
  got.length = 0;
  const r = await fetch(`${base}/f/${funnel.slug}/${funnel.steps[0].slug}/optin`, { method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=lead%40example.com&first_name=Lea' });
  assert.equal(r.status, 303);
  assert.equal(got.length, 0, 'nothing is sent while the visitor waits');
  const queued = await app.getDb().all("SELECT event FROM webhook_deliveries WHERE webhook_id = ? AND status = 'pending' ORDER BY id", hook.body.id);
  assert.ok(queued.map((x) => x.event).includes('person.created'));
  assert.ok(queued.map((x) => x.event).includes('form.submitted'));

  await withLocal(() => runJobs(c));
  const form = got.find((x) => x.headers['rilly-event'] === 'form.submitted');
  assert.ok(form, 'delivered by the job');
  assert.ok(verify(hook.body.secret, form.headers['rilly-signature'], form.body), 'valid signature');
  assert.ok(!verify('whsec_wrong', form.headers['rilly-signature'], form.body));
  const p = JSON.parse(form.body);
  assert.equal(p.type, 'form.submitted');
  assert.equal(p.person.email, 'lead@example.com');
  assert.equal(p.person.first_name, 'Lea');
  assert.equal(p.data.form, 'Glaze guide');
  assert.equal(p.data.kind, 'signup');
  assert.match(p.id, /^evt_/);

  // Tag added (by hand in the app) → receiver answers 500, then 200 on the retry.
  got.length = 0;
  answers = [500];
  const pid = p.person.id;
  await c('PUT', `/api/contacts/${pid}`, { tags: ['vip'] });
  await withLocal(() => runJobs(c));
  assert.equal(got.length, 1);
  assert.equal(JSON.parse(got[0].body).data.tag, 'vip');
  let log = (await c('GET', `/api/integrations/webhooks/${hook.body.id}/deliveries`)).body;
  assert.equal(log[0].status, 'pending');
  assert.equal(log[0].attempts, 1);
  assert.equal(log[0].response_status, 500);
  assert.equal((await c('GET', '/api/integrations')).body.webhooks[0].last_status, 500, 'last status shows on the webhook');
  await withLocal(() => runJobs(c)); // not due yet
  assert.equal(got.length, 1);
  await withLocal(() => runJobs(c, 2 * 60e3)); // after the backoff
  assert.equal(got.length, 2);
  assert.ok(verify(hook.body.secret, got[1].headers['rilly-signature'], got[1].body));
  log = (await c('GET', `/api/integrations/webhooks/${hook.body.id}/deliveries`)).body;
  assert.equal(log[0].status, 'sent');
  assert.equal(log[0].attempts, 2);
  assert.equal((await c('GET', '/api/integrations')).body.webhooks[0].last_status, 200);

  // Send test: goes now, shows the answer.
  got.length = 0;
  const t = await withLocal(() => c('POST', `/api/integrations/webhooks/${hook.body.id}/test`));
  assert.deepEqual(t.body, { ok: true, status: 200, error: '' });
  assert.equal(JSON.parse(got[0].body).type, 'test.ping');

  // Events the webhook didn't pick aren't queued; turned-off webhooks get nothing.
  const before = (await app.getDb().get('SELECT COUNT(*)::int AS n FROM webhook_deliveries')).n;
  await c('PUT', `/api/integrations/webhooks/${hook.body.id}`, { active: false });
  await c('POST', '/api/contacts', { email: 'quiet@example.com', tags: 'x' });
  assert.equal((await app.getDb().get('SELECT COUNT(*)::int AS n FROM webhook_deliveries')).n, before);

  // Another business can't see or test this webhook.
  const o = client();
  await o('POST', '/api/auth/signup', { name: 'Oz', email: 'oz@example.com', password: 'password123', workspace: 'Oz Co' });
  assert.equal((await o('GET', `/api/integrations/webhooks/${hook.body.id}/deliveries`)).status, 404);
  assert.equal((await o('POST', `/api/integrations/webhooks/${hook.body.id}/test`)).status, 404);
  assert.equal((await o('DELETE', `/api/integrations/webhooks/${hook.body.id}`)).status, 404);
});

test('webhooks never go to private or internal addresses', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Sec', email: 'sec@example.com', password: 'password123', workspace: 'Sec Co' });
  for (const url of ['http://example.com/hook', recvUrl, 'https://127.0.0.1/x', 'https://localhost/x', 'https://10.1.2.3/x', 'https://192.168.0.5/x',
    'https://172.20.0.1/x', 'https://169.254.169.254/latest', 'https://[::1]/x', 'https://[::ffff:127.0.0.1]/x', 'https://0.0.0.0/x', 'https://metadata.internal/x',
    'https://intranet/x', 'https://user:pw@example.com/x', 'ftp://example.com/x', 'not a url']) {
    const r = await c('POST', '/api/integrations/webhooks', { url, events: ['tag.added'] });
    assert.equal(r.status, 400, url);
  }
  assert.equal((await c('POST', '/api/integrations/webhooks', { url: 'https://8.8.8.8/hook', events: [] })).status, 400, 'needs an event');
  assert.equal((await c('POST', '/api/integrations/webhooks', { url: 'https://8.8.8.8/hook', events: ['tag.added'] })).status, 201, 'public IPs are fine');
  assert.ok(privateIp('::ffff:10.0.0.1'));
  assert.ok(privateIp('fd00::1'));
  assert.ok(!privateIp('93.184.216.34'));
  await assert.rejects(checkWebhookUrl('https://10.0.0.1/'), /public internet/);
  // The local test receiver is only allowed with WEBHOOKS_ALLOW_LOCAL=1.
  assert.equal(await withLocal(() => checkWebhookUrl(recvUrl)), recvUrl);
});
