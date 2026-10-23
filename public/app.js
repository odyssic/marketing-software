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
function renderAuth(mode = 'login') {
  const signup = mode === 'signup';
  app.innerHTML = `<div class="auth"><form class="card">
    <div class="logo">${LOGO}FunnelFlow</div>
    <h1>${signup ? 'Create your account' : 'Welcome back'}</h1>
    <p class="muted">${signup ? 'Build funnels, grow your list, send emails. Free to start.' : 'Sign in to your workspace.'}</p>
    ${signup ? '<label class="f">Your name<input name="name" required autocomplete="name"></label>' : ''}
    ${signup ? '<label class="f">Business name <span class="hint">(optional)</span><input name="workspace"></label>' : ''}
    <label class="f">Email<input name="email" type="email" required autocomplete="email"></label>
    <label class="f">Password<input name="password" type="password" required minlength="${signup ? 8 : 1}" autocomplete="${signup ? 'new-password' : 'current-password'}"></label>
    <div class="err"></div>
    <button class="btn primary" style="width:100%;justify-content:center;padding:11px">${signup ? 'Create account' : 'Sign in'}</button>
    <p class="muted small" style="text-align:center;margin-bottom:0">${signup ? 'Already have an account?' : 'New here?'}
      <a href="#" data-switch>${signup ? 'Sign in' : 'Create an account'}</a></p>
  </form></div>`;
  $('[data-switch]').onclick = (e) => { e.preventDefault(); renderAuth(signup ? 'login' : 'signup'); };
  $('form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('POST', `/api/auth/${mode}`, Object.fromEntries(new FormData(e.target)));
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
  ['contacts', '👥', 'Contacts'],
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
async function viewDashboard() {
  const [d, funnels] = await Promise.all([api('GET', '/api/dashboard'), api('GET', '/api/funnels')]);
  const days = [...Array(14)].map((_, i) => {
    const dt = new Date(Date.now() - (13 - i) * 864e5).toISOString().slice(0, 10);
    return { day: dt, n: d.daily.find((x) => x.day === dt)?.n || 0 };
  });
  const max = Math.max(1, ...days.map((x) => x.n));
  const steps = [
    [d.funnels > 0, 'Create your first funnel', '#/funnels'],
    [d.views30d > 0, 'Open your funnel’s public link', '#/funnels'],
    [d.contacts > 0, 'Capture or import your first contact', '#/contacts'],
    [d.emailsSent > 0, 'Send your first email broadcast', '#/email'],
  ];
  shell('', `
    <div class="head"><div><h1>Hi ${esc(state.me.user.name.split(' ')[0])} 👋</h1>
      <div class="muted">Here’s how ${esc(state.me.account.name)} is doing (last 30 days).</div></div>
      <a class="btn primary" href="#/funnels/new">+ New funnel</a></div>
    <div class="grid stats">
      ${stat('Revenue', d.revenue30d.length ? d.revenue30d.map((r) => esc(r.label)).join(' · ') : '$0',
        `${d.revenue30d.reduce((n, r) => n + r.n, 0)} paid orders`)}
      ${stat('Contacts', d.contacts, `+${d.newContacts7d} this week`)}
      ${stat('Page views', d.views30d, 'across all funnels')}
      ${stat('Opt-ins', d.optins30d, 'new form sign-ups')}
      ${stat('Conversion', `${d.conversion}%`, 'opt-ins ÷ views')}
    </div>
    <div class="grid two">
      <div class="card"><h2>New contacts · last 14 days</h2>
        <div class="bars">${days.map((x) => `<div style="height:${(x.n / max) * 100}%" data-tip="${x.n} on ${x.day.slice(5)}"></div>`).join('')}</div>
        <h2 style="margin-top:24px">Funnels</h2>
        ${funnels.length ? `<table><tr><th>Funnel</th><th>Views</th><th>Opt-ins</th><th>Conv.</th></tr>
          ${funnels.slice(0, 5).map((f) => `<tr class="click" data-go="#/funnels/${f.id}"><td>${esc(f.name)}</td><td>${f.views}</td><td>${f.optins}</td>
          <td>${f.views ? Math.round((f.optins / f.views) * 1000) / 10 : 0}%</td></tr>`).join('')}</table>`
          : '<p class="muted">No funnels yet.</p>'}
      </div>
      <div class="grid" style="align-content:start">
        ${steps.every((s) => s[0]) ? '' : `<div class="card"><h2>Get started</h2><ol class="checklist" style="padding-left:18px;margin:0">
          ${steps.map(([done, label, href]) => `<li class="${done ? 'done' : ''}">${done ? esc(label) : `<a href="${href}">${esc(label)}</a>`}</li>`).join('')}</ol></div>`}
        <div class="card"><h2>Recent contacts</h2>
          ${d.recent.length ? d.recent.map((c) => `<div style="padding:6px 0;border-bottom:1px solid var(--line)">
            <div>${esc(fullName(c) || c.email)}</div><div class="muted small">${esc(c.source)} · ${fmtDate(c.created_at)}</div></div>`).join('')
            : '<p class="muted">Contacts from your forms will show up here.</p>'}
        </div>
      </div>
    </div>`);
  bindRowLinks();
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

// ---------------- Contacts ----------------
async function viewContacts() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const q = params.get('q') || '', tag = params.get('tag') || '';
  const [contacts, tags] = await Promise.all([
    api('GET', `/api/contacts?${new URLSearchParams({ q, tag })}`),
    api('GET', '/api/tags'),
  ]);
  shell('contacts', `
    <div class="head"><div><h1>Contacts</h1><div class="muted">${contacts.length} ${q || tag ? 'matching' : 'total'} contact${contacts.length === 1 ? '' : 's'}</div></div>
      <div class="row"><button class="btn" data-import>Import CSV</button><a class="btn" href="/api/contacts/export.csv">Export CSV</a>
      <button class="btn primary" data-add>+ Add contact</button></div></div>
    <div class="row" style="margin-bottom:14px"><input data-q placeholder="Search name, email or phone…" value="${esc(q)}" style="max-width:340px">
      <select data-tag style="max-width:220px"><option value="">All tags</option>${tags.map((t) => `<option value="${esc(t.tag)}" ${t.tag === tag ? 'selected' : ''}>${esc(t.tag)} (${t.count})</option>`).join('')}</select></div>
    ${contacts.length ? `<div class="card table-wrap"><table>
      <tr><th>Name</th><th>Email</th><th>Phone</th><th>Tags</th><th>Source</th><th>Added</th></tr>
      ${contacts.map((c) => `<tr class="click" data-edit="${c.id}"><td>${esc(fullName(c)) || '<span class="muted">—</span>'}</td>
        <td>${esc(c.email)} ${c.unsubscribed ? '<span class="pill warn">unsubscribed</span>' : ''}</td><td>${esc(c.phone)}</td>
        <td>${tagsHtml(c.tags)}</td><td class="muted small">${esc(c.source)}</td><td class="muted small">${fmtDate(c.created_at)}</td></tr>`).join('')}
    </table></div>` : `<div class="card empty"><div class="big">👥</div><h2>${q || tag ? 'No matches' : 'No contacts yet'}</h2>
      <p>${q || tag ? 'Try a different search.' : 'Contacts appear here when people fill in your funnel forms. You can also add or import them.'}</p></div>`}`);

  const go = () => { location.hash = `#/contacts?${new URLSearchParams({ q: $('[data-q]').value, tag: $('[data-tag]').value })}`; };
  let t; $('[data-q]').oninput = () => { clearTimeout(t); t = setTimeout(go, 350); };
  $('[data-tag]').onchange = go;
  const qEl = $('[data-q]'); if (q) { qEl.focus(); qEl.setSelectionRange(q.length, q.length); }

  const form = (c = {}) => `
    <div class="colors" style="grid-template-columns:1fr 1fr"><label class="f">First name<input name="first_name" value="${esc(c.first_name)}"></label>
    <label class="f">Last name<input name="last_name" value="${esc(c.last_name)}"></label></div>
    <label class="f">Email<input name="email" type="email" required value="${esc(c.email)}"></label>
    <label class="f">Phone<input name="phone" value="${esc(c.phone)}"></label>
    <label class="f">Tags <span class="hint">comma separated</span><input name="tags" value="${esc((c.tags || []).join(', '))}"></label>`;
  $('[data-add]').onclick = async () => {
    if (await modal('Add contact', form(), { submit: 'Add contact', onSubmit: (v) => api('POST', '/api/contacts', v) })) { toast('Contact added'); viewContacts(); }
  };
  $$('[data-edit]').forEach((row) => { row.onclick = async () => {
    const c = contacts.find((x) => x.id === Number(row.dataset.edit));
    const pending = modal('Edit contact', `${form(c)}
      <label class="check"><input type="checkbox" name="unsubscribed" ${c.unsubscribed ? 'checked' : ''}>Unsubscribed from email</label>
      <p class="muted small">Source: ${esc(c.source)} · Added ${fmtDate(c.created_at)}</p>
      <button type="button" class="btn danger sm" data-delc>Delete contact</button>`,
    { onSubmit: (v) => api('PUT', `/api/contacts/${c.id}`, v) });
    $('[data-delc]').onclick = async () => {
      $('.modal-bg [data-x]').click();
      if (await confirmBox('Delete contact?', `${c.email} will be permanently removed.`)) {
        await api('DELETE', `/api/contacts/${c.id}`); toast('Contact deleted'); viewContacts();
      }
    };
    if (await pending) { toast('Saved'); viewContacts(); }
  }; });

  $('[data-import]').onclick = importCsv;
}

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

async function importCsv() {
  const r = await modal('Import contacts', `
    <p class="muted small">Upload a CSV with a header row. Recognised columns: <b>email</b> (required), first_name, last_name, phone, tags.
    Existing contacts are updated, not duplicated.</p>
    <label class="f">CSV file<input type="file" name="file" accept=".csv,text/csv" required></label>
    <label class="f">Also tag everyone with <span class="hint">optional</span><input name="tag" placeholder="e.g. imported-oct"></label>`,
  { submit: 'Import', onSubmit: async (v) => {
    const rows = parseCsv(await v.file.text());
    const header = rows.shift()?.map((h) => h.trim().toLowerCase().replace(/\s+/g, '_')) || [];
    const alias = { 'e-mail': 'email', email_address: 'email', first: 'first_name', firstname: 'first_name', name: 'first_name', last: 'last_name', lastname: 'last_name' };
    const cols = header.map((h) => alias[h] || h);
    if (!cols.includes('email')) throw new Error('No “email” column found in the header row');
    const contacts = rows.map((cells) => {
      const o = Object.fromEntries(cols.map((c, i) => [c, (cells[i] || '').trim()]));
      o.tags = [...String(o.tags || '').split(/[;,]/), v.tag].filter(Boolean);
      return o;
    });
    return api('POST', '/api/contacts/import', { contacts });
  } });
  if (r) { toast(`Imported: ${r.created} new, ${r.updated} updated${r.skipped ? `, ${r.skipped} skipped` : ''}`); viewContacts(); }
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
    else if (section === 'contacts') await viewContacts();
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
