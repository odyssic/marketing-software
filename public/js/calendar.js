'use strict';

// ---------------- Calendar ----------------
// Upcoming bookings by day, your available hours, and a booking page in one click.
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const COMMON_TZ = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu',
  'America/Toronto', 'America/Vancouver', 'Europe/London', 'Europe/Dublin', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Australia/Sydney', 'Australia/Perth', 'Pacific/Auckland', 'Asia/Singapore', 'Asia/Tokyo', 'Asia/Kolkata'];

async function viewCalendar(tab) {
  const past = tab === 'past';
  const { settings: s, bookings } = await api('GET', `/api/bookings${past ? '?when=past' : ''}`);
  const myTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const tz = s.configured ? s.tz : myTz;
  const zones = [...new Set([tz, myTz, ...COMMON_TZ])];
  const dayKey = (iso) => new Date(iso).toLocaleDateString(undefined, { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' });
  const time = (iso) => new Date(iso).toLocaleTimeString(undefined, { timeZone: tz, hour: 'numeric', minute: '2-digit' });
  const groups = {};
  for (const b of bookings) (groups[dayKey(b.starts_at)] ||= []).push(b);
  const pages = await api('GET', '/api/page-groups').catch(() => []);
  const bookingPages = pages.filter((g) => g.pages.some((p) => p.blocks.some((b) => b.type === 'booking')));

  shell('calendar', `
    <div class="head"><div><h1>Calendar</h1><div class="muted">Calls and appointments people book from your pages.</div></div>
      <button class="btn primary" data-newpage>${icon('plus')} Booking page</button></div>
    ${s.configured ? '' : `<div class="banner">${icon('clock')} <b>Set your available hours below</b> so visitors can book. Until then, booking blocks show “no open times”.</div>`}
    <div class="cal-grid">
      <section>
        <div class="tabs"><a href="#/calendar" class="${past ? '' : 'active'}">Upcoming</a><a href="#/calendar/past" class="${past ? 'active' : ''}">Past &amp; cancelled</a></div>
        ${bookings.length ? Object.entries(groups).map(([day, list]) => `<div class="cal-day"><h3>${esc(day)}</h3>
          ${list.map((b) => `<article class="cal-bk card ${b.status === 'cancelled' ? 'cancelled' : ''}">
            <div class="cal-time"><b>${time(b.starts_at)}</b><span class="muted small">to ${time(b.ends_at)}</span></div>
            <div class="cal-who"><a href="#/people/${b.contact_id}"><b>${esc(b.name)}</b></a> <span class="muted small">${esc(b.email)}${b.phone ? ` · ${esc(b.phone)}` : ''}</span>
              ${b.note ? `<p class="cal-note">“${esc(b.note)}”</p>` : ''}
              <span class="muted small">${b.funnel_name ? `from ${esc(b.funnel_name)}` : ''}${b.status === 'cancelled' ? ' · <b>cancelled</b>' : ''}</span></div>
            ${b.status === 'confirmed' && !past ? `<button class="btn sm" data-cancel="${b.id}">Cancel</button>` : ''}
          </article>`).join('')}</div>`).join('')
        : `<div class="card empty"><div class="big">${icon('calendar')}</div><h2>${past ? 'Nothing here yet' : 'No upcoming bookings'}</h2>
            <p>${bookingPages.length ? `Share your booking page${bookingPages.length > 1 ? 's' : ''}: ${bookingPages.map((g) => `<a href="#/funnels/${g.id}">${esc(g.name)}</a>`).join(', ')}.` : 'Make a booking page, or add a Booking block to any page.'}</p></div>`}
      </section>
      <div class="cal-side"><form class="card cal-hours" data-hours>
        <h2>Your available hours</h2>
        <label class="f">Time zone<select name="tz">${zones.map((z) => `<option value="${esc(z)}" ${z === tz ? 'selected' : ''}>${esc(z.replace(/_/g, ' '))}</option>`).join('')}</select></label>
        <div class="f">Days<div class="cal-days">${WEEKDAYS.map((d, i) => `<label class="cal-dchip"><input type="checkbox" name="day" value="${i}" ${s.days.includes(i) ? 'checked' : ''}><span>${d}</span></label>`).join('')}</div></div>
        <div class="colors" style="grid-template-columns:1fr 1fr"><label class="f">From<input type="time" name="start" value="${esc(s.start)}" step="900"></label><label class="f">Until<input type="time" name="end" value="${esc(s.end)}" step="900"></label></div>
        <div class="colors" style="grid-template-columns:1fr 1fr"><label class="f">Daily break <span class="hint">optional</span><input type="time" name="break_start" value="${esc(s.breaks?.[0]?.start || '')}" step="900"></label>
          <label class="f">Break ends<input type="time" name="break_end" value="${esc(s.breaks?.[0]?.end || '')}" step="900"></label></div>
        <div class="colors" style="grid-template-columns:1fr 1fr">
          <label class="f">Each call<select name="length">${[15, 20, 30, 45, 60, 90, 120].map((m) => `<option value="${m}" ${m === s.length ? 'selected' : ''}>${m} minutes</option>`).join('')}</select></label>
          <label class="f">Gap between<select name="buffer">${[0, 5, 10, 15, 30, 60].map((m) => `<option value="${m}" ${m === s.buffer ? 'selected' : ''}>${m ? `${m} minutes` : 'None'}</option>`).join('')}</select></label></div>
        <div class="colors" style="grid-template-columns:1fr 1fr">
          <label class="f">Earliest booking<select name="notice_hours">${[[0, 'Any time'], [2, '2 hours ahead'], [12, '12 hours ahead'], [24, '1 day ahead'], [48, '2 days ahead']].map(([v, l]) => `<option value="${v}" ${v === s.notice_hours ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="f">Book up to<select name="horizon_days">${[7, 14, 21, 30, 60, 90].map((d) => `<option value="${d}" ${d === s.horizon_days ? 'selected' : ''}>${d} days out</option>`).join('')}</select></label></div>
        <label class="f">What it’s called<input name="title" value="${esc(s.title)}" placeholder="Free consultation"></label>
        <label class="f">How you’ll meet <span class="hint">shown when booking and in the confirmation</span><input name="location" value="${esc(s.location)}" placeholder="Phone, Zoom link, or your address"></label>
        <div class="err"></div><button class="btn primary">Save hours</button>
      </form>
      <div class="card cal-busy" data-busycard>
        <h2>Busy &amp; time off</h2>
        <p class="muted small">Block times you’re not available, like an appointment or a day off. Nobody can book them.</p>
        ${(s.busy || []).filter((b) => new Date(b.end) > new Date()).map((b) => `<div class="li"><span><b>${esc(new Date(b.start).toLocaleDateString(undefined, { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }))}</b>
          ${new Date(b.end) - new Date(b.start) > 23 * 3600e3 ? 'all day' : `${time(b.start)}–${time(b.end)}`}${b.label ? ` · <span class="muted">${esc(b.label)}</span>` : ''}</span>
          <button class="btn sm icon" data-unbusy="${esc(b.id)}" title="Remove" aria-label="Remove busy time">${icon('x')}</button></div>`).join('') || '<p class="muted small">Nothing blocked.</p>'}
        <form data-busy class="cal-busy-form">
          <div class="colors" style="grid-template-columns:1fr 1fr"><label class="f">Date<input type="date" name="date" required></label><label class="f">For<select name="days">${[1, 2, 3, 5, 7, 14].map((d) => `<option value="${d}">${d === 1 ? '1 day' : `${d} days`}</option>`).join('')}</select></label></div>
          <label class="check"><input type="checkbox" name="all_day" checked> All day</label>
          <div class="colors" style="grid-template-columns:1fr 1fr" data-times hidden><label class="f">From<input type="time" name="from" value="12:00" step="900"></label><label class="f">Until<input type="time" name="to" value="13:00" step="900"></label></div>
          <label class="f">Note <span class="hint">optional, only you see it</span><input name="label" placeholder="e.g. Dentist"></label>
          <button class="btn">${icon('plus')} Block this time</button></form>
      </div></div>
    </div>`);

  $('[data-hours]').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const body = { tz: f.tz.value, days: $$('[name=day]:checked', f).map((c) => Number(c.value)), start: f.start.value, end: f.end.value, length: Number(f.length.value),
      buffer: Number(f.buffer.value), notice_hours: Number(f.notice_hours.value), horizon_days: Number(f.horizon_days.value), title: f.title.value, location: f.location.value,
      breaks: f.break_start.value && f.break_end.value ? [{ start: f.break_start.value, end: f.break_end.value }] : [] };
    try { await api('PUT', '/api/bookings/settings', body); toast('Hours saved. Visitors can book now'); viewCalendar(tab); }
    catch (err) { $('.err', f).textContent = err.message; }
  };
  const bf = $('[data-busy]');
  bf.all_day.onchange = () => { $('[data-times]', bf).hidden = bf.all_day.checked; };
  bf.onsubmit = async (e) => {
    e.preventDefault();
    try { await api('POST', '/api/bookings/busy', { date: bf.date.value, days: Number(bf.days.value), all_day: bf.all_day.checked, from: bf.from.value, to: bf.to.value, label: bf.label.value }); toast('Blocked'); viewCalendar(tab); }
    catch (err) { toast(err.message, true); }
  };
  $$('[data-unbusy]').forEach((b) => { b.onclick = async () => { await api('DELETE', `/api/bookings/busy/${b.dataset.unbusy}`); toast('Unblocked'); viewCalendar(tab); }; });
  $$('[data-cancel]').forEach((b) => { b.onclick = async () => {
    if (!await confirmBox('Cancel this booking?', 'They’ll get an email saying it’s cancelled, and the time opens up again.', 'Cancel booking')) return;
    await api('POST', `/api/bookings/${b.dataset.cancel}/cancel`); toast('Cancelled and they’ve been told'); viewCalendar(tab);
  }; });
  $('[data-newpage]').onclick = async () => {
    const r = await api('POST', '/api/funnels', { name: s.title || 'Book a call', template: 'booking' });
    toast('Booking page made. Edit it, then publish');
    location.hash = `#/funnels/${r.id}`;
  };
}
