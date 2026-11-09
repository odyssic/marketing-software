'use strict';

// ---------------- Workflows ----------------
// One map per workflow: a trigger, then waits, emails, yes/no splits and
// actions. Email sequences are just email + wait steps on the map.
const STEP_UI = {
  trigger: { icon: icon('bolt'), label: 'Trigger', color: '#1f7f78' },
  wait: { icon: icon('clock'), label: 'Wait', color: '#475569', hint: 'Pause for days or hours' },
  email: { icon: icon('mail'), label: 'Send email', color: '#475569', hint: 'An email in the sequence' },
  sms: { icon: icon('chat'), label: 'Send text', color: '#475569', hint: 'A text, to people who said yes to texts' },
  condition: { icon: icon('branch'), label: 'Yes / no split', color: '#475569', hint: 'Branch on what they did' },
  tag: { icon: icon('tag'), label: 'Tag', color: '#475569', hint: 'Add or remove tags' },
  subscribe: { icon: icon('inbox'), label: 'Subscribe', color: '#475569', hint: 'Add to a newsletter' },
  notify: { icon: icon('bell'), label: 'Notify me', color: '#475569', hint: 'Email you to follow up personally' },
  deal: { icon: icon('briefcase'), label: 'Create deal', color: '#475569', hint: 'Add to a pipeline' },
};
const PALETTE = ['email', 'sms', 'wait', 'condition', 'tag', 'subscribe', 'notify', 'deal'];
const TRIGGER_UI = {
  signup: 'Signs up (any form or page)', purchase: 'Buys something', tag_added: 'Gets a tag', subscribe: 'Subscribes to a newsletter',
  inquiry: 'Sends an inquiry', booking: 'Books a call', silent: 'Goes quiet (no activity for a while)',
  birthday: 'Has a birthday', anniversary: 'Reaches a customer anniversary', renewal: 'Has a subscription renewing soon', community_join: 'Joins the community', manual: 'Added by hand',
};
const CONDITION_UI = {
  purchased_since: 'Did they buy something since this started?', purchased: 'Has ever bought?', opened: 'Opened any email in this follow-up?',
  clicked: 'Clicked any email in this follow-up?', has_tag: 'Has a tag?', stage_is: 'Is at a stage?', has_email: 'Can be emailed?',
  guide_unopened: 'Haven’t opened the guide yet?', clicked_last: 'Clicked a link in the last email?', opened_last: 'Opened the last email?', replied: 'Replied (text, email or chat)?', booked_since: 'Booked a call?',
};
const leverPill = (k) => `<span class="lever-tag" style="--c:${LEVER_UI[k]?.color || '#64748b'}">${esc(LEVER_UI[k]?.label || k)}</span>`;

async function viewWorkflows() {
  const list = await api('GET', '/api/workflows');
  // Live follow-ups that start on exactly the same thing: one person would get both.
  const same = {};
  list.filter((w) => w.status === 'active').forEach((w) => { (same[w.triggerKey] = same[w.triggerKey] || []).push(w); });
  const twins = (w) => (w.status === 'active' ? (same[w.triggerKey] || []).filter((x) => x.id !== w.id) : []);
  shell('workflows', `
    <div class="head"><div><h1>Workflows</h1><div class="muted">Follow-ups that run themselves. <b>On</b> means it’s running: every time its trigger happens, from any page or import, it starts for that person. <b>Off</b> means nothing sends.</div></div>
      <button class="btn primary" data-new>+ New workflow</button></div>
    <div class="wf-grid">${list.map((w) => `<article class="wf-card" data-open="${w.id}" tabindex="0">
      <div class="row" style="justify-content:space-between;align-items:flex-start;flex-wrap:nowrap">
        <div><div class="row" style="gap:6px;margin-bottom:6px">${leverPill(w.lever)}${w.status === 'active' ? '<span class="pill ok">On · running</span>' : '<span class="pill">Off</span>'}</div>
          <h3>${esc(w.name)}</h3></div>
        <label class="switch" title="${w.status === 'active' ? 'Turn off' : 'Turn on'}"><input type="checkbox" data-toggle="${w.id}" ${w.status === 'active' ? 'checked' : ''}><span></span></label></div>
      <p class="muted small">${icon('bolt')} ${w.status === 'active' ? 'Runs when someone' : 'Would run when someone'} ${esc((w.triggerLabel || '').toLowerCase())}</p>
      ${twins(w).length ? `<p class="wf-twin">${icon('alert')} Also on: “${esc(twins(w)[0].name)}”${twins(w).length > 1 ? ` and ${twins(w).length - 1} more` : ''} starts on the same thing, so people get both. Turn one off?</p>` : ''}
      <div class="wf-meta"><span>${icon('mail')} ${w.emails} email${w.emails === 1 ? '' : 's'}</span><span>${w.steps} step${w.steps === 1 ? '' : 's'}</span>
        <span>${w.active_runs} in progress</span><span>${w.emails_sent} sent</span></div></article>`).join('')}</div>`);
  $$('[data-open]').forEach((c) => {
    c.onclick = (e) => { if (!e.target.closest('.switch')) location.hash = `#/workflows/${c.dataset.open}`; };
    c.onkeydown = (e) => { if (e.key === 'Enter') location.hash = `#/workflows/${c.dataset.open}`; };
  });
  $$('[data-toggle]').forEach((t) => { t.onchange = async () => {
    try {
      await api('PUT', `/api/workflows/${t.dataset.toggle}/status`, { status: t.checked ? 'active' : 'paused' });
      toast(t.checked ? 'On: it runs every time its trigger happens' : 'Off: nothing will send');
      viewWorkflows();
    } catch (err) { t.checked = !t.checked; toast(err.message, true); }
  }; });
  $('[data-new]').onclick = newWorkflow;
}

async function newWorkflow() {
  const templates = await api('GET', '/api/workflow-templates');
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal wide" role="dialog" aria-label="New workflow"><h2>Start a workflow</h2>
    <p class="muted small">Pick a starting point. Everything is editable on the map.</p>
    <div class="tpl-grid">${templates.map((t) => `<button class="tpl" data-tpl="${t.key}">
      <div class="row" style="gap:6px">${leverPill(t.lever)}<span class="muted small">${t.emails} email${t.emails === 1 ? '' : 's'}</span></div>
      <b>${esc(t.name)}</b><span class="muted small">${esc(t.description)}</span></button>`).join('')}</div>
    <div class="actions"><button class="btn" data-x>Cancel</button></div></div>`;
  document.body.append(bg);
  const close = () => bg.remove();
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
  $('[data-x]', bg).onclick = close;
  $$('[data-tpl]', bg).forEach((b) => { b.onclick = async () => {
    const r = await api('POST', '/api/workflows', { template: b.dataset.tpl });
    close();
    location.hash = `#/flows/followup/${r.id}`;
  }; });
  $('[data-tpl]', bg).focus();
}

// ---------- Builder ----------
const wf = { w: null, selected: null, saveTimer: null, pipelines: [], funnels: [] };

async function viewWorkflow(workflowId) {
  const [w, pipelines, funnels] = await Promise.all([api('GET', `/api/workflows/${workflowId}`), api('GET', '/api/pipelines'), api('GET', '/api/funnels')]);
  Object.assign(wf, { w, pipelines, funnels, selected: wf.w?.id === w.id ? wf.selected : w.graph.root });
  if (!w.graph.nodes[wf.selected]) wf.selected = w.graph.root;
  app.innerHTML = `<div class="wfb">
    <div class="bar"><a class="btn sm" href="${w.funnel_id ? `#/funnels/${w.funnel_id}` : `#/flows/followup/${w.id}`}">← Back to the flow</a>
      <div class="title"><input data-name value="${esc(w.name)}" aria-label="Workflow name"></div>
      <select data-lever aria-label="Growth lever" class="sm-select">${['lead', 'conversion', 'upsell', 'continuity'].map((k) => `<option value="${k}" ${w.lever === k ? 'selected' : ''}>${esc(LEVER_UI[k].label)}</option>`).join('')}</select>
      <span class="saved" data-saved>Saved</span>
      <button class="btn sm" data-activity>People</button><button class="btn sm" data-enroll>Add people</button>
      <button class="btn sm ${w.status === 'active' ? '' : 'primary'}" data-status>${w.status === 'active' ? icon('pause') + ' Pause' : icon('play') + ' Turn on'}</button></div>
    <aside class="palette-col" aria-label="Steps"><h3>Steps</h3><p class="hint">Drag onto a + on the map, or click a +.</p>
      ${PALETTE.map((t) => `<div class="pchip" draggable="true" data-ptype="${t}" style="--c:${STEP_UI[t].color}"><span class="pi">${STEP_UI[t].icon}</span><span><b>${STEP_UI[t].label}</b><small>${STEP_UI[t].hint}</small></span></div>`).join('')}</aside>
    <main class="canvas" data-canvas><div data-problems></div><div class="tree" data-tree></div></main>
    <aside class="inspector" data-inspector></aside></div>`;
  renderTree();
  renderInspector();
  renderProblems(w.problems);
  bindBuilderChrome();
  // Wide maps (several branches) open centered on the trigger.
  const cv = $('[data-canvas]');
  cv.scrollLeft = (cv.scrollWidth - cv.clientWidth) / 2;
}

const nodes = () => wf.w.graph.nodes;
function parentOf(key) {
  for (const [k, n] of Object.entries(nodes())) for (const port of ['next', 'yes', 'no']) if (n[port] === key) return [k, port];
  return [null, null];
}
function subtree(key, acc = new Set()) {
  if (!key || !nodes()[key]) return acc;
  acc.add(key);
  const n = nodes()[key];
  for (const port of ['next', 'yes', 'no']) subtree(n[port], acc);
  return acc;
}

// "Hi {{first_name|there}}" → "Hi ‹first name›" for display on the map.
const prettyMerge = (t) => previewMerge(t);
function stepSummary(key) {
  const n = nodes()[key], c = n.config || {};
  switch (n.type) {
    case 'trigger': {
      let s = `When someone ${(TRIGGER_UI[c.event] || '').toLowerCase()}`;
      if (c.funnel_id) s = s.replace(/ \(any form or page\)/, '') + ` on “${wf.funnels.find((f) => f.id === c.funnel_id)?.name || 'a page'}”`;
      if (c.event === 'purchase' && c.product) s += ` matching “${c.product}”`;
      if (c.event === 'tag_added') s += c.tag ? ` “${c.tag}”` : ' (pick a tag)';
      if (c.event === 'silent') s += ` for ${c.days} days`;
      return s;
    }
    case 'wait': return `Wait ${c.days ? `${c.days} day${c.days === 1 ? '' : 's'}` : ''}${c.days && c.hours ? ' ' : ''}${c.hours ? `${c.hours} hour${c.hours === 1 ? '' : 's'}` : ''}${!c.days && !c.hours ? '0 days' : ''}`;
    case 'email': return `${prettyMerge(c.subject) || 'No subject yet'}${c.sendIf ? ` (${SEND_IF_WORDS[c.sendIf] || 'only sometimes'})` : ''}`;
    case 'sms': return prettyMerge(c.body) || 'No message yet';
    case 'condition': return `${CONDITION_UI[c.check] || ''}${c.value ? ` “${c.value}”` : ''}`;
    case 'tag': return [c.add && `Add ${c.add}`, c.remove && `Remove ${c.remove}`].filter(Boolean).join(' · ') || 'Pick tags';
    case 'subscribe': return `Subscribe to ${c.product || 'Newsletter'}`;
    case 'notify': return `Email ${wf.w?.notifyTo || 'me'}${c.message ? `: ${c.message}` : ''}`;
    case 'deal': return c.pipeline_id ? `Add to ${wf.pipelines.find((p) => p.id === c.pipeline_id)?.name || 'pipeline'}` : 'Pick a pipeline';
    default: return '';
  }
}
function statBadge(key) {
  const s = wf.w.stats?.[key];
  if (!s) return '';
  const o = s.outcomes || {};
  const bits = [];
  if (s.at) bits.push(`${s.at} ${nodes()[key].type === 'wait' ? 'waiting' : 'here'}`);
  if (o.sent) bits.push(`${o.sent} sent`);
  if (o.yes || o.no) bits.push(`yes ${o.yes || 0} · no ${o.no || 0}`);
  for (const k of ['tagged', 'subscribed', 'notified', 'deal created']) if (o[k]) bits.push(`${o[k]} ${k}`);
  if (o.skipped) bits.push(`${o.skipped} skipped`);
  if (o.error) bits.push(`${o.error} errors`);
  return bits.length ? `<span class="nstat">${esc(bits.join(' · '))}</span>` : '';
}

function renderTree() {
  const slot = (parent, port) => `<div class="slot" data-slot="${parent}:${port}"><button class="plus" data-plus="${parent}:${port}" aria-label="Add a step here">${icon('plus')}</button></div>`;
  const card = (key) => {
    const n = nodes()[key], ui = STEP_UI[n.type];
    return `<div class="wnode t-${n.type} ${wf.selected === key ? 'sel' : ''}" data-node="${key}" ${n.type === 'trigger' ? '' : 'draggable="true"'} tabindex="0" style="--c:${ui.color}">
      <span class="ni">${ui.icon}</span><span class="nbody"><span class="nt">${esc(ui.label)}</span><span class="ns">${esc(stepSummary(key))}</span>${statBadge(key)}</span></div>`;
  };
  const chain = (parent, port) => {
    const key = nodes()[parent][port];
    if (!key) return `${slot(parent, port)}<div class="end">${port === 'next' && nodes()[parent].type === 'trigger' ? 'Add the first step' : 'End'}</div>`;
    const n = nodes()[key];
    if (n.type === 'condition') {
      return `${slot(parent, port)}${card(key)}<div class="branches">
        <div class="branch yes"><div class="blabel">Yes</div>${chain(key, 'yes')}</div>
        <div class="branch no"><div class="blabel">No</div>${chain(key, 'no')}</div></div>`;
    }
    return `${slot(parent, port)}${card(key)}${chain(key, 'next')}`;
  };
  const root = wf.w.graph.root;
  $('[data-tree]').innerHTML = card(root) + chain(root, 'next');
  bindTree();
}

function bindTree() {
  const tree = $('[data-tree]');
  $$('[data-node]', tree).forEach((el) => {
    el.onclick = () => { wf.selected = el.dataset.node; renderTree(); renderInspector(); };
    el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); } };
    el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-node', el.dataset.node); e.dataTransfer.effectAllowed = 'move'; tree.classList.add('dragging'); });
    el.addEventListener('dragend', () => tree.classList.remove('dragging'));
  });
  $$('[data-slot]', tree).forEach((s) => {
    s.addEventListener('dragover', (e) => { e.preventDefault(); s.classList.add('over'); });
    s.addEventListener('dragleave', () => s.classList.remove('over'));
    s.addEventListener('drop', (e) => {
      e.preventDefault(); s.classList.remove('over'); tree.classList.remove('dragging');
      const [parent, port] = s.dataset.slot.split(':');
      const type = e.dataTransfer.getData('text/x-type');
      const moving = e.dataTransfer.getData('text/x-node');
      if (type) insertStep(type, parent, port);
      else if (moving) moveStep(moving, parent, port);
    });
  });
  $$('[data-plus]', tree).forEach((b) => { b.onclick = (e) => { e.stopPropagation(); plusMenu(b); }; });
}

function plusMenu(btn) {
  $('.plus-menu')?.remove();
  const [parent, port] = btn.dataset.plus.split(':');
  const m = document.createElement('div');
  m.className = 'plus-menu';
  m.setAttribute('role', 'menu');
  m.innerHTML = PALETTE.map((t) => `<button role="menuitem" data-add="${t}"><span>${STEP_UI[t].icon}</span>${STEP_UI[t].label}</button>`).join('');
  btn.parentNode.append(m);
  const close = () => { m.remove(); document.removeEventListener('click', close); };
  setTimeout(() => document.addEventListener('click', close));
  m.onkeydown = (e) => { if (e.key === 'Escape') { close(); btn.focus(); } };
  $$('[data-add]', m).forEach((b) => { b.onclick = () => { close(); insertStep(b.dataset.add, parent, port); }; });
  $('button', m).focus();
}

const DEFAULT_CONFIG = {
  wait: () => ({ days: 1, hours: 0 }), email: () => ({ subject: '', body: 'Hi {{first_name|there}},\n\n\n\n{{business}}' }), sms: () => ({ body: 'Hi {{first_name|there}}, it’s {{business}}. ' }),
  condition: () => ({ check: 'purchased_since', value: '' }), tag: () => ({ add: '', remove: '' }), subscribe: () => ({ product: 'Newsletter' }),
  notify: () => ({ message: '' }), deal: () => ({ pipeline_id: wf.pipelines[0]?.id || null, title: '{{name}}', value: 0 }),
};
const newKey = () => `n${Math.random().toString(36).slice(2, 10)}`;

function insertStep(type, parent, port) {
  const key = newKey();
  const child = nodes()[parent][port] || null;
  nodes()[key] = type === 'condition' ? { type, config: DEFAULT_CONFIG[type](), yes: child, no: null } : { type, config: DEFAULT_CONFIG[type](), next: child };
  nodes()[parent][port] = key;
  wf.selected = key;
  changed();
}

function moveStep(key, parent, port) {
  const n = nodes()[key];
  if (!n || n.type === 'trigger') return;
  if (subtree(key).has(parent) && (n.type === 'condition' || parent === key)) { if (parent !== key) toast('A step can’t move inside itself', true); return; }
  const [p, pp] = parentOf(key);
  if (p === parent && pp === port) return; // dropped where it already is
  if (n.type === 'condition') {
    if (nodes()[parent][port]) { toast('Drop a yes/no split at the end of a path', true); return; }
    nodes()[p][pp] = null;
    nodes()[parent][port] = key;
  } else {
    nodes()[p][pp] = n.next || null;
    n.next = nodes()[parent][port] || null;
    nodes()[parent][port] = key;
  }
  wf.selected = key;
  changed();
}

function deleteStep(key) {
  const before = JSON.parse(JSON.stringify(wf.w.graph));
  const n = nodes()[key];
  const [p, pp] = parentOf(key);
  if (n.type === 'condition') {
    const lost = [...subtree(n.no)];
    for (const k of lost) delete nodes()[k];
    nodes()[p][pp] = n.yes || null;
  } else nodes()[p][pp] = n.next || null;
  delete nodes()[key];
  wf.selected = p;
  changed();
  undoToast(n.type === 'condition' ? 'Split removed (the “Yes” path stays)' : 'Step removed', () => { wf.w.graph = before; wf.selected = key; changed(); });
}

// Swap a step with the one above or below it in the same path (keyboard and touch friendly).
function shiftStep(key, dir) {
  const n = nodes()[key];
  const [p, pp] = parentOf(key);
  if (dir < 0) {
    const pn = nodes()[p];
    if (!pn || pn.type === 'trigger' || pn.type === 'condition' || pp !== 'next') return;
    const [g, gp] = parentOf(p);
    nodes()[g][gp] = key; pn.next = n.next || null; n.next = p;
  } else {
    const c = n.next && nodes()[n.next];
    if (!c || c.type === 'condition') return;
    const ck = n.next;
    nodes()[p][pp] = ck; n.next = c.next || null; c.next = key;
  }
  changed();
}

function changed() {
  renderTree();
  renderInspector();
  scheduleSave();
}
function scheduleSave(extra = {}) {
  $('[data-saved]').textContent = 'Saving…';
  clearTimeout(wf.saveTimer);
  wf.saveTimer = setTimeout(async () => {
    try {
      const r = await api('PUT', `/api/workflows/${wf.w.id}`, { graph: wf.w.graph, name: $('[data-name]').value, lever: $('[data-lever]').value, ...extra });
      wf.w.problems = r.problems;
      renderProblems(r.problems);
      $('[data-saved]').textContent = 'Saved';
    } catch (err) {
      $('[data-saved]').textContent = 'Not saved';
      toast(err.message, true);
    }
  }, 600);
}
function renderProblems(list) {
  const el = $('[data-problems]');
  if (!el) return;
  el.innerHTML = list?.length ? `<div class="banner"><b>Before turning this on:</b><ul style="margin:6px 0 0 18px;padding:0">${list.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>` : '';
}

function renderInspector() {
  const key = wf.selected, n = nodes()[key], ui = STEP_UI[n.type], c = n.config;
  const [p, pp] = parentOf(key);
  const canUp = p && pp === 'next' && !['trigger', 'condition'].includes(nodes()[p]?.type);
  const canDown = n.type !== 'condition' && n.next && nodes()[n.next]?.type !== 'condition';
  const field = (label, html, hint = '') => `<label class="f">${label}${hint ? ` <span class="hint">${hint}</span>` : ''}${html}</label>`;
  let body = '';
  switch (n.type) {
    case 'trigger':
      body = field('Start when someone…', `<select data-c="event">${Object.entries(TRIGGER_UI).map(([k, l]) => `<option value="${k}" ${c.event === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`)
        + (['signup', 'subscribe', 'inquiry', 'purchase'].includes(c.event) ? field('From', `<select data-c="funnel_id" data-num><option value="">Anywhere (any form, page or import)</option>${wf.funnels.map((f) => `<option value="${f.id}" ${c.funnel_id === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select>`) : '')
        + (c.event === 'purchase' ? field('Product name contains', `<input data-c="product" value="${esc(c.product)}" placeholder="Any product">`, 'optional') : '')
        + (c.event === 'tag_added' ? field('Tag', `<input data-c="tag" value="${esc(c.tag)}" placeholder="e.g. vip">`) : '')
        + (c.event === 'silent' ? field('Quiet for (days)', `<input type="number" min="1" data-c="days" data-num value="${c.days}">`, 'only past customers') : '')
        + (['birthday', 'anniversary', 'renewal'].includes(c.event) ? field('When', `<select data-c="before" data-num>${[[0, 'On the day'], [1, '1 day before'], [3, '3 days before'], [7, 'A week before'], [14, 'Two weeks before']].map(([v, l]) => `<option value="${v}" ${Number(c.before || 0) === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`,
          c.event === 'birthday' ? 'uses the birthday on each person (People, or a form that asks for it)' : c.event === 'renewal' ? 'monthly and yearly products' : 'each year after their first purchase') : '')
        + (['purchase', 'inquiry', 'tag_added'].includes(c.event) ? `<label class="check"><input type="checkbox" data-c="repeat" ${c.repeat ? 'checked' : ''}>Run again each time it happens</label>` : '')
        + '<p class="hint">Events from imports older than 2 days never start a workflow, so importing history won’t email old customers.</p>';
      break;
    case 'wait':
      body = `<div class="colors" style="grid-template-columns:1fr 1fr">${field('Days', `<input type="number" min="0" data-c="days" data-num value="${c.days}">`)}${field('Hours', `<input type="number" min="0" max="23" data-c="hours" data-num value="${c.hours}">`)}</div>`;
      break;
    case 'email':
      body = field('Subject', `<input data-c="subject" value="${esc(c.subject)}" placeholder="e.g. Welcome, {{first_name|friend}}!">`)
        + field('Message', `<textarea data-c="body" rows="12">${esc(c.body)}</textarea>`)
        + field('Who gets it', `<select data-c="sendIf"><option value="">Everyone who reaches this step</option>${Object.entries(SEND_IF_WORDS).map(([k, l]) => `<option value="${k}" ${c.sendIf === k ? 'selected' : ''}>Send ${esc(l)}</option>`).join('')}</select>`, 'skipped people carry on to the next step')
        + `<div class="row" style="gap:4px;margin:-4px 0 10px">${['{{first_name|there}}', '{{last_name}}', '{{business}}', '{{guide_link}}'].map((t) => `<button class="chip" data-insert="${esc(t)}">${esc(t)}</button>`).join('')}</div>
        <p class="hint">An unsubscribe link is added automatically. Links are tracked so the map can branch on clicks.</p>
        <button class="btn sm" data-test>Send me a test</button>`;
      break;
    case 'sms':
      body = field('Text message', `<textarea data-c="body" rows="4" maxlength="480">${esc(c.body)}</textarea>`, `${(c.body || '').length}/160 per text`)
        + `<div class="row" style="gap:4px;margin:-4px 0 10px">${['{{first_name|there}}', '{{business}}'].map((t) => `<button class="chip" data-insert="${esc(t)}">${esc(t)}</button>`).join('')}</div>
        <p class="hint">Only goes to people who ticked “text me” on a form or texted you first, and never after they reply STOP. Texts wait until 8am if it’s late at night. The first one adds “Reply STOP to opt out.”</p>`;
      break;
    case 'condition':
      body = field('Check', `<select data-c="check">${Object.entries(CONDITION_UI).map(([k, l]) => `<option value="${k}" ${c.check === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`)
        + (c.check === 'has_tag' ? field('Tag', `<input data-c="value" value="${esc(c.value)}">`) : '')
        + (c.check === 'stage_is' ? field('Stage', `<select data-c="value">${['audience', 'lead', 'customer', 'regular'].map((s) => `<option ${c.value === s ? 'selected' : ''}>${s}</option>`).join('')}</select>`) : '')
        + '<p class="hint">People who match go down “Yes”, everyone else down “No”.</p>';
      break;
    case 'tag':
      body = field('Add tags', `<input data-c="add" value="${esc(c.add)}" placeholder="comma separated">`) + field('Remove tags', `<input data-c="remove" value="${esc(c.remove)}">`);
      break;
    case 'subscribe':
      body = field('Newsletter', `<input data-c="product" value="${esc(c.product)}">`);
      break;
    case 'notify':
      body = `<p class="notify-to">${icon('mail')} Sends an email to <b>${esc(wf.w?.notifyTo || 'you')}</b> <a href="#/settings" class="small">change</a></p>
        <p class="hint" style="margin-top:-4px">Use it when a person needs your personal touch. The email names the person, links to their record, and includes your note.</p>`
        + field('Your note to yourself', `<textarea data-c="message" rows="3" placeholder="e.g. Call to thank them and ask what they’re restoring">${esc(c.message)}</textarea>`);
      break;
      break;
    case 'deal':
      body = field('Pipeline', `<select data-c="pipeline_id" data-num><option value="">Pick a pipeline</option>${wf.pipelines.map((pl) => `<option value="${pl.id}" ${c.pipeline_id === pl.id ? 'selected' : ''}>${esc(pl.name)}</option>`).join('')}</select>`)
        + (wf.pipelines.length ? '' : '<p class="hint"><a href="#/pipelines">Create a pipeline</a> first.</p>')
        + field('Deal name', `<input data-c="title" value="${esc(c.title)}">`, '{{name}} works') + field('Value', `<input type="number" min="0" data-c="value" data-num value="${c.value || ''}">`);
      break;
  }
  $('[data-inspector]').innerHTML = `<div class="ihead" style="--c:${ui.color}"><span class="ni">${ui.icon}</span><b>${esc(ui.label)}</b></div>
    ${body}
    ${n.type === 'trigger' ? '' : `<div class="row" style="margin-top:14px;justify-content:space-between">
      <span class="row" style="gap:4px"><button class="btn sm" data-up ${canUp ? '' : 'disabled'} aria-label="Move up">↑ Move up</button><button class="btn sm" data-down ${canDown ? '' : 'disabled'} aria-label="Move down">↓ Down</button></span>
      <button class="btn sm danger" data-del>Delete step</button></div>`}`;
  const ins = $('[data-inspector]');
  $$('[data-c]', ins).forEach((el) => {
    const evt = el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input';
    el.addEventListener(evt, () => {
      const k = el.dataset.c;
      c[k] = el.type === 'checkbox' ? el.checked : el.dataset.num !== undefined ? (el.value === '' ? null : Number(el.value)) : el.value;
      if (evt === 'change') { renderTree(); renderInspector(); } else {
        const ns = $(`[data-node="${key}"] .ns`);
        if (ns) ns.textContent = stepSummary(key);
      }
      scheduleSave();
    });
  });
  $$('[data-insert]', ins).forEach((b) => { b.onclick = () => {
    const ta = $('textarea[data-c=body]', ins);
    const at = ta.selectionStart ?? ta.value.length;
    ta.value = ta.value.slice(0, at) + b.dataset.insert + ta.value.slice(ta.selectionEnd ?? at);
    ta.dispatchEvent(new Event('input'));
    ta.focus();
  }; });
  const t = $('[data-test]', ins);
  if (t) t.onclick = async () => {
    try { const r = await api('POST', `/api/workflows/${wf.w.id}/test-email`, { subject: c.subject, body: c.body }); toast(`Test sent to ${r.to}${r.status === 'logged' ? ' (dev mode: see Email → Outbox)' : ''}`); } catch (err) { toast(err.message, true); }
  };
  const del = $('[data-del]', ins); if (del) del.onclick = () => deleteStep(key);
  const up = $('[data-up]', ins); if (up) up.onclick = () => shiftStep(key, -1);
  const dn = $('[data-down]', ins); if (dn) dn.onclick = () => shiftStep(key, 1);
}

function bindBuilderChrome() {
  $$('.pchip').forEach((ch) => {
    ch.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-type', ch.dataset.ptype); e.dataTransfer.effectAllowed = 'copy'; $('[data-tree]').classList.add('dragging'); });
    ch.addEventListener('dragend', () => $('[data-tree]').classList.remove('dragging'));
    // Click a palette step: add it at the end of the selected step's path.
    ch.onclick = () => {
      let k = wf.selected;
      while (nodes()[k] && nodes()[k].type !== 'condition' && nodes()[k].next) k = nodes()[k].next;
      if (nodes()[k].type === 'condition') { toast('Use a + under Yes or No to add after a split'); return; }
      insertStep(ch.dataset.ptype, k, 'next');
    };
  });
  $('[data-name]').addEventListener('input', () => scheduleSave());
  $('[data-lever]').addEventListener('change', () => scheduleSave());
  $('[data-status]').onclick = async () => {
    const on = wf.w.status !== 'active';
    try {
      clearTimeout(wf.saveTimer);
      await api('PUT', `/api/workflows/${wf.w.id}`, { graph: wf.w.graph, name: $('[data-name]').value, lever: $('[data-lever]').value });
      await api('PUT', `/api/workflows/${wf.w.id}/status`, { status: on ? 'active' : 'paused' });
      toast(on ? 'Live: new people will flow through this map' : 'Paused: nobody moves until you turn it back on');
      viewWorkflow(wf.w.id);
    } catch (err) { toast(err.message, true); }
  };
  $('[data-enroll]').onclick = async () => {
    const tags = await api('GET', '/api/tags');
    const r = await modal('Add people to this workflow', `
      <label class="f">Who<select name="by"><option value="stage">Everyone at a stage</option><option value="tag">Everyone with a tag</option></select></label>
      <label class="f">Stage<select name="stage">${['audience', 'lead', 'customer', 'regular'].map((s) => `<option>${s}</option>`).join('')}</select></label>
      <label class="f">or Tag<select name="tag"><option value="">—</option>${tags.map((t) => `<option value="${esc(t.tag)}">${esc(t.tag)} (${t.count})</option>`).join('')}</select></label>
      <p class="hint">People already in this workflow today aren’t added twice.${wf.w.status === 'active' ? '' : ' The workflow is off, so they’ll wait at the start until you turn it on.'}</p>`,
    { submit: 'Add people', onSubmit: (v) => api('POST', `/api/workflows/${wf.w.id}/enroll`, v.by === 'tag' ? { tag: v.tag } : { stage: v.stage }) });
    if (r) { toast(`${r.added} added${r.matched > r.added ? ` (${r.matched - r.added} already in)` : ''}`); viewWorkflow(wf.w.id); }
  };
  $('[data-activity]').onclick = async () => {
    const runs = await api('GET', `/api/workflows/${wf.w.id}/runs`);
    modal('People in this workflow', runs.length ? `<div class="table-wrap" style="max-height:60vh"><table class="mini"><tr><th>Person</th><th>Where</th><th>Status</th><th>Started</th></tr>
      ${runs.map((r) => `<tr><td><a href="#/people/${r.person_id}">${esc(r.name || r.email)}</a></td><td>${r.node_id && nodes()[r.node_id] ? esc(STEP_UI[nodes()[r.node_id].type].label) : '—'}</td>
        <td>${esc(r.status)}</td><td class="muted">${fmtDate(r.created_at)}</td></tr>`).join('')}</table></div>` : '<p class="muted">Nobody yet.</p>', { submit: 'Close' });
  };
}
