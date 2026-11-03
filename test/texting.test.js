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
const crypto = require('node:crypto');
const { twilioSignature, e164, quietUntil, stripQuoted } = require('../src/texting');
process.env.TWILIO_AUTH_TOKEN = 'test-token'; // no account SID, so nothing is really sent

// Posts like Twilio does: a form body with a valid signature.
async function twilio(path, params, { badSig = false } = {}) {
  const url = `${process.env.PUBLIC_URL}${path}`;
  const sig = badSig ? 'nope' : twilioSignature('test-token', url, params);
  const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': sig }, body: new URLSearchParams(params) });
  return { status: res.status, text: await res.text() };
}

test('phone numbers, quiet hours and quoted replies', () => {
  assert.equal(e164('(555) 123-4567'), '+15551234567');
  assert.equal(e164('+44 7700 900123'), '+447700900123');
  assert.equal(e164('abc'), '');
  const acct = { booking: JSON.stringify({ tz: 'America/New_York' }) };
  assert.equal(quietUntil(acct, new Date('2026-06-01T16:00:00Z')), null); // noon in New York
  assert.ok(quietUntil(acct, new Date('2026-06-02T03:00:00Z'))); // 11pm
  assert.equal(stripQuoted('Sounds good!\n\nOn Mon, Jun 1, 2026 Ann wrote:\n> hi'), 'Sounds good!');
});

test('texts in and out land in one inbox; STOP is respected', async () => {
  process.env.PUBLIC_URL = base;
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Tess', email: 'tess@example.com', password: 'password123', workspace: 'Tess Tiles', business_type: 'services' });
  assert.equal((await c('PUT', '/api/account/texting', { sms_number: '(555) 010-0001', forward_to: '' })).status, 200);
  assert.equal((await twilio('/hooks/sms', { From: '+15550109999', To: '+15550100001', Body: 'Do you do bathrooms?', MessageSid: 'SM1' }, { badSig: true })).status, 403);
  const r = await twilio('/hooks/sms', { From: '+15550109999', To: '+15550100001', Body: 'Do you do bathrooms?', MessageSid: 'SM1' });
  assert.equal(r.status, 200);
  assert.match(r.text, /<Response>/);
  await twilio('/hooks/sms', { From: '+15550109999', To: '+15550100001', Body: 'Do you do bathrooms?', MessageSid: 'SM1' }); // a retry
  let inbox = (await c('GET', '/api/inbox')).body;
  assert.equal(inbox.conversations.length, 1);
  assert.equal(inbox.conversations[0].unread, 1);
  assert.equal((await c('GET', '/api/inbox/unread')).body.unread, 1);
  const cid = inbox.conversations[0].id;
  const thread = (await c('GET', `/api/inbox/${cid}`)).body;
  assert.equal(thread.messages.length, 1);
  assert.equal((await c('GET', '/api/inbox/unread')).body.unread, 0);
  // Reply by text (test mode: logged).
  assert.equal((await c('POST', `/api/inbox/${cid}/reply`, { channel: 'sms', body: 'We do! Want a quote?' })).body.status, 'logged');
  assert.equal((await c('POST', `/api/inbox/${cid}/reply`, { channel: 'email', body: 'hi' })).status, 409); // no email address
  // STOP: no more texts.
  await twilio('/hooks/sms', { From: '+15550109999', To: '+15550100001', Body: 'STOP', MessageSid: 'SM2' });
  assert.equal((await c('POST', `/api/inbox/${cid}/reply`, { channel: 'sms', body: 'Still there?' })).status, 409);
  await twilio('/hooks/sms', { From: '+15550109999', To: '+15550100001', Body: 'START', MessageSid: 'SM3' });
  assert.equal((await c('POST', `/api/inbox/${cid}/reply`, { channel: 'sms', body: 'Welcome back' })).status, 200);
});

test('a missed call gets a text back once; an answered call is just noted', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Cal', email: 'cal@example.com', password: 'password123', workspace: 'Cal Cuts', business_type: 'local' });
  await c('PUT', '/api/account/texting', { sms_number: '+15550100002', forward_to: '555-010-7777' });
  const ring = await twilio('/hooks/voice', { From: '+15550108888', To: '+15550100002', CallSid: 'CA1' });
  assert.match(ring.text, /<Dial[^>]*action="\/hooks\/voice\/done"[^>]*>\+15550107777<\/Dial>/);
  await twilio('/hooks/voice/done', { From: '+15550108888', To: '+15550100002', DialCallStatus: 'no-answer' });
  await twilio('/hooks/voice/done', { From: '+15550108888', To: '+15550100002', DialCallStatus: 'busy' });
  const conv = (await c('GET', '/api/inbox')).body.conversations[0];
  const msgs = (await c('GET', `/api/inbox/${conv.id}`)).body.messages;
  assert.equal(msgs.filter((m) => m.channel === 'call').length, 2);
  const texts = msgs.filter((m) => m.channel === 'sms' && m.direction === 'out');
  assert.equal(texts.length, 1); // not twice
  assert.match(texts[0].body, /Cal Cuts.*missed your call/);
  await twilio('/hooks/voice/done', { From: '+15550108888', To: '+15550100002', DialCallStatus: 'completed', DialCallDuration: '125' });
  assert.ok((await c('GET', `/api/inbox/${conv.id}`)).body.messages.some((m) => m.body === 'Answered call (2 min)'));
});

test('workflow texts need permission; email replies thread into the inbox', async () => {
  process.env.INBOUND_DOMAIN = 'in.example.com';
  process.env.EMAIL_WEBHOOK_SECRET = `whsec_${Buffer.from('k'.repeat(24)).toString('base64')}`;
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Wes', email: 'wes@example.com', password: 'password123', workspace: 'Wes Web' });
  await c('PUT', '/api/account/texting', { sms_number: '+15550100003' });
  const yes = (await c('POST', '/api/contacts', { email: 'yes@example.com', first_name: 'Yan', phone: '5550101111' })).body;
  const no = (await c('POST', '/api/contacts', { email: 'no@example.com', first_name: 'Nia', phone: '5550102222' })).body;
  await app.getDb().run('UPDATE contacts SET sms_consent_at = now() WHERE id = ?', yes.id);
  const wf = (await c('POST', '/api/workflows', { name: 'Text hello' })).body;
  const g = (await c('GET', `/api/workflows/${wf.id}`)).body.graph;
  const key = 'smsnode';
  g.nodes[key] = { type: 'sms', config: { body: 'Hi {{first_name}}, thanks!' }, next: null };
  g.nodes[g.root].next = key;
  assert.equal((await c('PUT', `/api/workflows/${wf.id}`, { graph: g })).status, 200);
  await c('PUT', `/api/workflows/${wf.id}/status`, { status: 'active' });
  for (const p of [yes, no]) await c('POST', `/api/workflows/${wf.id}/enroll`, { person_ids: [p.id] });
  await c('POST', '/api/jobs/run', { now: '2026-06-01T16:00:00Z' }); // noon in New York
  const sent = await app.getDb().all("SELECT contact_id, body FROM messages WHERE channel = 'sms' AND direction = 'out' AND account_id = (SELECT account_id FROM contacts WHERE id = ?)", yes.id);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].contact_id, yes.id);
  assert.match(sent[0].body, /Hi Yan, thanks!\n\nReply STOP to opt out\./);

  // Email from the inbox carries a reply address; their reply comes back to the thread.
  assert.equal((await c('POST', `/api/inbox/${no.id}/reply`, { channel: 'email', body: 'Quick question for you' })).status, 200);
  const addr = await app.getDb().get('SELECT 1 FROM email_log WHERE contact_id = ?', no.id);
  assert.ok(addr);
  const token = `${no.id}-${crypto.createHmac('sha256', await secretOf()).update(`reply:${no.id}`).digest('hex').slice(0, 10)}`;
  const evt = JSON.stringify({ type: 'email.received', data: { email_id: 'em_1', from: 'Nia <no@example.com>', to: [`reply+${token}@in.example.com`], subject: 'Re: A note', text: 'Yes please!\n\nOn Tue Wes wrote:\n> Quick question' } });
  const id = 'msg_1', ts = String(Math.floor(Date.now() / 1000));
  const sig = crypto.createHmac('sha256', Buffer.from('k'.repeat(24))).update(`${id}.${ts}.${evt}`).digest('base64');
  const hook = await fetch(base + '/hooks/email', { method: 'POST', headers: { 'content-type': 'application/json', 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': `v1,${sig}` }, body: evt });
  assert.equal(hook.status, 200);
  const thread = (await c('GET', `/api/inbox/${no.id}`)).body.messages;
  assert.equal(thread.at(-1).direction, 'in');
  assert.equal(thread.at(-1).body, 'Yes please!');
});
const secretOf = async () => (await app.getDb().get("SELECT value FROM meta WHERE key = 'secret'"))?.value;
