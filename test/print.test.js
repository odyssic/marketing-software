process.env.ALLOW_SIGNUPS = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { labelsPdf, pdfText } = require('../src/print');

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
  return async (method, path, body, { raw } = {}) => {
    const res = await fetch(base + path, { method, redirect: 'manual', headers: { cookie, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    if (raw) return { status: res.status, headers: res.headers, text: Buffer.from(await res.arrayBuffer()).toString('latin1') };
    const type = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : await res.text() };
  };
}
async function setup(email) {
  const c = client();
  assert.equal((await c('POST', '/api/auth/signup', { name: 'Pr Int', email, password: 'password123' })).status, 201);
  return c;
}
const pageCount = (pdf) => Number(pdf.match(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/)[1]);

test('label PDF: valid structure, 30 labels a page, escaped text', () => {
  const one = labelsPdf([['Ann (Annie) Lee', '1 Main St', 'Austin, TX 78701']]).toString('latin1');
  assert.ok(one.startsWith('%PDF-1.4'));
  assert.ok(one.trimEnd().endsWith('%%EOF'));
  assert.equal(pageCount(one), 1);
  assert.match(one, /\(Ann \\\(Annie\\\) Lee\) Tj/);
  // xref offsets point at the objects they name.
  const xrefAt = Number(one.match(/startxref\n(\d+)/)[1]);
  assert.ok(one.slice(xrefAt).startsWith('xref'));
  const offsets = one.slice(xrefAt).split('\n').slice(3).filter((l) => / n $/.test(l)).map((l) => Number(l.slice(0, 10)));
  offsets.forEach((o, i) => assert.ok(one.slice(o).startsWith(`${i + 1} 0 obj`), `object ${i + 1}`));
  assert.equal(pageCount(labelsPdf(Array.from({ length: 31 }, (_, i) => [`P${i}`])).toString('latin1')), 2);
  assert.equal(pageCount(labelsPdf([]).toString('latin1')), 1);
  assert.equal(pdfText('Zoë 日本'), 'Zo\\353 ??');
});

test('print mailing list: counts, CSV, labels (skipping incomplete addresses)', async () => {
  const c = await setup('print@example.com');
  await c('POST', '/api/import/subscribers', { format: 'print', product: 'Field Notes', rows: [
    { name: 'Ann Lee', address1: '1 Main St', city: 'Austin', region: 'TX', postal: '78701' },
    { name: 'Bo Diaz', email: 'bo@example.com', address1: '22 Oak Ave', city: 'Portland', region: 'OR', postal: '97201', country: 'Canada' },
    { name: 'No Address', email: 'na@example.com' },
  ] });
  await c('POST', '/api/import/subscribers', { format: 'email', product: 'Weekly', rows: [{ email: 'email-only@example.com' }] });
  assert.deepEqual((await c('GET', '/api/print/lists')).body, [{ product: 'Field Notes', subscribers: 3, missing_address: 1 }]);
  const csv = (await c('GET', '/api/print/subscribers.csv?product=Field%20Notes')).body;
  assert.equal(csv.split('\n').length, 4);
  assert.match(csv, /Bo Diaz,bo@example\.com,22 Oak Ave/);
  assert.ok(!csv.includes('email-only'));
  const pdf = await c('GET', '/api/print/labels.pdf', undefined, { raw: true });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.equal(pdf.headers.get('x-skipped-missing-address'), '1');
  assert.match(pdf.text, /\(Ann Lee\) Tj/);
  assert.match(pdf.text, /\(Portland, OR 97201\) Tj/);
  assert.match(pdf.text, /\(Canada\) Tj/);
  assert.ok(!pdf.text.includes('No Address'));
});

test('short links and QR codes: scans vs visits, tied to a campaign, isolated per workspace', async () => {
  const c = await setup('links@example.com');
  assert.equal((await c('POST', '/api/links', { url: 'not a url' })).status, 400);
  assert.equal((await c('POST', '/api/links', { url: 'https://shop.example/spring', campaign_id: 999999 })).status, 400);
  const l = (await c('POST', '/api/links', { url: 'https://shop.example/spring?x=1', label: 'Spring postcard' })).body;
  assert.match(l.short_url, /\/s\/[A-Za-z0-9]{3,8}$/);

  const scan = await fetch(`${base}/s/${l.code}?q=1`, { redirect: 'manual' });
  assert.equal(scan.status, 302);
  assert.equal(scan.headers.get('location'), 'https://shop.example/spring?x=1');
  await fetch(`${base}/s/${l.code}`, { redirect: 'manual' });
  await fetch(`${base}/s/${l.code}`, { redirect: 'manual' });
  assert.equal((await fetch(`${base}/s/nope00`, { redirect: 'manual' })).status, 404);
  const [row] = (await c('GET', '/api/links')).body;
  assert.deepEqual([row.label, row.scans, row.visits], ['Spring postcard', 1, 2]);

  const qr = await c('GET', `/api/links/${l.id}/qr.svg`);
  assert.equal(qr.headers.get('content-type').split(';')[0], 'image/svg+xml');
  assert.match(qr.body, /^<svg[\s\S]*<path/);

  const other = await setup('links-other@example.com');
  assert.equal((await other('GET', `/api/links/${l.id}/qr.svg`)).status, 404);
  assert.deepEqual((await other('GET', '/api/links')).body, []);
  await other('DELETE', `/api/links/${l.id}`);
  assert.equal((await c('GET', '/api/links')).body.length, 1);
  await c('DELETE', `/api/links/${l.id}`);
  assert.equal((await c('GET', '/api/links')).body.length, 0);
});
