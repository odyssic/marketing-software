// Booking calendar: the owner sets available hours once; a Booking block on
// any page shows open times (in the visitor's own time zone), takes a name
// and email, and books. Confirmation with a manage/cancel link and a
// calendar file go to the visitor, a notice to the owner, and a reminder the
// day before. A database index makes double-booking a slot impossible.
const crypto = require('node:crypto');
const express = require('express');
const { rillyEmail } = require('./emailhtml');
const { createPaidBookings, payOf, cancelRule, paidLine, balanceOf, money } = require('./paidbookings');

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
    cancel_hours: n(b.cancel_hours, 0, 720, 24), // paid bookings: free cancellation up to this many hours before
    breaks: (Array.isArray(b.breaks) ? b.breaks : []).filter((x) => HHMM.test(x?.start) && HHMM.test(x?.end) && x.end > x.start).slice(0, 3).map((x) => ({ start: x.start, end: x.end })),
  };
  // Different hours per day: { 1: [['09:00','12:00'], ['14:00','17:00']], 6: [['10:00','14:00']] }.
  if (b.hours && typeof b.hours === 'object') {
    const hours = {};
    for (let d = 0; d <= 6; d++) {
      const ranges = (Array.isArray(b.hours[d]) ? b.hours[d] : []).filter((r) => Array.isArray(r) && HHMM.test(r[0]) && HHMM.test(r[1]) && r[1] > r[0])
        .map((r) => [r[0], r[1]]).sort((x, y) => x[0].localeCompare(y[0])).slice(0, 6);
      if (ranges.length) hours[d] = ranges;
    }
    out.hours = hours;
    out.days = Object.keys(hours).map(Number);
    if (out.days.length) { out.start = Object.values(hours).flat().map((r) => r[0]).sort()[0]; out.end = Object.values(hours).flat().map((r) => r[1]).sort().at(-1); }
    return out;
  }
  if (out.end <= out.start && !(b.hours && typeof b.hours === 'object')) throw Object.assign(new Error('The day has to end after it starts'), { status: 400 });
  return out;
}

// Open times: every slot in the working hours, minus notice, minus bookings (and their buffers).
function slotsFor(s, booked, now = new Date()) {
  const out = [];
  // Busy times (one-off) count like bookings.
  const blocked = [...booked, ...(s.busy || []).map((b) => ({ starts_at: b.start, ends_at: b.end }))];
  const earliest = now.getTime() + s.notice_hours * 3600e3;
  const step = (s.length + s.buffer) * 60e3;
  // The day's open stretches: per-day hours if set, else one from/until on the chosen days.
  const rangesFor = (wd) => (s.hours ? s.hours[wd] || [] : s.days.includes(wd) ? [[s.start, s.end]] : []);
  for (let i = 0; i <= s.horizon_days && out.length < 400; i++) {
    const day = zonedDate(new Date(now.getTime() + i * 86400e3), s.tz);
    for (const [rs, re] of rangesFor(day.wd)) {
    const [sh, sm] = rs.split(':').map(Number), [eh, em] = re.split(':').map(Number);
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
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
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

function registerBookings(app, api, { getDb, HttpError, id, upsertContact, logEvent, messaging, mailer, publicBase, ownerViewing, findPublicStep, attachSource = async () => null,
  calsync = null, stripe = null, orderToken = null, checkout = null, invoices = null, fulfilOrder = null }) {
  const db = () => getDb();
  // Taken times: confirmed bookings, times held while someone pays, and busy times from the owner's own calendar.
  const confirmed = async (accountId) => [
    ...await db().all("SELECT starts_at, ends_at FROM bookings WHERE account_id = ? AND (status = 'confirmed' OR (status = 'held' AND hold_until > now())) AND ends_at > now() - interval '1 day'", accountId),
    ...(calsync ? await calsync.busyFor(accountId) : [])];
  const page = (res, status, title, body) => res.status(status).type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
    <style>body{font:16px/1.55 -apple-system,system-ui,sans-serif;color:#14282B;background:#F4F7F6;margin:0;padding:40px 16px}.c{max-width:460px;margin:0 auto;background:#fff;border:1px solid #E3E9E8;border-radius:16px;padding:28px}
    h1{font-size:1.4rem;margin:0 0 12px}.m{color:#5B6B70}details{border-top:1px solid #E3E9E8;padding:12px 0}summary{cursor:pointer;font-weight:600;color:#1F7F78}.col{display:grid;gap:10px;margin-top:10px}.col label{display:grid;gap:4px;font-size:.9rem}input,select,textarea{padding:11px 12px;border:1px solid #d1d5db;border-radius:10px;font:inherit}.ok{background:#e6f4f2;color:#14524d;padding:10px 12px;border-radius:10px;margin-top:0}button{background:#1F7F78;color:#fff;border:0;border-radius:10px;padding:12px 20px;font:600 1rem system-ui;cursor:pointer}button.d{background:#b91c1c}button.link{background:none;color:#5B6B70;padding:4px 0;font-weight:500;text-decoration:underline}.pill{display:inline-block;background:#fef3c7;color:#92400e;border-radius:99px;padding:3px 10px;font-size:.8rem;font-weight:600;margin:0 0 10px}.paybox{background:#F4F7F6;border-radius:10px;padding:10px 12px}a.btn{display:inline-block;background:#1F7F78;color:#fff;border-radius:10px;padding:12px 20px;font-weight:600;text-decoration:none}.addcal{font-size:.9rem}.addcal a{color:#1F7F78}</style></head><body><div class="c">${body}</div></body></html>`);
  const escH = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Paid bookings (paidbookings.js), when the app passes in checkout and Stripe.
  const paid = fulfilOrder ? createPaidBookings({ getDb, HttpError, stripe, orderToken, checkout, invoices, fulfilOrder, messaging, publicBase, logEvent, settingsOf, when, sendConfirmation, escH }) : null;

  // ---------- Public: open times and booking ----------
  app.get('/f/:funnel/slots', async (req, res) => {
    const funnel = await db().get('SELECT * FROM funnels WHERE slug = ?', String(req.params.funnel));
    if (!funnel || (funnel.status !== 'live' && !await ownerViewing(req, funnel))) return res.status(404).json({ error: 'Not found' });
    const account = await db().get('SELECT * FROM accounts WHERE id = ?', funnel.account_id);
    const s = settingsOf(account);
    if (calsync && s.configured) await calsync.refreshIfStale(account.id).catch(() => {});
    if (paid) await paid.expireHolds(new Date(), account.id);
    const codes = checkout ? await checkout.hasCoupons(account.id) : false;
    res.set('Cache-Control', 'no-store').json({ title: s.title, length: s.length, location: s.location, codes, slots: s.configured ? slotsFor(s, await confirmed(account.id)) : [] });
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
    const contact = await upsertContact(db(), account.id, { email, first_name: first, entry: `${funnel.name} → booked a time`, last_name: rest.join(' '), phone: String(b.phone || '').slice(0, 40), tags: block.tag ? [String(block.tag).toLowerCase()] : [], source: 'funnel' });
    // A paid booking: hold the time for 15 minutes and send them to pay.
    const pay = payOf(block);
    if (pay.kind && paid) {
      try {
        const source = await attachSource(db(), contact.id, req);
        return res.json(await paid.start({ account, funnel, step, s, slot, contact, name, email, b, pay, source }));
      } catch (e) { if (e instanceof HttpError) return res.status(e.status).json({ error: e.message }); throw e; }
    }
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
    const { googleCalendarLink } = require('./calsync');
    const google = googleCalendarLink({ title: `${s.title} with ${account.name}`, start: bk.starts_at, end: bk.ends_at, details: `Manage: ${manage}`, location: s.location });
    const money1 = paidLine(bk) ? `\n${paidLine(bk)}.${bk.pay_kind ? ` ${cancelRule(s, bk).text}` : ''}\n` : '';
    const text = `Hi ${bk.name.split(' ')[0]},\n\n${movedFrom ? `Your booking has moved from ${when(movedFrom, s.tz)}.\n\n` : ''}You’re booked: ${s.title}\n${whenTxt} (${s.length} minutes)\n${s.location ? `\n${s.location}\n` : ''}${money1}\nAdd it to your calendar:\nGoogle: ${google}\nApple, Outlook and others: ${manage}/calendar.ics (also attached)\n\nNeed to change the time or cancel? ${manage}\n\n${account.from_name || account.name}`;
    await messaging.sendTransactional({ account, to: bk.email, contactId: bk.contact_id, subject: `Booked: ${s.title}, ${whenTxt}`, text,
      attachments: [{ filename: 'booking.ics', content: ics({ uid: `booking-${bk.id}`, start: bk.starts_at, end: bk.ends_at, title: `${s.title} with ${account.name}`, description: `${s.location}\n\nManage: ${manage}`, location: s.location, organizer: account.name }), contentType: 'text/calendar; charset=utf-8' }] });
    await messaging.sendToOwner({ account, subject: `${movedFrom ? 'Moved' : 'New booking'}: ${bk.name}, ${whenTxt}`,
      body: `${bk.name} <${bk.email}>${bk.phone ? `\n${bk.phone}` : ''} booked ${s.title}\n${whenTxt}${paidLine(bk) ? `\n${paidLine(bk)}` : ''}${bk.note ? `\n\nNote: ${bk.note}` : ''}\n\nCalendar: ${base}/#/calendar`,
      html: rillyEmail({ base, title: `${movedFrom ? 'Booking moved' : 'New booking'}: ${bk.name}`, preheader: whenTxt, blocks: [
        ...(movedFrom ? [{ p: `Was ${when(movedFrom, s.tz)}.` }] : []),
        { rows: [['When', whenTxt], ['Who', bk.name], ['Email', bk.email], ...(bk.phone ? [['Phone', bk.phone]] : []), ...(paidLine(bk) ? [['Payment', paidLine(bk)]] : [])] },
        ...(bk.note ? [{ p: `“${bk.note}”` }] : []), { button: ['Open your calendar', `${base}/#/calendar`] }] }) });
  }

  // ---------- Public: manage or cancel a booking ----------
  const byToken = (t) => db().get('SELECT b.*, a.booking AS acct_booking, a.name AS acct_name FROM bookings b JOIN accounts a ON a.id = b.account_id WHERE b.token = ?', String(t).slice(0, 64));
  app.get('/b/:token', async (req, res) => {
    const bk = await byToken(req.params.token);
    if (!bk) return page(res, 404, 'Not found', '<h1>Booking not found</h1><p class="m">This link may be old or mistyped.</p>');
    const s = settingsOf({ booking: bk.acct_booking });
    if (bk.status === 'cancelled') return page(res, 200, 'Cancelled', `<h1>This booking is cancelled</h1><p class="m">${escH(s.title)} with ${escH(bk.acct_name)}, ${escH(when(bk.starts_at, s.tz))}.</p>`);
    const extra = paid ? await paid.pagePart(bk, s, req.query) : { html: '', final: false };
    if (extra.final) return page(res, 200, 'Your booking', extra.html);
    if (new Date(bk.starts_at) < new Date()) return page(res, 200, 'Your booking', `<h1>${escH(s.title)}</h1><p class="m">This was on ${escH(when(bk.starts_at, s.tz))}.</p>`);
    const rule = extra.rule, locked = rule && !rule.free; // paid, and inside the free-cancellation window
    const kept = rule ? `${money(bk.paid_cents, bk.currency)} ${rule.what}` : '';
    const google = require('./calsync').googleCalendarLink({ title: `${s.title} with ${bk.acct_name}`, start: bk.starts_at, end: bk.ends_at, details: `Manage: ${publicBase()}/b/${bk.token}`, location: s.location });
    const open = slotsFor(s, (await confirmed(bk.account_id)).filter((x) => new Date(x.starts_at).getTime() !== new Date(bk.starts_at).getTime()));
    const saved = req.query.saved ? `<p class="ok">${req.query.saved === 'time' ? 'Your new time is booked. A confirmation is on its way.' : 'Saved.'}</p>` : '';
    return page(res, 200, 'Your booking', `${saved}${extra.top || ''}<h1>${escH(s.title)}</h1><p><b>${escH(when(bk.starts_at, s.tz))}</b><br><span class="m">with ${escH(bk.acct_name)} · ${s.length} minutes</span></p>
      ${s.location ? `<p class="m">${escH(s.location)}</p>` : ''}${extra.html}
      <p class="addcal">Add to your calendar: <a href="${escH(google)}" target="_blank" rel="noopener">Google</a> · <a href="/b/${escH(bk.token)}/calendar.ics">Apple, Outlook &amp; others</a></p>
      ${locked ? `<p class="m" style="border-top:1px solid #E3E9E8;padding-top:12px">It’s too close to the time to change it online. Reply to your confirmation email and ${escH(bk.acct_name)} will help.</p>` : ''}
      <details ${req.query.change ? 'open' : ''} ${locked ? 'hidden' : ''}><summary>Change the time</summary>
        <form method="post" action="/b/${escH(bk.token)}/move" class="col"><label>New time <span class="m">(your time zone is detected below)</span>
          <select name="start" required data-slots='${escH(JSON.stringify(open.map((x) => x.start)))}'><option value="">Loading times…</option></select></label>
          <button>Move my booking</button></form></details>
      <details><summary>Change my details</summary>
        <form method="post" action="/b/${escH(bk.token)}/details" class="col">
          <label>Name<input name="name" value="${escH(bk.name)}" required></label>
          <label>Phone<input name="phone" value="${escH(bk.phone)}"></label>
          <label>Note<textarea name="note" rows="3">${escH(bk.note)}</textarea></label>
          <button>Save</button></form></details>
      ${locked ? `<p class="m" style="margin:18px 0 0">If you cancel now, your ${escH(kept)} is kept.</p>` : ''}
      <form method="post" action="/b/${escH(bk.token)}/cancel" onsubmit="return confirm(${escH(JSON.stringify(locked ? `Cancel this booking? Your ${kept} is kept.` : rule ? `Cancel this booking? ${bk.acct_name} will refund your ${kept}.` : 'Cancel this booking?'))})" style="margin-top:${locked ? 10 : 18}px"><button class="d">${locked ? `Cancel (${escH(rule.what)} kept)` : 'Cancel this booking'}</button></form>
      <script>(function(){var sel=document.querySelector('select[data-slots]');var list=JSON.parse(sel.dataset.slots);
        sel.innerHTML=list.length?'<option value="">Pick a new time</option>'+list.map(function(s){return '<option value="'+s+'">'+new Date(s).toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+'</option>'}).join(''):'<option value="">No other open times right now</option>';
        var p=document.createElement('p');p.className='m';p.style.fontSize='.85rem';p.textContent='Times shown in '+Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g,' ');sel.parentNode.after(p);})();<\/script>`);
  });
  app.post('/b/:token/cancel', express.urlencoded({ extended: false, limit: '1kb' }), async (req, res) => {
    const bk = await byToken(req.params.token);
    if (!bk) return page(res, 404, 'Not found', '<h1>Booking not found</h1>');
    const s = settingsOf({ booking: bk.acct_booking });
    const rule = bk.pay_kind && bk.paid_cents ? cancelRule(s, bk) : null;
    const done = await cancel(bk, 'visitor');
    const amt = rule ? `${money(bk.paid_cents, bk.currency)} ${rule.what}` : '';
    const moneyNote = !done || !rule ? '' : rule.free ? ` ${escH(bk.acct_name)} will refund your ${escH(amt)} to your card.` : ` As it was within ${escH(rule.hours >= 48 && rule.hours % 24 === 0 ? `${rule.hours / 24} days` : `${rule.hours} hours`)} of the time, your ${escH(amt)} is kept.`;
    return page(res, 200, 'Cancelled', `<h1>${done ? 'Cancelled' : 'Already cancelled'}</h1><p class="m">${escH(s.title)}, ${escH(when(bk.starts_at, s.tz))}. ${done ? 'We’ve let them know.' : ''}${moneyNote}</p>`);
  });
  // Paying for a held time, or letting it go.
  app.post('/b/:token/pay', async (req, res) => {
    const bk = await byToken(req.params.token);
    if (!bk) return page(res, 404, 'Not found', '<h1>Booking not found</h1>');
    let url = null;
    try { url = paid && await paid.resume(bk); } catch (e) { console.error('booking checkout:', e.message); }
    res.redirect(303, url || `/b/${bk.token}`);
  });
  app.post('/b/:token/release', async (req, res) => {
    const bk = await byToken(req.params.token);
    if (!bk) return page(res, 404, 'Not found', '<h1>Booking not found</h1>');
    if (paid) await paid.release(bk);
    res.redirect(303, `/b/${bk.token}`);
  });
  // "Add to Apple / Outlook calendar" from the email and the booking page.
  app.get('/b/:token/calendar.ics', async (req, res) => {
    const bk = await byToken(req.params.token);
    if (!bk || bk.status !== 'confirmed') return page(res, 404, 'Not found', '<h1>Booking not found</h1>');
    const s = settingsOf({ booking: bk.acct_booking });
    res.set('Content-Disposition', 'attachment; filename="booking.ics"').type('text/calendar; charset=utf-8')
      .send(ics({ uid: `booking-${bk.id}`, start: bk.starts_at, end: bk.ends_at, title: `${s.title} with ${bk.acct_name}`, description: `${s.location}\n\nManage: ${publicBase()}/b/${bk.token}`, location: s.location, organizer: bk.acct_name }));
  });

  app.post('/b/:token/move', express.urlencoded({ extended: false, limit: '1kb' }), async (req, res) => {
    const bk = await byToken(req.params.token);
    if (!bk || bk.status !== 'confirmed' || new Date(bk.starts_at) < new Date()) return page(res, 404, 'Not found', '<h1>This booking can’t be changed</h1>');
    const account = await db().get('SELECT * FROM accounts WHERE id = ?', bk.account_id);
    const s = settingsOf(account);
    if (bk.pay_kind && bk.paid_cents && !cancelRule(s, bk).free) return res.redirect(303, `/b/${bk.token}`); // too close to change online
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
    // Paid: say who keeps the money, and where to refund it.
    let moneyNote = '';
    if (bk.pay_kind && bk.paid_cents && paid) {
      const rule = cancelRule(s, bk), [v] = await paid.ownerView([bk], bk.account_id), amt = money(bk.paid_cents, bk.currency);
      moneyNote = by !== 'visitor' ? `\n\nYour ${amt} payment will be refunded to your card.`
        : rule.free ? `\n\nThey paid ${amt} and cancelled before your free-cancellation cutoff, so please refund them.${v.refund_url ? `\nRefund in Stripe: ${v.refund_url}` : ' (It was a test payment, so there’s nothing to refund.)'}`
          : `\n\nThey cancelled within ${rule.hours} hours of the time, so the ${amt} ${rule.what} is kept.`;
    }
    if (by === 'visitor') await messaging.sendToOwner({ account, subject: `Cancelled: ${bk.name}, ${whenTxt}`, body: `${bk.name} <${bk.email}> cancelled ${s.title} on ${whenTxt}. The time is open again.${moneyNote}` }).catch(() => {});
    else await messaging.sendTransactional({ account, to: bk.email, contactId: bk.contact_id, subject: `Cancelled: ${s.title}, ${whenTxt}`, text: `Hi ${bk.name.split(' ')[0]},\n\nSorry, ${s.title} on ${whenTxt} has been cancelled.${moneyNote} Reply to this email to find another time.\n\n${account.from_name || account.name}` }).catch(() => {});
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
    const rows = await db().all(`SELECT b.id, b.contact_id, b.funnel_id, b.starts_at, b.ends_at, b.name, b.email, b.phone, b.note, b.status, b.created_at, f.name AS funnel_name,
        b.pay_kind, b.price_cents, b.paid_cents, b.currency, b.hold_until, b.stripe_payment, b.order_id, b.balance_invoice_id
      FROM bookings b LEFT JOIN funnels f ON f.id = b.funnel_id WHERE b.account_id = ? AND ${past ? "b.ends_at <= now() AND b.status IN ('confirmed', 'cancelled', 'clash')" : "b.ends_at > now() AND (b.status IN ('confirmed', 'clash') OR (b.status = 'held' AND b.hold_until > now()))"}
      ORDER BY b.starts_at ${past ? 'DESC' : 'ASC'} LIMIT 300`, req.accountId);
    res.json({ settings: settingsOf(account), bookings: paid ? await paid.ownerView(rows, req.accountId) : rows });
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
    const [v] = paid ? await paid.ownerView([bk], req.accountId) : [{}];
    res.json({ cancelled: await cancel(bk, 'owner'), refund_url: v.refund_url || '', paid_label: bk.paid_cents ? money(bk.paid_cents, bk.currency) : '' });
  });
  // Deposit bookings: email them a payment link (an invoice) for the rest.
  api.post('/bookings/:id/balance-link', async (req, res) => {
    if (!paid) throw new HttpError(400, 'Payments aren’t available');
    res.json(await paid.sendBalance(req.accountId, id(req.params.id)));
  });

  const noop = async () => ({});
  return { sendReminders, slotsFor, settingsOf, expireHolds: paid ? paid.expireHolds : noop, onOrderPaid: paid ? paid.onOrderPaid : noop, returnUrl: paid ? paid.returnUrl : async () => null };
}

module.exports = { registerBookings, slotsFor, zonedToUtc, offsetMinutes, settingsOf, cleanSettings, ics, DEFAULTS };
