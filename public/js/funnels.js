'use strict';

// ---------------- Funnels ----------------
async function viewFunnels() {
  const funnels = await api('GET', '/api/funnels');
  shell('pages', `${PAGES_TABS('funnels')}
    <div class="head"><div><h1>Pages</h1><div class="muted">Landing pages that turn visitors into contacts.</div></div>
      <button class="btn primary" data-new>+ New page</button></div>
    ${funnels.length ? `<div class="card table-wrap"><table>
      <tr><th>Name</th><th>Pages</th><th>Views</th><th>Sign-ups</th><th>Conversion</th><th>Created</th></tr>
      ${funnels.map((f) => `<tr class="click" data-go="#/funnels/${f.id}"><td><strong>${esc(f.name)}</strong><div class="muted small">/f/${esc(f.slug)}</div></td>
        <td>${f.steps}</td><td>${f.views}</td><td>${f.optins}</td><td>${f.views ? Math.round((f.optins / f.views) * 1000) / 10 : 0}%</td><td>${fmtDate(f.created_at)}</td></tr>`).join('')}
    </table></div>` : `<div class="card empty"><div class="big">${icon('magnet')}</div><h2>No pages yet</h2>
      <p>Pick a template and you’ll have a live page in under a minute.</p><button class="btn primary" data-new>Create your first page</button></div>`}`);
  bindRowLinks();
  $$('[data-new]').forEach((b) => { b.onclick = newFunnel; });
}

async function newFunnel() {
  const templates = await api('GET', '/api/templates');
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<form class="modal wide"><h2>New page</h2>
    <div class="describe"><label class="f" style="margin:0">Describe it in one sentence <span class="hint">we’ll pick the pages and write the words${state.me.aiLive ? ' in your voice' : ''}</span>
      <textarea data-sentence rows="2" placeholder="e.g. A free glaze guide for beginner potters that leads to my $49 starter kit"></textarea></label>
      <div class="row" style="margin-top:8px"><button type="button" class="btn primary" data-describe>${icon('sparkle')} Build it for me</button><span class="err" data-derr style="margin:0"></span></div></div>
    <div class="or"><span>or pick a template</span></div>
    <label class="f">Page name<input name="name" placeholder="e.g. Free glaze guide"></label>
    <div class="f" style="margin-bottom:6px;font-size:.85rem;font-weight:500">Start from</div>
    <div class="tpl-grid pics" role="radiogroup">${templates.map((t, i) => `<label class="tpl ${i === 0 ? 'on' : ''}"><input type="radio" name="template" value="${t.key}" ${i === 0 ? 'checked' : ''} class="sr">
      <span class="tpl-pic">${t.key === 'blank' ? '<span class="tpl-blank">+</span>' : `<img src="/img/tpl/${esc(t.key)}.jpg" alt="" loading="lazy" width="640" height="440">`}</span>
      <b>${esc(t.label)}</b><span class="muted small">${esc(t.description)}</span>
      <span class="small">${t.pages} page${t.pages === 1 ? '' : 's'}${t.workflows.length ? ` · ${icon('bolt')} ${t.workflows.map(esc).join(', ')}` : ''}</span></label>`).join('')}</div>
    <p class="hint">Tip: double-click a template to start with it. Follow-ups are created switched off, so you can review the emails first.</p>
    <div class="err"></div><div class="actions"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary">Create page</button></div></form>`;
  document.body.append(bg);
  const close = () => { bg.remove(); if (location.hash === '#/funnels/new') location.hash = '#/funnels'; };
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
  $('[data-x]', bg).onclick = close;
  $$('input[name=template]', bg).forEach((r) => { r.onchange = () => $$('.tpl', bg).forEach((l) => l.classList.toggle('on', l.contains(r) && r.checked)); });
  // Double-click a template to use it straight away (a page with no name yet is named after the template).
  $$('.tpl', bg).forEach((l) => { l.ondblclick = (e) => {
    e.preventDefault();
    const r = $('input[name=template]', l); r.checked = true; r.onchange();
    const nm = $('[name=name]', bg);
    if (nm && !nm.value.trim()) nm.value = $('b', l).textContent.trim();
    $('form', bg).requestSubmit();
  }; });
  // On phones the keyboard would cover the templates, so nothing is focused there.
  if (matchMedia('(pointer: fine)').matches) $('[data-sentence]', bg).focus();
  $('[data-describe]', bg).onclick = async (e) => {
    const b = e.currentTarget;
    b.disabled = true; b.textContent = 'Building…'; $('[data-derr]', bg).textContent = '';
    try {
      const r = await api('POST', '/api/funnels/describe', { sentence: $('[data-sentence]', bg).value });
      bg.remove();
      toast(`Built “${r.name}”${r.workflows.length ? ` with ${r.workflows.length} follow-up workflow${r.workflows.length === 1 ? '' : 's'}` : ''}. Review it, then publish`);
      location.hash = `#/funnels/${r.id}`;
    } catch (err) { $('[data-derr]', bg).textContent = err.message; b.disabled = false; b.innerHTML = icon('sparkle') + ' Build it for me'; }
  };
  $('form', bg).onsubmit = async (e) => {
    e.preventDefault();
    if (!$('[name=name]', bg).value.trim()) { $('.err:not([data-derr])', bg).textContent = 'Name the page, or describe it above'; $('[name=name]', bg).focus(); return; }
    try {
      const r = await api('POST', '/api/funnels', Object.fromEntries(new FormData(e.target)));
      bg.remove();
      toast(r.workflows?.length ? `Page created with ${r.workflows.length} follow-up${r.workflows.length === 1 ? '' : 's'}` : 'Page created');
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
// The map reads left to right, like the page strips on the Pages screen:
// each step is a column; "No thanks" branches sit below. The gap between
// columns leaves room for the follow-up emails that run in between.
const COL_GAP = 280;
const ROW_GAP = 60;
const NODE_H = 300; // card height with its page picture
const PORTS = { yes: { key: 'next_step_id', at: 0.27, label: '✓ Then' }, no: { key: 'no_step_id', at: 0.75, label: '✕ If they say no' } };

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
      // One exit leads further along (placed beside another page), so give
      // this page its own row and step the other branch out of the way:
      // "no" branches go below, "yes" branches stay on top.
      if (owned[0] === byId[id].no_step_id) { col = leaf++; place(owned[0]); } else { place(owned[0]); col = leaf++; }
    } else {
      const cols = owned.map(place);
      col = cols.length ? (Math.min(...cols) + Math.max(...cols)) / 2 : leaf++;
    }
    pos[id] = { x: depth[id] * (NODE_W + COL_GAP), y: col * (NODE_H + ROW_GAP) };
    return col;
  };
  for (const r of roots) if (!pos[r] && owner[r] === null) place(r);
  // Centre pages reached from several parents between those parents, moving
  // the pages after them along, so links don't cut through cards.
  const shift = (id, dy) => {
    pos[id].y += dy;
    for (const k of kids(id)) if (owner[k] === id) shift(k, dy);
  };
  for (const id of Object.keys(pos).map(Number).sort((a, b) => depth[a] - depth[b])) {
    const parents = steps.filter((s) => s.id !== id && kids(s.id).includes(id) && depth[s.id] < depth[id]);
    if (parents.length > 1) shift(id, parents.reduce((n, s) => n + pos[s.id].y, 0) / parents.length - pos[id].y);
  }
  return pos;
}

// One look for the whole flow, from the map: a palette and a type style applied to
// every page (Undo puts each page back as it was).
async function flowLook(funnelId) {
  const f = await api('GET', `/api/funnels/${funnelId}`);
  if (!f.steps.length) { toast('Add a page first'); return; }
  const first = f.steps.find((s) => s.id === f.entry_step_id) || f.steps[0];
  const cur = first.settings || {};
  const pals = allPalettes();
  const sw = (p) => `<span class="lk-sw"><i style="background:${p.bg}"></i><i style="background:${p.band}"></i><i style="background:${p.accent}"></i></span>`;
  const v = await modal('Look of every page', `<p class="muted small">Pick colours and a type style. Every page in “${esc(f.name)}” changes to match; Undo puts them back.</p>
    <fieldset class="lk-group"><legend>Colours</legend><div class="lk-pals">
      <label class="lk-pal"><input type="radio" name="pal" value="" ${cur.palette ? '' : 'checked'}><span class="lk-sw lk-keep">${icon('check')}</span><small>Keep as is</small></label>
      ${pals.map((p) => `<label class="lk-pal"><input type="radio" name="pal" value="${esc(p.name)}" ${cur.palette === p.name ? 'checked' : ''}>${sw(p)}<small>${esc(p.name)}</small></label>`).join('')}</div></fieldset>
    <fieldset class="lk-group"><legend>Type style</legend><div class="lk-types">
      ${[['', 'Classic'], ['elegant', 'Elegant'], ['modern', 'Modern']].map(([k, l]) => `<label class="lk-type t-${k || 'classic'}"><input type="radio" name="font" value="${k}" ${(cur.font || '') === k ? 'checked' : ''}><b>Aa</b><small>${l}</small></label>`).join('')}</div></fieldset>`,
  { submit: 'Apply to every page' });
  if (!v) return;
  const pal = pals.find((p) => p.name === v.pal);
  const before = f.steps.map((s) => ({ id: s.id, name: s.name, settings: JSON.parse(JSON.stringify(s.settings || {})), blocks: JSON.parse(JSON.stringify(s.blocks || [])) }));
  try {
    for (const s of f.steps) {
      s.settings = s.settings || {};
      if (pal) applyPalette(pal, s.settings, s.blocks);
      if (v.font) s.settings.font = v.font; else delete s.settings.font;
      await api('PUT', `/api/steps/${s.id}`, { name: s.name, blocks: s.blocks, settings: s.settings });
    }
  } catch (e) { toast(e.message, true); return; }
  if (location.hash === `#/funnels/${funnelId}`) viewFunnel(funnelId);
  undoToast(`All ${f.steps.length} page${f.steps.length === 1 ? '' : 's'} restyled`, async () => {
    for (const x of before) await api('PUT', `/api/steps/${x.id}`, { name: x.name, blocks: x.blocks, settings: x.settings });
    if (location.hash === `#/funnels/${funnelId}`) viewFunnel(funnelId);
    toast('Pages put back');
  });
}
async function viewFunnel(id) {
  const f = await api('GET', `/api/funnels/${id}`);
  const link = publicUrl(`/f/${f.slug}`);
  shell('pages', `${PAGES_TABS(f.kind === 'website' ? 'websites' : 'funnels')}
    <div class="head" style="margin-bottom:14px"><div><a href="#/flows?show=${f.kind === 'website' ? 'websites' : 'pageflows'}" class="small">← Flows</a>
      <h1 style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">${esc(f.name)} ${f.status === 'live' ? '<span class="pill ok">Live</span>' : '<span class="pill warn">Draft</span>'} ${purposeTag(f)}</h1></div>
      <div class="row">
        <a class="btn" href="${esc(link)}" target="_blank" rel="noopener">${icon('external')} View</a>
        <button class="btn" data-copy="${esc(link)}" title="${esc(link)}">${icon('copy')} Copy link</button>
        ${moreMenu(`<button role="menuitem" data-rename>${icon('gear')} Settings and address</button>
          <button role="menuitem" data-dup>${icon('copy')} Duplicate</button>
          <button role="menuitem" data-embed>${icon('globe')} Put on another website</button>
          <button role="menuitem" data-seoall>${icon('sparkle')} Write search titles for every page</button>
          ${f.status === 'live' ? `<button role="menuitem" data-unpublish>${icon('pause')} Unpublish</button>` : ''}
          <button role="menuitem" class="danger" data-del>${icon('trash')} Delete</button>`)}
        ${f.status === 'live' ? '' : '<button class="btn primary" data-publish>Publish</button>'}</div></div>
    <div class="fline" data-fstats aria-label="How this flow is doing"></div>
    <div data-leak></div>
    <div data-shared></div>
    <div data-sources></div>
    <details class="fu card" data-fu hidden>
      <summary><span>${icon('bolt')} <b>Follow-ups</b> <span class="muted small">emails and steps that run after someone goes through this page</span></span>
        <span class="muted small" data-fucount>${f.workflows?.length || 0} workflow${f.workflows?.length === 1 ? '' : 's'}</span></summary>
      <div data-fulist><p class="muted small" style="margin:8px 0">Loading…</p></div>
    </details>
    <div class="map ${f.kind === 'website' ? 'site' : ''}" tabindex="0">
      <div class="map-tools">
        <button class="btn primary sm" data-addpage>+ Add page</button>
        <button class="btn sm" data-tidy title="Arrange pages as a tidy tree">${icon('sparkle')} Tidy up</button>
        <button class="btn sm" data-look title="Colours and type style for every page in this flow">${icon('palette')} Look</button>
        <span class="sep"></span>
        <button class="btn sm icon" data-zoom="-1" title="Zoom out">${icon('minus')}</button><span class="zoomlbl" data-zoomlbl>100%</span>
        <button class="btn sm icon" data-zoom="1" title="Zoom in">+</button><button class="btn sm" data-fit>Fit</button>
      </div>
      <div class="map-help">${f.kind === 'website' ? 'Your site map: Home on top, the pages in its menu below (left to right, as in the menu) · A page’s ⋯ menu moves it or hides it from the menu · Tap <b>+</b> next to a form page to add an email or text' : 'Your flow: pages and the emails between them · Tap <b>+</b> on a link to add an email, a text or a page · Drag cards to move them · Drag the background to pan'}</div>
      <div class="world"><svg class="edges"></svg><div class="nodes"></div></div>
    </div>`);
  bindCopy();
  bindPurposeTags([f], () => viewFunnel(id));
  bindMoreMenus();
  $('[data-dup]').onclick = () => duplicateFunnel(f);
  $('[data-embed]').onclick = () => embedCode(f);
  $('[data-seoall]').onclick = async () => {
    const all = await modal('Search titles and descriptions', '<p class="muted small">Rilly writes a search title and description for each page from what’s on it, for Google and AI search. Page addresses stay as they are.</p><label class="check"><input type="checkbox" name="overwrite"> Rewrite pages that already have them</label>', { submit: 'Write them' });
    if (!all) return;
    toast('Writing…');
    try { const r = await api('POST', `/api/funnels/${id}/seo`, { overwrite: Boolean(all.overwrite) }); toast(r.pages ? `Done: ${r.pages} page${r.pages === 1 ? '' : 's'} updated` : 'Every page already had them'); } catch (err) { toast(err.message, true); }
  };

  const m = { steps: f.steps, entry: f.entry_step_id, zoom: 1, panX: 40, panY: 40 };
  const mapEl = $('.map'), world = $('.world'), svg = $('.edges'), nodesEl = $('.nodes');
  const byId = () => Object.fromEntries(m.steps.map((s) => [s.id, s]));
  // Lever colors, plain-language step metrics and the leakiest step.
  api('GET', `/api/funnels/${id}/flow`).then((flow) => {
    m.flow = flow;
    renderNodes();
    if (flow.leak) {
      const st = byId()[flow.leak.step_id];
      $('[data-leak]').innerHTML = `<div class="banner leak"><b>${icon('flag')} Biggest drop-off: “${esc(st?.name || '')}”</b> (${esc(flow.leak.plain)}).
        <br>Try this: ${esc(flow.leak.suggestion)} <a class="btn sm" href="#/editor/${flow.leak.step_id}" style="margin-left:6px">Edit page</a>
        ${st?.variant_blocks ? '<span class="pill">A/B test running</span>' : '<button class="btn sm primary" data-testfix>' + icon('flask') + ' Test the fix</button>'}</div>`;
      const tf = $('[data-testfix]');
      if (tf) tf.onclick = async () => { await api('POST', `/api/steps/${flow.leak.step_id}/variant`, { mode: 'suggestion' }); toast('Split test started with the fix as version B'); location.hash = `#/editor/${flow.leak.step_id}?v=b`; };
    }
  }).catch(() => {});
  const pub = $('[data-publish]');
  if (pub) pub.onclick = async () => {
    const pre = await api('GET', `/api/funnels/${id}/preflight`);
    const list = (ps) => ps.map((p) => `<div class="li"><span>${p.severity === 'block' ? icon('stop') : icon('alert')} ${esc(p.text)}</span>${p.fix ? `<a class="btn sm" href="${esc(p.fix.href)}">${esc(p.fix.label)}</a>` : ''}</div>`).join('');
    if (!pre.ready) {
      modal('Fix these before publishing', `<p class="muted small">Checked before going live so customers never hit a broken page.</p>${list(pre.problems)}`, { submit: 'OK' });
      return;
    }
    if (!await modal('Publish this page?', `<p>Everything checks out${pre.problems.length ? ', with a note or two:' : '.'}</p>${list(pre.problems)}<p class="muted small">Your pages go live at the page link. You can unpublish any time.</p>`, { submit: 'Publish' })) return;
    try { await api('POST', `/api/funnels/${id}/publish`); toast('Published! Your page is live'); viewFunnel(id); } catch (err) { toast(err.message, true); }
  };
  const unpub = $('[data-unpublish]');
  if (unpub) unpub.onclick = async () => {
    await api('POST', `/api/funnels/${id}/unpublish`); viewFunnel(id);
    undoToast('Unpublished', async () => { await api('POST', `/api/funnels/${id}/publish`).catch((e) => toast(e.message, true)); viewFunnel(id); });
  };
  const save = (body) => api('PUT', `/api/funnels/${id}/map`, body).catch((err) => toast(err.message, true));
  const reload = () => viewFunnel(id);
  // Websites read left to right in menu order (pages are reached from the menu, not by links);
  // pages are laid out as a tree that follows their links.
  const isSite = f.kind === 'website';
  const siteLayout = () => {
    const { home, menu, off } = sitePages([...m.steps].sort((a, b) => a.position - b.position || a.id - b.id), m.entry);
    const step = NODE_W + COL_GAP, row = NODE_H + 150;
    const pos = { [home.id]: { x: Math.max(0, ((menu.length - 1) * step) / 2), y: 0 } };
    menu.forEach((s, i) => { pos[s.id] = { x: i * step, y: row }; });
    off.forEach((s, i) => { pos[s.id] = { x: i * step, y: row * (menu.length ? 2 : 1) }; });
    return pos;
  };
  const layout = () => (isSite ? siteLayout() : tidyLayout(m.steps, m.entry));
  const siteHome = () => (isSite ? (m.steps.find((s) => s.id === m.entry) || [...m.steps].sort((a, b) => a.position - b.position || a.id - b.id)[0]) : null);

  // First visit (or pages made before the map existed): lay out automatically.
  if (m.steps.some((s) => s.x === null || s.y === null)) {
    const pos = layout();
    m.steps.forEach((s) => Object.assign(s, pos[s.id]));
    save({ steps: m.steps.map((s) => ({ id: s.id, x: s.x, y: s.y })) });
  }

  // ---------- Statistics: percentages at a glance ----------
  const pct = (a, b) => (b ? `${Math.round((a / b) * 1000) / 10}%` : '—');
  const renderStats = (mail) => {
    const entry = m.steps.find((s) => s.id === m.entry) || m.steps[0];
    const visitors = entry?.views || 0;
    const optins = m.steps.reduce((n, s) => n + s.optins, 0), sales = m.steps.reduce((n, s) => n + s.sales, 0);
    const bit = (value, label, title) => `<span title="${esc(title)}"><b>${value}</b> ${label}</span>`;
    if (f.status !== 'live' && !visitors) { $('[data-fstats]').innerHTML = '<span class="muted small">Not live yet: press <b>Publish</b> when the pages look right. Numbers show here once people visit.</span>'; return; }
    $('[data-fstats]').innerHTML = [
      bit(visitors, `visitor${visitors === 1 ? '' : 's'}`, 'on the start page'),
      bit(pct(optins, visitors), `signed up (${optins})`, 'of visitors'),
      bit(pct(sales, visitors), `bought (${sales})`, 'of visitors'),
      mail && mail.sent ? bit(pct(mail.opened, mail.sent), `opened the emails (${mail.sent} sent)`, `${mail.clicked} clicked`) : '',
    ].filter(Boolean).join('<span class="sep" aria-hidden="true">·</span>') + '<span class="muted small">all time</span>';
  };
  renderStats(null);
  // Where visitors came from, in plain words first, then the numbers.
  api('GET', `/api/funnels/${id}/sources`).then((rows) => {
    if (!rows.length) return;
    const best = rows.filter((r) => r.visitors >= 10 && r.rate !== null).sort((a, b) => b.rate - a.rate)[0];
    const top = rows[0];
    const line = (r) => `${r.source} brought ${r.visitors} visitor${r.visitors === 1 ? '' : 's'}${r.leads ? `, ${r.leads} lead${r.leads === 1 ? '' : 's'}` : ''}${r.sales ? `, ${r.sales} sale${r.sales === 1 ? '' : 's'}` : ''}${r.rate !== null && (r.leads || r.sales) ? ` (${r.rate}%)` : ''}`;
    $('[data-sources]').innerHTML = `<details class="fu card src-card" ${rows.length > 1 ? 'open' : ''}><summary><span>${icon('target')} <b>Where visitors came from</b> <span class="muted small">last 30 days</span></span><span class="muted small">${esc(line(top))}</span></summary>
      <div class="src-body">${best && best !== top ? `<p class="src-tip">${icon('sparkle')} <b>${esc(best.source)}</b> converts best: ${best.rate}% of its visitors sign up or buy.</p>` : ''}
        <table class="mini"><tr><th>Source</th><th>Visitors</th><th>Sign-ups</th><th>Sales</th><th>Convert</th></tr>
        ${rows.map((r) => `<tr><td><b>${esc(r.source)}</b></td><td>${r.visitors}</td><td>${r.leads}</td><td>${r.sales}</td><td>${r.rate === null ? '—' : `${r.rate}%`}</td></tr>`).join('')}</table>
        <p class="hint">Tip: add <code>?utm_source=facebook&amp;utm_campaign=spring-sale</code> to the links in your ads and posts to see each one separately.</p></div></details>`;
  }).catch(() => {});
  api('GET', `/api/funnels/${id}/email-stats`).then(renderStats).catch(() => {});
  sharedFollowupsFor(Number(id)).then((list) => {
    const box = $('[data-shared]');
    if (!box || !list.length) return;
    box.innerHTML = `<details class="banner shared"><summary>${icon('bolt')} ${list.length} other follow-up${list.length === 1 ? '' : 's'} also run${list.length === 1 ? 's' : ''} for people here</summary>
      <p class="small" style="margin:8px 0 0">${list.map((w) => `<a href="#/flows/followup/${w.id}">${esc(w.name)}</a> <span class="muted">(when someone ${esc((w.triggerLabel || '').toLowerCase())}${w.triggerFunnel ? '' : ', on any page'})</span>`).join('<br>')}<br><span class="muted">They’re shared, so a change there applies everywhere.</span></p></details>`;
  });

  // ---------- Follow-ups, laid out as steps you can add to ----------
  const FU_ICON = { trigger: 'bolt', wait: 'clock', email: 'mail', condition: 'branch', tag: 'tag', subscribe: 'inbox', notify: 'bell', deal: 'briefcase' };
  const fuLabel = (n, w) => {
    const c = n.config || {};
    switch (n.type) {
      case 'trigger': return ['When someone', (w.triggers?.[c.event] || 'starts').replace(/^./, (x) => x.toLowerCase())];
      case 'wait': return ['Wait', `${c.days || 0} day${c.days === 1 ? '' : 's'}${c.hours ? ` ${c.hours}h` : ''}`];
      case 'email': return ['Send email', c.subject || 'Untitled email'];
      case 'condition': return ['Yes / no split', 'opens the full map'];
      case 'tag': return ['Tag', [c.add && `+ ${c.add}`, c.remove && `− ${c.remove}`].filter(Boolean).join(' ') || 'tags'];
      case 'subscribe': return ['Subscribe', c.product || 'Newsletter'];
      case 'notify': return ['Notify me', c.message || 'a reminder'];
      case 'deal': return ['Create deal', c.title || 'a deal'];
      default: return [n.type, ''];
    }
  };
  // Merge codes read as plain words: {{first_name|there}} → [first name].
  const readable = (t) => previewMerge(t);
  const chain = (w) => {
    const out = [];
    for (let k = w.graph.root, guard = 0; k && guard < 60; guard++) {
      const n = w.graph.nodes[k]; if (!n) break;
      out.push([k, n]);
      if (n.type === 'condition') break; // branches live on the full map
      k = n.next;
    }
    return out;
  };
  // Which page each follow-up hangs off: sign-up, inquiry and booking follow-ups after the
  // page with the form or calendar, purchase follow-ups after the page that sells.
  function placeFollowups(list) {
    const ordered = [];
    const ids = byId();
    for (let s = ids[m.entry], guard = 0; s && guard < 50 && !ordered.includes(s); guard++) { ordered.push(s); s = ids[s.next_step_id]; }
    const pages = [...ordered, ...m.steps.filter((s) => !ordered.includes(s))];
    const has = (s, types) => s.blocks.some((b) => types.includes(b.type));
    m.fuAt = {};
    for (const w of list) {
      const cfg = w.graph.nodes[w.graph.root]?.config || {};
      const ev = cfg.event;
      const pinned = cfg.step_id && pages.find((s) => s.id === cfg.step_id);
      // The page where that thing happens: its form's purpose decides (an inquiry form, a sign-up form...).
      const formFor = (purposes) => pages.find((s) => s.blocks.some((b) => b.type === 'form' && purposes.includes(String(b.purpose || 'Sign up').toLowerCase())));
      const at = pinned ? pinned : ev === 'purchase' ? pages.find((s) => has(s, ['pricing']))
        : ev === 'inquiry' ? formFor(['inquiry']) || pages.find((s) => has(s, ['form']))
          : ev === 'booking' ? pages.find((s) => has(s, ['booking']))
            : ev === 'subscribe' ? formFor(['newsletter']) || formFor(['sign up'])
              : ev === 'signup' ? formFor(['sign up', 'newsletter']) || pages.find((s) => has(s, ['form', 'booking'])) : null;
      const page = at || pages[0];
      if (page) (m.fuAt[page.id] = m.fuAt[page.id] || []).push(w);
    }
  }
  // Roughly half the height of a page's follow-up cards, to sit the + just below them.
  const FC_W = 210, FC_GAP = 26;
  const cardsIn = (w) => Math.min(4, chain(w).filter(([, x]) => x.type === 'email' || x.type === 'sms').length) + (chain(w).at(-1)?.[1].type === 'condition' ? 1 : 0) + (chain(w).filter(([, x]) => x.type === 'email' || x.type === 'sms').length > 4 ? 1 : 0);
  const chipWidth = (stepId) => Math.max(0, ...(m.fuAt?.[stepId] || []).map((w) => { const k = Math.max(1, cardsIn(w)); return k * FC_W + (k - 1) * FC_GAP; }));
  const chipHalf = (stepId) => (m.fuAt?.[stepId] || []).reduce((n, w) => n + 230 + (chain(w).at(-1)?.[1].type === 'condition' ? 40 : 0), 0) / 2;
  // Room for a row of message cards between a page and the next: pages further right shift over.
  const makeRoom = () => {
    const ids = byId();
    for (const s of [...m.steps].sort((a, b) => a.x - b.x)) {
      const t = ids[s.next_step_id];
      if (!t || t.x <= s.x) continue;
      const w = chipWidth(s.id);
      const need = w ? w + 140 : 0, gap = t.x - (s.x + NODE_W);
      if (need > gap) {
        const d = need - gap, from = t.x;
        for (const x of m.steps) if (x.x >= from) { x.x += d; const el = nodeEl(x.id); if (el) el.style.left = `${x.x}px`; }
      }
    }
  };
  const STEP_UI_LABEL = { wait: 'Wait', tag: 'Tag', subscribe: 'Subscribe', notify: 'Notify me', deal: 'Create deal', condition: 'Another split' };

  // The + on a link: an email or text in this page's follow-up (made if there isn't one), or a page in between.
  async function addHere(stepId, between) {
    const s = byId()[stepId];
    const r = await modal(`After “${s.name}”`, `<div class="choices">
      <label class="choice"><input type="radio" name="kind" value="email" checked hidden><span class="ci">${icon('mail')}</span><span><b>Send an email</b><small>To people who go through this page</small></span></label>
      <label class="choice"><input type="radio" name="kind" value="sms" hidden><span class="ci">${icon('chat')}</span><span><b>Send a text</b><small>Only to people who said yes to texts</small></span></label>
      <label class="choice"><input type="radio" name="kind" value="wait" hidden><span class="ci">${icon('clock')}</span><span><b>Wait</b><small>Pause a few days before the next step</small></span></label>
      <label class="choice"><input type="radio" name="kind" value="split" hidden><span class="ci">${icon('branch')}</span><span><b>Yes / no split</b><small>e.g. if they opened the email send one thing, if not another</small></span></label>
      ${between ? `<label class="choice"><input type="radio" name="kind" value="page" hidden><span class="ci">${icon('page')}</span><span><b>Add a page here</b><small>In between, before “${esc(byId()[s.next_step_id]?.name || '')}”</small></span></label>` : ''}</div>`, { submit: 'Next' });
    if (!r) return;
    if (r.kind === 'page') {
      const t = byId()[s.next_step_id];
      const v = await modal('Add a page', '<label class="f">Page name<input name="name" required placeholder="e.g. Special offer"></label>',
        { submit: 'Add page', onSubmit: (x) => api('POST', `/api/funnels/${id}/steps`, { name: x.name, from: s.id, port: 'yes', insert: true, x: Math.round((s.x + t.x) / 2), y: s.y + 40 }) });
      if (!v) return;
      const fresh = await api('GET', `/api/funnels/${id}`);
      m.steps = fresh.steps;
      const pos = layout();
      m.steps.forEach((x) => Object.assign(x, pos[x.id]));
      await save({ steps: m.steps.map((x) => ({ id: x.id, x: x.x, y: x.y })) });
      toast('Page added. Click “Edit page” to design it.');
      return reload();
    }
    let w = m.fuAt?.[stepId]?.[0];
    if (!w) {
      // A follow-up that starts when someone uses this page: buys on a sales page, books, asks, or signs up.
      const has = (t) => s.blocks.some((b) => b.type === t);
      const form = s.blocks.find((b) => b.type === 'form');
      const event = has('pricing') ? 'purchase' : has('booking') ? 'booking' : String(form?.purpose || '').toLowerCase() === 'inquiry' ? 'inquiry' : 'signup';
      const made = await api('POST', '/api/workflows', { template: 'blank', name: `${f.name}: After ${s.name}`, funnel_id: id });
      w = await api('GET', `/api/workflows/${made.id}`);
      w.graph.nodes[w.graph.root].config = { event, funnel_id: id, repeat: event !== 'signup', step_id: s.id };
      await api('PUT', `/api/workflows/${made.id}`, { graph: w.graph });
      f.workflows = (await api('GET', `/api/funnels/${id}`)).workflows;
    }
    const steps = chain(w);
    const last = steps[steps.length - 1];
    if (last[1].type === 'condition') { toast('This follow-up already splits. Add to its Yes or No path on the full follow-up.'); location.hash = `#/workflows/${w.id}`; return; }
    if (r.kind === 'split') return addSplit(w, last[0]);
    await addStep(w, last[0], r.kind);
  }

  // A yes/no split at the end of a follow-up: wait, check, then one message for yes and one for no.
  async function addSplit(w, after) {
    const branch = (k, title, def) => `<fieldset class="split-b"><legend>${title}</legend>
      <div class="seg" role="group">${[['none', 'Nothing'], ['email', 'Email'], ['sms', 'Text']].map(([v, l]) => `<label><input type="radio" name="${k}_kind" value="${v}" ${v === def ? 'checked' : ''}> ${l}</label>`).join('')}</div>
      <div data-b="${k}"><input name="${k}_subject" placeholder="Email subject" value="${k === 'no' ? 'Did you see this, {{first_name|there}}?' : ''}">
      <textarea name="${k}_body" rows="3" placeholder="Message">Hi {{first_name|there}},\n\n</textarea></div></fieldset>`;
    const pending = modal('Yes / no split', `
      <div class="colors" style="grid-template-columns:auto 1fr;align-items:end"><label class="f">Wait first (days)<input name="days" type="number" min="0" max="365" value="2"></label>
      <label class="f">Then check<select name="check">${['opened', 'clicked', 'purchased_since', 'has_tag'].map((k) => `<option value="${k}">${esc(CONDITION_UI[k])}</option>`).join('')}</select></label></div>
      <label class="f" data-tagrow hidden>Tag<input name="value" placeholder="e.g. vip"></label>
      ${branch('yes', 'If yes', 'none')}${branch('no', 'If no', 'email')}`, { submit: 'Add split' });
    const bg = $$('.modal-bg').pop();
    const sync = () => {
      for (const k of ['yes', 'no']) {
        const kind = $(`[name=${k}_kind]:checked`, bg).value, box = $(`[data-b=${k}]`, bg);
        box.hidden = kind === 'none';
        $(`[name=${k}_subject]`, box).hidden = kind !== 'email';
      }
      $('[data-tagrow]', bg).hidden = $('[name=check]', bg).value !== 'has_tag';
    };
    bg.addEventListener('change', sync); sync();
    const v = await pending;
    if (!v) return;
    const g = w.graph, nk = () => `n${Math.random().toString(36).slice(2, 8)}`;
    const leaf = (k) => {
      const kind = v[`${k}_kind`];
      if (kind === 'none' || !String(v[`${k}_body`] || '').trim()) return null;
      const key = nk();
      g.nodes[key] = kind === 'email' ? { type: 'email', config: { subject: v[`${k}_subject`] || 'A quick note', body: v[`${k}_body`] }, next: null } : { type: 'sms', config: { body: v[`${k}_body`] }, next: null };
      return key;
    };
    const ck = nk();
    g.nodes[ck] = { type: 'condition', config: { check: v.check, value: String(v.value || '').trim().toLowerCase() }, yes: leaf('yes'), no: leaf('no') };
    let first = ck;
    if (Number(v.days) > 0) { first = nk(); g.nodes[first] = { type: 'wait', config: { days: Number(v.days), hours: 0 }, next: ck }; }
    g.nodes[after].next = first;
    if (await saveGraph(w, g)) toast('Split added');
  }

  // The emails a follow-up sends, as "Right away · Welcome", "Day 2 · The story behind…".
  function followupChip(stepId) {
    const list = m.fuAt?.[stepId];
    if (!list?.length) return '';
    return list.map((w) => {
      let days = 0;
      const rows = [];
      for (const [k, n] of chain(w)) {
        if (n.type === 'wait') days += Number(n.config.days || 0) + Number(n.config.hours || 0) / 24;
        if (n.type === 'email' || n.type === 'sms') {
          // The first real line of the message, skipping the greeting.
          const lines = readable(n.config.body).split('\n').map((x) => x.trim()).filter((x) => x && !/^(hi|hello|hey|dear)\b.{0,30},?$/i.test(x));
          rows.push({ key: k, when: `${days < 0.5 ? 'Right away' : `Day ${Math.round(days)}`}${n.config.sendIf ? ` · ${SEND_IF_WORDS[n.config.sendIf] || 'only sometimes'}` : ''}`, sms: n.type === 'sms', title: n.type === 'sms' ? 'Text message' : readable(n.config.subject) || 'Untitled email', preview: (n.type === 'sms' ? readable(n.config.body) : lines[0] || '').slice(0, 140) });
        }
      }
      const end = chain(w).at(-1)?.[1];
      let split = '';
      if (end?.type === 'condition') {
        const side = (key) => {
          const n = key && w.graph.nodes[key];
          if (!n) return '<span class="muted">Nothing</span>';
          const t = n.type === 'email' ? readable(n.config.subject) || 'Email' : n.type === 'sms' ? `Text: ${readable(n.config.body).slice(0, 60)}` : (STEP_UI_LABEL[n.type] || n.type);
          return `<span>${esc(t)}</span>${['email', 'sms'].includes(n.type) ? `<button type="button" class="fc-edit" data-fuedit="${w.id}:${key}">${icon('pencil')} Edit</button>` : ''}`;
        };
        split = `<div class="fc-r fc-split"><div class="fc-when">Day ${Math.round(days)} · ${esc((CONDITION_UI[end.config.check] || 'Check').replace(/\?$/, ''))}${end.config.value ? ` “${esc(end.config.value)}”` : ''}</div>
          <div class="fc-yes"><b>Yes</b>${side(end.yes)}</div><div class="fc-no"><b>No</b>${side(end.no)}</div></div>`;
      }
      if (!rows.length && !split) return `<div class="fu-card ${w.status === 'active' ? 'on' : 'off'}"><div class="fc-top"><span class="fc-t">${icon('bolt')} ${esc(w.name.replace(`${f.name}: `, ''))}</span></div>
        <a class="fc-more" href="#/workflows/${w.id}">No emails yet · Open follow-up</a></div>`;
      const branchMsgs = end?.type === 'condition' ? [end.yes, end.no].map((k) => k && w.graph.nodes[k]).filter((n) => n && ['email', 'sms'].includes(n.type)) : [];
      const count = rows.length + branchMsgs.length;
      const word = rows.some((r) => r.sms) || branchMsgs.some((n) => n.type === 'sms') ? 'message' : 'email';
      return `<div class="fu-card ${w.status === 'active' ? 'on' : 'off'}">
        <div class="fc-top"><span class="fc-t">${icon(split ? 'branch' : 'mail')} ${count} ${word}${count === 1 ? '' : 's'}</span>
          <label class="switch sm" title="${w.status === 'active' ? 'Live: turn off' : 'Off: turn on'}"><input type="checkbox" data-fuonmap="${w.id}" ${w.status === 'active' ? 'checked' : ''} aria-label="${w.status === 'active' ? 'Live' : 'Off'}"><span></span></label>
          <span class="fc-state">${w.status === 'active' ? 'Live' : 'Off: won’t send'}</span></div>
        <div class="fc-row">${rows.slice(0, 4).map((r) => `<div class="fc-r ${r.sms ? 'sms' : 'mail'}"><div class="fc-when">${icon(r.sms ? 'chat' : 'mail')} ${esc(r.when)}${r.sms ? ' · text' : ''}</div>
          <div class="fc-subj">${esc(r.title)}</div>${r.preview ? `<div class="fc-pre">${esc(r.preview)}</div>` : ''}
          <button type="button" class="fc-edit" data-fuedit="${w.id}:${r.key}">${icon('pencil')} Edit</button></div>`).join('')}${split}${rows.length > 4 ? `<a class="fc-r fc-extra" href="#/workflows/${w.id}">+ ${rows.length - 4} more</a>` : ''}</div>
        <a class="fc-more" href="#/workflows/${w.id}">Open full follow-up</a></div>`;
    }).join('');
  }
  async function renderFollowups() {
    const list = await Promise.all((f.workflows || []).map((w) => api('GET', `/api/workflows/${w.id}`)));
    placeFollowups(list);
    makeRoom();
    renderEdges();
    // First load: frame the pages and their follow-ups together.
    if (!m.framed) { m.framed = true; fit(); }
    $('[data-fucount]').textContent = `${list.length} workflow${list.length === 1 ? '' : 's'}`;
    $('[data-fulist]').innerHTML = `${list.map((w) => {
      const steps = chain(w);
      const last = steps[steps.length - 1];
      const canAppend = last && last[1].type !== 'condition';
      return `<div class="fu-wf" data-wf="${w.id}">
        <div class="fu-head"><b>${esc(w.name.replace(`${f.name}: `, ''))}</b>
          <label class="switch" title="${w.status === 'active' ? 'Turn off' : 'Turn on'}"><input type="checkbox" data-fuon="${w.id}" ${w.status === 'active' ? 'checked' : ''}><span></span></label>
          <span class="muted small">${w.status === 'active' ? 'Live' : 'Off'}</span>
          <a class="btn sm" href="#/workflows/${w.id}" style="margin-left:auto">Open full map</a></div>
        <div class="fu-strip">${steps.map(([k, n], i) => {
          const [t, d] = fuLabel(n, w);
          const sent = n.type === 'email' ? Object.values(w.stats?.[k]?.outcomes || {}).reduce((a, b) => a + b, 0) : 0;
          return `${i ? `<button class="fu-add" data-fuadd="${w.id}:${steps[i - 1][0]}" title="Add a step here" aria-label="Add a step here">${icon('plus')}</button>` : ''}
            <a class="fu-step t-${n.type}" href="#/workflows/${w.id}" data-fustep="${w.id}:${k}">
              <span class="fu-ico">${icon(FU_ICON[n.type] || 'bolt')}</span><span class="fc-t">${esc(t)}</span><span class="fu-d">${esc(readable(d))}</span>
              ${n.type === 'email' ? `<span class="fu-n">${sent} sent</span>` : ''}</a>`;
        }).join('')}
        ${canAppend ? `<button class="fu-add end" data-fuadd="${w.id}:${last[0]}" title="Add a step at the end">${icon('plus')} Add</button>` : ''}</div>
      </div>`;
    }).join('')}
      <button class="btn sm" data-funew>${icon('plus')} New follow-up for this page</button>`;
    $$('[data-fuon]').forEach((c) => { c.onchange = async () => {
      try { await api('PUT', `/api/workflows/${c.dataset.fuon}/status`, { status: c.checked ? 'active' : 'paused' }); toast(c.checked ? 'Follow-up is live' : 'Follow-up turned off'); f.workflows = (await api('GET', `/api/funnels/${id}`)).workflows; renderFollowups(); }
      catch (err) { c.checked = !c.checked; toast(err.message, true); }
    }; });
    // Click an email step to edit it right here.
    $$('[data-fustep]').forEach((a) => { a.onclick = (e) => {
      const [wid, key] = a.dataset.fustep.split(':');
      const w = list.find((x) => String(x.id) === wid), n = w.graph.nodes[key];
      if (n.type !== 'email' && n.type !== 'wait') return; // others open the full map
      e.preventDefault(); editStep(w, key);
    }; });
    $$('[data-fuadd]').forEach((b) => { b.onclick = () => {
      const [wid, after] = b.dataset.fuadd.split(':');
      addStep(list.find((x) => String(x.id) === wid), after);
    }; });
    $('[data-funew]').onclick = async () => {
      const r = await api('POST', '/api/workflows', { template: 'blank', name: `${f.name}: Follow-up ${(f.workflows?.length || 0) + 1}`, funnel_id: id });
      const w = await api('GET', `/api/workflows/${r.id}`);
      w.graph.nodes[w.graph.root].config = { event: 'signup', funnel_id: id };
      await api('PUT', `/api/workflows/${r.id}`, { graph: w.graph });
      f.workflows = (await api('GET', `/api/funnels/${id}`)).workflows; renderFollowups();
      toast('Follow-up added. Add its emails below');
    };
  }
  const emailForm = (c = {}, withWait = false) => `${withWait ? '<label class="f">Wait first <span class="hint">days after the previous step</span><input name="days" type="number" min="0" max="365" value="1"></label>' : ''}
    <div class="f"><span class="lbl-row">Subject ${fieldSelect('subject')}</span><input name="subject" required value="${esc(c.subject || '')}" placeholder="e.g. Quick tip for your new typewriter"></div>
    <div class="f"><span class="lbl-row">Message <span class="hint">type {{ for fill-in fields</span> ${fieldSelect('body')}</span><textarea name="body" rows="7" required>${esc(c.body || 'Hi {{first_name|there}},\n\n')}</textarea></div>`;
  const saveGraph = async (w, graph) => {
    try { await api('PUT', `/api/workflows/${w.id}`, { graph }); renderFollowups(); return true; }
    catch (err) { toast(err.message, true); return false; }
  };
  async function editStep(w, key) {
    const n = w.graph.nodes[key];
    setTimeout(() => { const m = $('.modal'); if (m) bindFieldInserts(m); });
    const v = await modal(n.type === 'email' ? 'Edit email' : n.type === 'sms' ? 'Edit text' : 'Edit wait', n.type === 'email' ? emailForm(n.config)
      : n.type === 'sms' ? `<label class="f">Text message <span class="hint">only to people who said yes to texts</span><textarea name="body" rows="4" maxlength="480" required>${esc(n.config.body || '')}</textarea></label>`
        : `<label class="f">Wait (days)<input name="days" type="number" min="0" max="3650" value="${n.config.days || 0}"></label>`, { submit: 'Save' });
    if (!v) return;
    n.config = n.type === 'email' ? { subject: v.subject, body: v.body } : n.type === 'sms' ? { body: v.body } : { days: Number(v.days) || 0, hours: 0 };
    if (await saveGraph(w, w.graph)) toast('Saved');
  }
  async function addStep(w, after, preset) {
    const kind = preset ? { kind: preset } : await modal('Add a step', `<div class="choices">
      <label class="choice"><input type="radio" name="kind" value="email" checked hidden><span class="ci">${icon('mail')}</span><span><b>Send email</b><small>With an optional wait before it</small></span></label>
      <label class="choice"><input type="radio" name="kind" value="wait" hidden><span class="ci">${icon('clock')}</span><span><b>Wait</b><small>Pause before the next step</small></span></label>
      <label class="choice"><input type="radio" name="kind" value="more" hidden><span class="ci">${icon('branch')}</span><span><b>Something else</b><small>Yes/no split, tag, notify me, deal: on the full map</small></span></label></div>`, { submit: 'Next' });
    if (!kind) return;
    if (kind.kind === 'more') { location.hash = `#/workflows/${w.id}`; return; }
    if (kind.kind === 'email') setTimeout(() => { const m = $('.modal'); if (m) bindFieldInserts(m); });
    const v = kind.kind === 'email' ? await modal('New email', emailForm({}, true), { submit: 'Add email' })
      : kind.kind === 'sms' ? await modal('New text', `<label class="f">Wait first <span class="hint">days after the previous step</span><input name="days" type="number" min="0" max="365" value="1"></label>
        <label class="f">Text message <span class="hint">only to people who said yes to texts</span><textarea name="body" rows="3" maxlength="480" required>Hi {{first_name|there}}, it’s {{business}}. </textarea></label>`, { submit: 'Add text' })
      : await modal('Wait', '<label class="f">Wait (days)<input name="days" type="number" min="0" max="3650" value="2"></label>', { submit: 'Add wait' });
    if (!v) return;
    const g = w.graph, prev = g.nodes[after], newKey = () => `n${Math.random().toString(36).slice(2, 8)}`;
    let tail = prev.next ?? null;
    const insert = (node) => { const k = newKey(); g.nodes[k] = { ...node, next: tail }; return k; };
    let first;
    if (kind.kind === 'email' || kind.kind === 'sms') {
      const ek = insert(kind.kind === 'email' ? { type: 'email', config: { subject: v.subject, body: v.body } } : { type: 'sms', config: { body: v.body } });
      first = Number(v.days) > 0 ? (tail = ek, insert({ type: 'wait', config: { days: Number(v.days), hours: 0 } })) : ek;
    } else first = insert({ type: 'wait', config: { days: Number(v.days) || 0, hours: 0 } });
    prev.next = first;
    if (await saveGraph(w, g)) toast(kind.kind === 'email' ? 'Email added' : kind.kind === 'sms' ? 'Text added' : 'Wait added');
  }
  renderFollowups().catch(() => { $('[data-fulist]').innerHTML = '<p class="muted small">Couldn’t load follow-ups.</p>'; });

  const pageIcon = (s) => (s.blocks.some((b) => b.type === 'pricing') ? icon('card') : s.blocks.some((b) => b.type === 'form') ? icon('mail') : icon('page'));
  const pageKind = (s) => (s.blocks.some((b) => b.type === 'pricing') ? 'Sales page' : s.blocks.some((b) => b.type === 'form') ? 'Sign-up page' : 'Page');

  // Page pictures: each page rendered once, then reused on every redraw.
  m.thumbs = {};
  const loadThumbs = async () => {
    await Promise.all(m.steps.map(async (s) => {
      if (m.thumbs[s.id]) return;
      try {
        const { html } = await api('POST', '/api/preview', { blocks: s.blocks, settings: s.settings, name: s.name });
        m.thumbs[s.id] = html;
        const fr = $(`[data-thumb="${s.id}"]`, nodesEl);
        if (fr) fr.srcdoc = html;
      } catch { /* the card still works without its picture */ }
    }));
    // Older funnels were laid out for shorter cards: tidy once if any now overlap.
    const hOf = (s) => nodeEl(s.id)?.offsetHeight || NODE_H;
    const overlap = m.steps.some((a) => m.steps.some((b) => a !== b && Math.abs(a.x - b.x) < NODE_W + 20 && b.y >= a.y && b.y < a.y + hOf(a) + 20));
    // Maps laid out top-to-bottom before the map turned sideways: lay them out again once.
    const ids = byId();
    const vertical = m.steps.some((s) => ids[s.next_step_id] && ids[s.next_step_id].y > s.y + hOf(s) * 0.6 && Math.abs(ids[s.next_step_id].x - s.x) < NODE_W);
    // Websites used to sit in one flat row: lay them out once as a site map.
    const home = siteHome();
    const flat = isSite && m.steps.length > 1 && m.steps.every((s) => s.y === home.y);
    if (overlap || vertical || flat) {
      const pos = layout();
      m.steps.forEach((s) => Object.assign(s, pos[s.id]));
      renderNodes(); fit();
      save({ steps: m.steps.map((s) => ({ id: s.id, x: s.x, y: s.y })) });
    }
  };

  function renderNodes() {
    nodesEl.innerHTML = m.steps.map((s) => `
      <div class="node ${s.id === m.entry ? 'start' : ''} ${m.flow?.leak?.step_id === s.id ? 'leaky' : ''}" data-node="${s.id}" style="left:${s.x}px;top:${s.y}px;width:${NODE_W}px;${m.flow ? `border-top:4px solid ${LEVER_UI[m.flow.levers[s.id]]?.color || 'var(--line)'}` : ''}">
        ${m.flow?.leak?.step_id === s.id ? '<span class="leakpill" title="Fewest people go on from here">' + icon('flag') + ' Biggest drop-off</span>' : ''}
        ${s.variant_blocks ? '<span class="abpill" title="Split test running on this page">A/B</span>' : ''}
        <div class="node-in" title="Visitors arrive here"></div>
        ${isSite ? (s === siteHome() ? '<span class="startpill">⌂ HOME</span>' : s.settings?.hideInMenu ? '<span class="startpill off">Not in menu</span>' : '') : s.id === m.entry ? '<span class="startpill">▶ START</span>' : ''}
        <div class="nhead"><span class="nicon">${pageIcon(s)}</span><div style="min-width:0"><div class="nname">${esc(s.name)}</div>
          <div class="nkind">${pageKind(s)} · /${esc(s.slug)}</div></div>
          <button class="nmenu" data-menu="${s.id}" title="More">${icon('more')}</button></div>
        <a class="nthumb" href="#/editor/${s.id}" title="Edit this page" draggable="false"><iframe tabindex="-1" aria-hidden="true" sandbox="" loading="lazy" data-thumb="${s.id}"${m.thumbs?.[s.id] ? ` srcdoc="${esc(m.thumbs[s.id])}"` : ''}></iframe></a>
        <div class="nstats"><span><b>${s.views}</b> views</span><span><b>${s.optins}</b> sign-ups</span><span><b>${s.sales}</b> sales</span></div>
        <div class="nact"><a class="btn sm primary" href="#/editor/${s.id}">Edit page</a>
          <a class="btn sm" href="${esc(publicUrl(`/f/${f.slug}/${s.slug}`))}" target="_blank" rel="noopener">View ${icon('external')}</a></div>
        <div class="ports">${Object.entries(PORTS).filter(([p, d]) => p === 'yes' || s[d.key] || s.blocks.some((b) => ['pricing', 'offer'].includes(b.type) || b.url === '#no')).map(([p, d]) => `<div class="port ${p} ${s[d.key] ? 'linked' : ''}" data-port="${p}" data-from="${s.id}"
          title="${s[d.key] ? 'Drag to change where this leads' : 'Drag to a page, or click to add the next page'}">${d.label}</div>`).join('')}</div>
      </div>`).join('') || `<div class="map-empty"><div class="big">${icon('sprout')}</div><p>Every page starts with one page.</p>
        <button class="btn primary" data-addpage>+ Add your first page</button></div>`;
    renderEdges();
  }

  const nodeEl = (sid) => $(`[data-node="${sid}"]`, nodesEl);
  // "Yes / Next" leaves from the right side, "No thanks" from the bottom; links arrive on the left.
  const anchor = (s, port) => {
    const h = nodeEl(s.id)?.offsetHeight || NODE_H;
    if (port === 'yes') return { x: s.x + NODE_W, y: s.y + Math.min(h / 2, 150), dir: 'right' };
    if (port === 'no') return { x: s.x + NODE_W * PORTS.no.at, y: s.y + h, dir: 'down' };
    return { x: s.x, y: s.y + Math.min(h / 2, 150) };
  };
  const curve = (a, b) => {
    const dx = Math.max(60, Math.abs(b.x - a.x) / 2);
    const c1 = a.dir === 'down' ? `${a.x},${a.y + Math.max(60, Math.abs(b.y - a.y) / 2)}` : `${a.x + dx},${a.y}`;
    return `M${a.x},${a.y} C${c1} ${b.x - dx},${b.y} ${b.x},${b.y}`;
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
        const fu = p === 'yes' ? followupChip(s.id) : '';
        buttons += `<button class="edge-x" style="left:${mid.x}px;top:${fu ? mid.y - 40 : mid.y}px" data-unlink="${s.id}:${p}" title="Remove this link">${icon('x')}</button>`;
        const metric = m.flow?.edges.find((e) => e.from === s.id && e.port === p);
        if (metric && metric.visitors) buttons += `<span class="edge-lbl ${p}" style="left:${mid.x}px;top:${fu ? mid.y - 66 : mid.y + 18}px">${esc(metric.plain)}</span>`;
        if (fu) buttons += `<div class="fu-chip" data-chip="${s.id}" style="left:${mid.x}px;top:${mid.y}px">${fu}</div>`;
        if (p === 'yes') buttons += `<button class="edge-add" style="left:${mid.x}px;top:${fu ? mid.y + chipHalf(s.id) + 20 : mid.y + 26}px" data-edgeadd="${s.id}" ${fu ? `data-below="${s.id}"` : ''} title="Add an email, a text or a page here" aria-label="Add an email, a text or a page here">${icon('plus')}</button>`;
      }
      // Follow-ups after the last page sit just to its right (on websites: after pages that collect people).
      if (!ids[s.next_step_id] && (f.kind !== 'website' || followupChip(s.id) || s.blocks.some((x) => ['form', 'booking', 'pricing'].includes(x.type)))) {
        const fu = followupChip(s.id);
        const a = anchor(s, 'yes');
        if (fu) buttons += `<div class="fu-chip end" data-chip="${s.id}" style="left:${a.x + 24}px;top:${a.y}px">${fu}</div>`;
        buttons += `<button class="edge-add" style="left:${a.x + (fu ? 142 : 34)}px;top:${fu ? a.y + chipHalf(s.id) + 20 : a.y}px" data-edgeadd="${s.id}" data-end="1" ${fu ? `data-below="${s.id}"` : ''} title="Add an email or a text after this page" aria-label="Add an email or a text after this page">${icon('plus')}</button>`;
      }
    }
    const home = siteHome();
    if (home) {
      const hh = nodeEl(home.id)?.offsetHeight || NODE_H;
      const hx = home.x + NODE_W / 2, hy = home.y + hh;
      for (const s of m.steps) {
        if (s === home || s.settings?.hideInMenu || s.y <= hy) continue;
        const kx = s.x + NODE_W / 2, mid = hy + (s.y - hy) / 2;
        html += `<path class="edge tree" d="M${hx},${hy} V${mid} H${kx} V${s.y}"/>`;
      }
    }
    if (temp) html += `<path class="edge temp ${temp.port}" d="${curve(temp.a, temp.b)}"/>`;
    svg.innerHTML = `<defs>${['yes', 'no'].map((p) => `<marker id="arrow-${p}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10z" class="arrow ${p}"/></marker>`).join('')}</defs>${html}`;
    $$('.edge-x, .edge-lbl, .fu-chip, .edge-add', world).forEach((b) => b.remove());
    world.insertAdjacentHTML('beforeend', buttons);
    // Sit each + just under its follow-up cards, using their real height.
    $$('[data-below]', world).forEach((b) => {
      const chip = $(`.fu-chip[data-chip="${b.dataset.below}"]`, world);
      if (chip) b.style.top = `${parseFloat(chip.style.top) + chip.offsetHeight / 2 + 20}px`;
    });
    $$('[data-edgeadd]', world).forEach((b) => { b.onclick = (e) => { e.stopPropagation(); addHere(Number(b.dataset.edgeadd), !b.dataset.end); }; });
    $$('.fu-chip [data-fuedit]', world).forEach((b) => { b.onclick = (e) => {
      e.stopPropagation();
      const [wid, key] = b.dataset.fuedit.split(':');
      const w = Object.values(m.fuAt || {}).flat().find((x) => String(x.id) === wid);
      if (w) editStep(w, key);
    }; });
    $$('.fu-chip [data-fuonmap]', world).forEach((c) => { c.onclick = (e) => e.stopPropagation(); c.onchange = async () => {
      try {
        await api('PUT', `/api/workflows/${c.dataset.fuonmap}/status`, { status: c.checked ? 'active' : 'paused' });
        toast(c.checked ? 'Follow-up is live' : 'Follow-up turned off');
      } catch (err) { c.checked = !c.checked; toast(err.message, true); return; }
      f.workflows = (await api('GET', `/api/funnels/${id}`)).workflows; renderFollowups();
    }; });
    $$('.fu-chip [data-fuopen]', world).forEach((b) => { b.onclick = (e) => {
      e.stopPropagation();
      const d = $('[data-fu]'); d.open = true;
      const card = $(`.fu-wf[data-wf="${b.dataset.fuopen}"]`) || d;
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('flash'); setTimeout(() => card.classList.remove('flash'), 1400);
    }; });
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
    // Everything on the map: the pages and the follow-up cards between them.
    const boxes = m.steps.map((s) => ({ l: s.x, t: s.y, r: s.x + NODE_W, b: s.y + (nodeEl(s.id)?.offsetHeight || NODE_H) }));
    $$('.fu-chip', world).forEach((c) => {
      const x = parseFloat(c.style.left), y = parseFloat(c.style.top), cw = c.offsetWidth, ch = c.offsetHeight;
      const l = c.classList.contains('end') ? x : x - cw / 2;
      boxes.push({ l, t: y - ch / 2, r: l + cw, b: y + ch / 2 + 40 });
    });
    const minX = Math.min(...boxes.map((x) => x.l)), minY = Math.min(...boxes.map((x) => x.t));
    const w = Math.max(...boxes.map((x) => x.r)) - minX, h = Math.max(...boxes.map((x) => x.b)) - minY;
    m.zoom = Math.min(1, (mapEl.clientWidth - 80) / w, (mapEl.clientHeight - 150) / h);
    m.zoom = Math.max(0.3, m.zoom);
    m.panX = (mapEl.clientWidth - w * m.zoom) / 2 - minX * m.zoom;
    m.panY = 112 - minY * m.zoom;
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
      if (!d.s[key]) addPage({ x: d.s.x + NODE_W + COL_GAP, y: d.s.y + (d.port === 'no' ? NODE_H + ROW_GAP : 0) }, d.s.id, d.port);
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
      addPage({ x: Math.round(w.x), y: Math.round(w.y - 120) }, d.s.id, d.port);
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
    } else if (ds.look !== undefined) {
      flowLook(id);
    } else if (ds.tidy !== undefined) {
      const pos = layout();
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
      menu.innerHTML = `${f.kind === 'website' ? `<button data-act="left">${icon('arrowRight')} Move left in the menu</button><button data-act="right">${icon('arrowRight')} Move right in the menu</button>
        <button data-act="hide">${icon('eye')} ${s.settings?.hideInMenu ? 'Show in the menu' : 'Hide from the menu'}</button>`
        : s.id === m.entry ? '' : '<button data-act="start">' + icon('play') + ' Make this the start page</button>'}
        <button data-act="rename">${icon('pencil')} Rename / change URL</button><button data-act="delete" class="danger">${icon('trash')} Delete page</button>`;
      t.closest('.node').append(menu);
      menu.onclick = async (ev) => {
        const act = ev.target.dataset.act;
        closeMenu();
        if (act === 'start') { m.entry = s.id; renderNodes(); await save({ entry_step_id: s.id }); toast('Visitors now start on this page'); }
        if (act === 'left' || act === 'right') {
          const order = [...m.steps].sort((x, y) => x.position - y.position || x.id - y.id).map((x) => x.id);
          const i = order.indexOf(s.id), j = i + (act === 'left' ? -1 : 1);
          if (j < 0 || j >= order.length) { toast(act === 'left' ? 'Already first in the menu' : 'Already last in the menu'); return; }
          [order[i], order[j]] = [order[j], order[i]];
          await api('PUT', `/api/websites/${id}/order`, { ids: order });
          order.forEach((sid, k) => { byId()[sid].position = k; });
          const pos = layout(); m.steps.forEach((x) => Object.assign(x, pos[x.id]));
          await save({ steps: m.steps.map((x) => ({ id: x.id, x: x.x, y: x.y })) });
          return reload();
        }
        if (act === 'hide') {
          await api('PUT', `/api/steps/${s.id}`, { name: s.name, settings: { ...s.settings, hideInMenu: !s.settings?.hideInMenu } });
          toast(s.settings?.hideInMenu ? 'Back in the menu' : 'Hidden from the menu (still reachable by link)'); return reload();
        }
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
    const r = await modal('Page settings', `<label class="f">Name<input name="name" required value="${esc(f.name)}"></label>
      <label class="f">URL <span class="hint">${esc(state.me.baseUrl)}/f/<b>this-part</b></span><input name="slug" required value="${esc(f.slug)}"></label>
      <p class="hint">Your domain is connected once for the whole business in <a href="#/settings">Settings</a>; this page then lives at /<b>${esc(f.slug)}</b> on it.</p>`,
    { onSubmit: (v) => api('PUT', `/api/funnels/${id}`, v) });
    if (r) { toast('Saved'); reload(); }
  };
  $('[data-del]').onclick = async () => {
    location.hash = '#/flows';
    deleteWithUndo(`“${f.name}” deleted`, { url: `/api/funnels/${id}`, hide: () => () => { location.hash = `#/funnels/${id}`; }, done: () => { if (location.hash === '#/flows') viewFlows(); } });
  };

  renderNodes();
  loadThumbs();
  fit();
}

function bindCopy() {
  $$('[data-copy]').forEach((b) => { b.onclick = async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); toast('Link copied'); } catch { toast('Copy failed: select the link and copy it manually', true); }
  }; });
}

// Copy-and-paste code to show this flow's first page on any other website.
function embedCode(f) {
  const start = f.steps.find((s) => s.id === f.entry_step_id) || f.steps[0];
  if (!start) { toast('Add a page first', true); return; }
  const origin = location.origin;
  const page = `${origin}/f/${f.slug}${start.id === f.entry_step_id ? '' : `/${start.slug}`}`;
  const inline = `<iframe data-rilly src="${page}?embed=1" style="width:100%;border:0;min-height:420px" title="${f.name.replace(/"/g, '')}"></iframe>\n<script src="${origin}/embed.js" async></script>`;
  const pop = (d) => `<script src="${origin}/embed.js" data-popup="${page}" ${d === 'exit' ? 'data-trigger="exit"' : `data-delay="${d}"`} async></script>`;
  const box = (id, code) => `<div class="embed-code"><textarea readonly rows="${code.split('\n').length + 1}" data-code="${id}">${esc(code)}</textarea><button type="button" class="btn sm" data-copy="${esc(code)}">Copy</button></div>`;
  modal('Put it on another website', `<p class="muted small">Paste the code into your other site (WordPress, Squarespace, Wix, Shopify, Webflow…) where you want it. Sign-ups land in Rilly with their follow-ups, just like on your Rilly page.</p>
    ${f.status === 'live' ? '' : `<p class="banner">${icon('alert')} Publish this flow first, or visitors will see “not published”.</p>`}
    <h3>In the page</h3>${box('inline', inline)}
    <h3>As a popup</h3>
    <label class="f">Show it<select data-popwhen><option value="8">8 seconds after they arrive</option><option value="20">20 seconds after they arrive</option><option value="exit">When they go to leave</option></select></label>
    ${box('popup', pop('8'))}
    <p class="hint">Someone who closes the popup won’t see it again for a week. Put the popup code just before &lt;/body&gt;, or in your site’s “custom code” setting.</p>`, { submit: 'Done' });
  setTimeout(() => {
    bindCopy();
    const sel = $('[data-popwhen]');
    if (sel) sel.onchange = () => { const code = pop(sel.value); const ta = $('[data-code="popup"]'); ta.value = code; ta.nextElementSibling.dataset.copy = code; };
  });
}
