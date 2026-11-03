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
    return { status: res.status, body: (res.headers.get('content-type') || '').includes('json') ? await res.json() : await res.text() };
  };
}
const pub = async (method, path, form) => {
  const res = await fetch(base + path, { method, redirect: 'manual', headers: form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}, body: form && new URLSearchParams(form) });
  return { status: res.status, location: res.headers.get('location'), text: await res.text() };
};

test('an invoice is emailed, paid through its link, and marked paid once', async () => {
  process.env.ALLOW_TIME_TRAVEL = '1';
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Ivy', email: 'ivy@example.com', password: 'password123', workspace: 'Ivy Design' });
  assert.equal((await c('POST', '/api/invoices', { client_email: 'x', items: [{ description: 'Logo', price: 50 }] })).status, 400);
  assert.equal((await c('POST', '/api/invoices', { client_email: 'sam@example.com', items: [] })).status, 400);
  const inv = (await c('POST', '/api/invoices', { client_email: 'Sam@Example.com', client_name: 'Sam Lee', title: 'Brand refresh', due_date: '2020-01-10',
    items: [{ description: 'Logo', qty: 1, price: 400 }, { description: 'Business cards', qty: 2, price: '25.50' }], send: true })).body;
  assert.equal(inv.number, 1001);
  assert.equal(inv.total_cents, 45100);
  assert.equal(inv.status, 'sent');
  assert.equal(inv.overdue, true);
  const sent = (await c('GET', '/api/outbox')).body;
  assert.ok(JSON.stringify(sent).includes('Invoice #1001'));
  // The client is now a person.
  assert.ok((await c('GET', '/api/contacts')).body.some((p) => p.email === 'sam@example.com'));

  const token = inv.url.split('/pay/')[1];
  const page = await pub('GET', `/pay/${token}`);
  assert.match(page.text, /\$451\.00/);
  assert.match(page.text, /Business cards/);
  // Pay (test mode: no Stripe key) → test checkout → back to the invoice, paid.
  const go = await pub('POST', `/pay/${token}`, {});
  assert.equal(go.status, 303);
  assert.match(go.location, /^\/checkout\/test\//);
  const done = await pub('POST', go.location, { email: 'sam@example.com', name: 'Sam Lee' });
  assert.equal(done.location, `/pay/${token}?paid=1`);
  let list = (await c('GET', '/api/invoices')).body;
  assert.equal(list[0].status, 'paid');
  assert.match((await pub('GET', `/pay/${token}`)).text, /Paid\. Thank you/);
  // Paid invoices can't be paid again or re-sent, and get no reminder.
  assert.equal((await pub('POST', `/pay/${token}`, {})).location, `/pay/${token}`);
  assert.equal((await c('POST', `/api/invoices/${inv.id}/send`)).status, 409);
  assert.equal((await c('POST', '/api/jobs/run', { now: new Date().toISOString() })).body.invoice_reminders, 0);
});

test('overdue invoices get one reminder; drafts stay private; payment links count payments', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Leo', email: 'leo@example.com', password: 'password123', workspace: 'Leo Studio' });
  const draft = (await c('POST', '/api/invoices', { client_email: 'kim@example.com', items: [{ description: 'Session', price: 90 }] })).body;
  assert.equal(draft.status, 'draft');
  const tok = draft.url.split('/pay/')[1];
  assert.equal((await pub('GET', `/pay/${tok}`)).status, 404);
  const due = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  await c('POST', '/api/invoices', { client_email: 'kim@example.com', due_date: due, items: [{ description: 'Session', price: 90 }], send: true });
  assert.equal((await c('POST', '/api/jobs/run', { now: new Date().toISOString() })).body.invoice_reminders, 0);
  const later = new Date(Date.now() + 4 * 864e5).toISOString();
  assert.equal((await c('POST', '/api/jobs/run', { now: later })).body.invoice_reminders, 1);
  assert.equal((await c('POST', '/api/jobs/run', { now: later })).body.invoice_reminders, 0);

  const link = (await c('POST', '/api/invoices', { kind: 'link', title: 'Deposit', items: [{ description: 'Deposit', price: 100 }] })).body;
  assert.equal(link.status, 'active');
  const lt = link.url.split('/pay/')[1];
  assert.match((await pub('GET', `/pay/${lt}`)).text, /Your email/);
  assert.equal((await pub('POST', `/pay/${lt}`, { email: 'nope' })).location, `/pay/${lt}`);
  for (const who of ['a1@example.com', 'a2@example.com']) {
    const go = await pub('POST', `/pay/${lt}`, { email: who, name: 'A' });
    await pub('POST', go.location, { email: who, name: 'A' });
    await pub('POST', go.location, { email: who, name: 'A' }); // a repeat doesn't count twice
  }
  assert.equal((await c('GET', '/api/invoices')).body.find((x) => x.id === link.id).payments, 2);
  await c('POST', `/api/invoices/${link.id}/status`, { status: 'archived' });
  assert.match((await pub('GET', `/pay/${lt}`)).text, /no longer open/);
});
