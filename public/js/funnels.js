'use strict';

// ---------------- Funnels ----------------
async function viewFunnels() {
  const funnels = await api('GET', '/api/funnels');
  shell('pages', `${PAGES_TABS('funnels')}
    <div class="head"><div><h1>Funnels</h1><div class="muted">Landing pages that turn visitors into contacts.</div></div>
      <button class="btn primary" data-new>+ New funnel</button></div>
    ${funnels.length ? `<div class="card table-wrap"><table>
      <tr><th>Name</th><th>Pages</th><th>Views</th><th>Opt-ins</th><th>Conversion</th><th>Created</th></tr>
      ${funnels.map((f) => `<tr class="click" data-go="#/funnels/${f.id}"><td><strong>${esc(f.name)}</strong><div class="muted small">/f/${esc(f.slug)}</div></td>
        <td>${f.steps}</td><td>${f.views}</td><td>${f.optins}</td><td>${f.views ? Math.round((f.optins / f.views) * 1000) / 10 : 0}%</td><td>${fmtDate(f.created_at)}</td></tr>`).join('')}
    </table></div>` : `<div class="card empty"><div class="big">${icon('magnet')}</div><h2>No funnels yet</h2>
      <p>Pick a template and you’ll have a live page in under a minute.</p><button class="btn primary" data-new>Create your first funnel</button></div>`}`);
  bindRowLinks();
  $$('[data-new]').forEach((b) => { b.onclick = newFunnel; });
}

async function newFunnel() {
  const templates = await api('GET', '/api/templates');
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<form class="modal wide"><h2>New funnel</h2>
    <div class="describe"><label class="f" style="margin:0">Describe it in one sentence <span class="hint">we’ll pick the pages and write the words${state.me.aiLive ? ' in your voice' : ''}</span>
      <textarea data-sentence rows="2" placeholder="e.g. A free glaze guide for beginner potters that leads to my $49 starter kit"></textarea></label>
      <div class="row" style="margin-top:8px"><button type="button" class="btn primary" data-describe>${icon('sparkle')} Build it for me</button><span class="err" data-derr style="margin:0"></span></div></div>
    <div class="or"><span>or pick a template</span></div>
    <label class="f">Funnel name<input name="name" placeholder="e.g. Free glaze guide"></label>
    <div class="f" style="margin-bottom:6px;font-size:.85rem;font-weight:500">Start from</div>
    <div class="tpl-grid" role="radiogroup">${templates.map((t, i) => `<label class="tpl ${i === 0 ? 'on' : ''}"><input type="radio" name="template" value="${t.key}" ${i === 0 ? 'checked' : ''} class="sr">
      <b>${esc(t.label)}</b><span class="muted small">${esc(t.description)}</span>
      <span class="small">${t.pages} page${t.pages === 1 ? '' : 's'}${t.workflows.length ? ` · ${icon('bolt')} ${t.workflows.map(esc).join(', ')}` : ''}</span></label>`).join('')}</div>
    <p class="hint">Follow-up workflows are created switched off, so you can review the emails first.</p>
    <div class="err"></div><div class="actions"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary">Create funnel</button></div></form>`;
  document.body.append(bg);
  const close = () => { bg.remove(); if (location.hash === '#/funnels/new') location.hash = '#/funnels'; };
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
  $('[data-x]', bg).onclick = close;
  $$('input[name=template]', bg).forEach((r) => { r.onchange = () => $$('.tpl', bg).forEach((l) => l.classList.toggle('on', l.contains(r) && r.checked)); });
  $('[data-sentence]', bg).focus();
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
    if (!$('[name=name]', bg).value.trim()) { $('.err:not([data-derr])', bg).textContent = 'Name the funnel, or describe it above'; $('[name=name]', bg).focus(); return; }
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
const ROW_GAP = 90;
const NODE_H = 300; // card height with its page picture
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
    pos[id] = { x: col * (NODE_W + COL_GAP), y: depth[id] * (NODE_H + ROW_GAP) };
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
  shell('pages', `${PAGES_TABS('funnels')}
    <div class="head" style="margin-bottom:14px"><div><a href="#/funnels" class="small">← All funnels</a>
      <h1 style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">${esc(f.name)} ${f.status === 'live' ? '<span class="pill ok">Live</span>' : '<span class="pill warn">Draft</span>'} ${purposeTag(f)}</h1></div>
      <div class="row"><div class="copy" style="min-width:320px"><input readonly value="${esc(link)}" aria-label="Funnel link">
        <button class="btn" data-copy="${esc(link)}">Copy</button><a class="btn" href="${esc(link)}" target="_blank" rel="noopener">Open ${icon('external')}</a></div>
        <button class="btn" data-rename>Settings</button><button class="btn" data-dup title="Make a copy of this funnel, its pages and follow-ups">${icon('copy')} Duplicate</button><button class="btn danger" data-del>Delete</button>
        ${f.status === 'live' ? '<button class="btn" data-unpublish>Unpublish</button>' : '<button class="btn primary" data-publish>Publish</button>'}</div></div>
    <div class="fstats" data-fstats aria-label="Funnel statistics"></div>
    <div data-leak></div>
    <div data-sources></div>
    <details class="fu card" data-fu ${f.workflows?.length ? 'open' : ''}>
      <summary><span>${icon('bolt')} <b>Follow-ups</b> <span class="muted small">emails and steps that run after someone goes through this funnel</span></span>
        <span class="muted small" data-fucount>${f.workflows?.length || 0} workflow${f.workflows?.length === 1 ? '' : 's'}</span></summary>
      <div data-fulist><p class="muted small" style="margin:8px 0">Loading…</p></div>
    </details>
    <div class="map" tabindex="0">
      <div class="map-tools">
        <button class="btn primary sm" data-addpage>+ Add page</button>
        <button class="btn sm" data-tidy title="Arrange pages as a tidy tree">${icon('sparkle')} Tidy up</button>
        <span class="sep"></span>
        <button class="btn sm icon" data-zoom="-1" title="Zoom out">${icon('minus')}</button><span class="zoomlbl" data-zoomlbl>100%</span>
        <button class="btn sm icon" data-zoom="1" title="Zoom in">+</button><button class="btn sm" data-fit>Fit</button>
      </div>
      <div class="map-help">Drag cards to move them · Drag from <b class="y">✓ Yes</b> or <b class="n">✕ No</b> to connect or create a page · Drag the background to pan</div>
      <div class="world"><svg class="edges"></svg><div class="nodes"></div></div>
    </div>`);
  bindCopy();
  bindPurposeTags([f], () => viewFunnel(id));
  $('[data-dup]').onclick = () => duplicateFunnel(f);

  const m = { steps: f.steps, entry: f.entry_step_id, zoom: 1, panX: 40, panY: 40 };
  const mapEl = $('.map'), world = $('.world'), svg = $('.edges'), nodesEl = $('.nodes');
  const byId = () => Object.fromEntries(m.steps.map((s) => [s.id, s]));
  // Lever colors, plain-language step metrics and the leakiest step.
  api('GET', `/api/funnels/${id}/flow`).then((flow) => {
    m.flow = flow;
    renderNodes();
    if (flow.leak) {
      const st = byId()[flow.leak.step_id];
      $('[data-leak]').innerHTML = `<div class="banner leak"><b>${icon('flag')} Leakiest step: “${esc(st?.name || '')}”</b> (${esc(flow.leak.plain)}).
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
    if (!await modal('Publish this funnel?', `<p>Everything checks out${pre.problems.length ? ', with a note or two:' : '.'}</p>${list(pre.problems)}<p class="muted small">Your pages go live at the funnel link. You can unpublish any time.</p>`, { submit: 'Publish' })) return;
    try { await api('POST', `/api/funnels/${id}/publish`); toast('Published! Your funnel is live'); viewFunnel(id); } catch (err) { toast(err.message, true); }
  };
  const unpub = $('[data-unpublish]');
  if (unpub) unpub.onclick = async () => {
    if (await confirmBox('Unpublish this funnel?', 'Visitors will see “not published yet” until you publish again.', 'Unpublish')) { await api('POST', `/api/funnels/${id}/unpublish`); toast('Unpublished'); viewFunnel(id); }
  };
  const save = (body) => api('PUT', `/api/funnels/${id}/map`, body).catch((err) => toast(err.message, true));
  const reload = () => viewFunnel(id);

  // First visit (or pages made before the map existed): lay out automatically.
  if (m.steps.some((s) => s.x === null || s.y === null)) {
    const pos = tidyLayout(m.steps, m.entry);
    m.steps.forEach((s) => Object.assign(s, pos[s.id]));
    save({ steps: m.steps.map((s) => ({ id: s.id, x: s.x, y: s.y })) });
  }

  // ---------- Statistics: percentages at a glance ----------
  const pct = (a, b) => (b ? `${Math.round((a / b) * 1000) / 10}%` : '—');
  const renderStats = (mail) => {
    const entry = m.steps.find((s) => s.id === m.entry) || m.steps[0];
    const visitors = entry?.views || 0;
    const optins = m.steps.reduce((n, s) => n + s.optins, 0), sales = m.steps.reduce((n, s) => n + s.sales, 0);
    const tile = (label, value, sub) => `<div class="fstat"><span class="fs-v">${value}</span><span class="fs-l">${label}</span>${sub ? `<span class="fs-s">${sub}</span>` : ''}</div>`;
    $('[data-fstats]').innerHTML = [
      tile('Visitors', visitors, 'on the start page'),
      tile('Opt-in rate', pct(optins, visitors), `${optins} opt-in${optins === 1 ? '' : 's'}`),
      tile('Sale rate', pct(sales, visitors), `${sales} sale${sales === 1 ? '' : 's'}`),
      mail ? tile('Emails opened', pct(mail.opened, mail.sent), `${mail.sent} sent`) : '',
      mail ? tile('Emails clicked', pct(mail.clicked, mail.sent), `${mail.clicked} click${mail.clicked === 1 ? '' : 's'}`) : '',
    ].join('');
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
        <table class="mini"><tr><th>Source</th><th>Visitors</th><th>Leads</th><th>Sales</th><th>Convert</th></tr>
        ${rows.map((r) => `<tr><td><b>${esc(r.source)}</b></td><td>${r.visitors}</td><td>${r.leads}</td><td>${r.sales}</td><td>${r.rate === null ? '—' : `${r.rate}%`}</td></tr>`).join('')}</table>
        <p class="hint">Tip: add <code>?utm_source=facebook&amp;utm_campaign=spring-sale</code> to the links in your ads and posts to see each one separately.</p></div></details>`;
  }).catch(() => {});
  api('GET', `/api/funnels/${id}/email-stats`).then(renderStats).catch(() => {});

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
  const readable = (t) => String(t || '').replace(/\{\{\s*([a-z_]+)[^}]*\}\}/g, (_, k) => `[${k.replace(/_/g, ' ')}]`);
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
  async function renderFollowups() {
    const list = await Promise.all((f.workflows || []).map((w) => api('GET', `/api/workflows/${w.id}`)));
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
              <span class="fu-ico">${icon(FU_ICON[n.type] || 'bolt')}</span><span class="fu-t">${esc(t)}</span><span class="fu-d">${esc(readable(d))}</span>
              ${n.type === 'email' ? `<span class="fu-n">${sent} sent</span>` : ''}</a>`;
        }).join('')}
        ${canAppend ? `<button class="fu-add end" data-fuadd="${w.id}:${last[0]}" title="Add a step at the end">${icon('plus')} Add</button>` : ''}</div>
      </div>`;
    }).join('')}
      <button class="btn sm" data-funew>${icon('plus')} New follow-up for this funnel</button>`;
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
    const v = await modal(n.type === 'email' ? 'Edit email' : 'Edit wait', n.type === 'email' ? emailForm(n.config)
      : `<label class="f">Wait (days)<input name="days" type="number" min="0" max="3650" value="${n.config.days || 0}"></label>`, { submit: 'Save' });
    if (!v) return;
    n.config = n.type === 'email' ? { subject: v.subject, body: v.body } : { days: Number(v.days) || 0, hours: 0 };
    if (await saveGraph(w, w.graph)) toast('Saved');
  }
  async function addStep(w, after) {
    const kind = await modal('Add a step', `<div class="choices">
      <label class="choice"><input type="radio" name="kind" value="email" checked hidden><span class="ci">${icon('mail')}</span><span><b>Send email</b><small>With an optional wait before it</small></span></label>
      <label class="choice"><input type="radio" name="kind" value="wait" hidden><span class="ci">${icon('clock')}</span><span><b>Wait</b><small>Pause before the next step</small></span></label>
      <label class="choice"><input type="radio" name="kind" value="more" hidden><span class="ci">${icon('branch')}</span><span><b>Something else</b><small>Yes/no split, tag, notify me, deal: on the full map</small></span></label></div>`, { submit: 'Next' });
    if (!kind) return;
    if (kind.kind === 'more') { location.hash = `#/workflows/${w.id}`; return; }
    if (kind.kind === 'email') setTimeout(() => { const m = $('.modal'); if (m) bindFieldInserts(m); });
    const v = kind.kind === 'email' ? await modal('New email', emailForm({}, true), { submit: 'Add email' })
      : await modal('Wait', '<label class="f">Wait (days)<input name="days" type="number" min="0" max="3650" value="2"></label>', { submit: 'Add wait' });
    if (!v) return;
    const g = w.graph, prev = g.nodes[after], newKey = () => `n${Math.random().toString(36).slice(2, 8)}`;
    let tail = prev.next ?? null;
    const insert = (node) => { const k = newKey(); g.nodes[k] = { ...node, next: tail }; return k; };
    let first;
    if (kind.kind === 'email') {
      const ek = insert({ type: 'email', config: { subject: v.subject, body: v.body } });
      first = Number(v.days) > 0 ? (tail = ek, insert({ type: 'wait', config: { days: Number(v.days), hours: 0 } })) : ek;
    } else first = insert({ type: 'wait', config: { days: Number(v.days) || 0, hours: 0 } });
    prev.next = first;
    if (await saveGraph(w, g)) toast(kind.kind === 'email' ? 'Email added' : 'Wait added');
  }
  renderFollowups().catch(() => { $('[data-fulist]').innerHTML = '<p class="muted small">Couldn’t load follow-ups.</p>'; });

  const pageIcon = (s) => (s.blocks.some((b) => b.type === 'pricing') ? icon('card') : s.blocks.some((b) => b.type === 'form') ? icon('mail') : icon('page'));
  const pageKind = (s) => (s.blocks.some((b) => b.type === 'pricing') ? 'Sales page' : s.blocks.some((b) => b.type === 'form') ? 'Opt-in page' : 'Page');

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
    const overlap = m.steps.some((a) => m.steps.some((b) => a !== b && Math.abs(a.x - b.x) < NODE_W && b.y > a.y && b.y < a.y + (nodeEl(a.id)?.offsetHeight || NODE_H) + 20));
    if (overlap) {
      const pos = tidyLayout(m.steps, m.entry);
      m.steps.forEach((s) => Object.assign(s, pos[s.id]));
      renderNodes(); fit();
      save({ steps: m.steps.map((s) => ({ id: s.id, x: s.x, y: s.y })) });
    }
  };

  function renderNodes() {
    nodesEl.innerHTML = m.steps.map((s) => `
      <div class="node ${s.id === m.entry ? 'start' : ''} ${m.flow?.leak?.step_id === s.id ? 'leaky' : ''}" data-node="${s.id}" style="left:${s.x}px;top:${s.y}px;width:${NODE_W}px;${m.flow ? `border-top:4px solid ${LEVER_UI[m.flow.levers[s.id]]?.color || 'var(--line)'}` : ''}">
        ${m.flow?.leak?.step_id === s.id ? '<span class="leakpill" title="Fewest people go on from here">' + icon('flag') + ' Leakiest step</span>' : ''}
        ${s.variant_blocks ? '<span class="abpill" title="Split test running on this page">A/B</span>' : ''}
        <div class="node-in" title="Visitors arrive here"></div>
        ${s.id === m.entry ? '<span class="startpill">▶ START</span>' : ''}
        <div class="nhead"><span class="nicon">${pageIcon(s)}</span><div style="min-width:0"><div class="nname">${esc(s.name)}</div>
          <div class="nkind">${pageKind(s)} · /${esc(s.slug)}</div></div>
          <button class="nmenu" data-menu="${s.id}" title="More">${icon('more')}</button></div>
        <a class="nthumb" href="#/editor/${s.id}" title="Edit this page" draggable="false"><iframe tabindex="-1" aria-hidden="true" sandbox="" loading="lazy" data-thumb="${s.id}"${m.thumbs?.[s.id] ? ` srcdoc="${esc(m.thumbs[s.id])}"` : ''}></iframe></a>
        <div class="nstats"><span><b>${s.views}</b> views</span><span><b>${s.optins}</b> opt-ins</span><span><b>${s.sales}</b> sales</span></div>
        <div class="nact"><a class="btn sm primary" href="#/editor/${s.id}">Edit page</a>
          <a class="btn sm" href="${esc(publicUrl(`/f/${f.slug}/${s.slug}`))}" target="_blank" rel="noopener">View ${icon('external')}</a></div>
        <div class="ports">${Object.entries(PORTS).map(([p, d]) => `<div class="port ${p} ${s[d.key] ? 'linked' : ''}" data-port="${p}" data-from="${s.id}"
          title="${s[d.key] ? 'Drag to change where this leads' : 'Drag to a page, or click to add the next page'}">${d.label}</div>`).join('')}</div>
      </div>`).join('') || `<div class="map-empty"><div class="big">${icon('sprout')}</div><p>Every funnel starts with one page.</p>
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
        buttons += `<button class="edge-x" style="left:${mid.x}px;top:${mid.y}px" data-unlink="${s.id}:${p}" title="Remove this link">${icon('x')}</button>`;
        const metric = m.flow?.edges.find((e) => e.from === s.id && e.port === p);
        if (metric && metric.visitors) buttons += `<span class="edge-lbl ${p}" style="left:${mid.x}px;top:${mid.y + 18}px">${esc(metric.plain)}</span>`;
      }
    }
    if (temp) html += `<path class="edge temp ${temp.port}" d="${curve(temp.a, temp.b)}"/>`;
    svg.innerHTML = `<defs>${['yes', 'no'].map((p) => `<marker id="arrow-${p}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10z" class="arrow ${p}"/></marker>`).join('')}</defs>${html}`;
    $$('.edge-x, .edge-lbl', world).forEach((b) => b.remove());
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
      if (!d.s[key]) addPage({ x: d.s.x + (d.port === 'no' ? NODE_W + COL_GAP : 0), y: d.s.y + NODE_H + ROW_GAP }, d.s.id, d.port);
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
      menu.innerHTML = `${s.id === m.entry ? '' : '<button data-act="start">' + icon('play') + ' Make this the start page</button>'}
        <button data-act="rename">${icon('pencil')} Rename / change URL</button><button data-act="delete" class="danger">${icon('trash')} Delete page</button>`;
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
      <label class="f">URL <span class="hint">${esc(state.me.baseUrl)}/f/<b>this-part</b></span><input name="slug" required value="${esc(f.slug)}"></label>
      <p class="hint">Your domain is connected once for the whole business in <a href="#/settings">Settings</a>; this funnel then lives at /<b>${esc(f.slug)}</b> on it.</p>`,
    { onSubmit: (v) => api('PUT', `/api/funnels/${id}`, v) });
    if (r) { toast('Saved'); reload(); }
  };
  $('[data-del]').onclick = async () => {
    if (await confirmBox('Delete funnel?', `“${f.name}” and all its pages and stats will be removed. Contacts and orders are kept.`)) {
      await api('DELETE', `/api/funnels/${id}`); toast('Funnel deleted'); location.hash = '#/funnels';
    }
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
