process.env.ALLOW_SIGNUPS = '1';
process.env.TEST_MIN_VISITS = '4';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Stand-in Stripe: checkout sessions (with the card saved) and off-session charges.
const charges = [];
let chargeStatus = 'succeeded';
const sessions = {};
const fakeStripe = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    const p = new URLSearchParams(body);
    if (req.method === 'POST' && req.url === '/v1/checkout/sessions') {
      const id = `cs_${Object.keys(sessions).length + 1}`;
      sessions[id] = { id, url: `https://checkout.stripe.test/${id}`, client_reference_id: p.get('client_reference_id'), payment_status: 'paid',
        saves_card: p.get('payment_intent_data[setup_future_usage]'), customer: 'cus_1', payment_intent: { id: 'pi_first', payment_method: 'pm_1' },
        customer_details: { email: 'buyer@example.com', name: 'Bea Buyer' } };
      return res.end(JSON.stringify(sessions[id]));
    }
    const m = req.url.match(/^\/v1\/checkout\/sessions\/([^?]+)/);
    if (m && sessions[m[1]]) return res.end(JSON.stringify(sessions[m[1]]));
    if (req.method === 'POST' && req.url === '/v1/payment_intents') {
      charges.push(Object.fromEntries(p));
      return res.end(JSON.stringify({ id: `pi_${charges.length + 1}`, status: chargeStatus }));
    }
    res.statusCode = 404; res.end(JSON.stringify({ error: { message: 'nope' } }));
  });
});

let app, server, base, port;
before(async () => {
  await new Promise((r) => fakeStripe.listen(0, r));
  process.env.STRIPE_API_BASE = `http://localhost:${fakeStripe.address().port}`;
  const { createApp } = require('../src/app');
  app = createApp(process.env.TEST_DATABASE_URL ? {} : { dbPath: ':memory:' });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  port = server.address().port;
  base = `http://localhost:${port}`;
});
after(async () => { server.close(); fakeStripe.close(); await app.close(); delete process.env.STRIPE_API_BASE; });

// A browser-like client: keeps every cookie it's given.
function client() {
  const jar = {};
  const call = async (method, path, body, { form } = {}) => {
    const res = await fetch(base + path, { method, redirect: 'manual',
      headers: { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
      body: form ? new URLSearchParams(form) : body && JSON.stringify(body) });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); }
    const type = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : await res.text() };
  };
  call.jar = jar;
  return call;
}
async function owner(email) {
  const c = client();
  assert.equal((await c('POST', '/api/auth/signup', { name: 'Adv', email, password: 'password123' })).status, 201);
  return c;
}
const hostGet = (host, path) => new Promise((resolve, reject) => {
  http.get({ host: 'localhost', port, path, headers: { host } }, (res) => { let d = ''; res.on('data', (x) => { d += x; }); res.on('end', () => resolve({ status: res.statusCode, body: d })); }).on('error', reject);
});

test('split test: visitors keep their version, conversions per version, winner marked, B promoted', async () => {
  const c = await owner('ab@example.com');
  const { id } = (await c('POST', '/api/funnels', { name: 'AB guide', template: 'optin' })).body;
  await c('POST', `/api/funnels/${id}/publish`);
  const f = (await c('GET', `/api/funnels/${id}`)).body;
  const page = f.steps[0];
  assert.equal((await c('POST', `/api/steps/${page.id}/variant`, { mode: 'suggestion' })).status, 201);
  assert.equal((await c('POST', `/api/steps/${page.id}/variant`)).status, 409);
  const step = (await c('GET', `/api/steps/${page.id}`)).body;
  assert.equal(step.variant_blocks.find((b) => b.type === 'form').collectName, false); // the suggested fix: email only
  // B is editable on its own.
  await c('PUT', `/api/steps/${page.id}`, { variant: 'b', blocks: step.variant_blocks.map((b) => (b.type === 'heading' ? { ...b, text: 'Version B headline' } : b)) });

  const form = page.blocks.find((b) => b.type === 'form');
  const seen = { a: 0, b: 0 };
  // Each visitor loads the page twice; once both versions pass the threshold the winner
  // is marked and new visitors just get it (no cookie), so stop there.
  for (let i = 0; i < 60; i++) {
    const v = client();
    const html = (await v('GET', `/f/${f.slug}`)).body;
    const variant = v.jar[`ab${page.id}`];
    if (!variant) break;
    assert.equal(html.includes('Version B headline'), variant === 'b');
    assert.equal((await v('GET', `/f/${f.slug}`)).body.includes('Version B headline'), variant === 'b'); // same visitor, same version
    seen[variant]++;
    if (variant === 'b') await v('POST', `/f/${f.slug}/optin/optin`, undefined, { form: { block: form.id, email: `b${i}@example.com` } });
  }
  assert.ok(seen.a >= 2 && seen.b >= 2, JSON.stringify(seen));
  const t = (await c('GET', `/api/steps/${page.id}/test`)).body;
  assert.equal(t.winner, 'b');
  assert.equal(t.a.conversions, 0);
  assert.ok(t.b.conversions >= 2);
  assert.match(t.b.plain, /of every 100 visitors converted/);
  assert.match((await client()('GET', `/f/${f.slug}`)).body, /Version B headline/); // everyone sees the winner now

  assert.equal((await c('POST', `/api/steps/${page.id}/variant/promote`)).status, 200);
  const after = (await c('GET', `/api/steps/${page.id}`)).body;
  assert.equal(after.variant_blocks, null);
  assert.equal(after.blocks.find((b) => b.type === 'heading').text, 'Version B headline');
  assert.equal((await c('GET', `/api/steps/${page.id}/versions`)).body[0].reason, 'before keeping version B');
  const other = await owner('ab-other@example.com');
  assert.equal((await other('POST', `/api/steps/${page.id}/variant`)).status, 404);
});

async function upsellFunnel(c) {
  const main = (await c('POST', '/api/products', { name: 'Glaze kit', price: 49 })).body;
  const up = (await c('POST', '/api/products', { name: 'Pro brushes', price: 19 })).body;
  const { id } = (await c('POST', '/api/funnels', { name: `Kit ${Math.random().toString(36).slice(2, 6)}`, template: 'upsell' })).body;
  const f = (await c('GET', `/api/funnels/${id}`)).body;
  const by = Object.fromEntries(f.steps.map((s) => [s.name, s]));
  for (const [nm, pid] of [['Sales page', main.id], ['Upsell', up.id], ['Downsell', up.id]]) {
    await c('PUT', `/api/steps/${by[nm].id}`, { blocks: by[nm].blocks.map((b) => (b.type === 'pricing' ? { ...b, productId: pid } : b)) });
  }
  assert.equal((await c('POST', `/api/funnels/${id}/publish`)).status, 200);
  return { f, by };
}

test('one-click upsell in test mode: buy once, then "yes" adds the upgrade with no second checkout', async () => {
  const c = await owner('oto@example.com');
  const { f, by } = await upsellFunnel(c);
  const buyer = client();
  const sales = by['Sales page'];
  const pricing = sales.blocks.find((b) => b.type === 'pricing');
  const go = await buyer('POST', `/f/${f.slug}/${sales.slug}/buy`, undefined, { form: { block: pricing.id } });
  const testUrl = go.headers.get('location');
  const paid = await buyer('POST', testUrl, undefined, { form: { email: 'oto-buyer@example.com', name: 'Otto' } });
  assert.equal(paid.headers.get('location'), `/f/${f.slug}/upgrade`);
  assert.ok(buyer.jar.ffbuyer);

  const upsellHtml = (await buyer('GET', `/f/${f.slug}/upgrade`)).body;
  assert.match(upsellHtml, /action="\/f\/[^"]+\/upgrade\/oneclick"/);
  assert.match(upsellHtml, /One click: added to the card you just used/);
  assert.doesNotMatch((await client()("GET", `/f/${f.slug}/upgrade`)).body, /\/oneclick"/); // strangers get the normal checkout

  const upBlock = by.Upsell.blocks.find((b) => b.type === 'pricing');
  const one = await buyer('POST', `/f/${f.slug}/upgrade/oneclick`, undefined, { form: { block: upBlock.id } });
  assert.equal(one.status, 303);
  assert.equal(one.headers.get('location'), `/f/${f.slug}/thank-you`);
  const orders = (await c('GET', '/api/orders')).body;
  assert.deepEqual(orders.map((o) => [o.product_name, o.amount_cents, o.status]), [['Pro brushes', 1900, 'paid'], ['Glaze kit', 4900, 'paid']]);
  const person = (await c('GET', '/api/contacts')).body.find((p) => p.email === 'oto-buyer@example.com');
  assert.equal((await c('GET', `/api/people/${person.id}`)).body.totals.spent_cents, 6800);
  // A stranger posting to the one-click URL is sent to the normal checkout.
  const stranger = await client()('POST', `/f/${f.slug}/upgrade/oneclick`, undefined, { form: { block: upBlock.id } });
  assert.equal(stranger.status, 307);
  assert.equal(stranger.headers.get('location'), `/f/${f.slug}/upgrade/buy`);
});

test('one-click upsell with Stripe: the saved card is charged off-session; a declined charge falls back to checkout', async () => {
  const c = await owner('oto-stripe@example.com');
  await c('PUT', '/api/account/stripe', { secretKey: 'sk_test_abc123' });
  const { f, by } = await upsellFunnel(c);
  const buyer = client();
  const pricing = by['Sales page'].blocks.find((b) => b.type === 'pricing');
  const go = await buyer('POST', `/f/${f.slug}/offer/buy`, undefined, { form: { block: pricing.id } });
  const sid = go.headers.get('location').split('/').pop();
  assert.equal(sessions[sid].saves_card, 'off_session');
  const [first] = (await c('GET', '/api/orders')).body;
  const ok = await buyer('GET', `/checkout/success/${first.id}?session_id=${sid}`);
  assert.equal(ok.headers.get('location'), `/f/${f.slug}/upgrade`);

  const upBlock = by.Upsell.blocks.find((b) => b.type === 'pricing');
  const one = await buyer('POST', `/f/${f.slug}/upgrade/oneclick`, undefined, { form: { block: upBlock.id } });
  assert.equal(one.status, 303);
  assert.deepEqual([charges[0].amount, charges[0].customer, charges[0].payment_method, charges[0].off_session, charges[0].confirm], ['1900', 'cus_1', 'pm_1', 'true', 'true']);
  assert.equal((await c('GET', '/api/orders')).body[0].status, 'paid');

  chargeStatus = 'requires_action';
  const fallback = await buyer('POST', `/f/${f.slug}/upgrade/oneclick`, undefined, { form: { block: upBlock.id } });
  assert.equal(fallback.status, 307);
  assert.equal(fallback.headers.get('location'), `/f/${f.slug}/upgrade/buy`);
  assert.equal((await c('GET', '/api/orders')).body[0].status, 'failed');
  chargeStatus = 'succeeded';
});

test('custom domains: a published funnel answers on its own domain; drafts and unknown domains don\'t', async () => {
  const c = await owner('domain@example.com');
  const { id } = (await c('POST', '/api/funnels', { name: 'Shop', template: 'optin' })).body;
  assert.equal((await c('PUT', `/api/funnels/${id}`, { domain: 'not a domain' })).status, 400);
  assert.equal((await c('PUT', `/api/funnels/${id}`, { domain: 'https://Shop.Example.com/' })).body.domain, 'shop.example.com');
  assert.equal((await hostGet('shop.example.com', '/')).status, 404); // still a draft
  await c('POST', `/api/funnels/${id}/publish`);
  const home = await hostGet('shop.example.com', '/');
  assert.equal(home.status, 200);
  assert.match(home.body, /free guide/i);
  assert.match((await hostGet('shop.example.com', '/thank-you')).body, /You are in!/);
  assert.match((await hostGet('localhost', '/d/shop.example.com/thank-you')).body, /You are in!/); // via the Netlify edge rewrite
  assert.equal((await hostGet('nobody.example.org', '/')).status, 404);
  assert.equal((await hostGet(`localhost:${port}`, '/')).status, 200); // the app itself is unaffected
  const other = await owner('domain-other@example.com');
  const o = (await other('POST', '/api/funnels', { name: 'Other', template: 'blank' })).body;
  assert.equal((await other('PUT', `/api/funnels/${o.id}`, { domain: 'shop.example.com' })).status, 409);
});

test('click-to-edit: the editor preview marks text as editable; live pages do not', async () => {
  const c = await owner('inline@example.com');
  const r = (await c('POST', '/api/preview', { blocks: [{ id: 'h', type: 'heading', text: 'Hello' }, { id: 'f', type: 'form', buttonLabel: 'Join' }] })).body;
  assert.match(r.html, /<div data-bi="0"><h1 style="text-align:center" data-f="text">Hello<\/h1>/);
  assert.match(r.html, /data-f="buttonLabel"/);
  assert.match(r.html, /postMessage\(\{ff:'edit'/);
});
