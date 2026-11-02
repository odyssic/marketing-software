'use strict';

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
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<form class="modal wide"><h2>New funnel</h2>
    <label class="f">Funnel name<input name="name" required placeholder="e.g. Free glaze guide"></label>
    <div class="f" style="margin-bottom:6px;font-size:.85rem;font-weight:500">Start from</div>
    <div class="tpl-grid" role="radiogroup">${templates.map((t, i) => `<label class="tpl ${i === 0 ? 'on' : ''}"><input type="radio" name="template" value="${t.key}" ${i === 0 ? 'checked' : ''} class="sr">
      <b>${esc(t.label)}</b><span class="muted small">${esc(t.description)}</span>
      <span class="small">${t.pages} page${t.pages === 1 ? '' : 's'}${t.workflows.length ? ` · ⚡ ${t.workflows.map(esc).join(', ')}` : ''}</span></label>`).join('')}</div>
    <p class="hint">Follow-up workflows are created switched off, so you can review the emails first.</p>
    <div class="err"></div><div class="actions"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary">Create funnel</button></div></form>`;
  document.body.append(bg);
  const close = () => { bg.remove(); if (location.hash === '#/funnels/new') location.hash = '#/funnels'; };
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
  $('[data-x]', bg).onclick = close;
  $$('input[name=template]', bg).forEach((r) => { r.onchange = () => $$('.tpl', bg).forEach((l) => l.classList.toggle('on', l.contains(r) && r.checked)); });
  $('[name=name]', bg).focus();
  $('form', bg).onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api('POST', '/api/funnels', Object.fromEntries(new FormData(e.target)));
      bg.remove();
      toast(r.workflows?.length ? `Funnel created with ${r.workflows.length} follow-up workflow${r.workflows.length === 1 ? '' : 's'}` : 'Funnel created');
      location.hash = `#/funnels/${r.id}`;
    } catch (err) { $('.err', bg).textContent = err.message; }
  };
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
    ${f.workflows?.length ? `<div class="wf-strip"><span class="muted small">⚡ Follow-ups for this funnel:</span>
      ${f.workflows.map((w) => `<a class="chip" href="#/workflows/${w.id}">${esc(w.name.replace(`${f.name}: `, ''))} <span class="pill ${w.status === 'active' ? 'ok' : ''}">${w.status === 'active' ? 'Live' : 'Off'}</span></a>`).join('')}
      ${f.workflows.some((w) => w.status !== 'active') ? '<span class="muted small">Review the emails, then turn them on.</span>' : ''}</div>` : ''}
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
