// Welcome emails for new Rilly users: day 0, 2 and 5, each pointing at the next step.
process.env.ALLOW_SIGNUPS = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { createOnboarding } = require('../src/onboarding');

let app, server, base;
before(async () => {
  app = createApp(process.env.TEST_DATABASE_URL ? {} : { dbPath: ':memory:' });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});
after(async () => { server.close(); await app.close(); });

test('three welcome emails, on schedule, once each', async () => {
  await fetch(`${base}/api/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Wen Li', email: 'wen@example.com', password: 'password123', business_type: 'coach' }) });
  const db = app.getDb();
  const step = async () => (await db.get("SELECT onboarding_step FROM users WHERE email = 'wen@example.com'")).onboarding_step;
  const now = Date.now();
  assert.equal((await app.runJobs(new Date(now + 60e3))).welcomeEmails, 1);
  assert.equal(await step(), 1);
  assert.equal((await app.runJobs(new Date(now + 3600e3))).welcomeEmails, 0, 'day 2 email waits');
  assert.equal(await step(), 1);
  await app.runJobs(new Date(now + 2 * 864e5 + 60e3));
  assert.equal(await step(), 2);
  await app.runJobs(new Date(now + 5 * 864e5 + 60e3));
  assert.equal(await step(), 3);
  assert.equal((await app.runJobs(new Date(now + 9 * 864e5))).welcomeEmails, 0, 'no more after the third');
});

test('each email points at what they have not done yet', () => {
  const { message } = createOnboarding({ getDb: () => null, publicBase: () => 'https://getrilly.com' });
  const u = { name: 'Wen Li', plan_status: 'trialing', created_at: new Date().toISOString() };
  assert.equal(message(0, u, { published: false }).subject, 'Welcome to Rilly');
  assert.equal(message(1, u, { published: false, people: 0 }).subject, 'Your first page is a few clicks away');
  assert.equal(message(1, u, { published: true, people: 0 }).subject, 'Bring your people into Rilly');
  assert.equal(message(1, u, { published: true, people: 40 }), null, 'skipped when already done');
  assert.equal(message(2, u, { followups: false }).subject, 'Let Rilly do the follow-up for you');
  assert.equal(message(2, u, { followups: true }).subject, 'Your week in Rilly');
});
