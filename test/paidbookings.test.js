process.env.ALLOW_SIGNUPS = '1';
process.env.ALLOW_TIME_TRAVEL = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { payOf, payLabel, cancelRule } = require('../src/paidbookings');

// Fake Stripe: records sessions; retrieving one reports it paid.
const sessions = {};
const fakeStripe = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'POST' && req.url === '/v1/checkout/sessions') {
      const p = new URLSearchParams(body);
      const id = `cs_test_pb${Object.keys(sessions).length + 1}`;
      sessions[id] = { id, url: `https://checkout.stripe.test/${id}`, client_reference_id: p.get('client_reference_id'), amount: Number(p.get('line_items[0][price_data][unit_amount]')),
        name: p.get('line_items[0][price_data][product_data][name]'), expires_at: Number(p.get('expires_at')), cancel_url: p.get('cancel_url'),
        payment_status: 'paid', payment_intent: `pi_${id.slice(-3)}`, livemode: false, customer_details: { email: 'cara@example.com', name: 'Cara Client' } };
      return res.end(JSON.stringify(sessions[id]));
    }
    const m = req.url.match(/^\/v1\/checkout\/sessions\/([^?]+)/);
    if (m && sessions[m[1]]) return res.end(JSON.stringify(sessions[m[1]]));
    res.statusCode = 404; res.end(JSON.stringify({ error: { message: 'Not found' } }));
  });
});

let app, server, base;
before(async () => {
  await new Promise((r) => fakeStripe.listen(0, r));
  process.env.STRIPE_API_BASE = `http://localhost:${fakeStripe.address().port}`;
  const { createApp } = require('../src/app');
  app = createApp(process.env.TEST_DATABASE_URL ? {} : { dbPath: ':memory:' });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});
after(async () => { server.close(); fakeStripe.close(); await app.close(); });
function client() {
  let cookie = '';
  return async (method, path, body, { form } = {}) => {
    const res = await fetch(base + path, { method, redirect: 'manual', headers: { cookie, 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
      body: form ? new URLSearchParams(form) : body && JSON.stringify(body) });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, location: res.headers.get('location'), body: type.includes('json') ? await res.json() : await res.text() };
  };
}

// A business with a paid Booking block and hours all day, every day.
async function setup(email, block, { cancelHours = 48 } = {}) {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Pia Owner', email, password: 'password123', workspace: `Pia ${email}` });
  const f = (await c('POST', '/api/funnels', { name: 'Massage', template: 'booking' })).body;
  let funnel = (await c('GET', `/api/funnels/${f.id}`)).body;
  const step = funnel.steps.find((s) => s.blocks.some((b) => b.type === 'booking'));
  await c('PUT', `/api/steps/${step.id}`, { blocks: step.blocks.map((b) => (b.type === 'booking' ? { ...b, ...block } : b)) });
  await c('POST', `/api/funnels/${f.id}/publish`);
  funnel = (await c('GET', `/api/funnels/${f.id}`)).body;
  await c('PUT', '/api/bookings/settings', { tz: 'UTC', days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:30', length: 60, notice_hours: 0, horizon_days: 3, title: 'Massage', location: 'The studio', cancel_hours: cancelHours });
  return { c, funnel, step };
}
const hoursOut = (slots, min, max) => slots.find((x) => new Date(x.start) > Date.now() + min * 3600e3 && new Date(x.start) < Date.now() + max * 3600e3);

test('price rules in plain words', () => {
  assert.deepEqual(payOf({ payment: 'Free', price: '50' }).kind, '');
  assert.deepEqual(payOf({ payment: 'Pay in full', price: '$80' }), { kind: 'full', price: 8000, due: 8000, balance: 0, currency: 'usd' });
  assert.deepEqual(payOf({ payment: 'Deposit', price: '80', deposit: '20', currency: 'gbp' }), { kind: 'deposit', price: 8000, due: 2000, balance: 6000, currency: 'gbp' });
  assert.equal(payOf({ payment: 'Deposit', price: '80', deposit: '' }).kind, 'full'); // no deposit set: the full price
  assert.equal(payLabel(payOf({ payment: 'Deposit', price: '80', deposit: '20' })), '$20 deposit to book · $60 at the appointment');
  const r = cancelRule({ cancel_hours: 24 }, { starts_at: '2026-12-10T15:00:00Z', pay_kind: 'deposit' }, new Date('2026-12-09T16:00:00Z'));
  assert.deepEqual([r.free, r.text], [false, 'Free cancellation up to 24 hours before. After that, your deposit is kept.']);
});

test('deposit booking: hold → pay (test mode) → confirmed, order, balance link, cancellation window', async () => {
  const { c, funnel } = await setup('pia@example.com', { payment: 'Deposit', price: '80', deposit: '20' });
  const v = client();
  // The page shows the price before they pick a time.
  const html = (await v('GET', `/f/${funnel.slug}`)).body;
  assert.match(html, /\$20 deposit to book · \$60 at the appointment/);
  assert.match(html, /Continue to pay \$20/);
  const slots = (await v('GET', `/f/${funnel.slug}/slots`)).body.slots;
  const far = hoursOut(slots, 52, 70), near = hoursOut(slots, 4, 40);

  // Picking a time holds it and sends them to pay.
  const r = await v('POST', `/f/${funnel.slug}/book/book`, { start: far.start, name: 'Dee Client', email: 'dee@example.com' });
  assert.equal(r.status, 200);
  assert.match(r.body.pay, /^\/checkout\/test\/\d+\/[a-f0-9]{24}$/);
  assert.ok(!(await v('GET', `/f/${funnel.slug}/slots`)).body.slots.some((x) => x.start === far.start), 'held while they pay');
  assert.equal((await v('POST', `/f/${funnel.slug}/book/book`, { start: far.start, name: 'Eve', email: 'eve@example.com' })).status, 409);
  const pending = (await v('GET', r.body.manage)).body;
  assert.match(pending, /Almost booked/);
  assert.match(pending, /Pay \$20/);
  assert.equal((await c('GET', '/api/bookings')).body.bookings[0].pay_line, 'Waiting for payment');
  assert.ok(!(await c('GET', '/api/outbox')).body.some((m) => m.to_email === 'dee@example.com'), 'no confirmation before payment');

  // Paying confirms it and comes back to the booking page.
  const paid = await v('POST', r.body.pay, null, { form: { email: 'dee@example.com', name: 'Dee Client' } });
  assert.equal(paid.status, 303);
  assert.equal(paid.location, `${r.body.manage}?paid=1`);
  const done = (await v('GET', paid.location)).body;
  assert.match(done, /Payment received\. You’re booked!/);
  assert.match(done, /Paid \$20 deposit · balance \$60 due at the appointment/);
  assert.match(done, /Free cancellation until [A-Z][a-z]+day, [\s\S]*After that, your deposit is kept/);
  assert.match(done, /calendar\.google\.com\/calendar\/render/);
  assert.match(done, /calendar\.ics/);
  const ics = await fetch(`${base}${r.body.manage}/calendar.ics`);
  assert.match(ics.headers.get('content-type'), /text\/calendar/);
  assert.match(await ics.text(), /SUMMARY:Massage with Pia/);
  // The order is in Orders like any sale.
  const orders = (await c('GET', '/api/orders')).body;
  const order = (orders.orders || orders).find((o) => /Deposit: Massage/.test(o.product_name));
  assert.equal(order.status, 'paid');
  assert.equal(order.amount_cents, 2000);
  // Confirmation email: balance due, add-to-calendar links, the .ics attachment.
  const mail = (await c('GET', '/api/outbox')).body;
  const conf = mail.find((m) => m.to_email === 'dee@example.com' && m.subject.startsWith('Booked: Massage'));
  assert.match(conf.body, /Paid \$20 deposit · balance \$60 due at the appointment\. Free cancellation up to 2 days before\. After that, your deposit is kept\./);
  assert.match(conf.body, /Google: https:\/\/calendar\.google\.com/);
  assert.match(conf.body, /\/b\/[\w-]+\/calendar\.ics/);
  assert.ok(mail.some((m) => m.to_email === 'pia@example.com' && m.subject.startsWith('New booking: Dee Client')));
  // The owner's card: what was paid, the balance, no Stripe refund for a test payment.
  let bk = (await c('GET', '/api/bookings')).body.bookings.find((b) => b.email === 'dee@example.com');
  assert.equal(bk.status, 'confirmed');
  assert.equal(bk.pay_line, 'Paid $20 deposit · balance $60 due at the appointment');
  assert.equal(bk.balance_cents, 6000);
  assert.equal(bk.test_payment, true);
  assert.equal(bk.refund_url, '');

  // "Send a payment link for the balance": an invoice for $60, emailed.
  const inv = (await c('POST', `/api/bookings/${bk.id}/balance-link`)).body;
  assert.equal(inv.total_cents, 6000);
  assert.equal(inv.status, 'sent');
  assert.ok((await c('GET', '/api/outbox')).body.some((m) => m.to_email === 'dee@example.com' && /Invoice #\d+/.test(m.subject) && /\$60\.00/.test(m.subject)));
  bk = (await c('GET', '/api/bookings')).body.bookings.find((b) => b.email === 'dee@example.com');
  assert.equal(bk.balance_status, 'sent');
  const payInv = await v('POST', `/pay/${inv.token}`, null, { form: {} });
  await v('POST', payInv.location, null, { form: { email: 'dee@example.com' } });
  bk = (await c('GET', '/api/bookings')).body.bookings.find((b) => b.email === 'dee@example.com');
  assert.equal(bk.balance_status, 'paid');
  assert.equal(bk.pay_line, 'Paid $20 deposit · balance paid');
  assert.equal((await c('POST', `/api/bookings/${bk.id}/balance-link`)).status, 409);

  // Cancelling more than 2 days ahead: free, the owner is told to refund.
  const page = (await v('GET', r.body.manage)).body;
  assert.match(page, /Cancel this booking/);
  assert.doesNotMatch(page, /deposit kept/);
  const cancelled = (await v('POST', `${r.body.manage}/cancel`, null, { form: {} })).body;
  assert.match(cancelled, /will refund your \$20 deposit/);
  assert.ok((await c('GET', '/api/outbox')).body.some((m) => m.to_email === 'pia@example.com' && m.subject.startsWith('Cancelled: Dee') && /please refund them/.test(m.body)));

  // Inside the window: no moving online, and cancelling keeps the deposit.
  const r2 = await v('POST', `/f/${funnel.slug}/book/book`, { start: near.start, name: 'Fay Late', email: 'fay@example.com' });
  await v('POST', r2.body.pay, null, { form: { email: 'fay@example.com' } });
  const late = (await v('GET', r2.body.manage)).body;
  assert.match(late, /too close to the time to change it online/);
  assert.match(late, /Cancel \(deposit kept\)/);
  assert.match(late, /If you cancel now, your \$20 deposit is kept/);
  const other = slots.find((x) => x.start > near.start && x.start !== far.start);
  await v('POST', `${r2.body.manage}/move`, null, { form: { start: other.start } });
  assert.equal((await c('GET', '/api/bookings')).body.bookings.find((b) => b.email === 'fay@example.com').starts_at.replace('.000', ''), near.start.replace('.000', ''));
  assert.match((await v('POST', `${r2.body.manage}/cancel`, null, { form: {} })).body, /your \$20 deposit is kept/);
  assert.ok((await c('GET', '/api/outbox')).body.some((m) => m.to_email === 'pia@example.com' && m.subject.startsWith('Cancelled: Fay') && /deposit is kept/.test(m.body)));

  // Another business sees none of it and can't send balance links for it.
  const o = client();
  await o('POST', '/api/auth/signup', { name: 'Oz', email: 'oz-paid@example.com', password: 'password123', workspace: 'Oz' });
  assert.equal((await o('GET', '/api/bookings')).body.bookings.length, 0);
  assert.equal((await o('POST', `/api/bookings/${bk.id}/balance-link`)).status, 404);
});

test('unpaid holds expire after 15 minutes; a late payment confirms if free, else flags a refund', async () => {
  const { c, funnel } = await setup('hold@example.com', { payment: 'Pay in full', price: '40' });
  const v = client();
  const slot = hoursOut((await v('GET', `/f/${funnel.slug}/slots`)).body.slots, 30, 60);
  const a = (await v('POST', `/f/${funnel.slug}/book/book`, { start: slot.start, name: 'Al Slow', email: 'al@example.com' })).body;
  assert.ok(a.pay);
  // 10 minutes later: still held. 16 minutes later: released.
  assert.equal((await c('POST', '/api/jobs/run', { now: new Date(Date.now() + 10 * 60e3).toISOString() })).body.holds_released, 0);
  assert.equal((await c('POST', '/api/jobs/run', { now: new Date(Date.now() + 16 * 60e3).toISOString() })).body.holds_released, 1);
  assert.ok((await v('GET', `/f/${funnel.slug}/slots`)).body.slots.some((x) => x.start === slot.start), 'time is open again');
  assert.match((await v('GET', a.manage)).body, /This time was released[\s\S]*Nothing was charged[\s\S]*Pick a new time/);
  const orders = (await c('GET', '/api/orders')).body;
  assert.equal((orders.orders || orders).find((o) => o.product_name === 'Massage').status, 'expired');
  // Al pays late, the time is still free: confirmed.
  await v('POST', a.pay, null, { form: { email: 'al@example.com' } });
  assert.equal((await c('GET', '/api/bookings')).body.bookings.find((b) => b.email === 'al@example.com').status, 'confirmed');

  // Bo holds a time, it expires, Cy books and pays it, then Bo pays late: flagged for a refund.
  const slot2 = (await v('GET', `/f/${funnel.slug}/slots`)).body.slots.find((x) => x.start > slot.start);
  const b = (await v('POST', `/f/${funnel.slug}/book/book`, { start: slot2.start, name: 'Bo Late', email: 'bo@example.com' })).body;
  await app.getDb().run("UPDATE bookings SET hold_until = now() - interval '1 minute' WHERE email = 'bo@example.com'");
  const cy = (await v('POST', `/f/${funnel.slug}/book/book`, { start: slot2.start, name: 'Cy Quick', email: 'cy@example.com' })).body;
  assert.ok(cy.pay, 'an expired hold frees the time at once');
  await v('POST', cy.pay, null, { form: { email: 'cy@example.com' } });
  await v('POST', b.pay, null, { form: { email: 'bo@example.com' } });
  const list = (await c('GET', '/api/bookings')).body.bookings;
  assert.equal(list.find((x) => x.email === 'cy@example.com').status, 'confirmed');
  assert.equal(list.find((x) => x.email === 'bo@example.com').status, 'clash');
  assert.match((await v('GET', b.manage)).body, /Payment received, but the time was taken/);
  assert.ok((await c('GET', '/api/outbox')).body.some((m) => m.to_email === 'hold@example.com' && m.subject.startsWith('Paid, but the time was taken: Bo Late')));

  // "Let this time go" from the booking page frees it straight away.
  const slot3 = (await v('GET', `/f/${funnel.slug}/slots`)).body.slots.find((x) => x.start > slot2.start);
  const d = (await v('POST', `/f/${funnel.slug}/book/book`, { start: slot3.start, name: 'Di', email: 'di@example.com' })).body;
  assert.equal((await v('POST', `${d.manage}/release`, null, { form: {} })).status, 303);
  assert.ok((await v('GET', `/f/${funnel.slug}/slots`)).body.slots.some((x) => x.start === slot3.start));
});

test('Stripe: checkout session for the booking, return page confirms, refund link, codes', async () => {
  const { c, funnel } = await setup('stripe-pia@example.com', { payment: 'Pay in full', price: '40' }, { cancelHours: 0 });
  await c('PUT', '/api/account/stripe', { secretKey: 'sk_test_bookings', webhookSecret: 'whsec_x' });
  await c('POST', '/api/coupons', { code: 'HALF', kind: 'percent', value: 50 });
  const v = client();
  const s = (await v('GET', `/f/${funnel.slug}/slots`)).body;
  assert.equal(s.codes, true);
  assert.equal((await v('POST', `/f/${funnel.slug}/book/book`, { start: s.slots[3].start, name: 'Cara', email: 'cara@example.com', code: 'NOPE' })).status, 400);
  const r = (await v('POST', `/f/${funnel.slug}/book/book`, { start: s.slots[3].start, name: 'Cara Client', email: 'cara@example.com', code: 'half' })).body;
  assert.match(r.pay, /^https:\/\/checkout\.stripe\.test\/cs_test_pb\d+$/);
  const session = sessions[r.pay.split('/').pop()];
  assert.equal(session.amount, 2000); // $40 with 50% off
  assert.ok(session.expires_at >= Date.now() / 1000 + 30 * 60, 'Stripe needs at least 30 minutes');
  assert.match(session.cancel_url, /\/b\/[\w-]+$/);
  const back = await v('GET', `/checkout/success/${session.client_reference_id}?session_id=${session.id}`);
  assert.equal(back.status, 303);
  assert.match(back.location, /^\/b\/[\w-]+\?paid=1$/);
  assert.match((await v('GET', back.location)).body, /Paid \$20[\s\S]*Free cancellation any time before it starts/);
  const bk = (await c('GET', '/api/bookings')).body.bookings[0];
  assert.equal(bk.status, 'confirmed');
  assert.equal(bk.refund_url, `https://dashboard.stripe.com/test/payments/${session.payment_intent}`);
  // Owner cancels: they're told about the refund, and get the link.
  const cancel = (await c('POST', `/api/bookings/${bk.id}/cancel`)).body;
  assert.equal(cancel.refund_url, bk.refund_url);
  assert.ok((await c('GET', '/api/outbox')).body.some((m) => m.to_email === 'cara@example.com' && /\$20 payment will be refunded/.test(m.body)));
  // The code was used once.
  assert.equal((await c('GET', '/api/coupons')).body.find((x) => x.code === 'HALF').uses, 1);
});
