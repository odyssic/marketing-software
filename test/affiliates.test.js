// Partners and referrals: links, cookie, commissions with a hold period,
// payouts, recurring limits, refunds, self-referrals, isolation, dashboard.
process.env.ALLOW_SIGNUPS = '1';
process.env.ALLOW_TIME_TRAVEL = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');

// Fake Stripe: creates checkout sessions (subscription mode for monthly products).
const sessions = {};
const fakeStripe = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'POST' && req.url === '/v1/checkout/sessions') {
      const p = new URLSearchParams(body);
      const n = Object.keys(sessions).length + 1;
      const sub = p.get('mode') === 'subscription';
      sessions[`cs_${n}`] = { id: `cs_${n}`, url: `https://checkout.stripe.test/cs_${n}`, client_reference_id: p.get('client_reference_id'), mode: p.get('mode'),
        payment_status: 'paid', customer_details: { email: 'subby@example.com', name: 'Subby Buyer' },
        ...(sub ? { subscription: `sub_${n}`, invoice: `in_${n}_1` } : { payment_intent: `pi_${n}` }) };
      return res.end(JSON.stringify(sessions[`cs_${n}`]));
    }
    res.statusCode = 404; res.end(JSON.stringify({ error: { message: 'Not here' } }));
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
  process.env.PUBLIC_URL = base;
});
after(async () => { server.close(); fakeStripe.close(); await app.close(); });

// A browser: keeps every cookie it is given.
function browser() {
  const jar = {};
  const fn = async (method, path, { json, form, headers = {} } = {}) => {
    const res = await fetch(path.startsWith('http') ? path : base + path, {
      method, redirect: 'manual',
      headers: { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '),
        ...(json !== undefined ? { 'content-type': 'application/json' } : form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), ...headers },
      body: json !== undefined ? (typeof json === 'string' ? json : JSON.stringify(json)) : form ? new URLSearchParams(form) : undefined,
    });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); }
    const type = res.headers.get('content-type') || '';
    return { status: res.status, location: res.headers.get('location'), body: type.includes('json') ? await res.json() : await res.text() };
  };
  fn.jar = jar;
  return fn;
}
const owner = async (name) => {
  const b = browser();
  await b('POST', '/api/auth/signup', { json: { name, email: `${name.toLowerCase()}@shop.test`, password: 'password123', workspace: `${name} Shop` } });
  const c = (method, path, body) => b(method, path, { json: body ?? (method === 'GET' ? undefined : {}) });
  { const me = (await c('GET', '/api/me')).body; c.accountId = me.account.id; c.handle = me.account.handle; }
  return c;
};
async function shop(c, { price = '49', billing = 'one_time' } = {}) {
  const { body: { id: productId } } = await c('POST', '/api/products', { name: 'Glaze Course', price, currency: 'usd', billing });
  const { body: { id: funnelId } } = await c('POST', '/api/funnels', { name: `Shop ${c.accountId} ${productId}`, template: 'pricing' });
  await c('POST', `/api/funnels/${funnelId}/publish`);
  const funnel = (await c('GET', `/api/funnels/${funnelId}`)).body;
  const block = funnel.steps[0].blocks.find((x) => x.type === 'pricing');
  return { funnel, block, productId };
}
const outbox = async (c, to) => (await c('GET', '/api/outbox')).body.filter((m) => m.to_email === to);
const partnerOf = async (c, pid) => (await c('GET', '/api/partners')).body.partners.find((x) => x.id === pid);
const jobs = (c, days) => c('POST', '/api/jobs/run', { now: new Date(Date.now() + days * 864e5).toISOString() });

// Visitor clicks the link, lands on the page, and buys in test mode.
async function clickAndBuy(link, { email, name = '', coupon, v = browser() } = {}) {
  const r = await v('GET', link);
  assert.equal(r.status, 302);
  const landing = await v('GET', r.location);
  assert.equal(landing.status, 200);
  const slug = r.location.match(/\/f\/([^/?]+)/)[1];
  const block = landing.body.match(/name="block" value="([^"]+)"/)?.[1];
  const buy = await v('POST', `/f/${slug}/pricing/buy`, { form: { block, ...(coupon ? { coupon } : {}) } });
  assert.equal(buy.status, 303, buy.body);
  const done = await v('POST', buy.location, { form: { email, name } });
  assert.ok([200, 303].includes(done.status));
  return { v, redirect: r.location, orderId: Number(buy.location.match(/test\/(\d+)\//)[1]) };
}

test('click → cookie → purchase → commission on hold → approved → paid, and the partner dashboard', async () => {
  const c = await owner('Olive');
  await shop(c);
  const inv = await c('POST', '/api/partners', { name: 'Jamie Rivera', email: 'jamie@example.com' });
  assert.equal(inv.status, 201);
  const welcome = (await outbox(c, 'jamie@example.com'))[0];
  assert.match(welcome.subject, /partner link/);
  let p = await partnerOf(c, inv.body.id);
  assert.match(p.link, /\/r\/jamie-[0-9a-f]{4}$/);
  assert.equal((await c('POST', '/api/partners', { name: 'Jamie', email: 'jamie@example.com' })).status, 409, 'no doubles');

  // Click: the link lands on the page with ?ref=, which sets the cookie; a second visit isn't another click.
  const v = browser();
  const r = await v('GET', p.link);
  assert.match(r.location, new RegExp(`^/f/[^?]+\\?ref=${p.code}$`));
  await v('GET', r.location);
  assert.ok(v.jar[`rref${c.accountId}`], 'referral cookie set');
  await v('GET', r.location);
  assert.equal((await partnerOf(c, p.id)).clicks, 1);

  const { orderId } = await clickAndBuy(p.link, { email: 'sam@example.com', name: 'Sam Lee', v });
  const order = (await c('GET', '/api/orders')).body.find((o) => o.id === orderId);
  assert.equal(order.status, 'paid');
  p = await partnerOf(c, p.id);
  assert.deepEqual([p.sales, p.earned, p.owed, p.ready], [1, '$9.80', '$0', false], '20% of $49, on hold');

  // Timelines: the partner referred Sam; Sam was referred by Jamie.
  const jamie = (await c('GET', `/api/people/${p.contact_id}`)).body;
  assert.ok(jamie.events.some((e) => e.type === 'referral' && e.meta.note === 'Referred Sam Lee (paid $49)'));
  const sam = (await c('GET', '/api/contacts')).body.find((x) => x.email === 'sam@example.com');
  assert.ok((await c('GET', `/api/people/${sam.id}`)).body.events.some((e) => e.meta?.note === 'Referred by Jamie Rivera'));

  // Hold period: nothing approved after 10 days; approved (and the partner told) after 31.
  await jobs(c, 10);
  assert.equal((await partnerOf(c, p.id)).owed, '$0');
  await jobs(c, 31);
  p = await partnerOf(c, p.id);
  assert.deepEqual([p.owed, p.ready], ['$9.80', true]);
  assert.ok((await outbox(c, 'jamie@example.com')).some((m) => m.subject === 'You earned $9.80'));
  await jobs(c, 32);
  assert.equal((await outbox(c, 'jamie@example.com')).filter((m) => m.subject === 'You earned $9.80').length, 1, 'told once');

  // Owed CSV, then "Mark as paid" (with Undo).
  const csv = await c('GET', '/api/partners/owed.csv');
  assert.match(csv.body, /jamie@example\.com,.*9\.80,USD/);
  const paid = await c('POST', `/api/partners/${p.id}/payouts`, { note: 'PayPal' });
  assert.equal(paid.status, 201);
  assert.deepEqual([(await partnerOf(c, p.id)).owed, (await partnerOf(c, p.id)).paid], ['$0', '$9.80']);
  assert.equal((await c('POST', `/api/partners/${p.id}/payouts`, {})).status, 400, 'nothing left to pay');
  await c('DELETE', `/api/partners/payouts/${paid.body.id}`);
  assert.equal((await partnerOf(c, p.id)).owed, '$9.80', 'undo puts it back');
  await c('POST', `/api/partners/${p.id}/payouts`, { amount: '9.80', paid_on: '2026-11-07', note: 'PayPal' });

  // Partner dashboard: sign in with the emailed link.
  const link = (await outbox(c, 'jamie@example.com')).find((m) => m.subject === 'You earned $9.80').body.match(/https?:\/\/\S+\/partner\/enter\/\S+/)[0];
  const pb = browser();
  assert.match((await pb('GET', `/my/${c.handle}/partner`)).body, /Email me a sign-in link/);
  const enter = await pb('GET', link);
  assert.equal(enter.location, `/my/${c.handle}/partner`);
  const dash = (await pb('GET', enter.location)).body;
  assert.match(dash, new RegExp(p.link.replace(/[/.]/g, '\\$&')));
  assert.match(dash, /<b>1<\/b><span>clicks/);
  assert.match(dash, /Glaze Course/);
  assert.match(dash, /pill paid">Paid/);
  assert.match(dash, /PayPal/);
  await pb('POST', `/my/${c.handle}/partner/details`, { form: { payout_details: 'PayPal: jamie@example.com' } });
  assert.equal((await partnerOf(c, p.id)).payout_details, 'PayPal: jamie@example.com');
  assert.equal((await pb('GET', `/my/${c.handle}/partner/enter/1.${c.accountId}.9999999999.bad`)).status, 401);
});

test('self-referral earns nothing; a refund inside the hold period voids', async () => {
  const c = await owner('Sally');
  await shop(c);
  const { body: { id } } = await c('POST', '/api/partners', { name: 'Pat', email: 'pat@example.com' });
  const p = await partnerOf(c, id);
  await clickAndBuy(p.link, { email: 'PAT@example.com' });
  assert.equal((await partnerOf(c, id)).sales, 0, 'own purchase earns nothing');

  const { orderId } = await clickAndBuy(p.link, { email: 'friend@example.com' });
  assert.equal((await partnerOf(c, id)).earned, '$9.80');
  await app.getDb().run("UPDATE orders SET status = 'refunded' WHERE id = ?", orderId);
  await jobs(c, 31);
  const after = await partnerOf(c, id);
  assert.deepEqual([after.sales, after.earned, after.owed], [0, '$0', '$0']);
  const detail = (await c('GET', `/api/partners/${id}`)).body;
  assert.equal(detail.commissions[0].status, 'void');

  // The owner can cancel a commission by hand, and undo it.
  const { orderId: o2 } = await clickAndBuy(p.link, { email: 'friend2@example.com' });
  const cm = (await c('GET', `/api/partners/${id}`)).body.commissions.find((x) => x.status === 'pending');
  assert.ok(o2 && cm);
  await c('PUT', `/api/partners/commissions/${cm.id}`, { status: 'void' });
  assert.equal((await partnerOf(c, id)).earned, '$0');
  await c('PUT', `/api/partners/commissions/${cm.id}`, { status: 'pending' });
  assert.equal((await partnerOf(c, id)).earned, '$9.80');
});

test('customer referrals: the friend gets the code at checkout, the customer a thank-you on their friend’s first purchase', async () => {
  const c = await owner('Cora');
  await shop(c);
  const { body: { id: couponId } } = await c('POST', '/api/coupons', { code: 'FRIEND10', kind: 'percent', value: 10 });
  assert.equal((await c('PUT', '/api/partners/program', { commission_type: 'percent', commission: 25, reward_type: 'amount', reward: 15, friend_coupon_id: couponId, hold_days: 0 })).status, 200);
  const { body: { id } } = await c('POST', '/api/partners', { name: 'Kim', email: 'kim@example.com', kind: 'customer' });
  const p = await partnerOf(c, id);
  const { redirect, orderId } = await clickAndBuy(p.link, { email: 'newbie@example.com' });
  assert.match(redirect, /&coupon=FRIEND10$/);
  const order = (await c('GET', '/api/orders')).body.find((o) => o.id === orderId);
  assert.deepEqual([order.coupon_code, order.amount_cents], ['FRIEND10', 4410], 'code applied without typing it');
  assert.equal((await partnerOf(c, id)).earned, '$15');
  // The same friend buying again isn't a new referral.
  await clickAndBuy(p.link, { email: 'newbie@example.com' });
  assert.equal((await partnerOf(c, id)).sales, 1);

  // The Referral ask email fills in each customer's own link and the reward.
  const wf = (await c('GET', '/api/workflows')).body.find((w) => /Referral ask/.test(w.name));
  const full = (await c('GET', `/api/workflows/${wf.id}`)).body;
  assert.ok(full.triggers.referral, 'a "Sends a referral that buys" trigger exists');
  const mail = Object.values(full.graph.nodes).find((n) => n.type === 'email');
  assert.match(mail.config.body, /\{\{referral_link\}\}/);
  const fields = await app.messaging.hooks.extraFields({ id: c.accountId }, { id: (await c('GET', '/api/contacts')).body.find((x) => x.email === 'newbie@example.com').id });
  assert.match(fields.referral_link, /\/r\/newbie-[0-9a-f]{4}$/);
  assert.equal(fields.referral_reward, 'They get 10% off and you get $15 as a thank-you when they buy.');
});

test('recurring commissions stop after the program’s months; Stripe refunds void', async () => {
  const c = await owner('Rhea');
  await shop(c, { price: '30', billing: 'monthly' });
  await c('PUT', '/api/account/stripe', { secretKey: 'sk_test_rec', webhookSecret: 'whsec_rec' });
  await c('PUT', '/api/partners/program', { commission_type: 'percent', commission: 50, recurring_months: 3, cookie_days: 30, hold_days: 30 });
  const { body: { id } } = await c('POST', '/api/partners', { name: 'Ray', email: 'ray@example.com' });
  const p = await partnerOf(c, id);
  const v = browser();
  const r = await v('GET', p.link);
  const landing = await v('GET', r.location);
  const slug = r.location.match(/\/f\/([^/?]+)/)[1];
  const buy = await v('POST', `/f/${slug}/pricing/buy`, { form: { block: landing.body.match(/name="block" value="([^"]+)"/)[1] } });
  assert.match(buy.location, /checkout\.stripe\.test/);
  const session = Object.values(sessions).at(-1);
  const hook = async (event) => {
    const payload = JSON.stringify(event);
    const t = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac('sha256', 'whsec_rec').update(`${t}.${payload}`).digest('hex');
    return browser()('POST', `/stripe/webhook/${c.accountId}`, { json: payload, headers: { 'stripe-signature': `t=${t},v1=${sig}` } });
  };
  assert.equal((await hook({ type: 'checkout.session.completed', data: { object: session } })).status, 200);
  assert.equal((await partnerOf(c, id)).earned, '$15');
  const paidAt = (days) => Math.floor((Date.now() + days * 864e5) / 1000);
  const invoice = (n, days) => ({ type: 'invoice.paid', data: { object: { id: `in_x_${n}`, subscription: session.subscription, billing_reason: 'subscription_cycle', amount_paid: 3000, status_transitions: { paid_at: paidAt(days) } } } });
  await hook(invoice(2, 31));
  await hook(invoice(2, 31)); // Stripe retries: counted once
  await hook(invoice(3, 61));
  await hook(invoice(4, 92)); // past 3 months: no commission
  const d = (await c('GET', `/api/partners/${id}`)).body;
  assert.deepEqual(d.commissions.map((x) => x.payment_no).sort(), [1, 2, 3]);
  assert.equal(d.earned, '$45');

  // Refund of the second payment voids its commission; the others stand.
  await hook({ type: 'charge.refunded', data: { object: { id: 'ch_1', invoice: 'in_x_2', amount: 3000, amount_refunded: 3000, refunded: true } } });
  assert.equal((await partnerOf(c, id)).earned, '$30');
  // First payment's refund matches by the checkout's invoice.
  await hook({ type: 'charge.refunded', data: { object: { id: 'ch_2', invoice: session.invoice, amount: 3000, amount_refunded: 3000, refunded: true } } });
  assert.equal((await partnerOf(c, id)).earned, '$15');
});

test('applications: public page only when turned on; approve emails the link', async () => {
  const c = await owner('Abby');
  const pub = browser();
  assert.equal((await pub('GET', `/my/${c.handle}/partner/join`)).status, 404);
  await c('PUT', '/api/partners/program', { commission_type: 'amount', commission: 12, signup_open: true });
  const page = await pub('GET', `/my/${c.handle}/partner/join`);
  assert.match(page.body, /earn \$12 for each sale/);
  await pub('POST', `/my/${c.handle}/partner/join`, { form: { name: 'Ann Apply', email: 'ann@example.com', how: 'My newsletter' } });
  const list = (await c('GET', '/api/partners')).body.partners;
  assert.deepEqual([list[0].status, list[0].application], ['applied', 'My newsletter']);
  assert.ok((await c('GET', '/api/outbox')).body.some((m) => /New partner application: Ann Apply/.test(m.subject)));
  // An applicant's link doesn't track yet.
  assert.equal((await pub('GET', list[0].link)).status, 404);
  await c('PUT', `/api/partners/${list[0].id}`, { status: 'active' });
  assert.ok((await outbox(c, 'ann@example.com')).some((m) => /approved/.test(m.subject)));
});

test('monthly "Partners to pay" summary goes to the owner once a month', async () => {
  const c = await owner('Mona');
  await shop(c);
  await c('PUT', '/api/partners/program', { commission_type: 'percent', commission: 10, hold_days: 0, min_payout: 1 });
  const { body: { id } } = await c('POST', '/api/partners', { name: 'Max', email: 'max@example.com' });
  await clickAndBuy((await partnerOf(c, id)).link, { email: 'buyer9@example.com' });
  await jobs(c, 1);
  await jobs(c, 40);
  await jobs(c, 41);
  const sums = (await c('GET', '/api/outbox')).body.filter((m) => /^Partners to pay/.test(m.subject));
  assert.equal(sums.length, 1);
  assert.match(sums[0].subject, /\$4\.90 to 1 person/);
  assert.match(sums[0].body, /Max: \$4\.90/);
});

test('account isolation, and a partner only sees their own data', async () => {
  const a = await owner('Ada');
  const b = await owner('Bob');
  const aShop = await shop(a);
  const { body: { id: p1 } } = await a('POST', '/api/partners', { name: 'One', email: 'one@example.com' });
  const { body: { id: p2 } } = await a('POST', '/api/partners', { name: 'Two', email: 'two@example.com' });
  const one = await partnerOf(a, p1);
  const two = await partnerOf(a, p2);
  await clickAndBuy(one.link, { email: 'x1@example.com' });

  assert.equal((await b('GET', '/api/partners')).body.partners.length, 0);
  assert.equal((await b('GET', `/api/partners/${p1}`)).status, 404);
  assert.equal((await b('PUT', `/api/partners/${p1}`, { status: 'paused' })).status, 404);
  assert.equal((await b('POST', `/api/partners/${p1}/payouts`, {})).status, 404);
  const cm = (await a('GET', `/api/partners/${p1}`)).body.commissions[0];
  assert.equal((await b('PUT', `/api/partners/commissions/${cm.id}`, { status: 'void' })).status, 400);
  assert.equal((await a('GET', `/api/partners/${p1}`)).body.commissions[0].status, 'pending');
  // A partner link for business A never tracks on business B's pages.
  const bShop = await shop(b);
  const v = browser();
  await v('GET', `/f/${bShop.funnel.slug}?ref=${one.code}`);
  assert.equal(v.jar[`rref${b.accountId}`], undefined);

  // Partner Two's dashboard shows Two's link and none of One's sales.
  const enter = (await outbox(a, 'two@example.com'))[0].body.match(/https?:\/\/\S+\/partner\/enter\/\S+/)[0];
  const pb = browser();
  await pb('GET', enter);
  const dash = (await pb('GET', `/my/${a.handle}/partner`)).body;
  assert.ok(dash.includes(two.code) && !dash.includes(one.code));
  assert.match(dash, /No sales yet/);
  // Two's sign-in doesn't open business B's partner page.
  assert.match((await pb('GET', `/my/${b.handle}/partner`)).body, /Email me a sign-in link/);
  // A tampered cookie is ignored at checkout.
  const tamper = browser();
  tamper.jar[`rref${a.accountId}`] = `${p2}.9999999999.forged`;
  const buy = await tamper('POST', `/f/${aShop.funnel.slug}/pricing/buy`, { form: { block: aShop.block.id } });
  await tamper('POST', buy.location, { form: { email: 'x2@example.com' } });
  assert.equal((await a('GET', '/api/orders')).body.find((o) => o.email === 'x2@example.com').status, 'paid');
  assert.equal((await partnerOf(a, p2)).sales, 0, 'forged cookie earns nothing');
});
