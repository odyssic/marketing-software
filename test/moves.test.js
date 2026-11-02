process.env.ALLOW_SIGNUPS = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../src/app');

// A stand-in for the Claude API: records requests, replies with JSON drafts.
let fakeReply = null;
const seen = [];
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    seen.push({ url: req.url, headers: req.headers, body: JSON.parse(body) });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: fakeReply.stop_reason || 'end_turn',
      content: [{ type: 'text', text: JSON.stringify(fakeReply.json || {}) }], usage: { input_tokens: 10, output_tokens: 10 } }));
  });
});

let app, server, base;
before(async () => {
  await new Promise((r) => fake.listen(0, r));
  app = createApp(process.env.TEST_DATABASE_URL ? {} : { dbPath: ':memory:' });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});
after(async () => { server.close(); fake.close(); await app.close(); delete process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_BASE_URL; });

function client() {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
}
async function setup(email) {
  const c = client();
  assert.equal((await c('POST', '/api/auth/signup', { name: 'Mo Ves', email, password: 'password123', workspace: 'Kiln & Co' })).status, 201);
  return c;
}
const daysAgo = (d) => new Date(Date.now() - d * 864e5).toISOString();
async function seedInquiries(c) {
  const ids = [];
  for (const [email, days] of [['a@example.com', 20], ['b@example.com', 30], ['c@example.com', 16], ['fresh@example.com', 3]]) {
    const p = (await c('POST', '/api/contacts', { email, first_name: email[0].toUpperCase() })).body;
    await c('POST', `/api/people/${p.id}/events`, { type: 'inquiry', occurred_at: daysAgo(days) });
    ids.push(p.id);
  }
  await c('PUT', `/api/contacts/${ids[2]}`, { unsubscribed: true });
  return ids;
}

test('weekly move: picked for the focus lever, stable for the week, template draft, approve & send, results', async () => {
  const c = await setup('moves@example.com');
  const [a, b] = await seedInquiries(c);
  await c('PUT', '/api/levers/pin', { lever: 'conversion' });
  const m = (await c('GET', '/api/moves/current')).body;
  assert.equal(m.lever, 'conversion');
  assert.equal(m.status, 'proposed');
  assert.equal(m.count, 3); // the 3-day-old inquiry is too fresh; the unsubscribed one has no usable email
  assert.match(m.title, /^Follow up personally on 2 inquiries older than two weeks$|^Follow up personally on 3 inquiries/);
  assert.match(m.reason, /You pinned Conversion/);
  assert.equal((await c('GET', '/api/moves/current')).body.campaign_id, m.campaign_id); // same move all week
  const tile = (await c('GET', '/api/tiles?ids=move')).body.move.data;
  assert.equal(tile.campaign_id, m.campaign_id);

  // No AI key: a clearly-marked template draft.
  const d = (await c('POST', `/api/campaigns/${m.campaign_id}/draft`)).body;
  assert.equal(d.template, true);
  assert.equal(d.subject, 'Following up on your question');
  await c('PUT', `/api/campaigns/${m.campaign_id}`, { subject: 'Still thinking it over, {{first_name|friend}}?', body: 'Hi {{first_name|there}}, happy to help.' });
  const sent = (await c('POST', `/api/campaigns/${m.campaign_id}/send`)).body;
  assert.equal(sent.sent + sent.skipped, m.count);
  assert.equal((await c('POST', `/api/campaigns/${m.campaign_id}/send`)).status, 409);
  assert.equal((await c('POST', `/api/campaigns/${m.campaign_id}/draft`)).status, 409);
  const mail = (await c('GET', '/api/outbox')).body.filter((x) => x.campaign_id === m.campaign_id);
  assert.equal(mail.length, sent.sent);
  assert.equal(mail.find((x) => x.to_email === 'a@example.com').subject, 'Still thinking it over, A?');

  // Answered people drop off "Inquiries waiting"; a purchase shows in results.
  const waiting = (await c('GET', '/api/tiles?ids=inquiries')).body.inquiries.data;
  assert.deepEqual(waiting.people.map((p) => p.name), ['fresh@example.com'].map(() => 'F'));
  await c('POST', '/api/import/orders', { orders: [{ order_id: 'm1', email: 'b@example.com', total: 75, date: new Date().toISOString() }] });
  const page = (await c('GET', `/api/campaigns/${m.campaign_id}`)).body;
  assert.equal(page.status, 'sent');
  assert.equal(page.stats.buyers, 1);
  assert.equal(page.stats.revenue, '$75');
  assert.match(page.stats.plain, /bought within 14 days/);
  assert.equal((await c('GET', '/api/moves/current')).body.status, 'sent');
  assert.ok((await c('GET', '/api/campaigns')).body.some((x) => x.id === m.campaign_id && x.audience_count === m.count));

  const other = await setup('moves-other@example.com');
  assert.equal((await other('GET', `/api/campaigns/${m.campaign_id}`)).status, 404);
  assert.equal((await other('POST', `/api/campaigns/${m.campaign_id}/send`)).status, 404);
  void a; void b;
});

test('skip, empty workspaces, and the voice profile', async () => {
  const empty = await setup('moves-empty@example.com');
  const e = (await empty('GET', '/api/moves/current')).body;
  assert.equal(e.status, 'empty');
  assert.equal((await empty('GET', '/api/tiles?ids=move')).body.move.data, null);

  const c = await setup('moves-skip@example.com');
  await seedInquiries(c);
  await c('PUT', '/api/levers/pin', { lever: 'conversion' });
  const m = (await c('GET', '/api/moves/current')).body;
  assert.equal((await c('POST', `/api/campaigns/${m.campaign_id}/skip`)).status, 200);
  assert.equal((await c('GET', '/api/moves/current')).body.status, 'skipped');

  const v = (await c('PUT', '/api/account/voice', { samples: ['one', ' ', 'two', 'three', 'four', 'five', 'six'], notes: 'warm, dry' })).body;
  assert.equal(v.samples, 5);
  const me = (await c('GET', '/api/me')).body;
  assert.equal(JSON.parse(me.account.voice_samples).length, 5);
  assert.equal(me.account.voice_notes, 'warm, dry');
  assert.equal(me.aiLive, false);
});

test('AI drafting: Claude Opus 5.5, the owner\'s voice, structured JSON; refusals are explained', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  process.env.ANTHROPIC_BASE_URL = `http://localhost:${fake.address().port}`;
  const c = await setup('moves-ai@example.com');
  await seedInquiries(c);
  await c('PUT', '/api/levers/pin', { lever: 'conversion' });
  await c('PUT', '/api/account/voice', { samples: ['We fire every mug twice.', 'Small batches, big hearts.', 'Glaze is weather.'], notes: 'warm, short' });
  const m = (await c('GET', '/api/moves/current')).body;

  fakeReply = { json: { subject: 'About your question', body: 'Hi {{first_name|there}}, I fire every mug twice.' } };
  const d = (await c('POST', `/api/campaigns/${m.campaign_id}/draft`)).body;
  assert.deepEqual(d, { subject: 'About your question', body: 'Hi {{first_name|there}}, I fire every mug twice.', template: false });
  const req = seen.at(-1);
  assert.equal(req.url, '/v1/messages');
  assert.equal(req.body.model, 'claude-opus-5-5');
  assert.equal(req.body.output_config.format.type, 'json_schema');
  assert.deepEqual(req.body.output_config.format.schema.required.sort(), ['body', 'subject']);
  const system = typeof req.body.system === 'string' ? req.body.system : JSON.stringify(req.body.system);
  assert.match(system, /Kiln & Co/);
  assert.match(system, /We fire every mug twice/);
  assert.match(system, /warm, short/);
  assert.match(system, /Never invent facts/);
  assert.match(req.body.messages[0].content, /Follow up personally/);

  fakeReply = { stop_reason: 'refusal', json: {} };
  const r = await c('POST', `/api/campaigns/${m.campaign_id}/draft`);
  assert.equal(r.status, 422);
  assert.match(r.body.error, /declined/);
});

test('describe-to-build: one sentence picks a template, writes the copy, and adds its workflows', async () => {
  // AI on (stand-in server from above).
  const c = await setup('describe@example.com');
  fakeReply = { json: { template: 'optin', name: 'Glaze guide', headline: 'Glaze like a pro in one weekend', subheadline: 'A free 12-page guide for beginners.', button: 'Send my guide', thank_you: 'Check your inbox!' } };
  const r = (await c('POST', '/api/funnels/describe', { sentence: 'A free glaze guide for beginner potters that leads to my kit' })).body;
  assert.equal(r.drafted, true);
  assert.equal(r.workflows.length, 1);
  const f = (await c('GET', `/api/funnels/${r.id}`)).body;
  assert.equal(f.name, 'Glaze guide');
  assert.equal(f.status, 'draft');
  const [first, last] = f.steps;
  assert.equal(first.blocks.find((b) => b.type === 'heading').text, 'Glaze like a pro in one weekend');
  assert.equal(first.blocks.find((b) => b.type === 'text').text, 'A free 12-page guide for beginners.');
  assert.equal(first.blocks.find((b) => b.type === 'form').buttonLabel, 'Send my guide');
  assert.equal(last.blocks.find((b) => b.type === 'heading').text, 'Check your inbox!');
  assert.match(seen.at(-1).body.output_config.format.schema.properties.template.description, /optin, sales, pricing, upsell, newsletter, consult/);
  // An unknown template name from the model falls back to a keyword guess.
  fakeReply = { json: { template: 'webinar', name: 'News', headline: 'h', subheadline: 's', button: 'b', thank_you: 't' } };
  assert.equal((await c('POST', '/api/funnels/describe', { sentence: 'A monthly newsletter about pottery' })).body.template, 'newsletter');
  assert.equal((await c('POST', '/api/funnels/describe', { sentence: 'short' })).status, 400);

  // AI off: keyword guess, template copy kept.
  delete process.env.ANTHROPIC_API_KEY;
  const g = (await c('POST', '/api/funnels/describe', { sentence: 'Book a free consultation call for kitchen remodels.' })).body;
  assert.equal(g.template, 'consult');
  assert.equal(g.drafted, false);
  assert.equal(g.name, 'Book a free consultation call for'); // up to 40 characters, whole words
});

