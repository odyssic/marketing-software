process.env.ALLOW_SIGNUPS = '1';
process.env.ALLOW_TIME_TRAVEL = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../src/app');
const { parseIcs, buildFeed, safeUrl } = require('../src/calsync');
const { zonedToUtc } = require('../src/bookings');

// The owner's own calendar, served locally (CALSYNC_ALLOW_LOCAL lets tests use http://localhost).
let icsBody = '', icsHits = 0;
const calServer = http.createServer((req, res) => {
  icsHits++;
  if (req.url === '/moved.ics') { res.writeHead(302, { location: 'http://10.0.0.7/private.ics' }); return res.end(); }
  if (req.url === '/notcal') { res.setHeader('content-type', 'text/html'); return res.end('<html>hi</html>'); }
  res.setHeader('content-type', 'text/calendar');
  res.end(icsBody);
});

let app, server, base, calBase;
before(async () => {
  app = createApp(process.env.TEST_DATABASE_URL ? {} : { dbPath: ':memory:' });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
  await new Promise((r) => calServer.listen(0, r));
  calBase = `http://localhost:${calServer.address().port}`;
});
after(async () => { server.close(); calServer.close(); await app.close(); delete process.env.CALSYNC_ALLOW_LOCAL; });
function client() {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(base + path, { method, redirect: 'manual', headers: { cookie, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, type, body: type.includes('json') ? await res.json() : await res.text() };
  };
}
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
const day = (n) => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return new Date(d.getTime() + n * 864e5); };

test('iCal reader: timed, all-day, TZID, Windows zones, weekly and daily repeats, exceptions', () => {
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-TIMEZONE:America/New_York',
    'BEGIN:VTIMEZONE', 'TZID:Custom Zone', 'X-LIC-LOCATION:Europe/Paris', 'END:VTIMEZONE',
    // Plain timed event in UTC, with a folded summary line.
    'BEGIN:VEVENT', 'UID:a', 'DTSTART:20261110T150000Z', 'DTEND:20261110T160000Z', 'SUMMARY:Dentist\\, then', '  lunch', 'END:VEVENT',
    // TZID: 9:00 New York in winter is 14:00 UTC.
    'BEGIN:VEVENT', 'UID:b', 'DTSTART;TZID=America/New_York:20261111T090000', 'DTEND;TZID=America/New_York:20261111T093000', 'SUMMARY:Call', 'END:VEVENT',
    // All-day (two days), placed in the calendar's zone.
    'BEGIN:VEVENT', 'UID:c', 'DTSTART;VALUE=DATE:20261112', 'DTEND;VALUE=DATE:20261114', 'SUMMARY:Trip', 'END:VEVENT',
    // Weekly on Mondays and Wednesdays 8:00 New York, 4 times, minus one date; keeps 8:00 across the time change.
    'BEGIN:VEVENT', 'UID:w', 'DTSTART;TZID=America/New_York:20261026T080000', 'DURATION:PT1H', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4', 'EXDATE;TZID=America/New_York:20261028T080000', 'SUMMARY:Gym', 'END:VEVENT',
    // Daily until a date, with one instance moved.
    'BEGIN:VEVENT', 'UID:d', 'DTSTART:20261116T120000Z', 'DTEND:20261116T123000Z', 'RRULE:FREQ=DAILY;UNTIL=20261118T235959Z', 'SUMMARY:Standup', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:d', 'RECURRENCE-ID:20261117T120000Z', 'DTSTART:20261117T170000Z', 'DTEND:20261117T173000Z', 'SUMMARY:Standup (moved)', 'END:VEVENT',
    // Outlook's Windows zone name and a VTIMEZONE alias.
    'BEGIN:VEVENT', 'UID:o', 'DTSTART;TZID="Pacific Standard Time":20261120T100000', 'DTEND;TZID="Pacific Standard Time":20261120T110000', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:p', 'DTSTART;TZID=Custom Zone:20261121T100000', 'DTEND;TZID=Custom Zone:20261121T110000', 'END:VEVENT',
    // Free time and cancelled events don't block anything; neither do alarms.
    'BEGIN:VEVENT', 'UID:f', 'DTSTART:20261110T080000Z', 'DTEND:20261110T090000Z', 'TRANSP:TRANSPARENT', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:x', 'DTSTART:20261110T100000Z', 'DTEND:20261110T110000Z', 'STATUS:CANCELLED', 'BEGIN:VALARM', 'TRIGGER:-PT15M', 'END:VALARM', 'END:VEVENT',
    'END:VCALENDAR'].join('\r\n');
  const got = parseIcs(ics, { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-12-31T00:00:00Z'), tz: 'UTC' });
  const list = got.map((e) => [e.start.toISOString().slice(0, 16), e.end.toISOString().slice(0, 16), e.allDay, e.label]);
  const has = (row) => assert.ok(list.some((x) => JSON.stringify(x) === JSON.stringify(row)), `missing ${JSON.stringify(row)} in ${JSON.stringify(list, null, 1)}`);
  has(['2026-11-10T15:00', '2026-11-10T16:00', false, 'Dentist, then lunch']);
  has(['2026-11-11T14:00', '2026-11-11T14:30', false, 'Call']);
  has(['2026-11-12T05:00', '2026-11-14T05:00', true, 'Trip']); // midnight New York (X-WR-TIMEZONE)
  // Gym: Oct 26 (summer time, 12:00 UTC), Oct 28 excluded, Nov 2 and Nov 4 (winter, 13:00 UTC). COUNT includes the excluded one.
  assert.deepEqual(list.filter((x) => x[3] === 'Gym').map((x) => x[0]), ['2026-10-26T12:00', '2026-11-02T13:00', '2026-11-04T13:00']);
  assert.deepEqual(list.filter((x) => x[3].startsWith('Standup')).map((x) => x[0]), ['2026-11-16T12:00', '2026-11-17T17:00', '2026-11-18T12:00']);
  has(['2026-11-20T18:00', '2026-11-20T19:00', false, '']); // 10:00 Pacific
  has(['2026-11-21T09:00', '2026-11-21T10:00', false, '']); // 10:00 Paris
  assert.ok(!list.some((x) => x[0] === '2026-11-10T08:00' || x[0] === '2026-11-10T10:00'));
  // Only what overlaps the window.
  assert.equal(parseIcs(ics, { from: new Date('2026-11-16T00:00:00Z'), to: new Date('2026-11-17T00:00:00Z'), tz: 'UTC' }).length, 1);
  // A never-ending weekly repeat from years ago still finds this week's.
  const old = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:z\r\nDTSTART;TZID=Europe/London:20180102T090000\r\nDTEND;TZID=Europe/London:20180102T100000\r\nRRULE:FREQ=WEEKLY\r\nEND:VEVENT\r\nEND:VCALENDAR';
  assert.deepEqual(parseIcs(old, { from: new Date('2026-11-09T00:00:00Z'), to: new Date('2026-11-16T00:00:00Z') }).map((e) => e.start.toISOString()), ['2026-11-10T09:00:00.000Z']);
  // The feed writer folds long lines and escapes text.
  const feed = buildFeed({ name: 'Studio bookings', events: [{ uid: 'u1', start: '2026-11-10T15:00:00Z', end: '2026-11-10T15:30:00Z', title: 'Call: Ann; Bo', description: 'x'.repeat(200) }] });
  assert.ok(feed.split('\r\n').every((l) => Buffer.byteLength(l) <= 75));
  assert.match(feed, /SUMMARY:Call: Ann\\; Bo/);
  assert.equal(parseIcs(feed, { from: new Date('2026-11-01'), to: new Date('2026-12-01') })[0].start.toISOString(), '2026-11-10T15:00:00.000Z');
});

test('calendar addresses must be public https: no local or private addresses', async () => {
  delete process.env.CALSYNC_ALLOW_LOCAL;
  for (const bad of ['http://example.com/cal.ics', 'https://127.0.0.1/cal.ics', 'https://localhost/cal.ics', 'https://10.0.0.5/cal.ics', 'https://[::1]/cal.ics',
    'https://169.254.169.254/latest/meta-data', 'https://router.local/cal.ics', 'file:///etc/passwd', 'https://user:pw@calendar.example.com/x.ics']) {
    await assert.rejects(safeUrl(bad), `${bad} should be refused`);
  }
  assert.equal(await safeUrl('webcal://8.8.8.8/basic.ics'), 'https://8.8.8.8/basic.ics');
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Sam', email: 'ssrf@example.com', password: 'password123', workspace: 'Sam Co' });
  const r = await c('PUT', '/api/calsync/import', { url: 'https://127.0.0.1:8080/cal.ics' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /isn’t allowed/);
  // With local addresses allowed (tests), a redirect to a private address is still refused.
  process.env.CALSYNC_ALLOW_LOCAL = '1';
  assert.equal((await c('PUT', '/api/calsync/import', { url: `${calBase}/moved.ics` })).status, 400);
  assert.match((await c('PUT', '/api/calsync/import', { url: `${calBase}/notcal` })).body.error, /iCal/);
  assert.equal((await c('GET', '/api/calsync')).body.import_url, '');
});

test('two-way sync: private feed with a token, busy times hide open slots, isolation', async () => {
  process.env.CALSYNC_ALLOW_LOCAL = '1';
  const c = client();
  await c('POST', '/api/auth/signup', { name: 'Cal Owner', email: 'cal@example.com', password: 'password123', workspace: 'Cal Studio' });
  const f = (await c('POST', '/api/funnels', { name: 'Book me', template: 'booking' })).body;
  const funnel = (await c('GET', `/api/funnels/${f.id}`)).body;
  await c('POST', `/api/funnels/${f.id}/publish`);
  await c('PUT', '/api/bookings/settings', { tz: 'UTC', days: [0, 1, 2, 3, 4, 5, 6], start: '08:00', end: '18:00', length: 30, notice_hours: 0, horizon_days: 4, title: 'Strategy call', location: 'Zoom' });

  // Outbound: a booking shows in the private feed.
  const visitor = client();
  const slots0 = (await visitor('GET', `/f/${funnel.slug}/slots`)).body.slots;
  const pick = slots0.find((x) => x.start.startsWith(day(3).toISOString().slice(0, 10)) && x.start.slice(11, 16) === '16:00');
  assert.equal((await visitor('POST', `/f/${funnel.slug}/book/book`, { start: pick.start, name: 'Ann Visitor', email: 'ann@example.com', note: 'Pricing, plans' })).status, 200);
  const sync = (await c('GET', '/api/calsync')).body;
  assert.match(sync.feed_url, /\/cal\/\d+-[a-f0-9]{32}\.ics$/);
  const feedPath = new URL(sync.feed_url).pathname;
  const feed = await visitor('GET', feedPath);
  assert.equal(feed.status, 200);
  assert.match(feed.type, /text\/calendar/);
  assert.match(feed.body, /X-WR-CALNAME:Cal Studio bookings/);
  assert.match(feed.body, /SUMMARY:Strategy call: Ann Visitor/);
  assert.match(feed.body, new RegExp(`DTSTART:${pick.start.replace(/[-:]/g, '').replace('.000', '')}`));
  assert.match(feed.body.replace(/\r\n /g, ''), /Note: Pricing\\, plans/);
  // A wrong or tampered token gets nothing.
  assert.equal((await visitor('GET', feedPath.replace(/[a-f0-9](?=\.ics$)/, (ch) => (ch === 'a' ? 'b' : 'a')))).status, 404);
  assert.equal((await visitor('GET', feedPath.replace(/\/cal\/\d+/, '/cal/999999'))).status, 404);
  // A new link stops the old one; undo brings it back.
  const fresh = (await c('POST', '/api/calsync/new-link')).body;
  assert.notEqual(fresh.feed_url, sync.feed_url);
  assert.equal((await visitor('GET', feedPath)).status, 404);
  assert.equal((await visitor('GET', new URL(fresh.feed_url).pathname)).status, 200);
  await c('POST', '/api/calsync/new-link', { restore: fresh.undo });
  assert.equal((await visitor('GET', feedPath)).status, 200);

  // Inbound: their own calendar's busy times.
  const d1 = day(1), d2 = day(2), weekAgo = day(-6);
  const ny = zonedToUtc(d1.getUTCFullYear(), d1.getUTCMonth() + 1, d1.getUTCDate(), 9, 0, 'America/New_York'); // 9:00 New York
  icsBody = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
    'BEGIN:VEVENT', 'UID:t1', `DTSTART:${ymd(d1)}T100000Z`, `DTEND:${ymd(d1)}T110000Z`, 'SUMMARY:Dentist', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:t2', `DTSTART;TZID=America/New_York:${ymd(d1)}T090000`, `DTEND;TZID=America/New_York:${ymd(d1)}T093000`, 'SUMMARY:School run', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:t3', `DTSTART;VALUE=DATE:${ymd(d2)}`, `DTEND;VALUE=DATE:${ymd(new Date(d2.getTime() + 864e5))}`, 'SUMMARY:Day off', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:t4', `DTSTART:${ymd(new Date(d1.getTime() - 7 * 864e5))}T150000Z`, `DTEND:${ymd(new Date(d1.getTime() - 7 * 864e5))}T153000Z`, 'RRULE:FREQ=WEEKLY', 'SUMMARY:Weekly team call', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:t5', `DTSTART:${ymd(weekAgo)}T170000Z`, `DTEND:${ymd(weekAgo)}T173000Z`, 'RRULE:FREQ=DAILY', 'SUMMARY:Walk', 'END:VEVENT',
    'END:VCALENDAR'].join('\r\n');
  const before = (await visitor('GET', `/f/${funnel.slug}/slots`)).body.slots.map((x) => x.start);
  const at = (d, hm) => `${d.toISOString().slice(0, 10)}T${hm}:00.000Z`;
  for (const t of [at(d1, '10:00'), at(d1, '10:30'), ny.toISOString(), at(d1, '15:00'), at(d2, '09:00'), at(d1, '17:00')]) assert.ok(before.includes(t), `${t} open before`);
  const imp = await c('PUT', '/api/calsync/import', { url: `${calBase}/basic.ics` });
  assert.equal(imp.status, 200, JSON.stringify(imp.body));
  assert.ok(imp.body.busy_count >= 6);
  assert.equal(imp.body.error, '');
  const open = (await visitor('GET', `/f/${funnel.slug}/slots`)).body.slots.map((x) => x.start);
  for (const t of [at(d1, '10:00'), at(d1, '10:30'), ny.toISOString(), at(d1, '15:00'), at(d1, '17:00')]) assert.ok(!open.includes(t), `${t} should be hidden`);
  assert.ok(!open.some((t) => t.startsWith(d2.toISOString().slice(0, 10))), 'the all-day event hides the whole day');
  assert.ok(open.includes(at(d1, '11:00')) && open.includes(at(d1, '12:00')));
  // Booking a busy time is refused too.
  assert.equal((await visitor('POST', `/f/${funnel.slug}/book/book`, { start: at(d1, '10:00'), name: 'Bo', email: 'bo@example.com' })).status, 409);
  // The owner sees the busy blocks (with their own labels) to explain the gaps.
  const mine = (await c('GET', '/api/calsync')).body;
  assert.ok(mine.busy.some((b) => b.label === 'Dentist' && !b.all_day));
  assert.ok(mine.busy.some((b) => b.label === 'Day off' && b.all_day));

  // Another business: its own feed, none of these busy times, can't read this one's settings.
  const other = client();
  await other('POST', '/api/auth/signup', { name: 'Olive', email: 'olive-cal@example.com', password: 'password123', workspace: 'Olive Co' });
  const theirs = (await other('GET', '/api/calsync')).body;
  assert.equal(theirs.import_url, '');
  assert.deepEqual(theirs.busy, []);
  assert.notEqual(theirs.feed_url, mine.feed_url);
  assert.doesNotMatch((await visitor('GET', new URL(theirs.feed_url).pathname)).body, /Ann Visitor/);
  const of = (await other('POST', '/api/funnels', { name: 'Olive book', template: 'booking' })).body;
  const ofun = (await other('GET', `/api/funnels/${of.id}`)).body;
  await other('PUT', '/api/bookings/settings', { tz: 'UTC', days: [0, 1, 2, 3, 4, 5, 6], start: '08:00', end: '18:00', length: 30, notice_hours: 0, horizon_days: 4 });
  assert.ok((await other('GET', `/f/${ofun.slug}/slots`)).body.slots.some((x) => x.start === at(d1, '10:00')));

  // The job re-reads it every 15 minutes; a booking page re-reads it when stale.
  icsBody = icsBody.replace('SUMMARY:Dentist', 'SUMMARY:Dentist (moved)').replace(`${ymd(d1)}T100000Z`, `${ymd(d1)}T120000Z`).replace(`${ymd(d1)}T110000Z`, `${ymd(d1)}T130000Z`);
  const now = Date.now();
  assert.equal((await c('POST', '/api/jobs/run', { now: new Date(now + 5 * 60e3).toISOString() })).body.calendars_synced, 0); // still fresh
  assert.equal((await c('POST', '/api/jobs/run', { now: new Date(now + 16 * 60e3).toISOString() })).body.calendars_synced, 1);
  assert.ok((await c('GET', '/api/calsync')).body.busy.some((b) => b.label === 'Dentist (moved)'));
  await app.getDb().run("UPDATE calendar_sync SET fetched_at = now() - interval '20 minutes'");
  icsBody = icsBody.replace('SUMMARY:Dentist (moved)', 'SUMMARY:Dentist (gone)').replace(`${ymd(d1)}T120000Z`, `${ymd(d1)}T070000Z`).replace(`${ymd(d1)}T130000Z`, `${ymd(d1)}T073000Z`);
  const hits = icsHits;
  const reopened = (await visitor('GET', `/f/${funnel.slug}/slots`)).body.slots.map((x) => x.start);
  assert.ok(icsHits > hits, 'stale calendar re-read on page load');
  assert.ok(reopened.includes(at(d1, '12:00')) && reopened.includes(at(d1, '10:00')));
  // A broken address keeps the last busy times and says what's wrong.
  await app.getDb().run("UPDATE calendar_sync SET import_url = ?, fetched_at = now() - interval '20 minutes' WHERE account_id = (SELECT account_id FROM calendar_sync WHERE import_url <> '' LIMIT 1)", `${calBase}/notcal`);
  await visitor('GET', `/f/${funnel.slug}/slots`);
  const broken = (await c('GET', '/api/calsync')).body;
  assert.match(broken.error, /iCal/);
  assert.ok(broken.busy.length > 0);
  // Stop syncing: busy times go away.
  await c('PUT', '/api/calsync/import', { url: '' });
  assert.ok((await visitor('GET', `/f/${funnel.slug}/slots`)).body.slots.some((x) => x.start === at(d2, '09:00')));
});
