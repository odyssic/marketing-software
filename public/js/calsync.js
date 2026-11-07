'use strict';

// ---------------- Calendar sync (on the Calendar screen) ----------------
// Two plain steps: 1) see your bookings in your own calendar (a private link
// to subscribe to), 2) let Rilly see when you're busy (paste your calendar's
// private iCal address). Busy times from your calendar show greyed out in the list.

const CALSYNC_SUBSCRIBE = [
  ['Google Calendar', ['Copy your link above.', 'Open Google Calendar on a computer.', 'On the left, next to “Other calendars”, click <b>+</b>, then <b>From URL</b>.', 'Paste the link and click <b>Add calendar</b>. Google checks it every few hours.']],
  ['Outlook', ['Copy your link above.', 'Open Outlook on the web (outlook.com or Microsoft 365) and go to Calendar.', 'Click <b>Add calendar</b>, then <b>Subscribe from web</b>.', 'Paste the link, give it a name and click <b>Import</b>.']],
  ['Apple Calendar', ['iPhone: open <b>Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar</b>, paste the link, tap <b>Next</b>, then <b>Save</b>.', 'Mac: open Calendar, choose <b>File → New Calendar Subscription</b>, paste the link and click <b>Subscribe</b>. Set “Auto-refresh” to every 15 minutes.']],
];
const CALSYNC_FIND = [
  ['Google Calendar', ['Open Google Calendar on a computer and click the <b>gear</b>, then <b>Settings</b>.', 'On the left, under “Settings for my calendars”, click your calendar.', 'Scroll to <b>Integrate calendar</b> and copy the <b>Secret address in iCal format</b>.']],
  ['Outlook', ['In Outlook on the web, open <b>Settings → Calendar → Shared calendars</b>.', 'Under <b>Publish a calendar</b>, pick your calendar and “Can view when I’m busy”, then click <b>Publish</b>.', 'Copy the <b>ICS</b> link.']],
  ['Apple iCloud', ['In the Calendar app on iPhone, tap <b>Calendars</b>, then the <b>ⓘ</b> next to your calendar.', 'Turn on <b>Public Calendar</b> and tap <b>Share Link</b> to copy it.']],
];
const calSyncSteps = (list) => list.map(([name, steps]) => `<details class="cs-how"><summary>${esc(name)}</summary><ol>${steps.map((s) => `<li>${s}</li>`).join('')}</ol></details>`).join('');
const calSyncAgo = (d) => {
  if (!d) return '';
  const m = Math.round((Date.now() - new Date(d)) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : fmtDate(d);
};

function calSyncCardHtml(sync) {
  const connected = Boolean(sync.import_url);
  return `<div class="card cal-sync" data-calsync>
    <h2>Sync with your calendar</h2>
    <div class="cs-step"><h3><span class="cs-n">1</span> See bookings in your calendar</h3>
      <p class="muted small">Your private link. Add it to Google, Apple or Outlook and new bookings show up there on their own. Keep it to yourself.</p>
      <div class="cs-copy"><input readonly value="${esc(sync.feed_url)}" aria-label="Your private calendar link" data-csfeed><button type="button" class="btn sm" data-cscopy>${icon('copy')} Copy</button></div>
      ${calSyncSteps(CALSYNC_SUBSCRIBE)}
      <button type="button" class="link-btn" data-csnew>${icon('refresh')} Make a new link</button> <span class="muted small">if the old one got shared</span>
    </div>
    <div class="cs-step"><h3><span class="cs-n">2</span> Hide times you’re busy</h3>
      <p class="muted small">Paste your calendar’s private address. We check it every 15 minutes and nobody can book over your own appointments.</p>
      ${connected ? `<p class="cs-status ${sync.error ? 'bad' : 'ok'}">${sync.error ? `${icon('alert')} ${esc(sync.error)}` : `${icon('check')} Connected. ${sync.busy_count} busy time${sync.busy_count === 1 ? '' : 's'} found`}${sync.ok_at ? ` · checked ${esc(calSyncAgo(sync.ok_at))}` : ''}</p>` : ''}
      <form data-csimport class="cs-copy"><input name="url" type="url" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" value="${esc(sync.import_url)}" aria-label="Your calendar’s private iCal address">
        <button class="btn sm primary">${connected ? 'Save' : 'Connect'}</button></form>
      ${connected ? `<div class="cs-actions"><button type="button" class="btn sm" data-csrefresh>${icon('refresh')} Check now</button><button type="button" class="btn sm" data-csstop>Stop syncing</button></div>` : ''}
      <p class="muted small" style="margin:10px 0 4px">Where to find it:</p>
      ${calSyncSteps(CALSYNC_FIND)}
    </div>
  </div>`;
}

// Busy times from their calendar, as greyed rows mixed into the day list.
function calSyncBusyRow(b, time) {
  return `<div class="cal-outside" title="From your own calendar, so this time can’t be booked">
    <span class="cal-otime">${b.all_day ? 'All day' : `${time(b.starts_at)}–${time(b.ends_at)}`}</span>
    <span class="cal-olabel">${esc(b.label || 'Busy')}</span><span class="muted small">from your calendar</span></div>`;
}

function bindCalSync(sync, rerender) {
  const card = $('[data-calsync]');
  if (!card) return;
  $('[data-cscopy]', card).onclick = async () => {
    try { await navigator.clipboard.writeText(sync.feed_url); toast('Link copied'); } catch { $('[data-csfeed]', card).select(); toast('Press Ctrl+C (or ⌘C) to copy', true); }
  };
  $('[data-csnew]', card).onclick = async () => {
    const r = await api('POST', '/api/calsync/new-link');
    rerender();
    undoToast('New link made. The old one stopped working', async () => { await api('POST', '/api/calsync/new-link', { restore: r.undo }); toast('Old link is back'); rerender(); });
  };
  const f = $('[data-csimport]', card);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('button', f); btn.disabled = true; btn.textContent = 'Checking…';
    try {
      const r = await api('PUT', '/api/calsync/import', { url: f.url.value });
      toast(r.import_url ? `Connected. ${r.busy_count} busy time${r.busy_count === 1 ? '' : 's'} found` : 'Calendar removed');
      rerender();
    } catch (err) { toast(err.message, true); btn.disabled = false; btn.textContent = sync.import_url ? 'Save' : 'Connect'; }
  };
  const refresh = $('[data-csrefresh]', card);
  if (refresh) refresh.onclick = async () => { try { const r = await api('POST', '/api/calsync/refresh'); toast(`Checked. ${r.busy_count} busy time${r.busy_count === 1 ? '' : 's'}`); rerender(); } catch (err) { toast(err.message, true); } };
  const stop = $('[data-csstop]', card);
  if (stop) stop.onclick = async () => {
    const was = sync.import_url;
    await api('PUT', '/api/calsync/import', { url: '' });
    rerender();
    undoToast('Stopped syncing your calendar', async () => { await api('PUT', '/api/calsync/import', { url: was }).catch((e) => toast(e.message, true)); rerender(); });
  };
}

// The money part of a booking card: what was paid, refunds, the balance.
function calPayHtml(b) {
  if (!b.pay_kind) return '';
  if (b.status === 'held') return `<span class="cal-pay held">${icon('clock')} Waiting for payment · held until ${esc(new Date(b.hold_until).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))}</span>`;
  if (b.status === 'clash') return `<span class="cal-pay bad">${icon('alert')} Paid, but the time was already taken. Refund them or offer another time.${b.refund_url ? ` <a href="${esc(b.refund_url)}" target="_blank" rel="noopener">Refund in Stripe ${icon('external')}</a>` : ''}</span>`;
  if (!b.pay_line) return '';
  return `<span class="cal-pay">${icon('dollar')} ${esc(b.pay_line)}${b.test_payment ? ' <span class="muted">(test)</span>' : ''}
    ${b.refund_url ? ` · <a href="${esc(b.refund_url)}" target="_blank" rel="noopener">Refund in Stripe ${icon('external')}</a>` : ''}
    ${b.balance_cents && b.status === 'confirmed' && b.balance_status !== 'paid' ? ` · ${b.balance_status ? `<a href="${esc(b.balance_url)}" target="_blank" rel="noopener">Balance link sent</a> · <button type="button" class="link-btn" data-balance="${b.id}">Send again</button>` : `<button type="button" class="link-btn" data-balance="${b.id}">Send a payment link for the ${esc(b.balance_label)} balance</button>`}` : ''}</span>`;
}
function bindCalPay(rerender) {
  $$('[data-balance]').forEach((btn) => { btn.onclick = async () => {
    btn.disabled = true;
    try { await api('POST', `/api/bookings/${btn.dataset.balance}/balance-link`); toast('Payment link emailed to them'); rerender(); } catch (err) { toast(err.message, true); btn.disabled = false; }
  }; });
}
