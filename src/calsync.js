// Calendar sync without any sign-in to Google or Microsoft:
// - Out: a private, signed calendar feed (/cal/<token>.ics) of upcoming
//   bookings that Google, Apple or Outlook can subscribe to.
// - In: the owner pastes their own calendar's private iCal address; we read it
//   every ~15 minutes (and when a booking page loads, if it's stale), keep the
//   busy times, and nobody can book over them.
// The iCal reader is small on purpose: timed and all-day events, TZID time
// zones, EXDATE, moved single instances (RECURRENCE-ID), and simple DAILY /
// WEEKLY (BYDAY) / MONTHLY / YEARLY repeats.
const crypto = require('node:crypto');
const { zonedToUtc } = require('./bookings');
const { checkWebhookUrl } = require('./integrations');

const STALE_MS = 15 * 60e3;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_EVENTS = 2000;

// Outlook writes Windows zone names; these are the common ones.
const WINDOWS_TZ = {
  'Eastern Standard Time': 'America/New_York', 'Central Standard Time': 'America/Chicago', 'Mountain Standard Time': 'America/Denver',
  'US Mountain Standard Time': 'America/Phoenix', 'Pacific Standard Time': 'America/Los_Angeles', 'Alaskan Standard Time': 'America/Anchorage',
  'Hawaiian Standard Time': 'Pacific/Honolulu', 'Atlantic Standard Time': 'America/Halifax', 'Newfoundland Standard Time': 'America/St_Johns',
  'Canada Central Standard Time': 'America/Regina', 'SA Pacific Standard Time': 'America/Bogota', 'E. South America Standard Time': 'America/Sao_Paulo',
  'GMT Standard Time': 'Europe/London', 'Greenwich Standard Time': 'Atlantic/Reykjavik', 'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris', 'Central Europe Standard Time': 'Europe/Budapest', 'Central European Standard Time': 'Europe/Warsaw',
  'E. Europe Standard Time': 'Europe/Chisinau', 'FLE Standard Time': 'Europe/Kiev', 'GTB Standard Time': 'Europe/Bucharest',
  'South Africa Standard Time': 'Africa/Johannesburg', 'Israel Standard Time': 'Asia/Jerusalem', 'Arabian Standard Time': 'Asia/Dubai',
  'India Standard Time': 'Asia/Kolkata', 'Singapore Standard Time': 'Asia/Singapore', 'China Standard Time': 'Asia/Shanghai',
  'Tokyo Standard Time': 'Asia/Tokyo', 'Korea Standard Time': 'Asia/Seoul', 'AUS Eastern Standard Time': 'Australia/Sydney',
  'E. Australia Standard Time': 'Australia/Brisbane', 'Cen. Australia Standard Time': 'Australia/Adelaide', 'W. Australia Standard Time': 'Australia/Perth',
  'New Zealand Standard Time': 'Pacific/Auckland', UTC: 'UTC', 'Coordinated Universal Time': 'UTC',
};
const validTz = (tz) => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };
function resolveTz(tzid, aliases, fallback) {
  const t = String(tzid || '').replace(/^"|"$/g, '').trim();
  if (!t) return fallback;
  if (aliases[t] && validTz(aliases[t])) return aliases[t];
  if (WINDOWS_TZ[t]) return WINDOWS_TZ[t];
  if (/^[A-Za-z_]+\/[A-Za-z_+-]+(\/[A-Za-z_+-]+)?$/.test(t) && validTz(t)) return t;
  const tail = t.match(/([A-Za-z_]+\/[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)?)$/); // e.g. /mozilla.org/20050126_1/America/New_York
  if (tail && validTz(tail[1])) return tail[1];
  return fallback;
}

// ---------- Reading an iCal file ----------
function parseLine(line) {
  let q = false, i = 0;
  for (; i < line.length; i++) { const ch = line[i]; if (ch === '"') q = !q; else if (ch === ':' && !q) break; }
  if (i >= line.length) return null;
  const head = line.slice(0, i), value = line.slice(i + 1);
  const parts = []; let cur = ''; q = false;
  for (const ch of head) { if (ch === '"') q = !q; if (ch === ';' && !q) { parts.push(cur); cur = ''; } else cur += ch; }
  parts.push(cur);
  const params = {};
  for (const p of parts.slice(1)) { const eq = p.indexOf('='); if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, ''); }
  return { name: parts[0].toUpperCase(), params, value };
}
const unescapeText = (s) => String(s || '').replace(/\\([nN,;\\])/g, (_, c) => (c === 'n' || c === 'N' ? ' ' : c)).trim();

// A DTSTART/DTEND/EXDATE value: { y, m, d, hh, mm, ss, date, tz }.
function parseWhen(value, params, aliases, calTz) {
  const v = String(value || '').trim();
  let m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return { y: +m[1], m: +m[2], d: +m[3], hh: 0, mm: 0, ss: 0, date: true, tz: calTz };
  m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3], hh: +m[4], mm: +m[5], ss: +(m[6] || 0), date: params.VALUE === 'DATE', tz: m[7] ? 'UTC' : resolveTz(params.TZID, aliases, calTz) };
}
const instant = (w) => zonedToUtc(w.y, w.m, w.d, w.hh, w.mm, w.tz).getTime() + w.ss * 1000;
const addDays = (w, n) => { const t = new Date(Date.UTC(w.y, w.m - 1, w.d + n)); return { ...w, y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; };
const weekday = (w) => new Date(Date.UTC(w.y, w.m - 1, w.d)).getUTCDay(); // 0 = Sunday
const dayNum = (w) => Math.round(Date.UTC(w.y, w.m - 1, w.d) / 864e5);
function durationMs(v) {
  const m = String(v || '').trim().match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  return (m[1] === '-' ? -1 : 1) * ((+m[2] || 0) * 7 * 864e5 + (+m[3] || 0) * 864e5 + (+m[4] || 0) * 3600e3 + (+m[5] || 0) * 60e3 + (+m[6] || 0) * 1e3);
}
const DAY_CODES = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
function parseRule(v) {
  const r = Object.fromEntries(String(v || '').split(';').map((p) => p.split('=')).filter((p) => p.length === 2).map(([k, x]) => [k.toUpperCase(), x]));
  return r.FREQ ? r : null;
}

// Every occurrence of the event's start (as a wall-clock date-time in its zone) up to `to`.
function* occurrences(start, rule, untilMs, toMs, fromDay = 0) {
  if (!rule) { yield start; return; }
  const freq = rule.FREQ.toUpperCase();
  const interval = Math.max(1, parseInt(rule.INTERVAL, 10) || 1);
  const count = parseInt(rule.COUNT, 10) || Infinity;
  const byday = (rule.BYDAY || '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
  const plainDays = byday.every((x) => DAY_CODES[x] !== undefined);
  let n = 0;
  const ok = (w) => { const t = instant(w); return !(untilMs !== null && t > untilMs) && t <= toMs; };
  if (freq === 'DAILY' && !byday.length) {
    // Without a COUNT, jump close to the window instead of walking from years ago.
    const k0 = count === Infinity ? Math.max(0, Math.floor((fromDay - dayNum(start)) / interval) - 2) : 0;
    for (let k = k0; k < k0 + 20000 && n < count; k++) { const w = addDays(start, k * interval); if (!ok(w)) return; n++; yield w; }
  } else if (freq === 'WEEKLY' && plainDays) {
    const days = (byday.length ? byday.map((x) => DAY_CODES[x]) : [weekday(start)]).map((d) => (d + 6) % 7).sort((a, b) => a - b); // Monday first
    const monday = addDays(start, -((weekday(start) + 6) % 7));
    const w0 = count === Infinity ? Math.max(0, Math.floor((fromDay - dayNum(monday)) / (7 * interval)) - 1) : 0;
    for (let wk = w0; wk < w0 + 5000 && n < count; wk++) {
      for (const off of days) {
        const w = addDays(monday, wk * 7 * interval + off);
        if (dayNum(w) < dayNum(start)) continue;
        if (!ok(w) || n >= count) return;
        n++; yield w;
      }
    }
  } else if ((freq === 'MONTHLY' || freq === 'YEARLY') && !byday.length && !rule.BYMONTHDAY && !rule.BYSETPOS) {
    for (let k = 0; k < 2000 && n < count; k++) {
      const months = freq === 'MONTHLY' ? k * interval : k * interval * 12;
      const t = new Date(Date.UTC(start.y, start.m - 1 + months, 1));
      const w = { ...start, y: t.getUTCFullYear(), m: t.getUTCMonth() + 1 };
      if (new Date(Date.UTC(w.y, w.m - 1, w.d)).getUTCMonth() !== w.m - 1) continue; // no 31st this month
      if (!ok(w)) return;
      n++; yield w;
    }
  } else {
    yield start; // a repeat we don't understand: at least the first one counts
  }
}

// Busy times from an iCal file within [from, to): [{ start, end, allDay, label }].
function parseIcs(text, { from = new Date(), to = new Date(Date.now() + 120 * 864e5), tz = 'UTC' } = {}) {
  const lines = String(text || '').replace(/^\uFEFF/, '').replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  let calTz = tz;
  const aliases = {}; // VTIMEZONE TZID → X-LIC-LOCATION
  const events = [];
  const stack = [];
  let ev = null, vtz = null;
  for (const raw of lines) {
    const p = parseLine(raw);
    if (!p) continue;
    if (p.name === 'BEGIN') {
      stack.push(p.value.toUpperCase());
      if (p.value.toUpperCase() === 'VEVENT' && stack.length === 2) ev = { props: {}, exdates: [] };
      if (p.value.toUpperCase() === 'VTIMEZONE') vtz = {};
      continue;
    }
    if (p.name === 'END') {
      const what = stack.pop();
      if (what === 'VEVENT' && ev && stack.length === 1) { events.push(ev); ev = null; }
      if (what === 'VTIMEZONE' && vtz) { if (vtz.id && vtz.loc) aliases[vtz.id] = vtz.loc; vtz = null; }
      continue;
    }
    const top = stack.at(-1);
    if (top === 'VCALENDAR' && p.name === 'X-WR-TIMEZONE' && validTz(p.value.trim())) calTz = p.value.trim();
    if (top === 'VTIMEZONE' && vtz) { if (p.name === 'TZID') vtz.id = p.value.trim(); if (p.name === 'X-LIC-LOCATION') vtz.loc = p.value.trim(); }
    if (top === 'VEVENT' && ev) {
      if (p.name === 'EXDATE') ev.exdates.push(p);
      else if (!ev.props[p.name]) ev.props[p.name] = p;
    }
  }

  const fromMs = from.getTime(), toMs = to.getTime();
  const out = [];
  const moved = new Set(); // "uid|instant" of single instances that were moved or cancelled
  for (const e of events) {
    const rid = e.props['RECURRENCE-ID'];
    const w = rid && parseWhen(rid.value, rid.params, aliases, calTz);
    if (w) moved.add(`${e.props.UID?.value || ''}|${instant(w)}`);
  }
  for (const e of events) {
    const P = e.props;
    if (!P.DTSTART) continue;
    if (String(P.STATUS?.value || '').toUpperCase() === 'CANCELLED') continue;
    if (String(P.TRANSP?.value || '').toUpperCase() === 'TRANSPARENT') continue; // marked "free"
    const start = parseWhen(P.DTSTART.value, P.DTSTART.params, aliases, calTz);
    if (!start) continue;
    const allDay = start.date;
    const end = P.DTEND && parseWhen(P.DTEND.value, P.DTEND.params, aliases, calTz);
    let days = 1, dur = 0;
    if (allDay) days = end ? Math.max(1, dayNum(end) - dayNum(start)) : Math.max(1, Math.round((durationMs(P.DURATION?.value) || 864e5) / 864e5));
    else dur = end ? instant(end) - instant(start) : durationMs(P.DURATION?.value) || 0;
    if (!allDay && dur <= 0) continue;
    const rule = P['RECURRENCE-ID'] ? null : parseRule(P.RRULE?.value);
    let untilMs = null;
    if (rule?.UNTIL) { const u = parseWhen(rule.UNTIL, {}, aliases, start.tz); if (u) untilMs = u.date ? instant({ ...addDays(u, 1), tz: start.tz }) - 1 : instant(u); }
    const ex = new Set(e.exdates.flatMap((x) => x.value.split(',').map((v) => parseWhen(v, x.params, aliases, calTz)).filter(Boolean).map((v) => instant(allDay ? { ...v, tz: start.tz } : v))));
    const uid = P.UID?.value || '';
    const label = unescapeText(P.SUMMARY?.value).slice(0, 80);
    for (const occ of occurrences(start, rule, untilMs, toMs, Math.floor(fromMs / 864e5) - 1)) {
      const s = instant(occ);
      if (ex.has(s) || (rule && moved.has(`${uid}|${s}`))) continue;
      const eMs = allDay ? instant(addDays(occ, days)) : s + dur;
      if (eMs <= fromMs || s >= toMs) continue;
      out.push({ start: new Date(s), end: new Date(eMs), allDay, label });
      if (out.length >= MAX_EVENTS) return out.sort((a, b) => a.start - b.start);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

// ---------- Writing the bookings feed ----------
const icsText = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/[,;]/g, (c) => `\\${c}`);
const icsTime = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
function fold(line) {
  const out = []; let cur = '', bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}
function buildFeed({ name, events }) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Rilly//Bookings feed//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(name)}`, 'REFRESH-INTERVAL;VALUE=DURATION:PT15M', 'X-PUBLISHED-TTL:PT15M'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${icsTime(e.stamp || new Date())}`, `DTSTART:${icsTime(e.start)}`, `DTEND:${icsTime(e.end)}`,
      `SUMMARY:${icsText(e.title)}`, ...(e.description ? [`DESCRIPTION:${icsText(e.description)}`] : []), ...(e.location ? [`LOCATION:${icsText(e.location)}`] : []),
      'STATUS:CONFIRMED', 'TRANSP:OPAQUE', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

// "Add to Google Calendar" link for one appointment.
function googleCalendarLink({ title, start, end, details = '', location = '' }) {
  const q = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${icsTime(start)}/${icsTime(end)}`, details, location });
  return `https://calendar.google.com/calendar/render?${q}`;
}

// ---------- Fetching the owner's calendar safely ----------
async function safeUrl(raw) {
  let s = String(raw || '').trim().replace(/^webcals?:\/\//i, 'https://');
  if (process.env.CALSYNC_ALLOW_LOCAL === '1' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(s)) return s; // tests only
  try { return await checkWebhookUrl(s); } catch (e) {
    const m = String(e.message || '');
    if (/public internet/.test(m)) throw new Error('That address isn’t allowed. Paste your calendar’s own https:// iCal address.');
    if (/https/.test(m)) throw new Error('Paste the calendar’s full address. It starts with https:// (or webcal://).');
    throw new Error(m.replace(/Webhooks?/g, 'Calendar addresses'));
  }
}
async function fetchIcs(raw) {
  let url = await safeUrl(raw);
  for (let hop = 0; hop < 4; hop++) {
    let res;
    try {
      res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { accept: 'text/calendar, */*;q=0.5', 'user-agent': 'Rilly calendar sync' } });
    } catch { throw new Error('We couldn’t reach that address. Check it and try again.'); }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = await safeUrl(new URL(res.headers.get('location'), url).href);
      continue;
    }
    if (res.status === 404 || res.status === 401 || res.status === 403) throw new Error('That calendar address doesn’t work any more. Copy a fresh one from your calendar.');
    if (!res.ok) throw new Error(`Your calendar didn’t answer (error ${res.status}). We’ll keep trying.`);
    const reader = res.body.getReader();
    const chunks = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) { reader.cancel().catch(() => {}); throw new Error('That calendar is too big to read (over 5 MB).'); }
      chunks.push(value);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    if (!/^\uFEFF?\s*BEGIN:VCALENDAR/i.test(text)) throw new Error('That address didn’t give us a calendar. Copy the iCal (.ics) address, not the normal web link.');
    return text;
  }
  throw new Error('That address redirects too many times.');
}

function createCalSync({ getDb, HttpError, publicBase, sign, settingsOf }) {
  const db = () => getDb();
  const iso = (d) => (d instanceof Date ? d.toISOString() : d);

  async function row(accountId) {
    await db().run('INSERT INTO calendar_sync (account_id, feed_key) VALUES (?, ?) ON CONFLICT (account_id) DO NOTHING', accountId, crypto.randomBytes(16).toString('hex'));
    return db().get('SELECT * FROM calendar_sync WHERE account_id = ?', accountId);
  }
  const tokenFor = (accountId, key) => `${accountId}-${sign(`calfeed:${accountId}:${key}`).slice(0, 32)}`;
  const feedUrl = (accountId, key) => `${publicBase()}/cal/${tokenFor(accountId, key)}.ics`;

  // Busy times from the owner's calendar, in the shape the open-times maths uses.
  const busyFor = (accountId) => db().all("SELECT starts_at, ends_at FROM calendar_busy WHERE account_id = ? AND ends_at > now() - interval '1 day'", accountId);

  async function refresh(accountId, now = new Date()) {
    const r = await db().get('SELECT s.import_url, a.booking FROM calendar_sync s JOIN accounts a ON a.id = s.account_id WHERE s.account_id = ?', accountId);
    if (!r?.import_url) return { ok: false };
    const s = settingsOf({ booking: r.booking });
    try {
      const text = await fetchIcs(r.import_url);
      const busy = parseIcs(text, { from: new Date(now.getTime() - 864e5), to: new Date(now.getTime() + (Math.max(60, s.horizon_days) + 2) * 864e5), tz: s.tz });
      await store(accountId, busy, now);
      return { ok: true, count: busy.length };
    } catch (e) {
      await db().run('UPDATE calendar_sync SET error = ?, fetched_at = ? WHERE account_id = ?', String(e.message).slice(0, 300), iso(now), accountId);
      return { ok: false, error: e.message };
    }
  }
  async function store(accountId, busy, now) {
    await db().tx(async (t) => {
      await t.run('DELETE FROM calendar_busy WHERE account_id = ?', accountId);
      for (let i = 0; i < busy.length; i += 200) {
        const part = busy.slice(i, i + 200);
        await t.run(`INSERT INTO calendar_busy (account_id, starts_at, ends_at, label, all_day) VALUES ${part.map(() => '(?, ?, ?, ?, ?)').join(', ')}`,
          ...part.flatMap((b) => [accountId, b.start.toISOString(), b.end.toISOString(), b.label, b.allDay ? 1 : 0]));
      }
      await t.run("UPDATE calendar_sync SET busy_count = ?, ok_at = ?, fetched_at = ?, error = '' WHERE account_id = ?", busy.length, iso(now), iso(now), accountId);
    });
  }
  // Claims a stale calendar so two requests don't fetch it at once.
  const claim = (accountId, now) => db().get(`UPDATE calendar_sync SET fetched_at = ? WHERE account_id = ? AND import_url <> ''
    AND (fetched_at IS NULL OR fetched_at < ?) RETURNING account_id`, iso(now), accountId, new Date(now.getTime() - STALE_MS).toISOString());

  // When a booking page loads: read the calendar again if it's older than 15 minutes (waits at most 4 seconds).
  async function refreshIfStale(accountId) {
    const now = new Date();
    if (!await claim(accountId, now)) return;
    await Promise.race([refresh(accountId, now), new Promise((r) => setTimeout(r, 4000))]).catch(() => {});
  }
  // The job runner: every calendar older than 15 minutes.
  async function syncDue(now = new Date()) {
    const due = await db().all("SELECT account_id FROM calendar_sync WHERE import_url <> '' AND (fetched_at IS NULL OR fetched_at < ?) ORDER BY fetched_at NULLS FIRST LIMIT 25",
      new Date(now.getTime() - STALE_MS).toISOString());
    let n = 0;
    for (const d of due) { if (await claim(d.account_id, now)) { await refresh(d.account_id, now); n++; } }
    return { calendars_synced: n };
  }

  function register(app, api) {
    // The private feed calendars subscribe to.
    app.get('/cal/:file', async (req, res) => {
      const m = String(req.params.file).match(/^(\d{1,9})-([a-f0-9]{32})\.ics$/);
      const r = m && await db().get('SELECT s.feed_key, a.name, a.booking FROM calendar_sync s JOIN accounts a ON a.id = s.account_id WHERE s.account_id = ?', Number(m[1]));
      const want = r && tokenFor(Number(m[1]), r.feed_key).split('-')[1];
      if (!r || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(m[2]))) return res.status(404).type('text').send('This calendar link has been replaced or doesn’t exist.');
      const s = settingsOf({ booking: r.booking });
      const rows = await db().all(`SELECT id, starts_at, ends_at, name, email, phone, note, pay_kind, price_cents, paid_cents, currency, created_at FROM bookings
        WHERE account_id = ? AND status = 'confirmed' AND ends_at > now() - interval '30 days' ORDER BY starts_at LIMIT 1000`, Number(m[1]));
      const money = (c, cur) => new Intl.NumberFormat('en-US', { style: 'currency', currency: String(cur || 'usd').toUpperCase() }).format(c / 100);
      const events = rows.map((b) => ({ uid: `booking-${b.id}@getrilly.com`, start: b.starts_at, end: b.ends_at, stamp: b.created_at,
        title: `${s.title}: ${b.name}`, location: s.location,
        description: [`${b.name} <${b.email}>`, b.phone, b.note ? `Note: ${b.note}` : '',
          b.pay_kind ? `Paid ${money(b.paid_cents, b.currency)}${b.price_cents > b.paid_cents ? `, ${money(b.price_cents - b.paid_cents, b.currency)} due at the appointment` : ''}` : '',
          `Open in Rilly: ${publicBase()}/#/calendar`].filter(Boolean).join('\n') }));
      res.set('Cache-Control', 'private, max-age=300').type('text/calendar; charset=utf-8').send(buildFeed({ name: `${r.name} bookings`, events }));
    });

    const out = async (accountId) => {
      const r = await row(accountId);
      const busy = await db().all(`SELECT id, starts_at, ends_at, label, all_day FROM calendar_busy WHERE account_id = ? AND ends_at > now()
        ORDER BY starts_at LIMIT 300`, accountId);
      return { feed_url: feedUrl(accountId, r.feed_key), import_url: r.import_url, fetched_at: r.fetched_at, ok_at: r.ok_at, error: r.error, busy_count: r.busy_count,
        busy: busy.map((b) => ({ ...b, all_day: Boolean(b.all_day) })) };
    };
    api.get('/calsync', async (req, res) => res.json(await out(req.accountId)));
    // A new private link (the old one stops working). Undo puts the old one back.
    api.post('/calsync/new-link', async (req, res) => {
      const r = await row(req.accountId);
      const restore = String(req.body?.restore || '');
      const key = /^[a-f0-9]{32}$/.test(restore) ? restore : crypto.randomBytes(16).toString('hex');
      await db().run('UPDATE calendar_sync SET feed_key = ? WHERE account_id = ?', key, req.accountId);
      res.json({ ...(await out(req.accountId)), undo: r.feed_key });
    });
    // Their own calendar's private iCal address. Empty stops syncing.
    api.put('/calsync/import', async (req, res) => {
      await row(req.accountId);
      const raw = String(req.body?.url || '').trim();
      if (!raw) {
        await db().run("UPDATE calendar_sync SET import_url = '', error = '', busy_count = 0, ok_at = NULL, fetched_at = NULL WHERE account_id = ?", req.accountId);
        await db().run('DELETE FROM calendar_busy WHERE account_id = ?', req.accountId);
        return res.json(await out(req.accountId));
      }
      let url, text;
      try { url = await safeUrl(raw); text = await fetchIcs(url); } catch (e) { throw new HttpError(400, e.message); }
      const account = await db().get('SELECT booking FROM accounts WHERE id = ?', req.accountId);
      const s = settingsOf(account), now = new Date();
      await db().run('UPDATE calendar_sync SET import_url = ? WHERE account_id = ?', url, req.accountId);
      await store(req.accountId, parseIcs(text, { from: new Date(now.getTime() - 864e5), to: new Date(now.getTime() + (Math.max(60, s.horizon_days) + 2) * 864e5), tz: s.tz }), now);
      res.json(await out(req.accountId));
    });
    api.post('/calsync/refresh', async (req, res) => {
      const r = await row(req.accountId);
      if (!r.import_url) throw new HttpError(400, 'Add your calendar’s address first');
      const got = await refresh(req.accountId);
      if (!got.ok) throw new HttpError(400, got.error || 'We couldn’t read your calendar');
      res.json(await out(req.accountId));
    });
  }

  return { register, busyFor, refreshIfStale, syncDue, refresh };
}

module.exports = { createCalSync, parseIcs, buildFeed, googleCalendarLink, fetchIcs, safeUrl, resolveTz };
