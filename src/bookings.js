// Booking calendar: the owner sets available hours once; a Booking block on
// any page shows open times (in the visitor's own time zone), takes a name
// and email, and books. Confirmation with a manage/cancel link and a
// calendar file go to the visitor, a notice to the owner, and a reminder the
// day before. A database index makes double-booking a slot impossible.
const crypto = require('node:crypto');
const express = require('express');
const { rillyEmail } = require('./emailhtml');

const DEFAULTS = {
  tz: 'America/New_York', days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00',
  length: 30, buffer: 0, notice_hours: 12, horizon_days: 21,
  title: 'Free consultation', location: 'Phone or video call. I’ll send the details.',
  breaks: [], // daily, e.g. [{ start: '12:00', end: '13:00' }]
  busy: [], // one-off, [{ id, start: ISO, end: ISO, label }]
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// ---------- Time zones without a library ----------
function validTz(tz) { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } }
// Minutes the zone is ahead of UTC at this instant (e.g. -300 for New York in winter).
function offsetMinutes(date, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(date).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}
// The UTC instant for a wall-clock time in a zone (handles daylight-saving changes).
function zonedToUtc(y, m, d, hh, mm, tz) {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let t = guess - offsetMinutes(new Date(guess), tz) * 60000;
  t = guess - offsetMinutes(new Date(t), tz) * 60000;
  return new Date(t);
}
// Year, month, day and weekday of an instant, as seen in the zone.
function zonedDate(date, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' })
    .formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}

function settingsOf(account) {
  let s = {};
  try { s = JSON.parse(account.booking || '{}') || {}; } catch { /* defaults */ }
  // Hours count as set once they've been saved (busy times alone don't switch booking on).
  return { ...DEFAULTS, ...s, configured: Boolean(s.start) };
}
const stored = (account) => { try { return JSON.parse(account.booking || '{}') || {}; } catch { return {}; } };
function cleanSettings(b = {}) {
  const n = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, Math.round(+v))) : d);
  const out = {
    tz: validTz(b.tz) ? String(b.tz) : DEFAULTS.tz,
    days: [...new Set((Array.isArray(b.days) ? b.days : []).map(Number).filter((d) => d >= 0 && d <= 6))].sort(),
    start: HHMM.test(b.start) ? b.start : DEFAULTS.start, end: HHMM.test(b.end) ? b.end : DEFAULTS.end,
    length: n(b.length, 10, 240, 30), buffer: n(b.buffer, 0, 120, 0), notice_hours: n(b.notice_hours, 0, 720, 12), horizon_days: n(b.horizon_days, 1, 120, 21),
    title: String(b.title || DEFAULTS.title).trim().slice(0, 100), location: String(b.location || '').trim().slice(0, 300),
    breaks: (Array.isArray(b.breaks) ? b.breaks : []).filter((x) => HHMM.test(x?.start) && HHMM.test(x?.end) && x.end > x.start).slice(0, 3).map((x) => ({ start: x.start, end: x.end })),
  };
  if (out.end <= out.start) throw Object.assign(new Error('The day has to end after it starts'), { status: 400 });
  return out;
}

// Open times: every slot in the working hours, minus notice, minus bookings (and their buffers).
function slotsFor(s, booked, now = new Date()) {
  const out = [];
  // Busy times (one-off) count like bookings.
  const blocked = [...booked, ...(s.busy || []).map((b) => ({ starts_at: b.start, ends_at: b.end }))];
  const earliest = now.getTime() + s.notice_hours * 3600e3;
  const step = (s.length + s.buffer) * 60e3;
  const [sh, sm] = s.start.split(':').map(Number), [eh, em] = s.end.split(':').map(Number);
  for (let i = 0; i <= s.horizon_days && out.length < 400; i++) {
    const day = zonedDate(new Date(now.getTime() + i * 86400e3), s.tz);
    if (!s.days.includes(day.wd)) continue;
    const dayStart = zonedToUtc(day.y, day.m, day.d, sh, sm, s.tz).getTime();
    const dayEnd = zonedToUtc(day.y, day.m, day.d, eh, em, s.tz).getTime();
    // Daily breaks (lunch etc.) in this day's local time.
    const breaks = (s.breaks || []).map((br) => {
      const [bh, bm] = br.start.split(':').map(Number), [xh, xm] = br.end.split(':').map(Number);
      return [zonedToUtc(day.y, day.m, day.d, bh, bm, s.tz).getTime(), zonedToUtc(day.y, day.m, day.d, xh, xm, s.tz).getTime()];
    });
    for (let t = dayStart; t + s.length * 60e3 <= dayEnd; t += step) {
      if (t < earliest) continue;
      const end = t + s.length * 60e3;
      if (breaks.some(([a, z]) => t < z && end > a)) continue;
      const clash = blocked.some((b) => t < new Date(b.ends_at).getTime() + s.buffer * 60e3 && end + s.buffer * 60e3 > new Date(b.starts_at).getTime());
      if (!clash) out.push({ start: new Date(t).toISOString(), end: new Date(end).toISOString() });
    }
  }
  return out;
}

// A calendar file, so the visitor can add the call in one tap.
function ics({ uid, start, end, title, description, location, organizer }) {
  const f = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const e = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => `\\${c}`);
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Rilly//Booking//EN', 'METHOD:PUBLISH', 'BEGIN:VEVENT', `UID:${uid}@getrilly.com`, `DTSTAMP:${f(new Date())}`,
    `DTSTART:${f(start)}`, `DTEND:${f(end)}`, `SUMMARY:${e(title)}`, `DESCRIPTION:${e(description)}`, location ? `LOCATION:${e(location)}` : '',
    organizer ? `ORGANIZER;CN=${e(organizer)}:mailto:noreply@getrilly.com` : '', 'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
}
const when = (iso, tz) => new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso));

function registerBookings(app, api, { getDb, HttpError, id, upsertContact, logEvent, messaging, mailer, publicBase, ownerViewing, findPublicStep, attachSource = async () => null }) {
  const db = () => getDb();
  const confirmed = (accountId) => db().all("SELECT starts_at, ends_at FROM bookings WHERE account_id = ? AND status = 'confirmed' AND ends_at > now() - interval '1 day'", accountId);
  const page = (res, status, title, body) => res.status(status).type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
    <style>body{font:16px/1.55 -apple-system,system-ui,sans-serif;color:#14282B;background:#F4F7F6;margin:0;padding:40px 16px}.c{max-width:460px;margin:0 auto;background:#fff;border:1px solid #E3E9E8;border-radius:16px;padding:28px}
    h1{font-size:1.4rem;margin:0 0 12px}.m{color:#5B6B70}details{border-top:1px solid #E3E9E8;padding:12px 0}summary{cursor:pointer;font-weight:600;color:#1F7F78}.col{display:grid;gap:10px;margin-top:10px}.col label{display:grid;gap:4px;font-size:.9rem}input,select,textarea{padding:11px 12px;border:1px solid #d1d5db;border-radius:10px;font:inherit}.ok{background:#e6f4f2;color:#14524d;padding:10px 12px;border-radius:10px}button{background:#1F7F78;color:#fff;border:0;border-radius:10px;padding:12px 20px;font:600 1rem system-ui;cursor:pointer}button.d{background:#b91c1c}</style></head><body><div class="c">${body}</div></body></html>`);
  const escH = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- Public: open times and booking ----------
  app.get('/f/:funnel/slots', async (req, res) => {
    const funnel = await db().get('SELECT * FROM funnels WHERE slug = ?', String(req.params.funnel));
    if (!funnel || (funnel.status !== 'live' && !await ownerViewing(req, funnel))) return res.status(404).json({ error: 'Not found' });
    const account = await db().get('SELECT * FROM accounts WHERE id = ?', funnel.account_id);
    const s = settingsOf(account);
    res.set('Cache-Control', 'no-store').json({ title: s.title, length: s.length, location: s.location, slots: s.configured ? slotsFor(s, await confirmed(account.id)) : [] });
  });

  app.post('/f/:funnel/:step/book', express.json({ limit: '10kb' }), async (req, res) => {
    const found = await findPublicStep(req.params.funnel, req.params.step);
    if (!found) return res.status(404).json({ error: 'Page not found' });
    const { funnel, step, nextUrl } = found;
    if (funnel.status !== 'live' && !await ownerViewing(req, funnel)) return res.status(404).json({ error: 'Page not found' });
    const b = req.body || {};
    if (b.website) return res.json({ ok: true }); // honeypot
    const email = String(b.email || '').trim().toLowerCase();
    const name = String(b.name || '').trim().slice(0, 120);
    if (!name || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please enter your name and a valid email' });
    const account = await db().get('SELECT * FROM accounts WHERE id = ?', funnel.account_id);
    const s = settingsOf(account);
    const asked = new Date(String(b.start || ''));
    const slot = Number.isNaN(asked.getTime()) ? null : slotsFor(s, await confirmed(account.id)).find((x) => x.start === asked.toISOString());
    if (!slot) return res.status(409).json({ error: 'Sorry, that time was just taken. Please pick another.' });
    const blocks = JSON.parse(step.blocks || '[]');
    const block = blocks.find((x) => x.type === 'booking') || {};
    const [first, ...rest] = name.split(/\s+/);
    const contact = await upsertContact(db(), account.id, { email, first_name: first, last_name: rest.join(' '), phone: String(b.phone || '').slice(0, 40), tags: block.tag ? [String(block.tag).toLowerCase()] : [], source: 'funnel' });
    const token = crypto.randomBytes(18).toString('base64url');
    let booking;
    try {
      booking = await db().get(`INSERT INTO bookings (account_id, contact_id, funnel_id, starts_at, ends_at, name, email, phone, note, token)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`, account.id, contact.id, funnel.id, slot.start, slot.end, name, email,
      String(b.phone || '').slice(0, 40), String(b.note || '').slice(0, 2000), token);
    } catch (e) {
      if (String(e.code) === '23505' || /unique/i.test(e.message)) return res.status(409).json({ error: 'Sorry, that time was just taken. Please pick another.' });
      throw e;
    }
    await logEvent(db(), account.id, { person_id: contact.id, type: 'booking', source: 'funnel', meta: { funnel: funnel.name, funnel_id: funnel.id, step_id: step.id, starts_at: slot.start, note: booking.note } });
    const src = await attachSource(db(), contact.id, req);
    await db().run("INSERT INTO page_events (account_id, funnel_id, step_id, type, contact_id, source) VALUES (?, ?, ?, 'optin', ?, ?)", account.id, funnel.id, step.id, contact.id, src?.source || '');
    await sendConfirmation(account, booking, s).catch((e) => console.error('booking email:', e.message));
    res.json({ ok: true, start: slot.start, end: slot.end, next: nextUrl === '#' ? null : nextUrl });
  });

  async function sendConfirmation(account, bk, s, { movedFrom = null } = {}) {
    const base = publicBase();
    const manage = `${base}/b/${bk.token}`;
    const whenTxt = when(bk.starts_at, s.tz);
    const text = `Hi ${bk.name.split(' ')[0]},\n\n${movedFrom ? `Your booking has moved from ${when(movedFrom, s.tz)}.\n\n` : ''}You’re booked: ${s.title}\n${whenTxt} (${s.length} minutes)\n${s.location ? `\n${s.location}\n` : ''}\nNeed to change the time or cancel? ${manage}\n\n${account.from_name || account.name}`;
    await messaging.sendTransactional({ account, to: bk.email, contactId: bk.contact_id, subject: `Booked: ${s.title}, ${whenTxt}`, text,
      attachments: [{ filename: 'booking.ics', content: ics({ uid: `booking-${bk.id}`, start: bk.starts_at, end: bk.ends_at, title: `${s.title} with ${account.name}`, description: `${s.location}\n\nManage: ${manage}`, location: s.location, organizer: account.name }), contentType: 'text/calendar; charset=utf-8' }] });
    await messaging.sendToOwner({ account, subject: `${movedFrom ? 'Moved' : 'New booking'}: ${bk.name}, ${whenTxt}`,
      body: `${bk.name} <${bk.email}>${bk.phone ? `\n${bk.phone}` : ''} booked ${s.title}\n${whenTxt}${bk.note ? `\n\nNote: ${bk.note}` : ''}\n\nCalendar: ${base}/#/calendar`,
      html: rillyEmail({ base, title: `${movedFrom ? 'Booking moved' : 'New booking'}: ${bk.name}`, preheader: whenTxt, blocks: [
        ...(movedFrom ? [{ p: `Was ${when(movedFrom, s.tz)}.` }] : []),
        { rows: [['When', whenTxt], ['Who', bk.name], ['Email', bk.email], ...(bk.phone ? [['Phone', bk.phone]] : [])] },
        ...(bk.note ? [{ p: `“${bk.note}”` }] : []), { button: ['Open your calendar', `${base}/#/calendar`] }] }) });
  }

  // ---------- Public: manage or cancel a booking ----------
  const byToken = (t) => db().get('SELECT b.*, a.booking AS acct_booking, a.name AS acct_name FROM bookings b JOIN accounts a ON a.id = b.account_id WHERE b.token = ?', String(t).slice(0, 64));
  app.get('/b/:token', async (req, res) => {
    const bk = await byToken(req.params.token);
    if (!bk) return page(res, 404, 'Not found', '<h1>Booking not found</h1><p class="m">This link may be old or mistyped.</p>');
    const s = settingsOf({ booking: bk.acct_booking });
    if (bk.status === 'cancelled') return page(res, 200, 'Cancelled', `<h1>This booking is cancelled</h1><p class="m">${escH(s.title)} with ${escH(bk.acct_name)}, ${escH(when(bk.starts_at, s.tz))}.</p>`);
    if (new Date(bk.starts_at) < new Date()) return page(res, 200, 'Your booking', `<h1>${escH(s.title)}</h1><p class="m">This was on ${escH(when(bk.starts_at, s.tz))}.</p>`);
    const open = slotsFor(s, (await confirmed(bk.account_id)).filter((x) => new Date(x.starts_at).getTime() !== new Date(bk.starts_at).getTime()));
    const saved = req.query.saved ? `<p class="ok">${req.query.saved === 'time' ? 'Your new time is booked. A confirmation is on its way.' : 'Saved.'}</p>` : '';
    return page(res, 200, 'Your booking', `${saved}<h1>${escH(s.title)}</h1><p><b>${escH(when(bk.starts_at, s.tz))}</b><br><span class="m">with ${escH(bk.acct_name)} · ${s.length} minutes</span></p>
      ${s.location ? `<p class="m">${escH(s.location)}</p>` : ''}
      <details ${req.query.change ? 'open' : ''}><summary>Change the time</summary>
        <form method="post" action="/b/${escH(bk.token)}/move" class="col"><label>New time <span class="m">(your time zone is detected below)</span>
          <select name="start" required data-slots='${escH(JSON.stringify(open.map((x) => x.start)))}'><option value="">Loading times…</option></select></label>
          <button>Move my booking</button></form></details>
      <details><summary>Change my details</summary>
        <form method="post" action="/b/${escH(bk.token)}/details" class="col">
          <label>Name<input name="name" value="${escH(bk.name)}" required></label>
          <label>Phone<input name="phone" value="${escH(bk.phone)}"></label>
          <label>Note<textarea name="note" rows="3">${escH(bk.note)}</textarea></label>
          <button>Save</button></form></details>
      <form method="post" action="/b/${escH(bk.token)}/cancel" onsubmit="return confirm('Cancel this booking?')" style="margin-top:18px"><button class="d">Cancel this booking</button></form>
      <script>(function(){var sel=document.querySelector('select[data-slots]');var list=JSON.parse(sel.dataset.slots);
        sel.innerHTML=list.length?'<option value="">Pick a new time</option>'+list.map(function(s){return '<option value="'+s+'">'+new Date(s).toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+'</option>'}).join(''):'<option value="">No other open times right now</option>';
        var p=document.createElement('p');p.className='m';p.style.fontSize='.85rem';p.textContent='Times shown in '+Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g,' ');sel.parentNode.after(p);})();<\/script>`);
  });
  app.post('/b/:token/cancel', express.urlencoded({ extended: false, limit: '1kb' }), async (req, res) => {
    const bk = await byToken(req.params.token);
    if (!bk) return page(res, 404, 'Not found', '<h1>Booking not found</h1>');
    const done = await cancel(bk, 'visitor');
    const s = settingsOf({ booking: bk.acct_booking });
    return page(res, 200, 'Cancelled', `<h1>${done ? 'Cancelled' : 'Already cancelled'}</h1><p class="m">${escH(s.title)}, ${escH(when(bk.starts_at, s.tz))}. ${done ? 'We’ve let them know.' : ''}</p>`);
  });

  app.post('/b/:token/move', express.urlencoded({ extended: false, limit: '1kb' }), async (req, res) => {
    const bk = await byToken(req.params.token);
    if (!bk || bk.status !== 'confirmed' || new Date(bk.starts_at) < new Date()) return page(res, 404, 'Not found', '<h1>This booking can’t be changed</h1>');
    const account = await db().get('SELECT * FROM accounts WHERE id = ?', bk.account_id);
    const s = settingsOf(account);
    const asked = new Date(String(req.body.start || ''));
    const others = (await confirmed(bk.account_id)).filter((x) => new Date(x.starts_at).getTime() !== new Date(bk.starts_at).getTime());
    const slot = Number.isNaN(asked.getTime()) ? null : slotsFor(s, others).find((x) => x.start === asked.toISOString());
    if (!slot) return res.redirect(303, `/b/${bk.token}?change=1`);
    const old = bk.starts_at;
    try { await db().run('UPDATE bookings SET starts_at = ?, ends_at = ?, reminded_at = NULL WHERE id = ?', slot.start, slot.end, bk.id); }
    catch (e) { if (String(e.code) === '23505' || /unique/i.test(e.message)) return res.redirect(303, `/b/${bk.token}?change=1`); throw e; }
    const moved = { ...bk, starts_at: slot.start, ends_at: slot.end };
    await logEvent(db(), account.id, { person_id: bk.contact_id, type: 'note', source: 'funnel', meta: { note: `Moved their booking from ${when(old, s.tz)} to ${when(slot.start, s.tz)}` } }).catch(() => {});
    await sendConfirmation(account, moved, s, { movedFrom: old }).catch((e) => console.error('booking email:', e.message));
    res.redirect(303, `/b/${bk.token}?saved=time`);
  });
  app.post('/b/:token/details', express.urlencoded({ extended: false, limit: '4kb' }), async (req, res) => {
    const bk = await byToken(req.params.token);
    if (!bk || bk.status !== 'confirmed') return page(res, 404, 'Not found', '<h1>This booking can’t be changed</h1>');
    const name = String(req.body.name || '').trim().slice(0, 120) || bk.name;
    await db().run('UPDATE bookings SET name = ?, phone = ?, note = ? WHERE id = ?', name, String(req.body.phone || '').slice(0, 40), String(req.body.note || '').slice(0, 2000), bk.id);
    res.redirect(303, `/b/${bk.token}?saved=details`);
  });

  async function cancel(bk, by) {
    const r = await db().get("UPDATE bookings SET status = 'cancelled', cancelled_at = now() WHERE id = ? AND status = 'confirmed' RETURNING id", bk.id);
    if (!r) return false;
    const account = await db().get('SELECT * FROM accounts WHERE id = ?', bk.account_id);
    const s = settingsOf(account), whenTxt = when(bk.starts_at, s.tz);
    if (by === 'visitor') await messaging.sendToOwner({ account, subject: `Cancelled: ${bk.name}, ${whenTxt}`, body: `${bk.name} <${bk.email}> cancelled ${s.title} on ${whenTxt}. The time is open again.` }).catch(() => {});
    else await messaging.sendTransactional({ account, to: bk.email, contactId: bk.contact_id, subject: `Cancelled: ${s.title}, ${whenTxt}`, text: `Hi ${bk.name.split(' ')[0]},\n\nSorry, ${s.title} on ${whenTxt} has been cancelled. Reply to this email to find another time.\n\n${account.from_name || account.name}` }).catch(() => {});
    return true;
  }

  // ---------- Reminders, run by the job runner ----------
  async function sendReminders(now = new Date()) {
    const due = await db().all(`SELECT * FROM bookings WHERE status = 'confirmed' AND reminded_at IS NULL
      AND starts_at > ? AND starts_at <= ? AND created_at < ?`, now.toISOString(), new Date(now.getTime() + 24 * 3600e3).toISOString(), new Date(now.getTime() - 3 * 3600e3).toISOString());
    let sent = 0;
    for (const bk of due) {
      const claimed = await db().get('UPDATE bookings SET reminded_at = ? WHERE id = ? AND reminded_at IS NULL RETURNING id', now.toISOString(), bk.id);
      if (!claimed) continue;
      const account = await db().get('SELECT * FROM accounts WHERE id = ?', bk.account_id);
      const s = settingsOf(account);
      await messaging.sendTransactional({ account, to: bk.email, contactId: bk.contact_id, subject: `Reminder: ${s.title}, ${when(bk.starts_at, s.tz)}`,
        text: `Hi ${bk.name.split(' ')[0]},\n\nA reminder about ${s.title}: ${when(bk.starts_at, s.tz)}.\n${s.location ? `\n${s.location}\n` : ''}\nNeed to change it? ${publicBase()}/b/${bk.token}\n\n${account.from_name || account.name}` }).catch((e) => console.error('reminder:', e.message));
      sent++;
    }
    return { reminders: sent };
  }

  // ---------- Owner API ----------
  api.get('/bookings', async (req, res) => {
    const account = await db().get('SELECT * FROM accounts WHERE id = ?', req.accountId);
    const past = req.query.when === 'past';
    const rows = await db().all(`SELECT b.id, b.contact_id, b.funnel_id, b.starts_at, b.ends_at, b.name, b.email, b.phone, b.note, b.status, b.created_at, f.name AS funnel_name
      FROM bookings b LEFT JOIN funnels f ON f.id = b.funnel_id WHERE b.account_id = ? AND ${past ? 'b.ends_at <= now()' : "b.ends_at > now() AND b.status = 'confirmed'"}
      ORDER BY b.starts_at ${past ? 'DESC' : 'ASC'} LIMIT 300`, req.accountId);
    res.json({ settings: settingsOf(account), bookings: rows });
  });
  api.put('/bookings/settings', async (req, res) => {
    let s;
    try { s = cleanSettings(req.body); } catch (e) { throw new HttpError(e.status || 400, e.message); }
    if (!s.days.length) throw new HttpError(400, 'Pick at least one day');
    const prev = settingsOf(await db().get('SELECT booking FROM accounts WHERE id = ?', req.accountId));
    s.busy = (prev.busy || []).filter((b) => new Date(b.end) > new Date());
    await db().run('UPDATE accounts SET booking = ? WHERE id = ?', JSON.stringify(s), req.accountId);
    res.json({ ok: true, settings: { ...s, configured: true } });
  });
  // Busy times: a date with a from/until (or the whole day) in the owner's time zone.
  api.post('/bookings/busy', async (req, res) => {
    const account = await db().get('SELECT booking FROM accounts WHERE id = ?', req.accountId);
    const s = settingsOf(account);
    const m = String(req.body?.date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) throw new HttpError(400, 'Pick a date');
    const allDay = Boolean(req.body?.all_day);
    const from = allDay ? '00:00' : String(req.body?.from || ''), to = allDay ? '23:59' : String(req.body?.to || '');
    if (!HHMM.test(from) || !HHMM.test(to) || to <= from) throw new HttpError(400, 'The busy time has to end after it starts');
    const [y, mo, d] = m.slice(1).map(Number);
    const days = Math.min(60, Math.max(1, Number(req.body?.days) || 1)); // a few days off in a row
    const busy = (s.busy || []).filter((b) => new Date(b.end) > new Date());
    for (let i = 0; i < days; i++) {
      const day = new Date(Date.UTC(y, mo - 1, d + i));
      const [fy, fm, fd] = [day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate()];
      const [fh, fmin] = from.split(':').map(Number), [th, tmin] = to.split(':').map(Number);
      busy.push({ id: crypto.randomBytes(6).toString('hex'), start: zonedToUtc(fy, fm, fd, fh, fmin, s.tz).toISOString(), end: zonedToUtc(fy, fm, fd, th, tmin, s.tz).toISOString(), label: String(req.body?.label || '').trim().slice(0, 80) });
    }
    busy.sort((a, b) => a.start.localeCompare(b.start));
    await db().run('UPDATE accounts SET booking = ? WHERE id = ?', JSON.stringify({ ...stored(account), busy: busy.slice(-300) }), req.accountId);
    res.status(201).json({ busy });
  });
  api.delete('/bookings/busy/:bid', async (req, res) => {
    const account = await db().get('SELECT booking FROM accounts WHERE id = ?', req.accountId);
    const s = settingsOf(account);
    const busy = (s.busy || []).filter((b) => b.id !== req.params.bid);
    await db().run('UPDATE accounts SET booking = ? WHERE id = ?', JSON.stringify({ ...stored(account), busy }), req.accountId);
    res.json({ busy });
  });

  api.post('/bookings/:id/cancel', async (req, res) => {
    const bk = await db().get('SELECT * FROM bookings WHERE id = ? AND account_id = ?', id(req.params.id), req.accountId);
    if (!bk) throw new HttpError(404, 'Booking not found');
    res.json({ cancelled: await cancel(bk, 'owner') });
  });

  return { sendReminders, slotsFor, settingsOf };
}

module.exports = { registerBookings, slotsFor, zonedToUtc, offsetMinutes, settingsOf, cleanSettings, ics, DEFAULTS };
