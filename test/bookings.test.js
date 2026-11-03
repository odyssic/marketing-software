process.env.ALLOW_SIGNUPS = '1';
process.env.ALLOW_TIME_TRAVEL = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { slotsFor, zonedToUtc, ics } = require('../src/bookings');

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
    const res = await fetch(base + path, { method, redirect: 'manual', headers: { cookie, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, body: type.includes('json') ? await res.json() : await res.text() };
  };
}

test('open times follow the owner’s hours and time zone, including daylight saving', () => {
  // 9:00 in New York is 13:00 UTC in summer and 14:00 UTC in winter.
  assert.equal(zonedToUtc(2026, 7, 1, 9, 0, 'America/New_York').toISOString(), '2026-07-01T13:00:00.000Z');
  assert.equal(zonedToUtc(2026, 12, 1, 9, 0, 'America/New_York').toISOString(), '2026-12-01T14:00:00.000Z');
  const s = { tz: 'America/New_York', days: [1, 2, 3, 4, 5], start: '09:00', end: '11:00', length: 30, buffer: 0, notice_hours: 0, horizon_days: 7 };
  const now = new Date('2026-12-07T00:00:00Z'); // Sunday evening in New York
  const slots = slotsFor(s, [], now);
  assert.equal(slots[0].start, '2026-12-07T14:00:00.000Z'); // Monday 9:00 New York
  assert.equal(slots.filter((x) => x.start.startsWith('2026-12-07')).length, 4); // 9:00, 9:30, 10:00, 10:30
  assert.ok(!slots.some((x) => new Date(x.start).getUTCDay() === 6)); // no Saturday
  // A booking at 9:30 with a 15-minute gap removes 9:00, 9:30 and 10:00.
  const busy = [{ starts_at: '2026-12-07T14:30:00Z', ends_at: '2026-12-07T15:00:00Z' }];
  const monday = slotsFor({ ...s, length: 30, buffer: 15 }, busy, now).filter((x) => x.start.startsWith('2026-12-07')).map((x) => x.start.slice(11, 16));
  assert.ok(!monday.includes('14:30') && !monday.includes('14:45'));
  // A daily lunch break and a one-off busy time remove those slots.
  const lunch = slotsFor({ ...s, end: '14:00', breaks: [{ start: '12:00', end: '13:00' }], busy: [{ start: '2026-12-07T14:00:00Z', end: '2026-12-07T15:00:00Z' }] }, [], now)
    .filter((x) => x.start.startsWith('2026-12-07')).map((x) => x.start.slice(11, 16));
  assert.deepEqual(lunch, ['15:00', '15:30', '16:00', '16:30', '18:00', '18:30']); // 9–10 busy, 12–13 lunch (New York)
  assert.match(ics({ uid: 'b1', start: slots[0].start, end: slots[0].end, title: 'Call, with; care', description: 'line\nnext' }), /SUMMARY:Call\\, with\\; care[\s\S]*DESCRIPTION:line\\nnext/);
});

test('booking: hours, open times, book, no double-booking, emails, workflow, reminder, cancel', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Bea Owner', email: 'bea@example.com', password: 'password123', workspace: 'Bea Coaching', business_type: 'coach' });
  const f = (await c('POST', '/api/funnels', { name: 'Intro call', template: 'booking' })).body;
  const funnel = (await c('GET', `/api/funnels/${f.id}`)).body;
  // No hours yet → no open times.
  assert.deepEqual((await c('GET', `/f/${funnel.slug}/slots`)).body.slots, []);
  assert.equal((await c('PUT', '/api/bookings/settings', { tz: 'UTC', days: [], start: '09:00', end: '17:00' })).status, 400);
  assert.equal((await c('PUT', '/api/bookings/settings', { tz: 'UTC', days: [0, 1, 2, 3, 4, 5, 6], start: '17:00', end: '09:00' })).status, 400);
  await c('PUT', '/api/bookings/settings', { tz: 'UTC', days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:30', length: 30, buffer: 0, notice_hours: 0, horizon_days: 3, title: 'Intro call', location: 'Zoom' });
  // A "Books a call" workflow.
  const wf = (await c('POST', '/api/workflows', { template: 'blank', name: 'After booking' })).body;
  const g = (await c('GET', `/api/workflows/${wf.id}`)).body.graph;
  g.nodes[g.root] = { type: 'trigger', config: { event: 'booking' }, next: 't' };
  g.nodes.t = { type: 'tag', config: { add: 'call-booked', remove: '' } };
  await c('PUT', `/api/workflows/${wf.id}`, { graph: g });
  assert.equal((await c('PUT', `/api/workflows/${wf.id}/status`, { status: 'active' })).status, 200);

  const { slots, title, length } = (await c('GET', `/f/${funnel.slug}/slots`)).body;
  assert.deepEqual([title, length], ['Intro call', 30]);
  const slot = slots.find((x) => new Date(x.start) > new Date(Date.now() + 26 * 3600e3)); // more than a day out
  const book = (body) => c('POST', `/f/${funnel.slug}/book/book`, body);
  assert.equal((await book({ start: slot.start, name: '', email: 'x' })).status, 400);
  assert.equal((await book({ start: 'not-a-date', name: 'Al', email: 'al@example.com' })).status, 409);
  const ok = await book({ start: slot.start, name: 'Al Visitor', email: 'al@example.com', phone: '555-0101', note: 'About the spring course' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.start, slot.start);
  assert.ok(ok.body.next); // goes on to the "Booked" page
  // The same time can't be booked twice.
  assert.equal((await book({ start: slot.start, name: 'Bo', email: 'bo@example.com' })).status, 409);
  assert.ok(!(await c('GET', `/f/${funnel.slug}/slots`)).body.slots.some((x) => x.start === slot.start));

  const mail = (await c('GET', '/api/outbox')).body;
  const conf = mail.find((m) => m.to_email === 'al@example.com');
  assert.match(conf.subject, /^Booked: Intro call, /);
  assert.match(conf.body, /\/b\/[\w-]+/); // manage link
  assert.ok(mail.some((m) => m.to_email === 'bea@example.com' && m.subject.startsWith('New booking: Al Visitor')));
  // The person is a lead with the booking on their timeline; the workflow tagged them.
  await c('POST', '/api/jobs/run');
  const al = (await c('GET', '/api/contacts?q=al@example.com')).body[0];
  assert.equal(al.stage, 'lead');
  assert.ok(al.tags.includes('booked') && al.tags.includes('call-booked'));
  const list = (await c('GET', '/api/bookings')).body.bookings;
  assert.deepEqual(list.map((b) => [b.name, b.status, b.note]), [['Al Visitor', 'confirmed', 'About the spring course']]);

  // Reminder the day before, once.
  const dayBefore = new Date(new Date(slot.start).getTime() - 20 * 3600e3).toISOString();
  assert.equal((await c('POST', '/api/jobs/run', { now: dayBefore })).body.reminders, 1);
  assert.equal((await c('POST', '/api/jobs/run', { now: dayBefore })).body.reminders, 0);
  assert.ok((await c('GET', '/api/outbox')).body.some((m) => m.to_email === 'al@example.com' && m.subject.startsWith('Reminder: Intro call')));

  // The visitor moves their booking to another open time from the link in their email.
  const token = conf.body.match(/\/b\/([\w-]+)/)[1];
  assert.match((await c('GET', `/b/${token}`)).body, /Change the time/);
  const later = (await c('GET', `/f/${funnel.slug}/slots`)).body.slots.find((x) => x.start > slot.start);
  const mv = await fetch(`${base}/b/${token}/move`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `start=${encodeURIComponent(later.start)}` });
  assert.equal(mv.status, 303);
  assert.equal((await c('GET', '/api/bookings')).body.bookings[0].starts_at.replace('.000', ''), later.start.replace('.000', ''));
  assert.ok((await c('GET', '/api/outbox')).body.some((m) => m.to_email === 'bea@example.com' && m.subject.startsWith('Moved: Al Visitor')));
  assert.ok((await c('GET', `/f/${funnel.slug}/slots`)).body.slots.some((x) => x.start === slot.start)); // old time free again
  await fetch(`${base}/b/${token}/details`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'name=Al%20V&phone=555-0199&note=Bring%20the%20ribbon' });
  assert.equal((await c('GET', '/api/bookings')).body.bookings[0].note, 'Bring the ribbon');
  // The visitor cancels from the same link; the time opens up again.
  assert.match((await c('GET', `/b/${token}`)).body, /Cancel this booking/);
  assert.match((await fetch(`${base}/b/${token}/cancel`, { method: 'POST' }).then((r) => r.text())), /Cancelled/);
  assert.ok((await c('GET', `/f/${funnel.slug}/slots`)).body.slots.some((x) => x.start === later.start));
  assert.ok((await c('GET', '/api/outbox')).body.some((m) => m.to_email === 'bea@example.com' && m.subject.startsWith('Cancelled: Al')));
  assert.equal((await c('GET', '/api/bookings')).body.bookings.length, 0);

  // Another business can't see or cancel these.
  const other = client();
  await other('POST', '/api/auth/signup', { name: 'O', email: 'other-book@example.com', password: 'password123', workspace: 'Other' });
  assert.equal((await other('GET', '/api/bookings')).body.bookings.length, 0);
  assert.equal((await other('POST', `/api/bookings/${list.length ? 1 : 1}/cancel`)).status, 404);
});

test('review requests: after an appointment ends, once per 90 days, only with a review link', async () => {
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Rhea', email: 'rhea@example.com', password: 'password123', workspace: 'Rhea Studio', business_type: 'local' });
  const f = (await c('POST', '/api/funnels', { name: 'Book', template: 'booking' })).body;
  const funnel = (await c('GET', `/api/funnels/${f.id}`)).body;
  await c('PUT', '/api/bookings/settings', { tz: 'UTC', days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:30', length: 30, notice_hours: 0, horizon_days: 3 });
  const slot = (await c('GET', `/f/${funnel.slug}/slots`)).body.slots[4];
  await c('POST', `/f/${funnel.slug}/book/book`, { start: slot.start, name: 'Vi Visitor', email: 'vi@example.com' });
  const after = (h) => new Date(new Date(slot.end).getTime() + h * 3600e3).toISOString();
  // No review link yet → nothing.
  assert.equal((await c('POST', '/api/jobs/run', { now: after(3) })).body.reviews_asked, 0);
  assert.equal((await c('PUT', '/api/account/reviews', { review_url: 'not a link' })).status, 400);
  await c('PUT', '/api/account/reviews', { review_url: 'https://g.page/r/abc/review' });
  assert.equal((await c('POST', '/api/jobs/run', { now: after(1) })).body.reviews_asked, 0); // not straight away
  assert.equal((await c('POST', '/api/jobs/run', { now: after(3) })).body.reviews_asked, 1);
  assert.equal((await c('POST', '/api/jobs/run', { now: after(4) })).body.reviews_asked, 0); // once
  const m = (await c('GET', '/api/outbox')).body.find((x) => x.subject === 'Would you leave a quick review?');
  assert.equal(m.to_email, 'vi@example.com');
  assert.match(m.body, /Thank you for your time today[\s\S]*https:\/\/g\.page\/r\/abc\/review/);
});
