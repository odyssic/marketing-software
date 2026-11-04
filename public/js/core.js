/* Rilly dashboard: a small hash-routed single-page app, no build step.
   Files load in order (see index.html); this one holds shared helpers. */
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');
const state = { me: null };

// Double-click protection for every form: while a submitted form's requests are
// running, more submits are ignored and its buttons are greyed out.
let inflight = 0;
const settle = () => {
  if (inflight > 0) return;
  $$('form[data-busy]').forEach((f) => {
    delete f.dataset.busy;
    $$('button[data-busydis]', f).forEach((b) => { b.disabled = false; delete b.dataset.busydis; });
    // Saved without an error: what's there now is the new "nothing to save" point.
    if (f._resnap && !$('.err', f)?.textContent) f._resnap();
  });
};
// Save buttons stay greyed out until something in their form actually changes.
function trackDirty(form, { dirty = false } = {}) {
  if (!form) return;
  const snap = () => JSON.stringify($$('input, select, textarea', form).filter((i) => i.name && i.type !== 'file').map((i) => (i.type === 'checkbox' || i.type === 'radio' ? i.checked : i.value)));
  let base = dirty ? null : snap();
  const btns = () => $$('button:not([type=button]):not([data-busydis])', form);
  const check = () => { const changed = snap() !== base; btns().forEach((b) => { b.disabled = !changed; b.title = changed ? '' : 'Nothing to save yet'; }); };
  form._resnap = () => { base = snap(); check(); };
  form.addEventListener('input', check);
  form.addEventListener('change', check);
  check();
}
document.addEventListener('submit', (e) => {
  const f = e.target;
  if (f.dataset.busy) { e.preventDefault(); e.stopImmediatePropagation(); return; }
  f.dataset.busy = '1';
  setTimeout(() => {
    $$('button:not([type=button]):not(:disabled)', f).forEach((b) => { b.disabled = true; b.dataset.busydis = '1'; });
    // Nothing was sent (e.g. a validation message): unlock straight away.
    setTimeout(settle, 60);
  });
}, true);

async function api(method, url, body) {
  inflight++;
  try { return await apiCall(method, url, body); } finally { inflight--; setTimeout(settle, 0); }
}
async function apiCall(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (res.status === 401 && !url.startsWith('/api/auth')) { state.me = null; renderAuth(); throw new Error('Please sign in'); }
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { problems: data.problems });
  return data;
}

let toastTimer;
function toast(msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `show${bad ? ' bad' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 2600);
}

// "Done · Undo" instead of "Are you sure?": acts at once, one tap reverses it.
function undoToast(msg, onUndo) {
  toast(msg);
  const t = $('#toast');
  const b = document.createElement('button');
  b.className = 'toast-undo'; b.textContent = 'Undo';
  b.onclick = async () => { t.className = ''; clearTimeout(toastTimer); await onUndo(); };
  t.append(' ', b);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 6000);
}

// Delete with Undo: the item disappears now, the real delete runs after the
// Undo window (or straight away if the tab is closed). `hide` removes it from
// view and returns a function that puts it back.
const pendingDeletes = new Set();
function deleteWithUndo(msg, { url, hide, done }) {
  const restore = hide?.() || (() => {});
  const job = { url, timer: null };
  const run = async () => {
    pendingDeletes.delete(job);
    try { await api('DELETE', url); done?.(); } catch (e) { restore(); toast(e.message, true); }
  };
  job.timer = setTimeout(run, 6000);
  pendingDeletes.add(job);
  undoToast(msg, () => { clearTimeout(job.timer); pendingDeletes.delete(job); restore(); });
}
// Hides an element and returns how to bring it back.
const hideEl = (el) => () => { if (!el) return () => {}; const d = el.style.display; el.style.display = 'none'; return () => { el.style.display = d; }; };
addEventListener('pagehide', () => {
  for (const j of pendingDeletes) { clearTimeout(j.timer); fetch(j.url, { method: 'DELETE', keepalive: true }); }
  pendingDeletes.clear();
});

// The Inbox badge: how many conversations are waiting for a reply.
async function refreshUnread() {
  try {
    const { unread } = await api('GET', '/api/inbox/unread');
    const b = $('[data-unread]');
    if (b) { b.hidden = !unread; b.textContent = unread > 9 ? '9+' : String(unread); b.setAttribute('aria-label', `${unread} unread`); }
  } catch { /* badge is optional */ }
}

const US_STATES = Object.fromEntries('Alabama AL,Alaska AK,Arizona AZ,Arkansas AR,California CA,Colorado CO,Connecticut CT,Delaware DE,District of Columbia DC,Florida FL,Georgia GA,Hawaii HI,Idaho ID,Illinois IL,Indiana IN,Iowa IA,Kansas KS,Kentucky KY,Louisiana LA,Maine ME,Maryland MD,Massachusetts MA,Michigan MI,Minnesota MN,Mississippi MS,Missouri MO,Montana MT,Nebraska NE,Nevada NV,New Hampshire NH,New Jersey NJ,New Mexico NM,New York NY,North Carolina NC,North Dakota ND,Ohio OH,Oklahoma OK,Oregon OR,Pennsylvania PA,Rhode Island RI,South Carolina SC,South Dakota SD,Tennessee TN,Texas TX,Utah UT,Vermont VT,Virginia VA,Washington WA,West Virginia WV,Wisconsin WI,Wyoming WY,Puerto Rico PR'
  .split(',').map((x) => [x.slice(0, -3), x.slice(-2)]));
// Address suggestions as you type: pick one to fill the whole address.
// Uses Photon (OpenStreetMap data, free, no account); only the typed text is sent.
function addressSuggest(input) {
  if (!input || input.dataset.suggest) return;
  input.dataset.suggest = '1';
  input.setAttribute('autocomplete', 'street-address');
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-expanded', 'false');
  const list = document.createElement('div');
  list.className = 'addr-list'; list.setAttribute('role', 'listbox'); list.hidden = true;
  input.parentElement.style.position = 'relative';
  input.after(list);
  let timer, items = [], at = -1, seq = 0;
  const fmt = (p) => [[p.housenumber, p.street || (p.type !== 'city' ? p.name : '')].filter(Boolean).join(' '), p.city || p.town || p.village || p.county, [(p.countrycode === 'US' && US_STATES[p.state]) || p.state, p.postcode].filter(Boolean).join(' '), p.countrycode && p.countrycode !== 'US' ? p.country : '']
    .filter(Boolean).join(', ');
  const close = () => { list.hidden = true; at = -1; input.setAttribute('aria-expanded', 'false'); };
  const pick = (i) => { if (!items[i]) return; input.value = items[i]; close(); input.dispatchEvent(new Event('input', { bubbles: true })); };
  const show = () => {
    list.innerHTML = items.map((t, i) => `<div role="option" class="addr-opt ${i === at ? 'on' : ''}" data-i="${i}" aria-selected="${i === at}">${icon('globe')}<span>${esc(t)}</span></div>`).join('') + '<div class="addr-src">Addresses from OpenStreetMap</div>';
    list.hidden = !items.length; input.setAttribute('aria-expanded', String(!list.hidden));
  };
  input.addEventListener('input', (e) => {
    if (!e.isTrusted) return;
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 4) { items = []; close(); return; }
    timer = setTimeout(async () => {
      const mine = ++seq;
      try {
        const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5&lang=en&lat=39.5&lon=-98.35`);
        const j = await r.json();
        if (mine !== seq) return;
        items = [...new Set((j.features || []).map((f) => fmt(f.properties)).filter((t) => /\d/.test(t) || t.includes(',')))].slice(0, 5);
        at = -1; show();
      } catch { /* suggestions are optional */ }
    }, 280);
  });
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { at = Math.min(items.length - 1, at + 1); show(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { at = Math.max(0, at - 1); show(); e.preventDefault(); }
    else if (e.key === 'Enter' && at >= 0) { pick(at); e.preventDefault(); }
    else if (e.key === 'Escape') close();
  });
  list.addEventListener('mousedown', (e) => { const o = e.target.closest('[data-i]'); if (o) { e.preventDefault(); pick(Number(o.dataset.i)); } });
  input.addEventListener('blur', () => setTimeout(close, 150));
}

// The phone's Back button (or swipe) closes an open popup instead of leaving
// the page. Opening a popup (.modal-bg) adds a history step with the same
// address. Closing it with a button takes that step back off, unless the app
// has already moved on to another page; a leftover step is skipped later.
(() => {
  let open = 0, skip = 0;
  new MutationObserver(() => {
    const n = $$('.modal-bg').length;
    for (; open < n; open++) history.pushState({ rillyModal: true }, '', location.href);
    if (open > n) {
      open = n;
      setTimeout(() => { if (history.state?.rillyModal && $$('.modal-bg').length < 1) { skip++; history.back(); } }, 0);
    }
  }).observe(document.body, { childList: true });
  addEventListener('popstate', (e) => {
    if (skip) { skip--; e.stopImmediatePropagation(); return; }
    const top = $$('.modal-bg').pop();
    if (top) { e.stopImmediatePropagation(); const x = $('[data-x]', top); if (x) x.click(); else top.remove(); return; }
    if (e.state?.rillyModal) history.back(); // a leftover popup step: keep going back
  }, true);
})();

// ⋯ More: rarely used actions in one small menu. Each item clicks a hidden
// button that keeps its usual handler, so nothing behaves differently.
function bindMoreMenus(root = document) {
  $$('[data-more]', root).forEach((btn) => {
    btn.setAttribute('aria-haspopup', 'menu'); btn.setAttribute('aria-expanded', 'false');
    btn.onclick = (e) => {
      e.stopPropagation();
      const menu = btn.nextElementSibling;
      const open = menu.hidden;
      $$('.more-menu').forEach((m) => { m.hidden = true; });
      menu.hidden = !open; btn.setAttribute('aria-expanded', String(open));
      if (open) { $('button, a', menu)?.focus(); setTimeout(() => addEventListener('pointerdown', function off(ev) { if (!menu.contains(ev.target) && ev.target !== btn) { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); removeEventListener('pointerdown', off, true); } }, true)); }
    };
    btn.nextElementSibling.addEventListener('click', (e) => { if (e.target.closest('button, a')) { btn.nextElementSibling.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
    btn.nextElementSibling.addEventListener('keydown', (e) => { if (e.key === 'Escape') { btn.nextElementSibling.hidden = true; btn.focus(); } });
  });
}
const moreMenu = (items) => `<span class="more-wrap"><button type="button" class="btn icon" data-more aria-label="More actions" title="More">${icon('more')}</button>
  <span class="more-menu nodemenu" role="menu" hidden>${items}</span></span>`;

const fmtDate = (s) => (s ? new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const fullName = (c) => [c.first_name, c.last_name].filter(Boolean).join(' ');
const tagsHtml = (tags) => tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('');
const publicUrl = (path) => `${state.me.baseUrl}${path}`;

// Opens a modal containing a <form>. Resolves with the form's values on
// submit (after onSubmit succeeds), or null if cancelled.
function modal(title, inner, { submit = 'Save', onSubmit, danger } = {}) {
  return new Promise((resolve) => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<form class="modal"><h2>${esc(title)}</h2>${inner}<div class="err"></div>
      <div class="actions"><button type="button" class="btn" data-x>Cancel</button>
      <button class="btn ${danger ? 'danger' : 'primary'}">${esc(submit)}</button></div></form>`;
    document.body.append(bg);
    const form = $('form', bg);
    const close = (v) => { bg.remove(); resolve(v); };
    bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(null); });
    $('[data-x]', bg).onclick = () => close(null);
    form.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(null); });
    form.onsubmit = async (e) => {
      e.preventDefault();
      const values = Object.fromEntries(new FormData(form));
      $$('input[type=checkbox]', form).forEach((c) => { values[c.name] = c.checked; });
      try {
        const result = onSubmit ? await onSubmit(values) : values;
        close(result ?? values);
      } catch (err) { $('.err', bg).textContent = err.message; }
    };
    $('input, textarea, select', form)?.focus();
  });
}
const confirmBox = (title, text, submit = 'Delete') => modal(title, `<p class="muted">${esc(text)}</p>`, { submit, danger: true });

// Kinds of business (mirrors src/business.js): sets starting follow-ups,
// whether there's a deals board, and which sections show. Changeable in Settings.
const BUSINESS_TYPES_UI = [
  ['shop', 'Shop or maker'], ['services', 'Services (trades, consulting, agency)'], ['coach', 'Coach, course or creator'],
  ['local', 'Local business (restaurant, salon, studio)'], ['nonprofit', 'Nonprofit or community'], ['other', 'Something else'],
];
const BUSINESS_OPTIONS = BUSINESS_TYPES_UI.map(([k, l]) => `<option value="${k}">${l}</option>`).join('');

// ---------------- Auth ----------------
// Single owner. A new install asks the owner to set up; after that, sign in
// with an emailed link (or a password, if one was set).
async function renderAuth(mode) {
  let status = { hasOwner: true };
  try { status = await api('GET', '/api/auth/status'); } catch { /* offline: show sign in */ }
  mode = mode || (status.hasOwner ? 'link' : 'setup');
  const setup = mode === 'setup';
  app.innerHTML = `<div class="auth"><form class="card">
    <div class="logo">${LOGO_INK}</div>
    <p class="tagline">${TAGLINE}</p>
    <h1>${setup ? 'Set up your marketing home' : 'Welcome back'}</h1>
    <p class="muted">${setup ? 'One owner, about an hour a week. You’ll sign in with a link sent to this email.'
      : mode === 'link' ? 'We’ll email you a link to sign in. No password needed.' : 'Sign in with your password.'}</p>
    ${setup ? `<label class="f">Your name<input name="name" required autocomplete="name"></label>
      <label class="f">Business name <span class="hint">(optional)</span><input name="workspace"></label>
      <label class="f">What kind of business?<select name="business_type">${BUSINESS_OPTIONS}</select></label>` : ''}
    <label class="f">Email<input name="email" type="email" required autocomplete="email"></label>
    ${mode === 'password' ? '<label class="f">Password<input name="password" type="password" required autocomplete="current-password"></label>' : ''}
    ${setup ? '<label class="f">Password <span class="hint">(optional, a backup to email links)</span><input name="password" type="password" minlength="8" autocomplete="new-password"></label>' : ''}
    <div class="err"></div><div data-sent></div>
    <button class="btn primary" style="width:100%;justify-content:center;padding:11px">${setup ? 'Create my workspace' : mode === 'link' ? 'Email me a sign-in link' : 'Sign in'}</button>
    ${setup ? '' : `<p class="muted small" style="text-align:center;margin-bottom:0"><a href="#" data-switch>${mode === 'link' ? 'Use a password instead' : 'Email me a link instead'}</a></p>`}
    ${status.signupOpen && !setup ? '<p class="muted small" style="text-align:center;margin:6px 0 0"><a href="#" data-setup>Create a new workspace</a></p>' : ''}
  </form></div>`;
  const sw = $('[data-switch]'); if (sw) sw.onclick = (e) => { e.preventDefault(); renderAuth(mode === 'link' ? 'password' : 'link'); };
  const su = $('[data-setup]'); if (su) su.onclick = (e) => { e.preventDefault(); renderAuth('setup'); };
  $('form').onsubmit = async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(e.target));
    $('.err').textContent = '';
    try {
      if (mode === 'link') {
        const r = await api('POST', '/api/auth/magic', { email: v.email });
        $('[data-sent]').innerHTML = `<div class="banner" style="background:#ecfdf5;border-color:#a7f3d0;color:#065f46">
          If <b>${esc(v.email)}</b> belongs to this app, a sign-in link is on its way. It works once, for 15 minutes.
          ${r.devLink ? `<br><br><b>Dev mode</b> (no email provider): <a href="${esc(r.devLink)}">open the sign-in link</a>` : ''}</div>`;
        return;
      }
      if (!v.password) delete v.password;
      await api('POST', `/api/auth/${setup ? 'signup' : 'login'}`, v);
      state.me = await api('GET', '/api/me');
      location.hash = setup ? '#/setup' : '#/';
      route();
    } catch (err) { $('.err').textContent = err.message; }
  };
}

// ---------------- Shell ----------------
const BRAND = 'Rilly';
const TAGLINE = 'Simple Marketing.';
// Four squares, one per growth lever: lead gen, conversion, upsell, continuity.
// Rilly lockups (public/brand): white text on the dark sidebar, ink text on light pages.
const LOGO = '<img class="lockup" src="/brand/rilly-lockup-white.svg" alt="Rilly" width="96" height="33"><img class="mark" src="/brand/rilly-icon.svg" alt="Rilly" width="26" height="26">';
const LOGO_INK = '<img class="lockup" src="/brand/rilly-lockup-ink.svg" alt="Rilly" width="102" height="35">';
const NAV = [
  ['', icon('dashboard'), 'Dashboard'],
  ['inbox', icon('chat'), 'Inbox'],
  ['flows', icon('branch'), 'Flows'],
  ['people', icon('people'), 'People'],
  ['calendar', icon('calendar'), 'Calendar'],
  ['products', icon('bag'), 'Products'],
  ['email', icon('mail'), 'Email'],
  ['settings', icon('gear'), 'Settings'],
];

// Pages, pageflows, websites, members areas and workflows all live under Flows.
const FLOW_SECTIONS = ['flows', 'pages', 'workflows', 'funnels', 'websites', 'members'];
// Sections shown under another menu item (Deals is a board inside People).
const NAV_HOME = { pipelines: 'people' };
function shell(section, html) {
  const initials = (n) => n.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  app.innerHTML = `<div class="shell">
    <aside class="sidebar">
      <div class="logo">${LOGO}</div>
      <div class="acct-wrap"><button class="acct" data-acct aria-haspopup="menu" aria-expanded="false" title="Switch sub-account">
        <span class="av">${esc(initials(state.me.account.name))}</span><span class="nm">${esc(state.me.account.name)}</span><span class="car">${icon('chevronDown')}</span></button></div>
      <nav class="nav">${NAV.filter(([k]) => !(state.me.account.hidden_sections || []).includes(k)).map(([k, i, l]) => `<a href="#/${k}" class="${(FLOW_SECTIONS.includes(section) ? 'flows' : NAV_HOME[section] || section) === k ? 'active' : ''}"><span class="ico">${i}</span>${l}${k === 'inbox' ? '<span class="nav-badge" data-unread hidden></span>' : ''}</a>`).join('')}</nav>
      <div class="foot"><div class="muted">${esc(state.me.user.email)}</div><button data-logout>Sign out</button></div>
    </aside>
    <main class="main">${html}</main></div>`;
  $('[data-logout]').onclick = logout;
  refreshUnread();
  $('[data-acct]').onclick = (e) => { e.stopPropagation(); accountMenu(e.currentTarget); };
}
async function logout() { await api('POST', '/api/auth/logout'); state.me = null; renderAuth(); }

// Sub-account switcher: every business you run, plus quick create.
function accountMenu(btn) {
  const open = $('.acct-menu');
  if (open) { open.remove(); btn.setAttribute('aria-expanded', 'false'); return; }
  const menu = document.createElement('div');
  menu.className = 'acct-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = `<div class="muted small" style="padding:6px 10px">Sub-accounts</div>
    ${state.me.accounts.map((a) => `<button role="menuitem" data-switch-to="${a.id}" class="${a.id === state.me.account.id ? 'on' : ''}">
      <span>${esc(a.name)}</span>${a.id === state.me.account.id ? '<span>' + icon('check') + '</span>' : ''}</button>`).join('')}
    <hr><button role="menuitem" data-new-acct>${icon('plus')} New sub-account</button><button role="menuitem" data-manage>Manage sub-accounts</button>
    <button role="menuitem" class="mobile-only" data-logout2>Sign out</button>`;
  btn.parentNode.append(menu);
  btn.setAttribute('aria-expanded', 'true');
  const close = () => { menu.remove(); btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('click', close); };
  setTimeout(() => document.addEventListener('click', close));
  menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { close(); btn.focus(); } });
  $$('[data-switch-to]', menu).forEach((b) => { b.onclick = () => switchAccount(Number(b.dataset.switchTo)); });
  $('[data-new-acct]', menu).onclick = () => newSubAccount();
  $('[data-manage]', menu).onclick = () => { location.hash = '#/settings'; };
  $('[data-logout2]', menu).onclick = logout;
  $('button', menu)?.focus();
}
async function switchAccount(accountId) {
  if (accountId === state.me.account.id) return;
  await api('POST', `/api/accounts/${accountId}/switch`);
  state.me = await api('GET', '/api/me');
  if (typeof dash !== 'undefined') dash.data = {};
  toast(`Switched to ${state.me.account.name}`);
  location.hash = '#/';
  route();
}
async function newSubAccount() {
  const r = await modal('New sub-account', `<p class="muted small">A separate workspace for another business: its own people, pageflows, emails and dashboard. No limit on how many.</p>
    <label class="f">Business name<input name="name" required placeholder="e.g. Corner Bakery"></label>
    <label class="f">What kind of business?<select name="business_type">${BUSINESS_OPTIONS}</select></label>`,
  { submit: 'Create and switch', onSubmit: (v) => api('POST', '/api/accounts', { ...v, switch: true }) });
  if (r) { state.me = await api('GET', '/api/me'); toast(`Created ${state.me.account.name}`); location.hash = '#/'; route(); }
}

// Photo upload: pictures are shrunk in the browser (longest side 2000px)
// before sending, so even big phone photos upload quickly. GIFs are sent as
// they are to keep any animation.
async function uploadImage(file) {
  if (!file || !/^image\/(jpeg|png|webp|gif)$/.test(file.type)) throw new Error('Use a JPG, PNG, WebP or GIF picture');
  let blob = file;
  if (file.type !== 'image/gif') {
    const img = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
    const out = await new Promise((r) => canvas.toBlob(r, type, 0.86));
    if (out && out.size < file.size) blob = out; // keep the original if it was already smaller
  }
  if (blob.size > 4 * 1024 * 1024) throw new Error('That picture is too big (over 4 MB), even after shrinking');
  const res = await fetch('/api/uploads', { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  return data.url;
}
