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
