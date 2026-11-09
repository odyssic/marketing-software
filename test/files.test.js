// Files: a PDF handed out on a sign-up page arrives as a personal link, and downloads are logged.
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
  return async (method, path, body, type = 'application/json') => {
    const res = await fetch(base + path, { method, redirect: 'manual', headers: { cookie, 'content-type': type }, body: body && (type === 'application/json' ? JSON.stringify(body) : body) });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    const t = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, body: t.includes('json') ? await res.json() : await res.text() };
  };
}

test('a guide from Files goes out as a personal link, and each download is logged', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Fi', email: 'fi@example.com', password: 'password123', business_type: 'coach' });
  const up = await c('POST', '/api/uploads', Buffer.from('%PDF-1.4\n% The Magnificent 7\n'), 'application/pdf');
  assert.equal(up.status, 201);
  await c('PUT', `/api/files/${up.body.id}`, { name: 'The Magnificent 7' });
  assert.equal((await c('GET', '/api/files')).body[0].name, 'The Magnificent 7');

  // A page whose form sends that file.
  const f = (await c('POST', '/api/funnels', { name: 'Guide', template: 'optin' })).body;
  const full = (await c('GET', `/api/funnels/${f.id}`)).body;
  const st = full.steps[0];
  await c('PUT', `/api/steps/${st.id}`, { name: st.name, blocks: st.blocks.map((b) => (b.type === 'form' ? { ...b, deliverUrl: up.body.url, deliverName: 'the guide' } : b)) });
  await c('POST', `/api/funnels/${f.id}/publish`);

  const visitor = client();
  await visitor('POST', `/f/${full.slug}/${st.slug}/optin`, new URLSearchParams({ email: 'reader@example.com', first_name: 'Rea' }).toString(), 'application/x-www-form-urlencoded');
  const mail = (await c('GET', '/api/outbox')).body.find((m) => m.to_email === 'reader@example.com' && /guide/.test(m.subject));
  const link = mail.body.match(/https?:\/\/\S+\/dl\/\S+/)[0];
  assert.doesNotMatch(mail.body, /\/u\//, 'not the public link');

  const dl = await visitor('GET', new URL(link).pathname);
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get('content-type'), 'application/pdf');
  assert.match(dl.headers.get('content-disposition'), /The Magnificent 7\.pdf/);
  assert.equal((await c('GET', '/api/files')).body[0].downloads, 1);

  // A changed link doesn't work.
  const parts = new URL(link).pathname.split('.');
  assert.equal((await visitor('GET', `${parts.slice(0, -1).join('.')}.AAAAAAAAAAAAAAAAAAAAAA`)).status, 404);
  const other = new URL(link).pathname.replace(/^\/dl\/\d+/, '/dl/99999');
  assert.equal((await visitor('GET', other)).status, 404, 'someone else’s number doesn’t work');
});

test('setup with a guide: one welcome email with the guide’s name as its link; a reminder only if they haven’t opened it', async () => {
  process.env.ALLOW_TIME_TRAVEL = '1';
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Gi', email: 'gi-guide@example.com', password: 'password123', business_type: 'shop' });
  const up = (await c('POST', '/api/uploads', Buffer.from('%PDF-1.4\n% guide\n'), 'application/pdf')).body;
  const r = (await c('POST', '/api/setup/build', { business_type: 'shop', name: 'Classic Typewriter', goal: 'list', incentive: 'guide', guide: 'The Magnificent 7', guide_url: up.url })).body;
  assert.equal(r.guide_needs_file, false);
  const f = (await c('GET', `/api/funnels/${r.funnel_id}`)).body;
  assert.equal(f.steps[0].blocks.find((b) => b.type === 'form').deliverUrl, up.url);
  await c('POST', `/api/funnels/${f.id}/publish`);
  for (const w of r.followups) await c('PUT', `/api/workflows/${w.id}/status`, { status: 'active' });

  const signup = (email) => client()('POST', `/f/${f.slug}/${f.steps[0].slug}/optin`, new URLSearchParams({ email, first_name: email.split('@')[0] }).toString(), 'application/x-www-form-urlencoded');
  await signup('reader@example.com'); await signup('opener@example.com');
  await c('POST', '/api/jobs/run', {});
  const mine = async (to) => (await c('GET', '/api/outbox')).body.filter((m) => m.to_email === to);
  const first = await mine('reader@example.com');
  assert.equal(first.length, 1, 'one email, not a delivery email plus a welcome');
  assert.match(first[0].body, /Thanks for signing up\. Here it is: The Magnificent 7 \(https?:\/\/\S+\/dl\/\S+\)/);
  assert.doesNotMatch(first[0].body, /\[Link to your download\]/);

  // One of them opens it.
  const link = (await mine('opener@example.com'))[0].body.match(/\/dl\/[^)\s]+/)[0];
  assert.equal((await client()('GET', link)).status, 200);

  await c('POST', '/api/jobs/run', { now: new Date(Date.now() + 2.2 * 864e5).toISOString() });
  const reminders = (await c('GET', '/api/outbox')).body.filter((m) => /^Did you get/.test(m.subject));
  assert.deepEqual(reminders.map((m) => m.to_email), ['reader@example.com']);
  assert.match(reminders[0].subject, /Did you get the Magnificent 7\?/);
  assert.match(reminders[0].body, /the Magnificent 7 \(https?:\/\/\S+\/dl\//);
});

test('large files (over 4 MB) go to file storage through a one-time slot, and are served from there', async () => {
  const http = require('node:http');
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Lf', email: 'large-file@example.com', password: 'password123', business_type: 'coach' });
  delete process.env.STORAGE_URL;
  assert.equal((await c('POST', '/api/uploads/large', { type: 'application/pdf', size: 9e6 })).status, 503, 'not set up: a plain message');
  // A stand-in for file storage that holds whatever the "browser" put there.
  const stored = {};
  const store = http.createServer((req, res) => {
    const key = req.url.replace('/storage/v1/object/public/files/', '');
    const body = stored[key];
    if (!body) { res.writeHead(400); return res.end('{}'); }
    res.writeHead(206, { 'content-type': 'application/pdf', 'content-range': `bytes 0-15/${body.length}` });
    res.end(body.subarray(0, 16));
  }).listen(0);
  await new Promise((r) => store.once('listening', r));
  process.env.STORAGE_URL = `http://localhost:${store.address().port}/`;
  try {
    assert.equal((await c('POST', '/api/uploads/large', { type: 'application/x-msdownload', size: 9e6 })).status, 415);
    assert.equal((await c('POST', '/api/uploads/large', { type: 'application/pdf', size: 60e6 })).status, 413);
    const slot = (await c('POST', '/api/uploads/large', { type: 'application/pdf', size: 9e6 })).body;
    assert.match(slot.slot, /\/functions\/v1\/upload-slot$/);
    assert.equal((await c('POST', `/api/uploads/large/${slot.token}/done`)).status, 422, 'nothing arrived yet');
    const acct = (await c('GET', '/api/me')).body.account.id;
    stored[`${acct}/${slot.id}`] = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(9e6, 32)]);
    const done = await c('POST', `/api/uploads/large/${slot.token}/done`);
    assert.equal(done.status, 201);
    assert.equal(done.body.size, 9e6 + 9);
    // The usual /u/ address sends people to storage; a second "done" finds no slot.
    const u = await client()('GET', new URL(done.body.url).pathname);
    assert.equal(u.status, 302);
    assert.equal(u.headers.get('location'), `${process.env.STORAGE_URL.replace(/\/$/, '')}/storage/v1/object/public/files/${acct}/${slot.id}`);
    assert.equal((await c('POST', `/api/uploads/large/${slot.token}/done`)).status, 404);
    assert.ok((await c('GET', '/api/files')).body.some((f) => f.id === slot.id));
    // Another business can't finish someone else's upload.
    const other = client();
    await other('POST', '/api/auth/signup', { name: 'Ot', email: 'large-other@example.com', password: 'password123', business_type: 'coach' });
    const s2 = (await c('POST', '/api/uploads/large', { type: 'application/pdf', size: 5e6 })).body;
    assert.equal((await other('POST', `/api/uploads/large/${s2.token}/done`)).status, 404);
  } finally { delete process.env.STORAGE_URL; store.close(); }
});
