/* Fourfold dashboard: a small hash-routed single-page app, no build step.
   Files load in order (see index.html); this one holds shared helpers. */
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');
const state = { me: null };

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (res.status === 401 && !url.startsWith('/api/auth')) { state.me = null; renderAuth(); throw new Error('Please sign in'); }
  if (!res.ok) throw new Error(data.error || 'Request failed');
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

// ---------------- Auth ----------------
// Single owner. A new install asks the owner to set up; after that, sign in
// with an emailed link (or a password, if one was set).
async function renderAuth(mode) {
  let status = { hasOwner: true };
  try { status = await api('GET', '/api/auth/status'); } catch { /* offline: show sign in */ }
  mode = mode || (status.hasOwner ? 'link' : 'setup');
  const setup = mode === 'setup';
  app.innerHTML = `<div class="auth"><form class="card">
    <div class="logo">${LOGO}${BRAND}</div>
    <h1>${setup ? 'Set up your marketing home' : 'Welcome back'}</h1>
    <p class="muted">${setup ? 'One owner, about an hour a week. You’ll sign in with a link sent to this email.'
      : mode === 'link' ? 'We’ll email you a link to sign in. No password needed.' : 'Sign in with your password.'}</p>
    ${setup ? `<label class="f">Your name<input name="name" required autocomplete="name"></label>
      <label class="f">Business name <span class="hint">(optional)</span><input name="workspace"></label>` : ''}
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
      location.hash = '#/';
      route();
    } catch (err) { $('.err').textContent = err.message; }
  };
}

// ---------------- Shell ----------------
const BRAND = 'Fourfold';
// Four squares, one per growth lever: lead gen, conversion, upsell, continuity.
const LOGO = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="3" width="12" height="12" rx="3.5" fill="#0ea5e9"/><rect x="17" y="3" width="12" height="12" rx="3.5" fill="#8b5cf6"/><rect x="3" y="17" width="12" height="12" rx="3.5" fill="#f59e0b"/><rect x="17" y="17" width="12" height="12" rx="3.5" fill="#10b981"/></svg>';
const NAV = [
  ['', '📊', 'Dashboard'],
  ['funnels', '🧲', 'Funnels'],
  ['people', '👥', 'People'],
  ['pipelines', '📈', 'Pipelines'],
  ['products', '🛒', 'Products'],
  ['email', '✉️', 'Email'],
  ['settings', '⚙️', 'Settings'],
];

function shell(section, html) {
  app.innerHTML = `<div class="shell">
    <aside class="sidebar">
      <div class="logo">${LOGO}${BRAND}</div>
      <nav class="nav">${NAV.map(([k, i, l]) => `<a href="#/${k}" class="${section === k ? 'active' : ''}"><span class="ico">${i}</span>${l}</a>`).join('')}</nav>
      <div class="foot"><div style="color:#fff">${esc(state.me.account.name)}</div>
        <div class="muted">${esc(state.me.user.email)}</div><button data-logout>Sign out</button></div>
    </aside>
    <main class="main">${html}</main></div>`;
  $('[data-logout]').onclick = async () => { await api('POST', '/api/auth/logout'); state.me = null; renderAuth(); };
}
