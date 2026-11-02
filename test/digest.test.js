process.env.ALLOW_SIGNUPS = '1';
process.env.ALLOW_TIME_TRAVEL = '1';
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
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
}
async function setup(email) {
  const c = client();
  assert.equal((await c('POST', '/api/auth/signup', { name: 'Di Gest', email, password: 'password123', workspace: 'Digest Co' })).status, 201);
  return c;
}

test('weekly digest: lever health, the move, old inquiries; sent once on the chosen day', async () => {
  const c = await setup('digest@example.com');
  const p = (await c('POST', '/api/contacts', { email: 'waiting@example.com', first_name: 'Wanda' })).body;
  await c('POST', `/api/people/${p.id}/events`, { type: 'inquiry', occurred_at: new Date(Date.now() - 21 * 864e5).toISOString() });
  const prev = (await c('GET', '/api/digest/preview')).body;
  assert.match(prev.subject, /^Your week: focus on .*, 1 inquiry waiting$/);
  for (const s of ['LEVER HEALTH', 'Lead gen', 'Conversion', 'Upsell', 'Continuity', 'THIS WEEK’S MOVE', 'INQUIRIES WAITING MORE THAN 14 DAYS (1)', 'Wanda: 21 days', '/#/people/']) {
    assert.ok(prev.text.includes(s), s);
  }
  assert.equal(prev.day, 'Monday');
  assert.equal((await c('PUT', '/api/account/digest', { day: 9 })).status, 400);

  // A week from now: same weekday, and the workspace is no longer brand new.
  const later = new Date(Date.now() + 7 * 864e5).toISOString();
  const today = new Date(later).getUTCDay();
  await c('POST', '/api/jobs/run'); // a brand-new workspace gets no digest yet
  await c('PUT', '/api/account/digest', { day: (today + 1) % 7 });
  await c('POST', '/api/jobs/run', { now: later });
  const mine = async () => (await c('GET', '/api/outbox')).body.filter((m) => m.subject.startsWith('Your week'));
  assert.equal((await mine()).length, 0); // not today
  await c('PUT', '/api/account/digest', { day: today });
  await c('POST', '/api/jobs/run', { now: later });
  await c('POST', '/api/jobs/run', { now: later }); // only once a day
  const sent = await mine();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to_email, 'digest@example.com');
  // "Send me one now" works any day.
  assert.equal((await c('POST', '/api/digest/send')).body.to, 'digest@example.com');
});

test('repurpose: needs enough text; without an AI key returns labelled templates for all five channels', async () => {
  const c = await setup('repurpose@example.com');
  assert.equal((await c('POST', '/api/repurpose', { text: 'too short' })).status, 400);
  const text = 'Glaze is weather. Every firing is a forecast you can only half trust. ' .repeat(5);
  const r = (await c('POST', '/api/repurpose', { text, kind: 'episode' })).body;
  assert.equal(r.template, true);
  assert.ok(r.email.subject && r.email.body.includes('Glaze is weather.'));
  assert.ok(r.product_listing.title && r.product_listing.description);
  assert.equal(r.social_posts.length, 2);
  assert.ok(r.show_notes.includes('•'));
});
