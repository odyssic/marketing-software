/* FunnelFlow dashboard: a small hash-routed single-page app, no build step. */
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
    <div class="logo">${LOGO}FunnelFlow</div>
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
const LOGO = '<svg viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#4f46e5"/><path d="M8 9h16l-6 8v6l-4 2v-8z" fill="#fff"/></svg>';
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
      <div class="logo">${LOGO}FunnelFlow</div>
      <nav class="nav">${NAV.map(([k, i, l]) => `<a href="#/${k}" class="${section === k ? 'active' : ''}"><span class="ico">${i}</span>${l}</a>`).join('')}</nav>
      <div class="foot"><div style="color:#fff">${esc(state.me.account.name)}</div>
        <div class="muted">${esc(state.me.user.email)}</div><button data-logout>Sign out</button></div>
    </aside>
    <main class="main">${html}</main></div>`;
  $('[data-logout]').onclick = async () => { await api('POST', '/api/auth/logout'); state.me = null; renderAuth(); };
}

// ---------------- Dashboard ----------------
// A calm grid of tiles, one saved layout per lever. Editing controls only
// appear in Customize mode; drag uses pointer events so it works on touch.
const LEVER_UI = {
  all: { label: 'All four', color: '#111827' },
  lead: { label: 'Lead gen', color: '#0ea5e9' },
  conversion: { label: 'Conversion', color: '#8b5cf6' },
  upsell: { label: 'Upsell', color: '#f59e0b' },
  continuity: { label: 'Continuity', color: '#10b981' },
};
const dash = { lever: localStorage.getItem('dashLever') || 'all', customize: false, layouts: {}, catalog: [], data: {}, levers: null };

async function viewDashboard() {
  const keys = Object.keys(LEVER_UI);
  // All five layouts load up front, so switching levers is instant.
  const [levers, ...layouts] = await Promise.all([api('GET', '/api/levers'), ...keys.map((k) => api('GET', `/api/layouts/${k}`))]);
  dash.levers = levers;
  keys.forEach((k, i) => { dash.layouts[k] = layouts[i].tiles; });
  dash.catalog = layouts[0].catalog;
  dash.data = {};
  dash.customize = false;
  if (!LEVER_UI[dash.lever]) dash.lever = 'all';
  renderDashboard();
}

function renderDashboard() {
  const lv = dash.lever, tiles = dash.layouts[lv];
  const focus = dash.levers.focus;
  const meta = (id) => dash.catalog.find((t) => t.id === id);
  shell('', `
    <div class="head"><div><h1>Hi ${esc(state.me.user.name.split(' ')[0])} 👋</h1>
      <div class="muted">${esc(state.me.account.name)} · focus this week: <b style="color:${LEVER_UI[focus].color}">${esc(LEVER_UI[focus].label)}</b>${dash.levers.pinned ? ' (pinned)' : ''}</div></div>
      <button class="btn ${dash.customize ? 'primary' : ''}" data-customize>${dash.customize ? 'Done' : '⚙ Customize'}</button></div>
    <div class="leverbar" role="tablist">${Object.entries(LEVER_UI).map(([k, l]) => `<button role="tab" aria-selected="${k === lv}" data-lever="${k}" style="--c:${l.color}" class="${k === lv ? 'on' : ''}"><i class="dot"></i>
      ${k !== 'all' && dash.levers.levers[k]?.score !== null && dash.levers.levers[k]?.score !== undefined ? `<span class="sc">${dash.levers.levers[k].score}</span>` : ''}${esc(l.label)}${k === focus ? ' <span class="focus-dot" title="Focus here">●</span>' : ''}</button>`).join('')}</div>
    ${dash.customize ? `<div class="tray"><span class="muted small">Hidden tiles:</span>
      ${tiles.filter((t) => t.hidden).map((t) => `<button class="chip" data-restore="${t.tile_id}">＋ ${esc(meta(t.tile_id)?.title || t.tile_id)}</button>`).join('') || '<span class="muted small">none. Hide a tile with ✕ to park it here.</span>'}</div>` : ''}
    <div class="tiles ${dash.customize ? 'editing' : ''}" style="--lever:${lv === 'all' ? 'var(--brand)' : LEVER_UI[lv].color}">
      ${tiles.filter((t) => !t.hidden).map((t) => `<section class="tile ${t.width}" data-tile="${t.tile_id}">
        <header><h2>${esc(meta(t.tile_id)?.title || t.tile_id)}</h2>
          ${dash.customize ? `<div class="tctl"><button class="handle" title="Drag to move" aria-label="Drag to move">⠿</button>
            <button data-width title="Change width">${t.width === 'full' ? '½' : '↔'}</button><button data-hide title="Hide">✕</button></div>` : ''}</header>
        <div class="tbody"><div class="skeleton"></div></div></section>`).join('')}
    </div>`);

  $$('[data-lever]').forEach((b) => { b.onclick = () => switchLever(b.dataset.lever); });
  $('[data-customize]').onclick = async () => {
    if (dash.customize) {
      // Save on Done.
      const r = await api('PUT', `/api/layouts/${lv}`, { tiles: dash.layouts[lv] });
      dash.layouts[lv] = r.tiles;
      toast('Layout saved');
    }
    dash.customize = !dash.customize;
    renderDashboard();
  };
  if (dash.customize) bindCustomize();
  fillTiles();
}

function switchLever(k) {
  if (dash.customize) { toast('Press Done to save this layout first'); return; }
  dash.lever = k;
  localStorage.setItem('dashLever', k);
  renderDashboard();
}

async function fillTiles() {
  const lv = dash.lever;
  const visible = dash.layouts[lv].filter((t) => !t.hidden).map((t) => t.tile_id);
  const key = (id) => (id === 'move' ? `move:${lv}` : id);
  const missing = visible.filter((id) => !(key(id) in dash.data));
  if (missing.length) {
    const got = await api('GET', `/api/tiles?lever=${lv}&ids=${missing.join(',')}`);
    for (const [id, v] of Object.entries(got)) dash.data[key(id)] = v;
  }
  if (dash.lever !== lv) return;
  for (const id of visible) {
    const el = $(`[data-tile="${id}"] .tbody`);
    if (el) { el.innerHTML = renderTile(id, dash.data[key(id)]); bindTile(id, el); }
  }
}

// ---- Tile renderers: one big number with a change line, a small bar set, or the flow strip.
const bigNumber = (d) => `<div class="big-n">${esc(d.value)}</div>
  ${d.sub ? `<div class="muted small">${esc(d.sub)}</div>` : ''}
  ${d.change ? `<div class="chg ${d.change.dir}">${d.change.dir === 'up' ? '▲' : d.change.dir === 'down' ? '▼' : '■'} ${esc(d.change.text)}</div>` : ''}`;
const columnBars = (bars) => {
  const max = Math.max(1, ...bars.map((b) => b.n));
  return `<div class="cbars">${bars.map((b) => `<div title="${esc(b.label)}: ${esc(b.value ?? String(b.n))}" style="height:${Math.max(4, (b.n / max) * 100)}%"></div>`).join('')}</div>`;
};
const rowBars = (bars) => {
  const max = Math.max(1, ...bars.map((b) => b.n));
  return `<div class="rbars">${bars.map((b) => `<${b.href ? `a href="${esc(b.href)}"` : 'div'} class="rb"><span class="l">${esc(b.label)}</span>
    <span class="track"><span style="width:${(b.n / max) * 100}%"></span></span><span class="v">${esc(b.value ?? String(b.n))}</span></${b.href ? 'a' : 'div'}>`).join('')}</div>`;
};
const FLOW = [['audience', 'Audience'], ['lead', 'Leads'], ['customer', 'Customers'], ['regular', 'Regulars']];
const FLOW_ARROWS = [['lead', 'audience', 'lead'], ['conversion', 'lead', 'customer'], ['continuity', 'customer', 'regular']];
function flowStrip(counts, lever) {
  const on = (stage) => lever === 'all' || (lever === 'upsell' ? stage === 'customer' : FLOW_ARROWS.some(([l, a, b]) => l === lever && (stage === a || stage === b)));
  return `<div class="flow">${FLOW.map(([k, l], i) => {
    const arrow = FLOW_ARROWS[i - 1];
    return `${arrow ? `<div class="farrow ${lever === 'all' || lever === arrow[0] ? 'on' : ''}" style="--c:${LEVER_UI[arrow[0]].color}"><span>${esc(LEVER_UI[arrow[0]].label)}</span>→</div>` : ''}
      <div class="fstage ${k} ${on(k) ? 'on' : 'dim'}"><b>${counts[k]}</b>${l}${k === 'customer' ? `<span class="loop ${lever === 'all' || lever === 'upsell' ? 'on' : ''}" title="Upsell happens within an order">↻ Upsell</span>` : ''}</div>`;
  }).join('')}</div>`;
}

function renderTile(id, t) {
  if (!t) return '<div class="skeleton"></div>';
  const d = t.data;
  if (t.error) return `<p class="muted">${esc(t.error)}</p>`;
  if (id === 'health') return healthTile(d);
  if (!d) return `<p class="empty-line">${esc(t.empty_state)}</p>`;
  switch (id) {
    case 'move': return moveTile(d);
    case 'flow': return flowStrip(d, dash.lever);
    case 'revenue': case 'listens': case 'signups': return `<div class="nb"><div>${bigNumber(d)}</div>${d.bars ? columnBars(d.bars) : ''}</div>`;
    case 'subscribers': case 'pipeline': return `<div class="nb"><div>${bigNumber(d)}</div>${d.bars ? rowBars(d.bars) : '<div></div>'}</div>`;
    case 'inquiries': return `${bigNumber({ ...d, change: null })}<div class="${d.warn ? 'warnline' : ''}"></div>
      ${d.people.map((p) => `<a class="li" href="#/people/${p.id}"><span>${esc(p.name)}</span><span class="pill ${p.days >= 14 ? 'warn' : ''}">${p.days}d waiting</span></a>`).join('')}`;
    case 'sources': return `<div class="seg" data-seg><button class="on" data-mode="first">First source</button><button data-mode="last">Last touch</button></div>
      <div data-bars>${rowBars(d.first)}</div>`;
    case 'funnels': return rowBars(d.bars);
    default: return `<pre>${esc(JSON.stringify(d))}</pre>`;
  }
}

function healthTile(d) {
  if (!d) return '';
  const levers = d.levers;
  return `<div class="health">${['lead', 'conversion', 'upsell', 'continuity'].map((k) => {
    const l = levers[k];
    return `<button class="hcard ${k === d.focus ? 'focus' : ''}" data-golever="${k}" style="--c:${LEVER_UI[k].color}">
      <div class="row" style="justify-content:space-between"><b>${esc(l.label)}</b>${k === d.focus ? '<span class="badge">Focus here</span>' : ''}</div>
      <div class="hbar"><span style="width:${l.score ?? 0}%"></span></div>
      <div class="row" style="justify-content:space-between"><span class="score">${l.score ?? '—'}<small>/100</small></span><span class="muted small">${esc(l.valueLabel)}</span></div>
      <div class="muted small">${esc(l.score === null ? 'Not enough data yet' : l.metric)}${l.changeLabel ? ` · ${esc(l.changeLabel)}` : ''}</div></button>`;
  }).join('')}</div>`;
}

function moveTile(m) {
  return `<div class="move" style="--c:${LEVER_UI[m.lever]?.color || 'var(--brand)'}">
    <div class="ml"><span class="lever-tag">${esc(LEVER_UI[m.lever]?.label || m.lever)}</span>
      <h3>${esc(m.title)}</h3><p class="muted">${esc(m.reason)}</p>
      ${m.count ? `<p class="small"><b>${m.count}</b> ${m.count === 1 ? 'person' : 'people'}: ${m.people.slice(0, 5).map((p) => `<a href="#/people/${p.id}">${esc(p.name)}</a>`).join(', ')}${m.count > 5 ? ` and ${m.count - 5} more` : ''}</p>` : ''}</div>
    <div class="mr">${m.campaign_id ? `<a class="btn primary" href="#/campaigns/${m.campaign_id}">${m.status === 'sent' ? 'View results' : 'Open draft'}</a>` : `<button class="btn primary" data-draft>✍️ Draft it</button>`}
      <button class="btn sm" data-skipmove>Skip this week</button></div></div>`;
}

function bindTile(id, el) {
  if (id === 'health') $$('[data-golever]', el).forEach((b) => { b.onclick = () => switchLever(b.dataset.golever); });
  if (id === 'sources') {
    const d = dash.data.sources.data;
    $$('[data-mode]', el).forEach((b) => { b.onclick = () => {
      $$('[data-mode]', el).forEach((x) => x.classList.toggle('on', x === b));
      $('[data-bars]', el).innerHTML = rowBars(d[b.dataset.mode]);
    }; });
  }
  if (id === 'move' && typeof bindMoveTile === 'function') bindMoveTile(el, dash.data[`move:${dash.lever}`]?.data);
}

function bindCustomize() {
  const lv = dash.lever;
  const grid = $('.tiles');
  const layout = () => dash.layouts[lv];
  const syncOrder = () => {
    const shown = $$('.tile', grid).map((t) => t.dataset.tile);
    const hidden = layout().filter((t) => t.hidden);
    dash.layouts[lv] = [...shown.map((id) => layout().find((t) => t.tile_id === id)), ...hidden].map((t, i) => ({ ...t, order: i }));
  };
  $$('[data-restore]').forEach((b) => { b.onclick = () => {
    // Restored tiles keep their width and settings.
    dash.layouts[lv] = layout().map((t) => (t.tile_id === b.dataset.restore ? { ...t, hidden: false } : t));
    renderDashboard();
  }; });
  $$('.tile', grid).forEach((tile) => {
    const tid = tile.dataset.tile;
    $('[data-hide]', tile).onclick = () => { syncOrder(); dash.layouts[lv] = layout().map((t) => (t.tile_id === tid ? { ...t, hidden: true } : t)); renderDashboard(); };
    $('[data-width]', tile).onclick = () => { syncOrder(); dash.layouts[lv] = layout().map((t) => (t.tile_id === tid ? { ...t, width: t.width === 'full' ? 'half' : 'full' } : t)); renderDashboard(); };
    $('.handle', tile).addEventListener('pointerdown', (e) => {
      e.preventDefault();
      tile.classList.add('dragging');
      const move = (ev) => {
        const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.tile');
        if (!over || over === tile || over.parentNode !== grid) return;
        const all = $$('.tile', grid);
        // Tiles swap places as the pointer crosses them.
        if (all.indexOf(tile) < all.indexOf(over)) over.after(tile); else over.before(tile);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        tile.classList.remove('dragging');
        syncOrder();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up, { once: true });
      window.addEventListener('pointercancel', up, { once: true });
    });
  });
}

const stat = (label, value, sub) => `<div class="card stat"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
const bindRowLinks = () => $$('[data-go]').forEach((r) => { r.onclick = () => { location.hash = r.dataset.go; }; });

// ---------------- Funnels ----------------
async function viewFunnels() {
  const funnels = await api('GET', '/api/funnels');
  shell('funnels', `
    <div class="head"><div><h1>Funnels</h1><div class="muted">Landing pages that turn visitors into contacts.</div></div>
      <button class="btn primary" data-new>+ New funnel</button></div>
    ${funnels.length ? `<div class="card table-wrap"><table>
      <tr><th>Name</th><th>Pages</th><th>Views</th><th>Opt-ins</th><th>Conversion</th><th>Created</th></tr>
      ${funnels.map((f) => `<tr class="click" data-go="#/funnels/${f.id}"><td><strong>${esc(f.name)}</strong><div class="muted small">/f/${esc(f.slug)}</div></td>
        <td>${f.steps}</td><td>${f.views}</td><td>${f.optins}</td><td>${f.views ? Math.round((f.optins / f.views) * 1000) / 10 : 0}%</td><td>${fmtDate(f.created_at)}</td></tr>`).join('')}
    </table></div>` : `<div class="card empty"><div class="big">🧲</div><h2>No funnels yet</h2>
      <p>Pick a template and you’ll have a live page in under a minute.</p><button class="btn primary" data-new>Create your first funnel</button></div>`}`);
  bindRowLinks();
  $$('[data-new]').forEach((b) => { b.onclick = newFunnel; });
}

async function newFunnel() {
  const templates = await api('GET', '/api/templates');
  const r = await modal('New funnel', `
    <label class="f">Funnel name<input name="name" required placeholder="e.g. Free guide"></label>
    <label class="f">Start from<select name="template">${templates.map((t) => `<option value="${t.key}">${esc(t.label)}</option>`).join('')}</select></label>`,
  { submit: 'Create funnel', onSubmit: (v) => api('POST', '/api/funnels', v) });
  if (r) { toast('Funnel created'); location.hash = `#/funnels/${r.id}`; } else if (location.hash === '#/funnels/new') location.hash = '#/funnels';
}

// ---------------- Funnel map (visual tree) ----------------
// Each page is a card on a pannable canvas. Cards have two exits: "yes"
// (form submitted, purchase, Next button) and "no" ("No thanks" button).
// Drag from an exit onto a card to link them, or into empty space to create
// the next page right there.
const NODE_W = 230;
const COL_GAP = 60;
const ROW_GAP = 120;
const PORTS = { yes: { key: 'next_step_id', at: 0.27, label: '✓ Yes / Next' }, no: { key: 'no_step_id', at: 0.75, label: '✕ No thanks' } };

// Lays the funnel out top-down as a tree. A page sits one row below the
// deepest page that leads to it, so shared pages (e.g. one Thank-you page
// reached from both an upsell and a downsell) go below all of their parents.
function tidyLayout(steps, entryId) {
  const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
  const kids = (id) => [...new Set(['next_step_id', 'no_step_id'].map((k) => byId[id][k]))].filter((k) => byId[k]);
  const roots = [entryId, ...steps.map((s) => s.id)].filter((id, i, a) => byId[id] && a.indexOf(id) === i);
  const depth = {};
  const owner = {};
  // Longest-path depth, ignoring links that loop back to an earlier page.
  const walk = (id, d, parent, stack) => {
    if (stack.has(id) || (depth[id] !== undefined && depth[id] >= d)) return;
    depth[id] = d;
    owner[id] = parent;
    stack.add(id);
    for (const k of kids(id)) walk(k, d + 1, id, stack);
    stack.delete(id);
  };
  for (const r of roots) if (depth[r] === undefined) walk(r, 0, null, new Set());
  const pos = {};
  let leaf = 0;
  const place = (id) => {
    const all = kids(id);
    const owned = all.filter((k) => owner[k] === id && !pos[k]);
    let col;
    if (all.length === 2 && owned.length === 1) {
      // One exit leads further down the tree (placed under another page), so
      // give this page its own column and step the other branch to the side:
      // "no" branches go right, "yes" branches go left.
      if (owned[0] === byId[id].no_step_id) { col = leaf++; place(owned[0]); } else { place(owned[0]); col = leaf++; }
    } else {
      const cols = owned.map(place);
      col = cols.length ? (Math.min(...cols) + Math.max(...cols)) / 2 : leaf++;
    }
    pos[id] = { x: col * (NODE_W + COL_GAP), y: depth[id] * (150 + ROW_GAP) };
    return col;
  };
  for (const r of roots) if (!pos[r] && owner[r] === null) place(r);
  // Centre pages reached from several parents between those parents, moving
  // the pages hanging below them along, so links don't cut through cards.
  const shift = (id, dx) => {
    pos[id].x += dx;
    for (const k of kids(id)) if (owner[k] === id) shift(k, dx);
  };
  for (const id of Object.keys(pos).map(Number).sort((a, b) => depth[a] - depth[b])) {
    const parents = steps.filter((s) => s.id !== id && kids(s.id).includes(id) && depth[s.id] < depth[id]);
    if (parents.length > 1) shift(id, parents.reduce((n, s) => n + pos[s.id].x, 0) / parents.length - pos[id].x);
  }
  return pos;
}

async function viewFunnel(id) {
  const f = await api('GET', `/api/funnels/${id}`);
  const link = publicUrl(`/f/${f.slug}`);
  shell('funnels', `
    <div class="head" style="margin-bottom:14px"><div><a href="#/funnels" class="small">← All funnels</a><h1>${esc(f.name)}</h1></div>
      <div class="row"><div class="copy" style="min-width:320px"><input readonly value="${esc(link)}" aria-label="Funnel link">
        <button class="btn" data-copy="${esc(link)}">Copy</button><a class="btn" href="${esc(link)}" target="_blank" rel="noopener">Open ↗</a></div>
        <button class="btn" data-rename>Settings</button><button class="btn danger" data-del>Delete</button></div></div>
    <div class="map" tabindex="0">
      <div class="map-tools">
        <button class="btn primary sm" data-addpage>+ Add page</button>
        <button class="btn sm" data-tidy title="Arrange pages as a tidy tree">✨ Tidy up</button>
        <span class="sep"></span>
        <button class="btn sm icon" data-zoom="-1" title="Zoom out">−</button><span class="zoomlbl" data-zoomlbl>100%</span>
        <button class="btn sm icon" data-zoom="1" title="Zoom in">+</button><button class="btn sm" data-fit>Fit</button>
      </div>
      <div class="map-help">Drag cards to move them · Drag from <b class="y">✓ Yes</b> or <b class="n">✕ No</b> to connect or create a page · Drag the background to pan</div>
      <div class="world"><svg class="edges"></svg><div class="nodes"></div></div>
    </div>`);
  bindCopy();

  const m = { steps: f.steps, entry: f.entry_step_id, zoom: 1, panX: 40, panY: 40 };
  const mapEl = $('.map'), world = $('.world'), svg = $('.edges'), nodesEl = $('.nodes');
  const byId = () => Object.fromEntries(m.steps.map((s) => [s.id, s]));
  const save = (body) => api('PUT', `/api/funnels/${id}/map`, body).catch((err) => toast(err.message, true));
  const reload = () => viewFunnel(id);

  // First visit (or pages made before the map existed): lay out automatically.
  if (m.steps.some((s) => s.x === null || s.y === null)) {
    const pos = tidyLayout(m.steps, m.entry);
    m.steps.forEach((s) => Object.assign(s, pos[s.id]));
    save({ steps: m.steps.map((s) => ({ id: s.id, x: s.x, y: s.y })) });
  }

  const pageIcon = (s) => (s.blocks.some((b) => b.type === 'pricing') ? '💳' : s.blocks.some((b) => b.type === 'form') ? '✉️' : '📄');
  const pageKind = (s) => (s.blocks.some((b) => b.type === 'pricing') ? 'Sales page' : s.blocks.some((b) => b.type === 'form') ? 'Opt-in page' : 'Page');

  function renderNodes() {
    nodesEl.innerHTML = m.steps.map((s) => `
      <div class="node ${s.id === m.entry ? 'start' : ''}" data-node="${s.id}" style="left:${s.x}px;top:${s.y}px;width:${NODE_W}px">
        <div class="node-in" title="Visitors arrive here"></div>
        ${s.id === m.entry ? '<span class="startpill">▶ START</span>' : ''}
        <div class="nhead"><span class="nicon">${pageIcon(s)}</span><div style="min-width:0"><div class="nname">${esc(s.name)}</div>
          <div class="nkind">${pageKind(s)} · /${esc(s.slug)}</div></div>
          <button class="nmenu" data-menu="${s.id}" title="More">⋯</button></div>
        <div class="nstats"><span><b>${s.views}</b> views</span><span><b>${s.optins}</b> opt-ins</span><span><b>${s.sales}</b> sales</span></div>
        <div class="nact"><a class="btn sm primary" href="#/editor/${s.id}">Edit page</a>
          <a class="btn sm" href="${esc(publicUrl(`/f/${f.slug}/${s.slug}`))}" target="_blank" rel="noopener">View ↗</a></div>
        <div class="ports">${Object.entries(PORTS).map(([p, d]) => `<div class="port ${p} ${s[d.key] ? 'linked' : ''}" data-port="${p}" data-from="${s.id}"
          title="${s[d.key] ? 'Drag to change where this leads' : 'Drag to a page, or click to add the next page'}">${d.label}</div>`).join('')}</div>
      </div>`).join('') || `<div class="map-empty"><div class="big">🌱</div><p>Every funnel starts with one page.</p>
        <button class="btn primary" data-addpage>+ Add your first page</button></div>`;
    renderEdges();
  }

  const nodeEl = (sid) => $(`[data-node="${sid}"]`, nodesEl);
  const anchor = (s, port) => {
    const h = nodeEl(s.id)?.offsetHeight || 170;
    return port ? { x: s.x + NODE_W * PORTS[port].at, y: s.y + h } : { x: s.x + NODE_W / 2, y: s.y };
  };
  const curve = (a, b) => {
    const dy = Math.max(50, Math.abs(b.y - a.y) / 2);
    return `M${a.x},${a.y} C${a.x},${a.y + dy} ${b.x},${b.y - dy} ${b.x},${b.y}`;
  };

  function renderEdges(temp) {
    const ids = byId();
    let html = '';
    let buttons = '';
    for (const s of m.steps) {
      for (const [p, d] of Object.entries(PORTS)) {
        const t = ids[s[d.key]];
        if (!t) continue;
        const a = anchor(s, p), b = anchor(t);
        html += `<path class="edge ${p}" d="${curve(a, b)}" marker-end="url(#arrow-${p})"/>`;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        buttons += `<button class="edge-x" style="left:${mid.x}px;top:${mid.y}px" data-unlink="${s.id}:${p}" title="Remove this link">✕</button>`;
      }
    }
    if (temp) html += `<path class="edge temp ${temp.port}" d="${curve(temp.a, temp.b)}"/>`;
    svg.innerHTML = `<defs>${['yes', 'no'].map((p) => `<marker id="arrow-${p}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10z" class="arrow ${p}"/></marker>`).join('')}</defs>${html}`;
    $$('.edge-x', world).forEach((b) => b.remove());
    world.insertAdjacentHTML('beforeend', buttons);
  }

  const applyView = () => {
    world.style.transform = `translate(${m.panX}px,${m.panY}px) scale(${m.zoom})`;
    $('[data-zoomlbl]').textContent = `${Math.round(m.zoom * 100)}%`;
  };
  const toWorld = (e) => {
    const r = mapEl.getBoundingClientRect();
    return { x: (e.clientX - r.left - m.panX) / m.zoom, y: (e.clientY - r.top - m.panY) / m.zoom };
  };
  const setZoom = (z, cx = mapEl.clientWidth / 2, cy = mapEl.clientHeight / 2) => {
    z = Math.min(1.6, Math.max(0.3, z));
    m.panX = cx - ((cx - m.panX) / m.zoom) * z;
    m.panY = cy - ((cy - m.panY) / m.zoom) * z;
    m.zoom = z;
    applyView();
  };
  const fit = () => {
    if (!m.steps.length) { m.zoom = 1; m.panX = 40; m.panY = 40; return applyView(); }
    const xs = m.steps.map((s) => s.x), ys = m.steps.map((s) => s.y);
    const w = Math.max(...xs) + NODE_W - Math.min(...xs), h = Math.max(...ys) + 200 - Math.min(...ys);
    m.zoom = Math.min(1, (mapEl.clientWidth - 80) / w, (mapEl.clientHeight - 110) / h);
    m.zoom = Math.max(0.3, m.zoom);
    m.panX = (mapEl.clientWidth - w * m.zoom) / 2 - Math.min(...xs) * m.zoom;
    m.panY = 70 - Math.min(...ys) * m.zoom;
    applyView();
  };

  async function addPage(at, from, port) {
    const r = await modal('Add a page', `
      <label class="f">Page name<input name="name" required placeholder="${port === 'no' ? 'e.g. Downsell' : from ? 'e.g. Thank you' : 'e.g. Sales page'}"></label>
      ${from ? `<p class="muted small">It will open when visitors ${port === 'no' ? 'click <b>No thanks</b>' : 'continue (<b>yes</b>: submit the form, buy, or click Next)'} on “${esc(byId()[from].name)}”.</p>` : ''}`,
    { submit: 'Add page', onSubmit: (v) => api('POST', `/api/funnels/${id}/steps`, { name: v.name, from, port, x: at.x, y: at.y }) });
    if (r) { toast('Page added. Click “Edit page” to design it.'); reload(); }
  }

  // ----- pointer interactions -----
  let drag = null;
  mapEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.nodemenu')) return;
    closeMenu();
    const port = e.target.closest('[data-port]');
    const node = e.target.closest('[data-node]');
    if (port) {
      const s = byId()[port.dataset.from];
      drag = { kind: 'link', s, port: port.dataset.port, a: anchor(s, port.dataset.port), start: toWorld(e), moved: false };
    } else if (node && !e.target.closest('a, button')) {
      const s = byId()[node.dataset.node];
      drag = { kind: 'node', s, el: node, start: toWorld(e), ox: s.x, oy: s.y, moved: false };
      node.classList.add('dragging');
    } else if (!e.target.closest('a, button, .map-tools')) {
      drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, px: m.panX, py: m.panY, moved: false };
      mapEl.classList.add('panning');
    } else return;
    mapEl.setPointerCapture(e.pointerId);
  });
  mapEl.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const w = toWorld(e);
    if (drag.kind === 'pan') {
      m.panX = drag.px + e.clientX - drag.sx; m.panY = drag.py + e.clientY - drag.sy;
      drag.moved = true; applyView();
      return;
    }
    if (Math.hypot(w.x - drag.start.x, w.y - drag.start.y) > 4) drag.moved = true;
    if (drag.kind === 'node' && drag.moved) {
      drag.s.x = Math.round(drag.ox + w.x - drag.start.x); drag.s.y = Math.round(drag.oy + w.y - drag.start.y);
      drag.el.style.left = `${drag.s.x}px`; drag.el.style.top = `${drag.s.y}px`;
      renderEdges();
    } else if (drag.kind === 'link' && drag.moved) {
      $$('.node.drop').forEach((n) => n.classList.remove('drop'));
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-node]');
      if (over && Number(over.dataset.node) !== drag.s.id) over.classList.add('drop');
      renderEdges({ a: drag.a, b: w, port: drag.port });
    }
  });
  mapEl.addEventListener('pointerup', async (e) => {
    if (!drag) return;
    const d = drag; drag = null;
    mapEl.classList.remove('panning');
    $$('.node.drop, .node.dragging').forEach((n) => n.classList.remove('drop', 'dragging'));
    if (d.kind === 'node' && d.moved) save({ steps: [{ id: d.s.id, x: d.s.x, y: d.s.y }] });
    if (d.kind !== 'link') return;
    const key = PORTS[d.port].key;
    if (!d.moved) { // click on an exit
      renderEdges();
      if (!d.s[key]) addPage({ x: d.s.x + (d.port === 'no' ? NODE_W + COL_GAP : 0), y: d.s.y + 150 + ROW_GAP }, d.s.id, d.port);
      return;
    }
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-node]');
    if (over && Number(over.dataset.node) !== d.s.id) {
      d.s[key] = Number(over.dataset.node);
      renderNodes();
      await save({ steps: [{ id: d.s.id, [key]: d.s[key] }] });
    } else if (!over) {
      renderEdges();
      const w = toWorld(e);
      addPage({ x: Math.round(w.x - NODE_W / 2), y: Math.round(w.y) }, d.s.id, d.port);
    } else renderEdges();
  });
  mapEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = mapEl.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) setZoom(m.zoom * (e.deltaY < 0 ? 1.1 : 0.9), e.clientX - r.left, e.clientY - r.top);
    else { m.panX -= e.deltaX; m.panY -= e.deltaY; applyView(); }
  }, { passive: false });

  // ----- toolbar, links and card menu -----
  let menu = null;
  function closeMenu() { menu?.remove(); menu = null; }
  mapEl.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    const ds = t.dataset;
    if (ds.addpage !== undefined) {
      addPage({ x: Math.round((mapEl.clientWidth / 2 - m.panX) / m.zoom - NODE_W / 2), y: Math.round((mapEl.clientHeight / 2 - m.panY) / m.zoom - 80) });
    } else if (ds.tidy !== undefined) {
      const pos = tidyLayout(m.steps, m.entry);
      m.steps.forEach((s) => Object.assign(s, pos[s.id]));
      renderNodes(); fit();
      save({ steps: m.steps.map((s) => ({ id: s.id, x: s.x, y: s.y })) });
    } else if (ds.zoom) setZoom(m.zoom * (ds.zoom === '1' ? 1.2 : 1 / 1.2));
    else if (ds.fit !== undefined) fit();
    else if (ds.unlink) {
      const [sid, p] = ds.unlink.split(':');
      const s = byId()[sid];
      s[PORTS[p].key] = null;
      renderNodes();
      save({ steps: [{ id: s.id, [PORTS[p].key]: null }] });
    } else if (ds.menu) {
      const open = menu?.dataset.for === ds.menu;
      closeMenu();
      if (open) return;
      const s = byId()[ds.menu];
      menu = document.createElement('div');
      menu.className = 'nodemenu';
      menu.dataset.for = ds.menu;
      menu.innerHTML = `${s.id === m.entry ? '' : '<button data-act="start">▶ Make this the start page</button>'}
        <button data-act="rename">✏️ Rename / change URL</button><button data-act="delete" class="danger">🗑 Delete page</button>`;
      t.closest('.node').append(menu);
      menu.onclick = async (ev) => {
        const act = ev.target.dataset.act;
        closeMenu();
        if (act === 'start') { m.entry = s.id; renderNodes(); await save({ entry_step_id: s.id }); toast('Visitors now start on this page'); }
        if (act === 'rename') {
          const r = await modal('Page settings', `<label class="f">Name<input name="name" required value="${esc(s.name)}"></label>
            <label class="f">URL <span class="hint">/f/${esc(f.slug)}/<b>this-part</b></span><input name="slug" required value="${esc(s.slug)}"></label>`,
          { onSubmit: (v) => api('PUT', `/api/steps/${s.id}`, v) });
          if (r) reload();
        }
        if (act === 'delete' && await confirmBox('Delete page?', `“${s.name}” and its stats will be removed. Links to it are removed too.`)) {
          await api('DELETE', `/api/steps/${s.id}`); reload();
        }
      };
    }
  });

  $('[data-rename]').onclick = async () => {
    const r = await modal('Funnel settings', `<label class="f">Name<input name="name" required value="${esc(f.name)}"></label>
      <label class="f">URL <span class="hint">${esc(state.me.baseUrl)}/f/<b>this-part</b></span><input name="slug" required value="${esc(f.slug)}"></label>`,
    { onSubmit: (v) => api('PUT', `/api/funnels/${id}`, v) });
    if (r) { toast('Saved'); reload(); }
  };
  $('[data-del]').onclick = async () => {
    if (await confirmBox('Delete funnel?', `“${f.name}” and all its pages and stats will be removed. Contacts and orders are kept.`)) {
      await api('DELETE', `/api/funnels/${id}`); toast('Funnel deleted'); location.hash = '#/funnels';
    }
  };

  renderNodes();
  fit();
}

function bindCopy() {
  $$('[data-copy]').forEach((b) => { b.onclick = async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); toast('Link copied'); } catch { toast('Copy failed: select the link and copy it manually', true); }
  }; });
}

// ---------------- Page builder ----------------
const ALIGN = ['align', 'align', 'Alignment'];
const BLOCKS = {
  hero: { label: 'Hero banner', icon: '▀', defaults: { eyebrow: 'New', text: 'A bold headline for your offer', subtext: '', background: '#0d9488', textColor: '#ffffff' },
    fields: [['eyebrow', 'text', 'Small label above'], ['text', 'textarea', 'Headline'], ['subtext', 'textarea', 'Subheadline'],
      ['background', 'color', 'Band color'], ['textColor', 'color', 'Text color']] },
  pricing: { label: 'Pricing card', icon: '$', defaults: { productId: null, badge: 'LIMITED TIME OFFER', compareText: '', billingText: '', note: '',
    featuresTitle: 'Everything you get:', features: 'Feature one\nFeature two\nFeature three', buttonLabel: 'Get Instant Access Now',
    buttonSubtext: '14-day money-back guarantee', buttonColor: '#ff7849' },
  fields: [['productId', 'product', 'Product sold by this card'], ['badge', 'text', 'Badge'],
    ['compareText', 'text', 'Crossed-out “was” price', null, 'e.g. $190 per year'],
    ['billingText', 'text', 'Text under the price', null, 'Leave empty to use the product’s billing (e.g. one-time payment)'],
    ['note', 'text', 'Highlight line'], ['featuresTitle', 'text', 'Features heading'], ['features', 'textarea', 'Features (one per line)'],
    ['buttonLabel', 'text', 'Button text'], ['buttonSubtext', 'text', 'Small text in button'], ['buttonColor', 'color', 'Button color']] },
  heading: { label: 'Heading', icon: 'H', defaults: { text: 'Your big headline', size: 'large', align: 'center' },
    fields: [['text', 'textarea', 'Text'], ['size', 'select', 'Size', ['large', 'medium', 'small']], ALIGN] },
  text: { label: 'Text', icon: '¶', defaults: { text: 'Write something persuasive here.', align: 'center' },
    fields: [['text', 'textarea', 'Text'], ALIGN] },
  image: { label: 'Image', icon: '🖼', defaults: { url: '', alt: '', align: 'center' },
    fields: [['url', 'text', 'Image URL', null, 'Paste a link to an image (https://…)'], ['alt', 'text', 'Description (for accessibility)'], ALIGN] },
  video: { label: 'Video', icon: '▶', defaults: { url: '' },
    fields: [['url', 'text', 'YouTube link', null, 'e.g. https://youtu.be/…']] },
  button: { label: 'Button', icon: '⬭', defaults: { label: 'Continue', url: '#next', align: 'center' },
    fields: [['label', 'text', 'Button text'], ['url', 'text', 'Link', null, '#next = the page this one’s ✓ Yes exit leads to · #no = its ✕ No thanks exit'], ALIGN] },
  form: { label: 'Opt-in form', icon: '✉', defaults: { buttonLabel: 'Get instant access', collectName: true, collectPhone: false, tag: 'lead' },
    fields: [['buttonLabel', 'text', 'Button text'], ['collectName', 'check', 'Ask for first name'], ['collectPhone', 'check', 'Ask for phone number'],
      ['tag', 'text', 'Tag new contacts with', null, 'Use tags to email this group later. Comma-separate for several.']] },
  spacer: { label: 'Spacer', icon: '↕', defaults: { height: 40 }, fields: [['height', 'number', 'Height (px)']] },
  divider: { label: 'Divider', icon: '—', defaults: {}, fields: [] },
};
const uid = () => Math.random().toString(36).slice(2, 10);

async function viewEditor(stepId) {
  const [step, products] = await Promise.all([api('GET', `/api/steps/${stepId}`), api('GET', '/api/products')]);
  const ed = { step, blocks: step.blocks, settings: { background: '#ffffff', textColor: '#1f2937', accent: '#4f46e5', width: 720, ...step.settings }, open: null };
  const link = publicUrl(`/f/${step.funnel.slug}/${step.slug}`);
  app.innerHTML = `<div class="editor">
    <div class="bar"><a class="btn sm" href="#/funnels/${step.funnel.id}">← ${esc(step.funnel.name)}</a>
      <div class="title"><input data-name value="${esc(step.name)}" aria-label="Page name"></div>
      <span class="saved" data-saved>All changes saved</span>
      <button class="btn sm" data-device title="Toggle mobile preview">📱 Mobile</button>
      <a class="btn sm primary" href="${esc(link)}" target="_blank" rel="noopener" data-live>View live ↗</a></div>
    <div class="side">
      <h3>Add a block</h3><div class="palette">${Object.entries(BLOCKS).map(([k, b]) => `<button data-addblock="${k}"><span class="ico">${b.icon}</span>${b.label}</button>`).join('')}</div>
      <h3>Page content</h3><div data-blocks></div>
      <h3>Page style</h3>
      <div class="colors">
        <label class="f">Background<input type="color" data-s="background" value="${esc(ed.settings.background)}"></label>
        <label class="f">Text<input type="color" data-s="textColor" value="${esc(ed.settings.textColor)}"></label>
        <label class="f">Buttons<input type="color" data-s="accent" value="${esc(ed.settings.accent)}"></label></div>
      <label class="f">Content width (px)<input type="number" min="360" max="1200" step="20" data-s="width" value="${esc(ed.settings.width)}"></label>
      <h3>SEO &amp; sharing</h3>
      <label class="f">Browser tab title<input data-s="seoTitle" value="${esc(ed.settings.seoTitle || '')}" placeholder="${esc(step.name)}"></label>
      <label class="f">Description<textarea data-s="seoDescription" rows="2">${esc(ed.settings.seoDescription || '')}</textarea></label>
      <label class="f">Page URL<input data-slug value="${esc(step.slug)}"></label>
    </div>
    <div class="stage"><iframe title="Page preview" sandbox="allow-same-origin allow-scripts allow-modals"></iframe></div></div>`;

  const saved = $('[data-saved]');
  let saveTimer, previewTimer;
  const preview = async () => {
    const { html } = await api('POST', '/api/preview', { blocks: ed.blocks, settings: ed.settings, name: $('[data-name]').value });
    $('iframe').srcdoc = html;
  };
  const changed = (extra = {}) => {
    saved.textContent = 'Saving…';
    clearTimeout(previewTimer); previewTimer = setTimeout(preview, 250);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        const r = await api('PUT', `/api/steps/${stepId}`, { name: $('[data-name]').value, blocks: ed.blocks, settings: ed.settings, ...extra });
        saved.textContent = 'All changes saved';
        if (extra.slug !== undefined) { $('[data-slug]').value = r.slug; $('[data-live]').href = publicUrl(`/f/${step.funnel.slug}/${r.slug}`); }
      } catch (err) { saved.textContent = 'Not saved'; toast(err.message, true); }
    }, 700);
  };

  const fieldHtml = (b, i, [key, kind, label, options, hint]) => {
    const v = b[key] ?? '';
    const attrs = `data-i="${i}" data-k="${key}"`;
    if (kind === 'textarea') return `<label class="f">${label}<textarea ${attrs} rows="3">${esc(v)}</textarea></label>`;
    if (kind === 'select') return `<label class="f">${label}<select ${attrs}>${options.map((o) => `<option ${o === v ? 'selected' : ''}>${o}</option>`).join('')}</select></label>`;
    if (kind === 'color') return `<label class="f">${label}<input type="color" ${attrs} value="${esc(v || '#000000')}"></label>`;
    if (kind === 'product') {
      return `<label class="f">${label}${products.length ? `<select ${attrs} data-num>
        <option value="">— None (button just goes to next page) —</option>
        ${products.map((pr) => `<option value="${pr.id}" ${pr.id === v ? 'selected' : ''}>${esc(pr.name)} · ${esc(pr.priceLabel)}</option>`).join('')}</select>`
        : '<div class="hint" style="margin-top:4px">No products yet. <a href="#/products" target="_blank">Create one</a>, then reload this page.</div>'}</label>`;
    }
    if (kind === 'check') return `<label class="check"><input type="checkbox" ${attrs} ${v ? 'checked' : ''}>${label}</label>`;
    if (kind === 'align') return `<div class="f">${label}<div class="aligns">${['left', 'center', 'right'].map((a) => `<button type="button" data-align="${i}:${a}" class="${(v || 'center') === a ? 'on' : ''}">${a}</button>`).join('')}</div></div>`;
    return `<label class="f">${label}${hint ? ` <span class="hint">${esc(hint)}</span>` : ''}<input type="${kind}" ${attrs} value="${esc(v)}"></label>`;
  };
  const summary = (b) => esc(String(b.type === 'pricing' ? (products.find((pr) => pr.id === b.productId)?.name || 'no product')
    : b.text || b.label || b.buttonLabel || b.url || '').slice(0, 40));

  const renderBlocks = () => {
    $('[data-blocks]').innerHTML = ed.blocks.length ? ed.blocks.map((b, i) => {
      const def = BLOCKS[b.type] || { label: b.type, icon: '?', fields: [] };
      const open = ed.open === b.id;
      return `<div class="block ${open ? 'open' : ''}">
        <div class="bh" data-toggle="${b.id}"><span>${def.icon}</span><span class="name">${def.label} <span>${summary(b)}</span></span>
          <button class="btn" data-up="${i}" ${i === 0 ? 'disabled' : ''} title="Move up">↑</button>
          <button class="btn" data-down="${i}" ${i === ed.blocks.length - 1 ? 'disabled' : ''} title="Move down">↓</button>
          <button class="btn" data-dup="${i}" title="Duplicate">⧉</button>
          <button class="btn danger" data-rm="${i}" title="Delete">✕</button></div>
        ${open ? `<div class="bb">${def.fields.length ? def.fields.map((fd) => fieldHtml(b, i, fd)).join('') : '<p class="muted small">No settings for this block.</p>'}</div>` : ''}
      </div>`;
    }).join('') : '<p class="muted small">Your page is empty. Click a block above to add it.</p>';
  };
  const structural = () => { renderBlocks(); changed(); };

  const side = $('.side');
  side.addEventListener('click', (e) => {
    const t = e.target.closest('button, [data-toggle]');
    if (!t) return;
    const d = t.dataset;
    if (d.addblock) {
      const b = { id: uid(), type: d.addblock, ...BLOCKS[d.addblock].defaults };
      ed.blocks.push(b); ed.open = b.id; structural();
      $('[data-blocks]').lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else if (d.up || d.down) {
      const i = Number(d.up ?? d.down), j = d.up ? i - 1 : i + 1;
      [ed.blocks[i], ed.blocks[j]] = [ed.blocks[j], ed.blocks[i]]; structural();
    } else if (d.dup) {
      const i = Number(d.dup);
      const copy = { ...ed.blocks[i], id: uid() };
      ed.blocks.splice(i + 1, 0, copy); ed.open = copy.id; structural();
    } else if (d.rm) {
      ed.blocks.splice(Number(d.rm), 1); structural();
    } else if (d.align) {
      const [i, a] = d.align.split(':');
      ed.blocks[i].align = a; renderBlocks(); changed();
    } else if (d.toggle) {
      ed.open = ed.open === d.toggle ? null : d.toggle; renderBlocks();
    }
  });
  side.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.k) {
      const b = ed.blocks[t.dataset.i];
      b[t.dataset.k] = t.type === 'checkbox' ? t.checked : t.type === 'number' ? Number(t.value)
        : 'num' in t.dataset ? (t.value ? Number(t.value) : null) : t.value;
      const name = t.closest('.block')?.querySelector('.name span');
      if (name) name.innerHTML = summary(b);
      changed();
    } else if (t.dataset.s) {
      ed.settings[t.dataset.s] = t.type === 'number' ? Number(t.value) : t.value;
      changed();
    }
  });
  $('[data-slug]').addEventListener('change', (e) => changed({ slug: e.target.value }));
  $('[data-name]').addEventListener('input', () => changed());
  $('[data-device]').onclick = () => $('.stage').classList.toggle('mobile');

  renderBlocks();
  preview();
}

// ---------------- People ----------------
const STAGES = [['audience', 'Audience'], ['lead', 'Leads'], ['customer', 'Customers'], ['regular', 'Regulars']];
const STAGE_LABEL = { audience: 'Audience', lead: 'Lead', customer: 'Customer', regular: 'Regular' };
const stagePill = (s) => `<span class="stage ${esc(s)}">${esc(STAGE_LABEL[s] || s)}</span>`;
const personName = (c) => fullName(c) || c.email || 'Unnamed';
const addressLines = (c) => [c.address1, c.address2, [c.city, c.region].filter(Boolean).join(', ') + (c.postal ? ` ${c.postal}` : ''), c.country]
  .map((x) => String(x || '').trim()).filter(Boolean);

async function viewPeople() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const q = params.get('q') || '', tag = params.get('tag') || '', stage = params.get('stage') || '';
  const [all, tags] = await Promise.all([api('GET', `/api/contacts?${new URLSearchParams({ q, tag })}`), api('GET', '/api/tags')]);
  const people = stage ? all.filter((c) => c.stage === stage) : all;
  const count = (s) => all.filter((c) => c.stage === s).length;
  const link = (over) => `#/people?${new URLSearchParams({ q, tag, stage, ...over })}`;
  shell('people', `
    <div class="head"><div><h1>People</h1><div class="muted">One record per person, across your store, newsletter, podcast and inquiries.</div></div>
      <div class="row"><button class="btn" data-import>Import CSV</button><a class="btn" href="/api/export.zip">Export everything</a>
      <button class="btn primary" data-add>+ Add person</button></div></div>
    <div class="stagebar">
      <a href="${link({ stage: '' })}" class="${stage ? '' : 'active'}"><b>${all.length}</b>Everyone</a>
      ${STAGES.map(([k, l]) => `<a href="${link({ stage: k })}" class="${stage === k ? 'active' : ''} ${k}"><b>${count(k)}</b>${l}</a>`).join('<span class="arrow">→</span>')}
    </div>
    <div class="row" style="margin:14px 0"><input data-q placeholder="Search name, email, phone or city…" value="${esc(q)}" style="max-width:340px">
      <select data-tag style="max-width:220px"><option value="">All tags</option>${tags.map((t) => `<option value="${esc(t.tag)}" ${t.tag === tag ? 'selected' : ''}>${esc(t.tag)} (${t.count})</option>`).join('')}</select></div>
    ${people.length ? `<div class="card table-wrap"><table>
      <tr><th>Name</th><th>Email</th><th>Stage</th><th>City</th><th>Tags</th><th>First source</th><th>Added</th></tr>
      ${people.map((c) => `<tr class="click" data-go="#/people/${c.id}"><td><strong>${esc(personName(c))}</strong></td>
        <td>${esc(c.email) || '<span class="muted">no email</span>'} ${c.unsubscribed ? '<span class="pill warn">unsubscribed</span>' : ''}</td>
        <td>${stagePill(c.stage)}</td><td>${esc(c.city)}</td>
        <td>${tagsHtml(c.tags)}</td><td class="muted small">${esc(c.source)}</td><td class="muted small">${fmtDate(c.created_at)}</td></tr>`).join('')}
    </table></div>` : `<div class="card empty"><div class="big">👥</div><h2>${q || tag || stage ? 'No matches' : 'No people yet'}</h2>
      <p>${q || tag || stage ? 'Try a different search.' : 'Import your store orders, newsletter list or podcast signups to get started.'}</p>
      ${q || tag || stage ? '' : '<button class="btn primary" data-import>Import a CSV</button>'}</div>`}`);
  bindRowLinks();
  const go = () => { location.hash = link({ q: $('[data-q]').value, tag: $('[data-tag]').value }); };
  let t; $('[data-q]').oninput = () => { clearTimeout(t); t = setTimeout(go, 350); };
  $('[data-tag]').onchange = go;
  const qEl = $('[data-q]'); if (q) { qEl.focus(); qEl.setSelectionRange(q.length, q.length); }
  $('[data-add]').onclick = async () => {
    const r = await modal('Add person', personForm(), { submit: 'Add person', onSubmit: (v) => api('POST', '/api/contacts', v) });
    if (r) { toast('Person added'); location.hash = `#/people/${r.id}`; }
  };
  $$('[data-import]').forEach((b) => { b.onclick = () => importWizard(viewPeople); });
}

const personForm = (c = {}) => `
  <div class="colors" style="grid-template-columns:1fr 1fr"><label class="f">First name<input name="first_name" value="${esc(c.first_name)}"></label>
  <label class="f">Last name<input name="last_name" value="${esc(c.last_name)}"></label></div>
  <div class="colors" style="grid-template-columns:3fr 2fr"><label class="f">Email <span class="hint">optional for print-only people</span><input name="email" type="email" value="${esc(c.email)}"></label>
  <label class="f">Phone<input name="phone" value="${esc(c.phone)}"></label></div>
  <label class="f">Mailing address<input name="address1" value="${esc(c.address1)}" placeholder="Street"></label>
  <input name="address2" value="${esc(c.address2)}" placeholder="Apt, suite (optional)" style="margin:-6px 0 8px">
  <div class="colors" style="grid-template-columns:2fr 1fr 1fr 1fr;margin-bottom:8px"><input name="city" value="${esc(c.city)}" placeholder="City">
    <input name="region" value="${esc(c.region)}" placeholder="State"><input name="postal" value="${esc(c.postal)}" placeholder="ZIP"><input name="country" value="${esc(c.country)}" placeholder="Country"></div>
  <label class="f">Tags <span class="hint">comma separated</span><input name="tags" value="${esc((c.tags || []).join(', '))}"></label>`;

const EVENT_ICON = { signup: '✍️', inquiry: '💬', purchase: '🛍️', subscribe: '📬', unsubscribe: '🚪', open: '👀', click: '🖱️', listen: '🎧', scan: '📷', visit: '🌐', note: '📝' };
const EVENT_LABEL = { signup: 'Signed up', inquiry: 'Inquiry', purchase: 'Bought', subscribe: 'Subscribed', unsubscribe: 'Unsubscribed', open: 'Opened an email', click: 'Clicked a link', listen: 'Listened', scan: 'Scanned a QR code', visit: 'Visited', note: 'Note' };
const eventText = (e) => {
  const m = e.meta || {};
  const bits = [m.items || m.product, m.funnel && `funnel “${m.funnel}”`, m.format && `${m.format}`, m.campaign, m.url, m.note].filter(Boolean);
  return bits.map(esc).join(' · ');
};

async function viewPerson(personId) {
  const p = await api('GET', `/api/people/${personId}`);
  const addr = addressLines(p);
  shell('people', `
    <div class="head"><div><a href="#/people" class="small">← People</a>
      <h1 style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">${esc(personName(p))} ${stagePill(p.stage)}</h1>
      <div class="muted">${[p.email && esc(p.email), p.phone && esc(p.phone), `first came from <b>${esc(p.source)}</b>`, `added ${fmtDate(p.created_at)}`].filter(Boolean).join(' · ')}</div></div>
      <div class="row"><button class="btn" data-log>+ Log activity</button><button class="btn" data-edit>Edit</button></div></div>
    <div class="flowline">${STAGES.map(([k, l]) => `<div class="${k} ${STAGES.findIndex((s) => s[0] === k) <= STAGES.findIndex((s) => s[0] === p.stage) ? 'on' : ''}">${esc(l.replace(/s$/, ''))}</div>`).join('')}</div>
    <div class="grid two">
      <div class="card"><h2>Timeline</h2>
        ${p.events.length ? `<ol class="timeline">${p.events.map((e) => `<li><span class="ico">${EVENT_ICON[e.type] || '•'}</span>
          <div><b>${esc(EVENT_LABEL[e.type] || e.type)}</b>${e.value_cents ? ` · ${esc(e.valueLabel)}` : ''}${e.source ? ` <span class="muted small">via ${esc(e.source)}</span>` : ''}
          <div class="muted small">${eventText(e)}</div></div>
          <time class="muted small">${fmtDate(e.occurred_at)}</time></li>`).join('')}</ol>`
          : '<p class="muted">Nothing yet. Signups, purchases, opens and inquiries show up here.</p>'}
      </div>
      <div class="grid" style="align-content:start">
        <div class="card"><div class="grid" style="grid-template-columns:1fr 1fr;gap:8px">
          ${stat('Spent', esc(fmtMoney(p.totals.spent_cents)), `${p.totals.orders} order${p.totals.orders === 1 ? '' : 's'}`)}
          ${stat('Events', p.events.length, p.events[0] ? `last ${fmtDate(p.events[0].occurred_at)}` : 'none yet')}</div>
          ${addr.length ? `<h2 style="margin-top:14px">Mailing address</h2><div>${addr.map(esc).join('<br>')}</div>` : ''}
          ${p.tags.length ? `<h2 style="margin-top:14px">Tags</h2>${tagsHtml(p.tags)}` : ''}</div>
        <div class="card"><h2>Orders</h2>${p.orders.length ? p.orders.map((o) => `<div class="li"><span>${esc(o.product_name)}<span class="muted small"> · ${esc(o.source)}${o.status !== 'paid' ? ` · ${esc(o.status)}` : ''}</span></span>
          <span><b>${esc(o.amountLabel)}</b> <span class="muted small">${fmtDate(o.paid_at || o.created_at)}</span></span></div>`).join('') : '<p class="muted small">No orders yet.</p>'}</div>
        <div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Subscriptions</h2><button class="btn sm" data-sub>+ Subscribe</button></div>
          ${p.subscriptions.length ? p.subscriptions.map((s) => `<div class="li"><span>${esc(s.product)} <span class="pill">${esc(s.format)}</span> <span class="pill ${s.status === 'active' ? 'ok' : 'warn'}">${esc(s.status)}</span></span>
          <span>${s.status === 'active' ? `<button class="btn sm" data-substatus="${s.id}" data-to="cancelled">Cancel</button>` : `<button class="btn sm" data-substatus="${s.id}" data-to="active">Restart</button>`}</span></div>`).join('')
          : '<p class="muted small" style="margin-top:10px">Not subscribed to a newsletter.</p>'}</div>
        ${p.deals.length ? `<div class="card"><h2>Deals</h2>${p.deals.map((d) => `<a class="cdeal" href="#/pipelines/${d.pipeline_id}"><span>${esc(d.title)}</span>
          <span class="muted small">${d.status === 'open' ? esc(d.stage_name) : esc(d.status)} · ${esc(d.valueLabel)}</span></a>`).join('')}</div>` : ''}
      </div>
    </div>`);

  $('[data-edit]').onclick = async () => {
    const pending = modal('Edit person', `${personForm(p)}
      <label class="check"><input type="checkbox" name="unsubscribed" ${p.unsubscribed ? 'checked' : ''}>Unsubscribed from email</label>
      <button type="button" class="btn danger sm" data-delc>Delete person</button>`,
    { onSubmit: (v) => api('PUT', `/api/contacts/${p.id}`, v) });
    $('[data-delc]').onclick = async () => {
      $('.modal-bg [data-x]').click();
      if (await confirmBox('Delete person?', `${personName(p)} and their whole timeline will be permanently removed. Orders are kept.`)) {
        await api('DELETE', `/api/contacts/${p.id}`); toast('Person deleted'); location.hash = '#/people';
      }
    };
    if (await pending) { toast('Saved'); viewPerson(p.id); }
  };
  $('[data-log]').onclick = async () => {
    const r = await modal('Log activity', `
      <label class="f">What happened<select name="type">${['inquiry', 'note', 'listen', 'signup', 'open', 'click', 'scan', 'visit'].map((t) => `<option value="${t}">${EVENT_LABEL[t]}</option>`).join('')}</select></label>
      <label class="f">When<input name="occurred_at" type="date" value="${new Date().toISOString().slice(0, 10)}"></label>
      <label class="f">Details <span class="hint">optional</span><textarea name="note" rows="3" placeholder="e.g. Called asking about a custom order"></textarea></label>`,
    { submit: 'Log it', onSubmit: (v) => api('POST', `/api/people/${p.id}/events`, v) });
    if (r) { toast('Logged'); viewPerson(p.id); }
  };
  $('[data-sub]').onclick = async () => {
    const r = await modal('Add a subscription', `
      <label class="f">Newsletter<input name="product" value="Newsletter" required></label>
      <label class="f">Format<select name="format"><option value="email">Email</option><option value="print">Print (mailed)</option></select></label>`,
    { submit: 'Subscribe', onSubmit: (v) => api('POST', `/api/people/${p.id}/subscriptions`, v) });
    if (r) { toast('Subscribed'); viewPerson(p.id); }
  };
  $$('[data-substatus]').forEach((b) => { b.onclick = async () => {
    await api('PUT', `/api/subscriptions/${b.dataset.substatus}`, { status: b.dataset.to }); toast('Updated'); viewPerson(p.id);
  }; });
}
const fmtMoney = (cents, currency = 'usd') => new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase(), minimumFractionDigits: cents % 100 ? 2 : 0 }).format((cents || 0) / 100);

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

// ---------------- Import wizard ----------------
// Pick what you're importing, upload a CSV, match its columns (guessed for
// Squarespace, Shopify, Etsy and PayPal exports), check a preview, import.
const IMPORT_TYPES = {
  people: { label: 'People (a contact or mailing list)', endpoint: '/api/import/people',
    fields: ['email', 'name', 'first_name', 'last_name', 'phone', 'tags', 'address1', 'address2', 'city', 'region', 'postal', 'country', 'source'] },
  orders: { label: 'Orders (store, Etsy, PayPal export)', endpoint: '/api/import/orders',
    fields: ['order_id', 'email', 'name', 'first_name', 'last_name', 'date', 'total', 'currency', 'item_name', 'item_qty', 'item_price', 'address1', 'address2', 'city', 'region', 'postal', 'country', 'tags'] },
  subscribers: { label: 'Newsletter subscribers (print or email)', endpoint: '/api/import/subscribers',
    fields: ['email', 'name', 'first_name', 'last_name', 'address1', 'address2', 'city', 'region', 'postal', 'country', 'product', 'format', 'status', 'started_at', 'tags'] },
  listens: { label: 'Podcast listens (from your podcast host)', endpoint: '/api/import/listens', fields: ['date', 'episode', 'listens'] },
};
const FIELD_LABEL = { email: 'Email', name: 'Full name', first_name: 'First name', last_name: 'Last name', phone: 'Phone', tags: 'Tags', address1: 'Street address', address2: 'Address line 2', city: 'City', region: 'State / region', postal: 'ZIP / postal code', country: 'Country', source: 'Source', order_id: 'Order ID', date: 'Order date', total: 'Order total', currency: 'Currency', item_name: 'Item name', item_qty: 'Item quantity', item_price: 'Item price', product: 'Newsletter name', format: 'Format (print/email)', status: 'Status', started_at: 'Start date', episode: 'Episode', listens: 'Listens' };
const ALIASES = {
  email: ['email', 'emailaddress', 'customeremail', 'buyeremail', 'fromemailaddress', 'e-mail', 'mail'],
  name: ['name', 'fullname', 'customername', 'billingname', 'shippingname', 'buyer', 'buyername', 'shipname', 'contactname'],
  first_name: ['firstname', 'first', 'givenname', 'billingfirstname'], last_name: ['lastname', 'last', 'surname', 'familyname', 'billinglastname'],
  phone: ['phone', 'phonenumber', 'billingphone', 'shippingphone', 'mobile'], tags: ['tags', 'tag', 'labels', 'groups'],
  address1: ['address1', 'address', 'street', 'streetaddress', 'addressline1', 'shippingaddress1', 'shippingaddress', 'shipaddress1', 'street1', 'billingaddress1', 'mailingaddress'],
  address2: ['address2', 'addressline2', 'shippingaddress2', 'shipaddress2', 'street2', 'billingaddress2', 'apt', 'suite'],
  city: ['city', 'shippingcity', 'shipcity', 'billingcity', 'town'], region: ['state', 'province', 'region', 'shippingprovince', 'shippingstate', 'shipstate', 'billingprovince', 'billingstate', 'statecode'],
  postal: ['zip', 'zipcode', 'postal', 'postalcode', 'postcode', 'shippingzip', 'shipzipcode', 'shippingpostalcode', 'billingzip'],
  country: ['country', 'shippingcountry', 'shipcountry', 'billingcountry', 'countrycode'], source: ['source', 'firstsource', 'channel', 'leadsource'],
  order_id: ['orderid', 'ordernumber', 'order', 'orderno', 'transactionid', 'saleid', 'receiptid'], date: ['date', 'createdat', 'orderdate', 'paidat', 'saledate', 'datepaid', 'created', 'datecreated'],
  total: ['total', 'ordertotal', 'gross', 'amount', 'totalprice', 'ordervalue', 'grandtotal', 'net'], currency: ['currency', 'currencycode'],
  item_name: ['lineitemname', 'itemname', 'product', 'productname', 'title', 'item', 'itemtitle'], item_qty: ['lineitemquantity', 'quantity', 'qty', 'itemquantity'],
  item_price: ['lineitemprice', 'price', 'itemprice', 'unitprice', 'itemtotal'],
  product: ['newsletter', 'publication', 'list', 'productname'], format: ['format', 'delivery', 'type'], status: ['status', 'subscriptionstatus'],
  started_at: ['startedat', 'startdate', 'subscribedat', 'datesubscribed', 'since', 'joined', 'signupdate'],
  episode: ['episode', 'episodetitle', 'title', 'episodename'], listens: ['listens', 'downloads', 'plays', 'count', 'totallistens', 'totaldownloads'],
};
const normHeader = (h) => String(h).toLowerCase().replace(/[^a-z0-9]/g, '');
function guessMapping(type, headers, sample) {
  const fields = IMPORT_TYPES[type].fields;
  const used = new Set();
  return headers.map((h, i) => {
    const n = normHeader(h);
    // Shopify's "Name" column is the order number (#1001), not a person.
    if (type === 'orders' && n === 'name' && sample.every((r) => !r[i] || /^#?\d+$/.test(r[i].trim()))) { used.add('order_id'); return 'order_id'; }
    const hit = fields.find((f) => !used.has(f) && (ALIASES[f] || [f]).includes(n));
    if (hit) used.add(hit);
    return hit || '';
  });
}

async function importWizard(done) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  document.body.append(bg);
  const close = () => bg.remove();
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
  let type = 'people', headers = [], rows = [], mapping = [];

  const step1 = () => {
    bg.innerHTML = `<form class="modal"><h2>Import from a CSV</h2>
      <label class="f">What’s in the file?<select name="type">${Object.entries(IMPORT_TYPES).map(([k, t]) => `<option value="${k}" ${k === type ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label>
      <label class="f">CSV file <span class="hint">with a header row</span><input type="file" name="file" accept=".csv,text/csv" required></label>
      <p class="hint">Re-importing is safe: people merge by email and orders skip ones already imported.</p>
      <div class="err"></div><div class="actions"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary">Next: match columns</button></div></form>`;
    $('[data-x]', bg).onclick = close;
    $('form', bg).onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      type = f.get('type');
      const parsed = parseCsv((await f.get('file').text()).replace(/^﻿/, ''));
      headers = parsed.shift() || [];
      rows = parsed;
      if (!headers.length || !rows.length) { $('.err', bg).textContent = 'That file has no rows under the header.'; return; }
      mapping = guessMapping(type, headers, rows.slice(0, 20));
      step2();
    };
  };

  const mapped = () => rows.map((cells) => {
    const o = {};
    mapping.forEach((f, i) => { if (f && cells[i] !== undefined && String(cells[i]).trim()) o[f] = String(cells[i]).trim(); });
    return o;
  });
  // Orders: one row per line item → group rows that share an order id.
  const groupOrders = (list) => {
    const byId = new Map(), out = [];
    for (const r of list) {
      const key = r.order_id || Symbol('row');
      let o = byId.get(key);
      if (!o) {
        o = { ...r, items: [] };
        delete o.item_name; delete o.item_qty; delete o.item_price;
        byId.set(key, o); out.push(o);
      } else for (const [k, v] of Object.entries(r)) if (!k.startsWith('item_') && !o[k]) o[k] = v;
      if (r.item_name) o.items.push({ name: r.item_name, qty: r.item_qty || 1, price: r.item_price || '' });
    }
    return out;
  };

  const step2 = () => {
    const t = IMPORT_TYPES[type];
    const preview = mapped().slice(0, 5);
    const cols = t.fields.filter((f) => mapping.includes(f));
    const records = type === 'orders' ? groupOrders(mapped()).length : rows.length;
    const needs = type === 'listens' ? ['listens'] : type === 'orders' ? ['email', 'name', 'first_name'] : type === 'subscribers' ? ['email', 'name', 'first_name', 'address1'] : ['email', 'name', 'first_name'];
    bg.innerHTML = `<form class="modal wide"><h2>Match your columns</h2>
      <p class="muted small">${rows.length} rows${type === 'orders' ? ` → ${records} orders` : ''}. We guessed the matches; change any that are wrong, or skip a column.</p>
      <div class="mapgrid">${headers.map((h, i) => `<div class="m"><span title="${esc(h)}">${esc(h)}</span><span class="muted small">${esc((rows[0][i] || '').slice(0, 30))}</span>
        <select data-col="${i}"><option value="">— skip —</option>${t.fields.map((f) => `<option value="${f}" ${mapping[i] === f ? 'selected' : ''}>${esc(FIELD_LABEL[f])}</option>`).join('')}</select></div>`).join('')}</div>
      ${type === 'listens' ? '' : type === 'subscribers' ? `<div class="colors" style="grid-template-columns:2fr 1fr;margin-top:12px"><label class="f">Newsletter name<input name="product" value="Newsletter"></label>
        <label class="f">Format<select name="format"><option value="email">Email</option><option value="print">Print</option></select></label></div>`
        : `<label class="f" style="margin-top:12px">Where did these ${type === 'orders' ? 'orders' : 'people'} come from?<select name="source">
          ${(type === 'orders' ? ['store', 'etsy', 'paypal', 'stripe', 'other'] : ['newsletter', 'podcast', 'store', 'inquiry', 'social', 'referral', 'import', 'other']).map((s) => `<option>${s}</option>`).join('')}</select></label>`}
      ${type === 'people' ? '<label class="f">Also tag everyone with <span class="hint">optional</span><input name="tag" placeholder="e.g. spring-fair"></label>' : ''}
      <h2 style="margin-top:6px">Preview</h2>
      ${cols.length ? `<div class="table-wrap" style="border:1px solid var(--line);border-radius:8px"><table class="mini"><tr>${cols.map((c) => `<th>${esc(FIELD_LABEL[c])}</th>`).join('')}</tr>
        ${preview.map((r) => `<tr>${cols.map((c) => `<td>${esc(r[c] || '')}</td>`).join('')}</tr>`).join('')}</table></div>` : '<p class="muted">Match at least one column.</p>'}
      <div class="err">${needs.some((f) => mapping.includes(f)) ? '' : `Match an ${needs.map((f) => FIELD_LABEL[f].toLowerCase()).join(' or ')} column so we know who each row is.`}</div>
      <div class="actions"><button type="button" class="btn" data-back>Back</button><button class="btn primary" ${needs.some((f) => mapping.includes(f)) ? '' : 'disabled'}>Import ${records} ${type === 'orders' ? 'orders' : 'rows'}</button></div></form>`;
    $$('[data-col]', bg).forEach((s) => { s.onchange = () => {
      const i = Number(s.dataset.col);
      if (s.value) mapping = mapping.map((m) => (m === s.value ? '' : m));
      mapping[i] = s.value;
      const keep = Object.fromEntries(new FormData($('form', bg)));
      step2();
      for (const [k, v] of Object.entries(keep)) { const el = $(`[name="${k}"]`, bg); if (el) el.value = v; }
    }; });
    $('[data-back]', bg).onclick = step1;
    $('form', bg).onsubmit = async (e) => {
      e.preventDefault();
      const opts = Object.fromEntries(new FormData(e.target));
      const list = type === 'orders' ? groupOrders(mapped()) : mapped();
      const key = type === 'orders' ? 'orders' : 'rows';
      const btn = $('button.primary', bg);
      btn.disabled = true;
      const sum = {};
      const t0 = Date.now();
      try {
        // Small batches keep each request quick (serverless time limits).
        for (let i = 0; i < list.length; i += 200) {
          btn.textContent = `Importing… ${Math.min(i + 200, list.length)} of ${list.length}`;
          const r = await api('POST', t.endpoint, { ...opts, [key]: list.slice(i, i + 200) });
          for (const [k, v] of Object.entries(r)) sum[k] = (sum[k] || 0) + v;
        }
      } catch (err) { $('.err', bg).textContent = err.message; btn.disabled = false; btn.textContent = 'Try again'; return; }
      close();
      const n = (k) => sum[k] || 0;
      const parts = type === 'orders' ? [`${n('created')} orders imported`, n('people') && `${n('people')} new people`, n('duplicates') && `${n('duplicates')} already imported`, n('skipped') && `${n('skipped')} skipped (no email or name)`]
        : type === 'listens' ? [`${n('created')} listen rows imported`, n('skipped') && `${n('skipped')} skipped (no date or count)`]
        : type === 'subscribers' ? [`${n('created')} subscribers added`, n('existing') && `${n('existing')} already subscribed`, n('skipped') && `${n('skipped')} skipped`]
          : [`${n('created')} new people`, n('updated') && `${n('updated')} updated`, n('skipped') && `${n('skipped')} skipped (no email or name)`];
      toast(`${parts.filter(Boolean).join(' · ')} (${Math.round((Date.now() - t0) / 100) / 10}s)`);
      done?.();
    };
  };
  step1();
}

// ---------------- Pipelines ----------------
const DEFAULT_STAGES = ['New lead', 'Contacted', 'Proposal sent', 'Negotiation'];
const CURRENCY_LIST = ['usd', 'eur', 'gbp', 'cad', 'aud'];
// Same output as the server's formatMoney: (120000, 'usd') → '$1,200'.
const money = (cents, currency = 'usd') => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: currency.toUpperCase(), minimumFractionDigits: cents % 100 ? 2 : 0,
}).format(cents / 100);
const totalsLabel = (deals) => {
  const by = {};
  for (const d of deals) by[d.currency] = (by[d.currency] || 0) + d.value_cents;
  const parts = Object.entries(by).filter(([, c]) => c > 0).sort((x, y) => y[1] - x[1]).map(([cur, c]) => money(c, cur));
  return parts.length ? parts.join(' · ') : money(0);
};

async function viewPipeline(pipelineId) {
  const pipelines = await api('GET', '/api/pipelines');
  if (!pipelines.length) {
    shell('pipelines', `
      <div class="head"><div><h1>Pipelines</h1><div class="muted">Track deals from first contact to closed.</div></div></div>
      <div class="card empty"><div class="big">📈</div><h2>No pipeline yet</h2>
        <p>A pipeline is a board of stages, like <i>${DEFAULT_STAGES.map(esc).join(' → ')}</i>. Add a deal for each opportunity and drag it along as it moves forward.</p>
        <button class="btn primary" data-new>Create your first pipeline</button></div>`);
    $('[data-new]').onclick = () => editPipeline();
    return;
  }
  const current = pipelines.find((p) => p.id === Number(pipelineId));
  if (!current) { location.replace(`#/pipelines/${pipelines[0].id}`); return; }
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const view = ['won', 'lost'].includes(params.get('view')) ? params.get('view') : 'board';
  const [p, contacts] = await Promise.all([api('GET', `/api/pipelines/${current.id}`), api('GET', '/api/contacts')]);
  const open = p.deals.filter((d) => d.status === 'open');
  const closed = p.deals.filter((d) => d.status === view).sort((a, b) => String(b.closed_at).localeCompare(String(a.closed_at)));
  const base = `#/pipelines/${p.id}`;

  shell('pipelines', `
    <div class="head"><div>
        ${pipelines.length > 1 ? `<select data-switch class="pipe-switch">${pipelines.map((x) => `<option value="${x.id}" ${x.id === p.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`
          : `<h1>${esc(p.name)}</h1>`}
        <div class="muted">${open.length} open deal${open.length === 1 ? '' : 's'} worth <b>${esc(totalsLabel(open))}</b></div></div>
      <div class="row"><button class="btn" data-edit-pipe>Edit pipeline</button><button class="btn" data-new>+ New pipeline</button>
        <button class="btn primary" data-add>+ Add deal</button></div></div>
    <div class="tabs"><a href="${base}" class="${view === 'board' ? 'active' : ''}">Board</a>
      <a href="${base}?view=won" class="${view === 'won' ? 'active' : ''}">Won (${p.deals.filter((d) => d.status === 'won').length})</a>
      <a href="${base}?view=lost" class="${view === 'lost' ? 'active' : ''}">Lost (${p.deals.filter((d) => d.status === 'lost').length})</a></div>
    ${view === 'board' ? `<div class="board">${p.stages.map((s) => {
      const deals = open.filter((d) => d.stage_id === s.id);
      return `<section class="col" data-stage="${s.id}">
        <header><div class="name">${esc(s.name)} <span class="count">${deals.length}</span></div><div class="muted small">${esc(totalsLabel(deals))}</div></header>
        <div class="cards" data-cards="${s.id}">${deals.map(dealCard).join('')}</div>
        <button class="add" data-add-stage="${s.id}">+ Add deal</button></section>`;
    }).join('')}</div>
    ${open.length ? '<p class="hint" style="margin-top:10px">Drag a deal to another stage, or up and down to set its priority. Click a deal to edit it or mark it won or lost.</p>' : ''}`
    : closed.length ? `<div class="card table-wrap"><table>
      <tr><th>Deal</th><th>Contact</th><th>Value</th><th>${view === 'won' ? 'Won at stage' : 'Lost at stage'}</th><th>Closed</th><th></th></tr>
      ${closed.map((d) => `<tr class="click" data-deal="${d.id}"><td><strong>${esc(d.title)}</strong></td>
        <td>${esc(d.contact_name || d.contact_email || '') || '<span class="muted">—</span>'}</td><td>${esc(d.valueLabel)}</td>
        <td>${esc(p.stages.find((s) => s.id === d.stage_id)?.name || '')}</td><td class="muted small">${fmtDate(d.closed_at)}</td>
        <td style="text-align:right"><button class="btn sm" data-reopen="${d.id}">Reopen</button></td></tr>`).join('')}
    </table></div>` : `<div class="card empty"><div class="big">${view === 'won' ? '🏆' : '🗂️'}</div><h2>No ${view} deals yet</h2>
      <p>Open a deal on the board and mark it ${view} to see it here.</p></div>`}`);

  const reload = () => viewPipeline(p.id);
  const sw = $('[data-switch]'); if (sw) sw.onchange = () => { location.hash = `#/pipelines/${sw.value}`; };
  $('[data-new]').onclick = () => editPipeline();
  $('[data-edit-pipe]').onclick = () => editPipeline(p);
  $('[data-add]').onclick = () => editDeal(p, contacts, null, reload);
  $$('[data-add-stage]').forEach((b) => { b.onclick = () => editDeal(p, contacts, { stage_id: Number(b.dataset.addStage) }, reload); });
  $$('[data-deal]').forEach((el) => { el.onclick = (e) => {
    if (e.target.closest('[data-reopen]')) return;
    editDeal(p, contacts, p.deals.find((d) => d.id === Number(el.dataset.deal)), reload);
  }; });
  $$('[data-reopen]').forEach((b) => { b.onclick = async () => {
    await api('PUT', `/api/deals/${b.dataset.reopen}`, { status: 'open' }); toast('Deal reopened'); reload();
  }; });
  if (view === 'board') bindBoardDrag(reload);
}

const dealCard = (d) => `<article class="deal" draggable="true" data-deal="${d.id}">
  <div class="title">${esc(d.title)}</div>
  ${d.contact_name || d.contact_email ? `<div class="muted small">👤 ${esc(d.contact_name || d.contact_email)}</div>` : ''}
  <div class="foot"><b>${esc(d.valueLabel)}</b>${d.notes ? '<span class="muted small" title="Has notes">📝</span>' : ''}</div></article>`;

// HTML5 drag and drop: a gap opens where the deal will land; on drop the new
// order of that column is saved. (On touch screens, change the stage from the
// deal's edit form instead.)
function bindBoardDrag(reload) {
  let dragging = null;
  const gap = document.createElement('div');
  gap.className = 'deal-gap';
  $$('.deal').forEach((card) => {
    card.addEventListener('dragstart', (e) => {
      dragging = card;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.dataset.deal);
      gap.style.height = `${card.offsetHeight}px`;
      requestAnimationFrame(() => card.classList.add('dragging'));
    });
    card.addEventListener('dragend', () => { card.classList.remove('dragging'); gap.remove(); $$('.col.over').forEach((c) => c.classList.remove('over')); dragging = null; });
  });
  $$('.col').forEach((col) => {
    const list = $('.cards', col);
    col.addEventListener('dragover', (e) => {
      if (!dragging) return;
      e.preventDefault();
      $$('.col.over').forEach((c) => c !== col && c.classList.remove('over'));
      col.classList.add('over');
      const after = $$('.deal:not(.dragging)', list).find((c) => { const r = c.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
      if (after) list.insertBefore(gap, after); else list.append(gap);
    });
    col.addEventListener('drop', async (e) => {
      if (!dragging) return;
      e.preventDefault();
      const card = dragging;
      gap.replaceWith(card);
      const order = $$('.deal', list).map((c) => Number(c.dataset.deal));
      try { await api('PUT', `/api/deals/${card.dataset.deal}/move`, { stage_id: Number(col.dataset.stage), order }); } catch (err) { toast(err.message, true); }
      reload();
    });
  });
}

async function editDeal(p, contacts, deal, reload) {
  const isNew = !deal?.id;
  const d = deal || {};
  const status = d.status || 'open';
  const contactLabel = (c) => `${c.email}${fullName(c) ? ` (${fullName(c)})` : ''}`;
  const pending = modal(isNew ? 'New deal' : 'Edit deal', `
    ${status !== 'open' ? `<div class="banner">This deal was marked <b>${esc(status)}</b> on ${fmtDate(d.closed_at)}.</div>` : ''}
    <label class="f">Deal name<input name="title" required value="${esc(d.title)}" placeholder="e.g. Website redesign for Acme"></label>
    <div class="colors" style="grid-template-columns:2fr 1fr"><label class="f">Value<input name="value" type="number" min="0" step="0.01" value="${d.value ?? ''}" placeholder="0"></label>
      <label class="f">Currency<select name="currency">${CURRENCY_LIST.map((c) => `<option value="${c}" ${(d.currency || 'usd') === c ? 'selected' : ''}>${c.toUpperCase()}</option>`).join('')}</select></label></div>
    <label class="f">Contact <span class="hint">pick someone, or type a new email to add them to contacts</span>
      <input name="contact_email" type="email" list="deal-contacts" autocomplete="off" value="${esc(d.contact_email)}" placeholder="name@example.com"></label>
    <datalist id="deal-contacts">${contacts.map((c) => `<option value="${esc(c.email)}">${esc(contactLabel(c))}</option>`).join('')}</datalist>
    <label class="f" data-newname hidden>New contact’s name <span class="hint">optional</span><input name="contact_name"></label>
    <label class="f">Stage<select name="stage_id">${p.stages.map((s) => `<option value="${s.id}" ${(d.stage_id || p.stages[0].id) === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
    <label class="f">Notes<textarea name="notes" rows="3">${esc(d.notes)}</textarea></label>
    ${isNew ? '' : `<div class="row">${status === 'open'
      ? '<button type="button" class="btn sm won" data-status="won">🏆 Mark won</button><button type="button" class="btn sm" data-status="lost">Mark lost</button>'
      : '<button type="button" class="btn sm" data-status="open">Reopen</button>'}
      <span style="flex:1"></span><button type="button" class="btn danger sm" data-deld>Delete deal</button></div>`}`,
  { submit: isNew ? 'Add deal' : 'Save', onSubmit: (v) => (isNew
    ? api('POST', '/api/deals', { ...v, pipeline_id: p.id })
    : api('PUT', `/api/deals/${d.id}`, v)) });

  const emailEl = $('.modal [name=contact_email]');
  const known = new Set(contacts.map((c) => c.email));
  const syncName = () => { $('.modal [data-newname]').hidden = !emailEl.value.trim() || known.has(emailEl.value.trim().toLowerCase()); };
  emailEl.addEventListener('input', syncName);
  $$('.modal [data-status]').forEach((b) => { b.onclick = async () => {
    const values = Object.fromEntries(new FormData($('.modal')));
    try {
      await api('PUT', `/api/deals/${d.id}`, { ...values, status: b.dataset.status });
      $('.modal-bg [data-x]').click();
      toast(b.dataset.status === 'won' ? 'Deal won 🎉' : b.dataset.status === 'lost' ? 'Deal marked lost' : 'Deal reopened');
      reload();
    } catch (err) { $('.modal .err').textContent = err.message; }
  }; });
  const del = $('.modal [data-deld]');
  if (del) del.onclick = async () => {
    $('.modal-bg [data-x]').click();
    if (await confirmBox('Delete deal?', `“${d.title}” will be permanently removed. The contact is kept.`)) {
      await api('DELETE', `/api/deals/${d.id}`); toast('Deal deleted'); reload();
    }
  };
  if (await pending) { toast(isNew ? 'Deal added' : 'Saved'); reload(); }
}

// Create a pipeline (p omitted) or rename / reorder / add / remove its stages.
async function editPipeline(p) {
  const isNew = !p;
  let stages = isNew ? DEFAULT_STAGES.map((name) => ({ id: null, name })) : p.stages.map((s) => ({ id: s.id, name: s.name }));
  const counts = {};
  for (const d of p?.deals || []) if (d.status === 'open') counts[d.stage_id] = (counts[d.stage_id] || 0) + 1;
  const pending = modal(isNew ? 'New pipeline' : 'Edit pipeline', `
    <label class="f">Pipeline name<input name="name" required value="${esc(p?.name || (isNew ? 'Sales pipeline' : ''))}"></label>
    <div class="f" style="margin-bottom:6px;font-size:.85rem;font-weight:500">Stages <span class="hint">in order, left to right on the board</span></div>
    <div data-stages></div>
    <button type="button" class="btn sm" data-addstage>+ Add stage</button>
    ${isNew ? '' : '<p class="hint">Removing a stage moves its deals to the first stage.</p><button type="button" class="btn danger sm" data-delpipe style="margin-top:6px">Delete pipeline</button>'}`,
  { submit: isNew ? 'Create pipeline' : 'Save', onSubmit: async (v) => {
    sync();
    const body = { name: v.name, stages: stages.filter((s) => s.name.trim()) };
    if (!body.stages.length) throw new Error('Add at least one stage');
    return isNew ? api('POST', '/api/pipelines', body) : api('PUT', `/api/pipelines/${p.id}`, body).then(() => ({ id: p.id }));
  } });

  const box = $('.modal [data-stages]');
  const sync = () => { $$('input', box).forEach((inp, i) => { stages[i].name = inp.value; }); };
  const draw = () => {
    box.innerHTML = stages.map((s, i) => `<div class="stage-row">
      <input value="${esc(s.name)}" placeholder="Stage name" aria-label="Stage ${i + 1}">
      <span class="muted small n" title="Open deals in this stage">${s.id && counts[s.id] ? `${counts[s.id]} open` : ''}</span>
      <button type="button" class="btn sm icon" data-up="${i}" ${i ? '' : 'disabled'} title="Move up">↑</button>
      <button type="button" class="btn sm icon" data-down="${i}" ${i < stages.length - 1 ? '' : 'disabled'} title="Move down">↓</button>
      <button type="button" class="btn sm icon danger" data-rm="${i}" ${stages.length > 1 ? '' : 'disabled'} title="Remove stage">✕</button></div>`).join('');
    $$('[data-up]', box).forEach((b) => { b.onclick = () => { sync(); const i = Number(b.dataset.up); [stages[i - 1], stages[i]] = [stages[i], stages[i - 1]]; draw(); }; });
    $$('[data-down]', box).forEach((b) => { b.onclick = () => { sync(); const i = Number(b.dataset.down); [stages[i + 1], stages[i]] = [stages[i], stages[i + 1]]; draw(); }; });
    $$('[data-rm]', box).forEach((b) => { b.onclick = () => { sync(); stages.splice(Number(b.dataset.rm), 1); draw(); }; });
  };
  draw();
  $('.modal [data-addstage]').onclick = () => { sync(); stages.push({ id: null, name: '' }); draw(); $$('input', box).at(-1).focus(); };
  const del = $('.modal [data-delpipe]');
  if (del) del.onclick = async () => {
    $('.modal-bg [data-x]').click();
    if (await confirmBox('Delete pipeline?', `“${p.name}” and all ${p.deals.length} of its deals will be permanently removed. Contacts are kept.`)) {
      await api('DELETE', `/api/pipelines/${p.id}`); toast('Pipeline deleted'); location.hash = '#/pipelines';
    }
  };
  const r = await pending;
  if (r) {
    toast(isNew ? 'Pipeline created' : 'Saved');
    if (location.hash.split('?')[0] === `#/pipelines/${r.id}`) viewPipeline(r.id); else location.hash = `#/pipelines/${r.id}`;
  }
}

// ---------------- Products & orders ----------------
const BILLING_LABEL = { one_time: 'One-time', monthly: 'Monthly', yearly: 'Yearly' };

async function viewProducts(tab) {
  const orders = tab === 'orders';
  const items = await api('GET', orders ? '/api/orders' : '/api/products');
  const p = state.me.payments;
  shell('products', `
    <div class="head"><div><h1>Products</h1><div class="muted">What you sell, and the orders that come in.</div></div>
      <button class="btn primary" data-new>+ New product</button></div>
    ${p.connected ? (p.testKey ? '<div class="banner">Stripe is connected with a <b>test</b> key: checkouts use Stripe’s test cards and no real money moves.</div>' : '')
      : '<div class="banner"><b>Test mode:</b> Stripe isn’t connected, so checkouts are simulated and no card is charged. <a href="#/settings">Connect Stripe</a> to take real payments.</div>'}
    <div class="tabs"><a href="#/products" class="${orders ? '' : 'active'}">Products</a><a href="#/products/orders" class="${orders ? 'active' : ''}">Orders</a></div>
    ${orders ? ordersHtml(items) : productsHtml(items)}`);

  const form = (pr = {}) => `
    <label class="f">Product name<input name="name" required value="${esc(pr.name)}" placeholder="e.g. Lifetime access"></label>
    <label class="f">Description <span class="hint">shown at checkout</span><textarea name="description" rows="2">${esc(pr.description)}</textarea></label>
    <div class="colors"><label class="f">Price<input name="price" type="number" min="0.5" step="0.01" required value="${pr.price ?? ''}"></label>
      <label class="f">Currency<select name="currency">${['usd', 'eur', 'gbp', 'cad', 'aud'].map((c) => `<option value="${c}" ${pr.currency === c ? 'selected' : ''}>${c.toUpperCase()}</option>`).join('')}</select></label>
      <label class="f">Billing<select name="billing">${Object.entries(BILLING_LABEL).map(([k, l]) => `<option value="${k}" ${pr.billing === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    <label class="f">Tag buyers with <span class="hint">buyers are always tagged “customer” too</span><input name="tag" value="${esc(pr.tag)}" placeholder="e.g. bought-course"></label>`;
  $('[data-new]').onclick = async () => {
    const r = await modal('New product', form(), { submit: 'Create product', onSubmit: (v) => api('POST', '/api/products', v) });
    if (r) {
      toast('Product created');
      if (await modal('Sell it on a page?', '<p class="muted">Create a pricing page funnel for this product now? You can edit everything after.</p>', { submit: 'Create pricing page' })) {
        const f = await api('POST', '/api/funnels', { name: `${(await api('GET', '/api/products')).find((x) => x.id === r.id).name} pricing`, template: 'pricing' });
        location.hash = `#/funnels/${f.id}`;
      } else viewProducts();
    }
  };
  $$('[data-edit]').forEach((row) => { row.onclick = async () => {
    const pr = items.find((x) => x.id === Number(row.dataset.edit));
    const pending = modal('Edit product', `${form(pr)}<button type="button" class="btn danger sm" data-delp>Delete product</button>`,
      { onSubmit: (v) => api('PUT', `/api/products/${pr.id}`, v) });
    $('[data-delp]').onclick = async () => {
      $('.modal-bg [data-x]').click();
      if (await confirmBox('Delete product?', `Pricing cards selling “${pr.name}” will stop taking payments. Past orders are kept.`)) {
        await api('DELETE', `/api/products/${pr.id}`); toast('Product deleted'); viewProducts();
      }
    };
    if (await pending) { toast('Saved'); viewProducts(); }
  }; });
}

const productsHtml = (items) => (items.length ? `<div class="card table-wrap"><table>
  <tr><th>Product</th><th>Price</th><th>Billing</th><th>Buyer tag</th><th>Sales</th></tr>
  ${items.map((pr) => `<tr class="click" data-edit="${pr.id}"><td><strong>${esc(pr.name)}</strong><div class="muted small">${esc(pr.description.slice(0, 70))}</div></td>
    <td>${esc(pr.priceLabel)}</td><td>${BILLING_LABEL[pr.billing]}</td><td>${pr.tag ? tagsHtml(pr.tag.split(',')) : ''}</td><td>${pr.sales}</td></tr>`).join('')}
  </table></div>` : `<div class="card empty"><div class="big">🛒</div><h2>No products yet</h2>
  <p>Create a product, then sell it with a Pricing card on any funnel page.</p></div>`);

const ordersHtml = (items) => (items.length ? `<div class="card table-wrap"><table>
  <tr><th>Order</th><th>Product</th><th>Buyer</th><th>Amount</th><th>Status</th><th>Date</th></tr>
  ${items.map((o) => `<tr><td>#${o.id}${o.mode === 'test' ? ' <span class="pill">test</span>' : ''}</td><td>${esc(o.product_name)}<div class="muted small">${esc(o.funnel_name || '')}</div></td>
    <td>${esc(o.email) || '<span class="muted">—</span>'}</td><td>${esc(o.amountLabel)}</td>
    <td><span class="pill ${o.status === 'paid' ? 'ok' : ''}">${o.status === 'pending' ? 'abandoned / pending' : esc(o.status)}</span></td>
    <td class="muted small">${fmtDate(o.paid_at || o.created_at)}</td></tr>`).join('')}
  </table></div>` : '<div class="card empty"><div class="big">🧾</div><h2>No orders yet</h2><p>Orders appear here when someone clicks buy on a pricing card.</p></div>');

// ---------------- Email ----------------
async function viewEmail(tab) {
  const outbox = tab === 'outbox';
  const [items, tags] = await Promise.all([api('GET', outbox ? '/api/outbox' : '/api/broadcasts'), api('GET', '/api/tags')]);
  shell('email', `
    <div class="head"><div><h1>Email</h1><div class="muted">Send newsletters and announcements to your contacts.</div></div>
      <button class="btn primary" data-compose>+ New broadcast</button></div>
    ${state.me.emailLive ? '' : '<div class="banner"><b>Dev mode:</b> no email provider is connected, so emails are saved to the Outbox instead of being delivered. Add SMTP settings on the server to send for real.</div>'}
    <div class="tabs"><a href="#/email" class="${outbox ? '' : 'active'}">Broadcasts</a><a href="#/email/outbox" class="${outbox ? 'active' : ''}">Outbox</a></div>
    ${outbox ? outboxHtml(items) : broadcastsHtml(items)}`);

  $('[data-compose]').onclick = async () => {
    const r = await modal('New broadcast', `
      <label class="f">Send to<select name="tag"><option value="">All subscribed contacts</option>
        ${tags.map((t) => `<option value="${esc(t.tag)}">Contacts tagged “${esc(t.tag)}” (${t.count})</option>`).join('')}</select></label>
      <label class="f">Subject<input name="subject" required placeholder="A quick update for you, {{first_name}}"></label>
      <label class="f">Message<textarea name="body" rows="9" required placeholder="Hi {{first_name}},&#10;&#10;…"></textarea></label>
      <p class="hint">Personalise with {{first_name}}, {{last_name}} or {{email}}. An unsubscribe link is added automatically.</p>`,
    { submit: 'Save draft', onSubmit: (v) => api('POST', '/api/broadcasts', v) });
    if (r) { toast('Draft saved. Review it, then click Send.'); viewEmail(); }
  };
  $$('[data-send]').forEach((b) => { b.onclick = async () => {
    const bc = items.find((x) => x.id === Number(b.dataset.send));
    if (!await modal('Send broadcast?', `<p>“${esc(bc.subject)}” will go to <b>${bc.tag ? `contacts tagged “${esc(bc.tag)}”` : 'all subscribed contacts'}</b>. This can’t be undone.</p>`, { submit: 'Send now' })) return;
    b.disabled = true; b.textContent = 'Sending…';
    try { const r = await api('POST', `/api/broadcasts/${bc.id}/send`); toast(`Sent to ${r.sent} of ${r.total} contacts`); } catch (err) { toast(err.message, true); }
    viewEmail();
  }; });
  $$('[data-delb]').forEach((b) => { b.onclick = async () => {
    if (await confirmBox('Delete draft?', 'This draft will be removed.')) { await api('DELETE', `/api/broadcasts/${b.dataset.delb}`); viewEmail(); }
  }; });
  $$('[data-view]').forEach((r) => { r.onclick = () => {
    const m = items.find((x) => x.id === Number(r.dataset.view));
    modal(m.subject, `<p class="muted small">To ${esc(m.to_email)} · ${esc(m.status)}${m.error ? ` · ${esc(m.error)}` : ''}</p><pre class="mail">${esc(m.body)}</pre>`, { submit: 'Close' });
  }; });
}

const broadcastsHtml = (items) => (items.length ? `<div class="card table-wrap"><table>
  <tr><th>Subject</th><th>Audience</th><th>Status</th><th>Sent</th><th></th></tr>
  ${items.map((b) => `<tr><td><strong>${esc(b.subject)}</strong><div class="muted small">${esc(b.body.slice(0, 80))}</div></td>
    <td>${b.tag ? `<span class="tag">${esc(b.tag)}</span>` : 'Everyone'}</td>
    <td><span class="pill ${b.status === 'sent' ? 'ok' : ''}">${esc(b.status)}</span></td>
    <td>${b.status === 'sent' ? `${b.sent_count} · ${fmtDate(b.sent_at)}` : '—'}</td>
    <td style="text-align:right;white-space:nowrap">${b.status === 'draft' ? `<button class="btn sm primary" data-send="${b.id}">Send</button>
      <button class="btn sm danger icon" data-delb="${b.id}" title="Delete draft">✕</button>` : ''}</td></tr>`).join('')}
  </table></div>` : `<div class="card empty"><div class="big">✉️</div><h2>No broadcasts yet</h2><p>Write your first email to your list.</p></div>`);

const outboxHtml = (items) => (items.length ? `<div class="card table-wrap"><table>
  <tr><th>To</th><th>Subject</th><th>Status</th><th>When</th></tr>
  ${items.map((m) => `<tr class="click" data-view="${m.id}"><td>${esc(m.to_email)}</td><td>${esc(m.subject)}</td>
    <td><span class="pill ${m.status === 'failed' ? 'warn' : 'ok'}">${esc(m.status)}</span></td><td class="muted small">${fmtDate(m.created_at)}</td></tr>`).join('')}
  </table></div>` : '<div class="card empty"><div class="big">📭</div><h2>Outbox is empty</h2><p>Every email you send is recorded here.</p></div>');

// ---------------- Settings ----------------
function viewSettings() {
  const a = state.me.account;
  shell('settings', `
    <div class="head"><h1>Settings</h1></div>
    <form class="card" style="max-width:560px" data-form>
      <h2>Workspace</h2>
      <label class="f">Business name<input name="name" required value="${esc(a.name)}"></label>
      <h2 style="margin-top:20px">Email sender</h2>
      <label class="f">From name<input name="from_name" value="${esc(a.from_name || '')}"></label>
      <label class="f">From email <span class="hint">must be allowed by your SMTP provider</span><input name="from_email" type="email" value="${esc(a.from_email || '')}"></label>
      <p class="muted small">Email delivery: <b>${state.me.emailLive ? 'connected (SMTP)' : 'dev mode (Outbox only)'}</b></p>
      <div class="err"></div><button class="btn primary">Save settings</button>
    </form>
    <div class="card" style="max-width:560px;margin-top:16px">
      <h2>Your data</h2>
      <p class="muted small">Download everything (people, events, orders, subscriptions, campaigns, funnels, deals) at any time.</p>
      <div class="row"><a class="btn" href="/api/export.zip">⬇ Every table as CSV (.zip)</a><a class="btn" href="/api/export.json">⬇ Everything as JSON</a></div>
    </div>
    <form class="card" style="max-width:560px;margin-top:16px" data-stripe>
      <h2>Payments (Stripe)</h2>
      <p class="small">Status: ${state.me.payments.connected ? `<span class="pill ok">connected${state.me.payments.testKey ? ' · test key' : ''}</span> key ${esc(state.me.payments.keyHint)}`
        : '<span class="pill warn">not connected</span> checkouts run in test mode'}</p>
      <label class="f">Secret key <span class="hint">Stripe Dashboard → Developers → API keys</span>
        <input name="secretKey" type="password" autocomplete="off" placeholder="${state.me.payments.connected ? 'Saved. Paste a new key to replace it' : 'sk_live_… or sk_test_…'}"></label>
      <label class="f">Webhook signing secret <span class="hint">recommended</span>
        <input name="webhookSecret" type="password" autocomplete="off" placeholder="${state.me.payments.webhookSecretSet ? 'Saved. Paste a new one to replace it' : 'whsec_…'}"></label>
      <p class="hint">In Stripe, add a webhook endpoint for <b>checkout.session.completed</b> pointing to:</p>
      <div class="copy" style="margin-bottom:12px"><input readonly value="${esc(state.me.payments.webhookUrl)}"><button type="button" class="btn" data-copy="${esc(state.me.payments.webhookUrl)}">Copy</button></div>
      <div class="err"></div>
      <div class="row"><button class="btn primary">Save payment settings</button>
        ${state.me.payments.connected ? '<button type="button" class="btn danger" data-disconnect>Disconnect</button>' : ''}</div>
    </form>`);
  bindCopy();
  const saveStripe = async (body, form) => {
    try {
      await api('PUT', '/api/account/stripe', body);
      state.me = await api('GET', '/api/me');
      toast('Payment settings saved'); viewSettings();
    } catch (err) { $('.err', form).textContent = err.message; }
  };
  $('[data-stripe]').onsubmit = (e) => { e.preventDefault(); saveStripe(Object.fromEntries(new FormData(e.target)), e.target); };
  const dc = $('[data-disconnect]');
  if (dc) dc.onclick = async () => { if (await confirmBox('Disconnect Stripe?', 'Checkouts will switch to test mode until you connect again.', 'Disconnect')) saveStripe({ disconnect: true }, $('[data-stripe]')); };
  $('[data-form]').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('PUT', '/api/account', Object.fromEntries(new FormData(e.target)));
      state.me = await api('GET', '/api/me');
      toast('Settings saved'); viewSettings();
    } catch (err) { $('.err').textContent = err.message; }
  };
}

// ---------------- Router ----------------
async function route() {
  if (!state.me) {
    try { state.me = await api('GET', '/api/me'); } catch { return renderAuth(); }
  }
  const [path] = location.hash.replace(/^#\/?/, '').split('?');
  const [section, id] = path.split('/');
  try {
    if (section === 'funnels' && id === 'new') { await viewFunnels(); await newFunnel(); }
    else if (section === 'funnels' && id) await viewFunnel(id);
    else if (section === 'funnels') await viewFunnels();
    else if (section === 'editor') await viewEditor(id);
    else if ((section === 'people' || section === 'contacts') && id) await viewPerson(id);
    else if (section === 'people' || section === 'contacts') await viewPeople();
    else if (section === 'pipelines') await viewPipeline(id);
    else if (section === 'products') await viewProducts(id);
    else if (section === 'email') await viewEmail(id);
    else if (section === 'settings') viewSettings();
    else await viewDashboard();
  } catch (err) {
    if (state.me) shell(section, `<div class="card empty"><div class="big">⚠️</div><h2>${esc(err.message)}</h2><a href="#/">Back to dashboard</a></div>`);
  }
}

window.addEventListener('hashchange', route);
route();
