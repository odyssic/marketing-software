'use strict';

// ---------------- Flows ----------------
// One place for everything that brings people in and follows up with them:
// websites, pageflows and members areas (pages, with their follow-up emails on
// the same map), and follow-ups that start on their own (someone buys, goes
// quiet, gets a tag). Set things up once, where you see them.
const FLOW_TABS = [['', 'All'], ['websites', 'Websites'], ['pageflows', 'Pageflows'], ['members', 'Members areas'], ['followups', 'Follow-ups']];
const FLOW_OPEN = { website: 'websites', members: 'members', funnel: 'funnels' };
const STEP_WORD = { email: 'Email', sms: 'Text', wait: 'Wait', condition: 'Split', tag: 'Tag', notify: 'Notify me', subscribe: 'Subscribe', deal: 'Deal' };
const STEP_ICON = { email: 'mail', sms: 'chat', wait: 'clock', condition: 'branch', tag: 'tag', notify: 'bell', subscribe: 'inbox', deal: 'briefcase' };
const flowText = (t) => String(t || '').replace(/\{\{\s*([a-z_]+)[^}]*\}\}/g, (_, k) => `[${k.replace(/_/g, ' ')}]`);

function flowTabs(on) {
  return `<div class="tabs" style="margin-top:-6px">${FLOW_TABS.map(([k, l]) => `<a href="#/flows${k ? `?show=${k}` : ''}" class="${on === k ? 'active' : ''}">${l}</a>`).join('')}</div>`;
}

async function viewFlows() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const show = FLOW_TABS.some(([k]) => k === params.get('show')) ? params.get('show') : '';
  const q = (params.get('q') || '').toLowerCase();
  const [groupsAll, wfs] = await Promise.all([api('GET', '/api/page-groups'), api('GET', '/api/workflows')]);
  const kindOk = (g) => !show || (show === 'websites' && g.kind === 'website') || (show === 'members' && g.kind === 'members') || (show === 'pageflows' && g.kind !== 'website' && g.kind !== 'members');
  const groups = show === 'followups' ? [] : groupsAll.filter(kindOk)
    .filter((g) => !q || `${g.name} ${g.pages.map((p) => `${p.name} ${p.slug}`).join(' ')}`.toLowerCase().includes(q));
  // Follow-ups that belong to a pageflow live on its map; the rest start on their own.
  const standalone = ['', 'followups'].includes(show) ? wfs.filter((w) => !w.funnel_id)
    .filter((w) => !q || `${w.name} ${w.triggerLabel} ${(w.preview || []).map((x) => x.text).join(' ')}`.toLowerCase().includes(q)) : [];
  const same = {};
  wfs.filter((w) => w.status === 'active').forEach((w) => { (same[w.triggerKey] = same[w.triggerKey] || []).push(w); });
  const twins = (w) => (w.status === 'active' ? (same[w.triggerKey] || []).filter((x) => x.id !== w.id) : []);
  const link = (g, p, i) => publicUrl(`/f/${g.slug}${i === 0 && g.kind !== 'website' ? '' : `/${p.slug}`}`);
  const kindWord = (g) => ({ website: 'Website', members: 'Members area' })[g.kind] || 'Pageflow';

  shell('flows', `
    <div class="head"><div><h1>Flows</h1><div class="muted">Everything that brings people in and follows up with them: your pages, the emails between them, and follow-ups that start on their own.</div></div>
      ${!groupsAll.length && !wfs.filter((w) => !w.funnel_id).length ? '' : `<button class="btn primary" data-newflow>${icon('plus')} New</button>`}</div>
    ${flowTabs(show)}
    <input data-q placeholder="Search flows, pages and emails…" value="${esc(q)}" style="max-width:340px;margin-bottom:14px" aria-label="Search">
    ${groups.map((g) => `<section class="pgroup card">
      <header class="pg-head">
        <div><a class="pg-name" href="#/${FLOW_OPEN[g.kind] || 'funnels'}/${g.id}">${esc(g.name)}</a>
          <span class="muted small">${kindWord(g)} · ${g.pages.length} page${g.pages.length === 1 ? '' : 's'}${g.followups ? ` · ${g.followups} follow-up${g.followups === 1 ? '' : 's'}` : ''}</span></div>
        ${purposeTag(g)}
        ${g.status === 'live' ? '<span class="pill ok">Live</span>' : '<span class="pill warn">Draft</span>'}
        <div class="pg-stats"><span><b>${g.views}</b> visitors</span><span><b>${g.leads}</b> leads &amp; sales</span><span><b>${g.rate === null ? '—' : `${g.rate}%`}</b> convert</span><span class="muted small">last 30 days</span></div>
        <span class="row" style="gap:6px"><button class="btn sm" data-gdup="${g.id}" title="Duplicate">${icon('copy')} Duplicate</button>
          <a class="btn sm" href="#/${FLOW_OPEN[g.kind] || 'funnels'}/${g.id}">Open</a></span>
      </header>
      <div class="pg-strip">${g.pages.map((p, i) => `${i && g.kind !== 'website' ? `<span class="pg-arrow" aria-hidden="true">${icon('arrowRight')}</span>` : ''}
        <figure class="pg-page">
          <a class="pg-thumb" href="#/editor/${p.id}" title="Edit “${esc(p.name)}”"><iframe tabindex="-1" aria-hidden="true" sandbox="" loading="lazy" data-pthumb="${p.id}"></iframe>
            ${i === 0 && g.kind !== 'website' ? '<span class="pg-start">Start</span>' : ''}${p.testing ? '<span class="pg-ab">A/B</span>' : ''}</a>
          <figcaption><b>${esc(p.name)}</b><span class="muted small">${p.views} views${p.leads ? ` · ${p.leads} ${p.leads === 1 ? 'lead' : 'leads'}` : ''}</span>
            <span class="pg-links"><a href="#/editor/${p.id}">Edit</a> · <a href="${esc(link(g, p, i))}" target="_blank" rel="noopener">View</a></span></figcaption>
        </figure>`).join('')}</div>
    </section>`).join('')}
    ${standalone.length ? `${groups.length ? '<h2 class="section-h">Follow-ups that start on their own</h2>' : ''}
      ${standalone.map((w) => `<section class="pgroup card ff-group">
        <header class="pg-head">
          <div><a class="pg-name" href="#/flows/followup/${w.id}">${esc(w.name)}</a><span class="muted small">Follow-up · ${w.emails} email${w.emails === 1 ? '' : 's'} · ${w.emails_sent} sent</span></div>
          ${w.status === 'active' ? '<span class="pill ok">On</span>' : '<span class="pill">Off</span>'}
          <label class="switch" title="${w.status === 'active' ? 'Turn off' : 'Turn on'}"><input type="checkbox" data-fftoggle="${w.id}" ${w.status === 'active' ? 'checked' : ''} aria-label="${w.status === 'active' ? 'On' : 'Off'}"><span></span></label>
          <span class="row" style="gap:6px;margin-left:auto"><a class="btn sm" href="#/flows/followup/${w.id}">Open</a></span>
        </header>
        ${twins(w).length ? `<p class="wf-twin">${icon('alert')} “${esc(twins(w)[0].name)}” also starts on the same thing, so people get both. Turn one off?</p>` : ''}
        <div class="ff-strip"><span class="ff-chip start">${icon('bolt')} When someone ${esc((w.triggerLabel || '').toLowerCase())}</span>
          ${(w.preview || []).map((s) => `<span class="pg-arrow" aria-hidden="true">${icon('arrowRight')}</span><span class="ff-chip ${s.type}">${icon(STEP_ICON[s.type] || 'bolt')}<b>${esc(STEP_WORD[s.type] || s.type)}</b> ${esc(flowText(s.text || '').slice(0, 60))}</span>`).join('')}</div>
      </section>`).join('')}` : ''}
    ${!groups.length && !standalone.length ? `<div class="card empty"><div class="big">${icon('branch')}</div><h2>${q ? 'Nothing matches' : 'Nothing here yet'}</h2>
      <p>${q ? 'Try a different search.' : show === 'followups' ? 'A follow-up starts on its own when something happens: someone buys, goes quiet, or gets a tag.' : 'Answer three quick questions and Rilly builds your first page with its follow-ups.'}</p>
      ${q || (show === 'followups' ? false : groupsAll.length || wfs.some((w) => !w.funnel_id)) ? '' : show === 'followups' ? '<button class="btn primary" data-newfu>New follow-up</button>' : '<button class="btn primary" data-newflow>Make my first flow</button>'}</div>` : ''}`);

  let t; $('[data-q]').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { const p = new URLSearchParams(); if (show) p.set('show', show); if (e.target.value) p.set('q', e.target.value); location.hash = `#/flows${p.toString() ? `?${p}` : ''}`; }, 350); };
  if (q) { const el = $('[data-q]'); el.focus(); el.setSelectionRange(q.length, q.length); }
  $$('[data-newflow]').forEach((b) => { b.onclick = newFlow; });
  const nf = $('[data-newfu]'); if (nf) nf.onclick = newWorkflow;
  bindPurposeTags(groups, viewFlows);
  $$('[data-gdup]').forEach((b) => { b.onclick = () => duplicateFunnel(groups.find((g) => String(g.id) === b.dataset.gdup), { stay: true }); });
  $$('[data-fftoggle]').forEach((c) => { c.onchange = async () => {
    try { await api('PUT', `/api/workflows/${c.dataset.fftoggle}/status`, { status: c.checked ? 'active' : 'paused' }); toast(c.checked ? 'On: it runs every time its trigger happens' : 'Off: nothing will send'); viewFlows(); }
    catch (err) { c.checked = !c.checked; toast(err.message, true); }
  }; });
  // Page pictures, a few at a time.
  const queue = groups.flatMap((g) => g.pages);
  const next = async () => {
    const p = queue.shift();
    if (!p || !$('.pgroup')) return;
    try { const { html } = await api('POST', '/api/preview', { blocks: p.blocks, settings: p.settings, name: p.name }); const fr = $(`[data-pthumb="${p.id}"]`); if (fr) fr.srcdoc = html; } catch { /* fine without */ }
    return next();
  };
  for (let i = 0; i < 4; i++) next();
}

// One "New" button: what are you making?
async function newFlow() {
  const r = await modal('What do you want to make?', `<div class="choices">
    <label class="choice"><input type="radio" name="kind" value="wizard" checked hidden><span class="ci">${icon('sparkle')}</span><span><b>Build it for me</b><small>Three quick questions and Rilly makes a page with its follow-ups</small></span></label>
    <label class="choice"><input type="radio" name="kind" value="pageflow" hidden><span class="ci">${icon('arrowRight')}</span><span><b>Pageflow</b><small>A page or a few in a row, for one goal: collect leads, take bookings, sell something</small></span></label>
    <label class="choice"><input type="radio" name="kind" value="website" hidden><span class="ci">${icon('globe')}</span><span><b>Website</b><small>Your business site: pages with a menu</small></span></label>
    <label class="choice"><input type="radio" name="kind" value="followup" hidden><span class="ci">${icon('bolt')}</span><span><b>Follow-up</b><small>Emails or texts that start on their own: when someone buys, goes quiet, gets a tag</small></span></label>
    <label class="choice"><input type="radio" name="kind" value="members" hidden><span class="ci">${icon('door')}</span><span><b>Members area</b><small>Lessons and downloads only members can open</small></span></label></div>`, { submit: 'Next' });
  if (!r) return;
  if (r.kind === 'wizard') { location.hash = '#/setup'; return; }
  if (r.kind === 'pageflow') return newFunnel();
  if (r.kind === 'website') return newWebsite();
  if (r.kind === 'followup') return newWorkflow();
  const m = await modal('New members area', '<label class="f">Name <span class="hint">members see this</span><input name="name" required placeholder="e.g. Pottery Basics course, Client portal"></label>',
    { submit: 'Create', onSubmit: (v) => api('POST', '/api/members-areas', v) });
  if (m?.id) { toast('Members area created. Fill in the lessons, then publish'); location.hash = `#/members/${m.id}`; }
}

// ---------------- A follow-up that starts on its own, as a flow ----------------
// The same picture as a pageflow: what starts it, then each step left to right,
// with + between steps. Splits show both paths; deeper branching opens the
// advanced editor.
async function viewFollowupFlow(id) {
  const [w, funnels] = await Promise.all([api('GET', `/api/workflows/${id}`), api('GET', '/api/funnels').catch(() => [])]);
  const g = w.graph, N = g.nodes;
  const t = N[g.root].config || {};
  const chainKeys = [];
  for (let k = N[g.root].next, guard = 0; k && N[k] && guard < 80; guard++) { chainKeys.push(k); if (N[k].type === 'condition') break; k = N[k].next; }
  const stat = (k) => w.stats?.[k];
  const where = t.funnel_id ? funnels.find((f) => f.id === t.funnel_id)?.name : '';
  const triggerText = `${(TRIGGER_UI[t.event] || w.triggerLabel || 'Something happens').replace(/^./, (x) => x.toLowerCase())}${t.event === 'tag_added' && t.tag ? ` “${t.tag}”` : ''}${t.event === 'silent' ? ` for ${t.days} days` : ''}${where ? ` on “${where}”` : ''}`;
  let day = 0;
  const card = (k) => {
    const n = N[k], c = n.config || {};
    if (n.type === 'wait') day += Number(c.days || 0) + Number(c.hours || 0) / 24;
    const when = day < 0.5 ? 'Right away' : `Day ${Math.round(day)}`;
    const s = stat(k);
    if (n.type === 'condition') {
      const side = (key, label) => {
        const b = key && N[key];
        const text = !b ? 'Nothing' : b.type === 'email' ? flowText(b.config.subject) || 'Email' : b.type === 'sms' ? flowText(b.config.body) : STEP_WORD[b.type] || b.type;
        return `<div class="ffs-side ${label === 'Yes' ? 'yes' : 'no'}"><b>${label}</b><span>${esc(text)}</span>${b && ['email', 'sms'].includes(b.type) ? `<button type="button" class="fc-edit" data-ffedit="${key}">${icon('pencil')} Edit</button>` : ''}${b?.next ? '<span class="muted small">+ more steps</span>' : ''}</div>`;
      };
      return `<div class="ff-step split"><div class="ffs-top">${icon('branch')}<span>${when} · ${esc((CONDITION_UI[c.check] || 'Check').replace(/\?$/, ''))}${c.value ? ` “${esc(c.value)}”` : ''}</span><button type="button" class="ffs-x" data-ffdel="${k}" aria-label="Remove this split">${icon('x')}</button></div>
        ${side(n.yes, 'Yes')}${side(n.no, 'No')}<a class="fc-more" href="#/workflows/${id}">Edit both paths in the advanced editor</a></div>`;
    }
    const body = n.type === 'email' ? `<div class="fc-subj">${esc(flowText(c.subject) || 'Untitled email')}</div><div class="fc-pre">${esc(flowText(c.body).split('\n').map((x) => x.trim()).filter((x) => x && !/^(hi|hello|hey|dear)\b.{0,30},?$/i.test(x))[0] || '')}</div>`
      : n.type === 'sms' ? `<div class="fc-pre">${esc(flowText(c.body))}</div>`
        : n.type === 'wait' ? `<div class="fc-subj">${c.days || 0} day${c.days === 1 ? '' : 's'}${c.hours ? ` ${c.hours}h` : ''}</div>`
          : `<div class="fc-pre">${esc(flowText(c.message || c.add || c.product || c.title || ''))}</div>`;
    return `<div class="ff-step ${n.type}"><div class="ffs-top">${icon(STEP_ICON[n.type] || 'bolt')}<span>${n.type === 'wait' ? 'Wait' : `${when} · ${STEP_WORD[n.type] || n.type}`}</span><button type="button" class="ffs-x" data-ffdel="${k}" aria-label="Remove this step">${icon('x')}</button></div>
      ${body}${s && (n.type === 'email' || n.type === 'sms') ? `<div class="muted small">${s.sent || 0} sent${n.type === 'email' && s.sent ? ` · ${Math.round(((s.opened || 0) / s.sent) * 100)}% opened` : ''}</div>` : ''}
      ${['email', 'sms', 'wait', 'tag', 'notify'].includes(n.type) ? `<button type="button" class="fc-edit" data-ffedit="${k}">${icon('pencil')} Edit</button>` : `<a class="fc-edit" href="#/workflows/${id}">${icon('pencil')} Edit</a>`}</div>`;
  };
  const plus = (after) => `<button type="button" class="edge-add ff-plus" data-ffadd="${after}" aria-label="Add a step here" title="Add an email, a text, a wait or a split">${icon('plus')}</button>`;
  const steps = chainKeys.map((k) => `${card(k)}${N[k].type === 'condition' ? '' : plus(k)}`).join('');
  shell('flows', `
    <div class="head"><div><a href="#/flows?show=followups" class="small">← Flows</a>
      <h1 style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span data-ffname>${esc(w.name)}</span>
        <label class="switch" title="${w.status === 'active' ? 'On: turn off' : 'Off: turn on'}"><input type="checkbox" data-fftoggle ${w.status === 'active' ? 'checked' : ''} aria-label="${w.status === 'active' ? 'On' : 'Off'}"><span></span></label>
        <span class="muted small">${w.status === 'active' ? 'On: runs every time its trigger happens' : 'Off: nothing sends'}</span></h1></div>
      <div class="row">${moreMenu(`<button role="menuitem" data-ffrename>${icon('pencil')} Rename</button><a role="menuitem" href="#/workflows/${id}">${icon('branch')} Advanced editor</a>
        <button role="menuitem" class="danger" data-ffdelete>${icon('trash')} Delete</button>`)}</div></div>
    <div class="ff-canvas card"><div class="ff-row">
      <button type="button" class="ff-step start" data-fftrigger><div class="ffs-top">${icon('bolt')}<span>Starts when</span></div><div class="fc-subj">Someone ${esc(triggerText)}</div><span class="fc-edit">${icon('pencil')} Change</span></button>
      ${plus(g.root)}${steps}
    </div></div>
    <p class="muted small">Tap <b>+</b> to add an email, a text, a wait or a yes/no split. Changes save straight away${w.status === 'active' ? ' and apply to people from their next step' : ''}.</p>`);
  bindMoreMenus();
  const save = async (graph, msg) => { try { await api('PUT', `/api/workflows/${id}`, { graph }); if (msg) toast(msg); viewFollowupFlow(id); } catch (e) { toast(e.message, true); } };
  $('[data-fftoggle]').onchange = async (e) => {
    try { await api('PUT', `/api/workflows/${id}/status`, { status: e.target.checked ? 'active' : 'paused' }); toast(e.target.checked ? 'On: it runs every time its trigger happens' : 'Off: nothing will send'); viewFollowupFlow(id); }
    catch (err) { e.target.checked = !e.target.checked; toast(err.message, true); }
  };
  $('[data-ffrename]').onclick = async () => {
    const r = await modal('Rename', `<label class="f">Name<input name="name" required value="${esc(w.name)}"></label>`, { onSubmit: (v) => api('PUT', `/api/workflows/${id}`, { name: v.name }) });
    if (r) viewFollowupFlow(id);
  };
  $('[data-ffdelete]').onclick = () => {
    location.hash = '#/flows?show=followups';
    deleteWithUndo(`“${w.name}” deleted`, { url: `/api/workflows/${id}`, hide: () => () => { location.hash = `#/flows/followup/${id}`; }, done: () => { if (location.hash.startsWith('#/flows')) viewFlows(); } });
  };
  // What starts it.
  $('[data-fftrigger]').onclick = async () => {
    const v = await modal('Starts when someone…', `
      <label class="f">Event<select name="event">${Object.entries(TRIGGER_UI).map(([k, l]) => `<option value="${k}" ${t.event === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      <label class="f" data-tf>On<select name="funnel_id"><option value="">Any page or import</option>${funnels.map((f) => `<option value="${f.id}" ${t.funnel_id === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>
      <label class="f" data-tt>Tag<input name="tag" value="${esc(t.tag || '')}" placeholder="e.g. vip"></label>
      <label class="f" data-td>Quiet for (days)<input name="days" type="number" min="1" value="${t.days || 180}"></label>`, { submit: 'Save' });
    if (!v) return;
    N[g.root].config = { ...t, event: v.event, funnel_id: v.funnel_id ? Number(v.funnel_id) : null, tag: v.tag || '', days: Number(v.days) || 180 };
    save(g, 'Trigger saved');
  };
  // Edit a step in place.
  $$('[data-ffedit]').forEach((b) => { b.onclick = async () => {
    const n = N[b.dataset.ffedit], c = n.config || {};
    const forms = {
      email: `<label class="f">Subject<input name="subject" required value="${esc(c.subject || '')}"></label><label class="f">Message<textarea name="body" rows="8" required>${esc(c.body || '')}</textarea></label>`,
      sms: `<label class="f">Text message <span class="hint">only to people who said yes to texts</span><textarea name="body" rows="4" maxlength="480" required>${esc(c.body || '')}</textarea></label>`,
      wait: `<label class="f">Days<input name="days" type="number" min="0" max="3650" value="${c.days || 0}"></label><label class="f">Hours<input name="hours" type="number" min="0" max="23" value="${c.hours || 0}"></label>`,
      tag: `<label class="f">Add tags<input name="add" value="${esc(c.add || '')}"></label><label class="f">Remove tags<input name="remove" value="${esc(c.remove || '')}"></label>`,
      notify: `<label class="f">Your note to yourself<textarea name="message" rows="3">${esc(c.message || '')}</textarea></label>`,
    };
    const pend = modal(`Edit ${STEP_WORD[n.type].toLowerCase()}`, forms[n.type], { submit: 'Save' });
    setTimeout(() => { const m = $('.modal'); if (m && typeof bindFieldInserts === 'function') bindFieldInserts(m); });
    const v = await pend;
    if (!v) return;
    n.config = n.type === 'wait' ? { days: Number(v.days) || 0, hours: Number(v.hours) || 0 } : { ...c, ...v };
    save(g, 'Saved');
  }; });
  // Remove a step: its place is taken by what came after it (Undo puts it back).
  $$('[data-ffdel]').forEach((b) => { b.onclick = async () => {
    const key = b.dataset.ffdel, before = JSON.parse(JSON.stringify(g));
    const parent = Object.entries(N).find(([, n]) => n.next === key || n.yes === key || n.no === key);
    if (!parent) return;
    const [pk, pn] = parent, port = pn.next === key ? 'next' : pn.yes === key ? 'yes' : 'no';
    const n = N[key];
    pn[port] = n.type === 'condition' ? n.yes || null : n.next || null;
    delete N[key];
    try { await api('PUT', `/api/workflows/${id}`, { graph: g }); } catch (e) { toast(e.message, true); return viewFollowupFlow(id); }
    viewFollowupFlow(id);
    undoToast(`${STEP_WORD[n.type]} removed`, async () => { await api('PUT', `/api/workflows/${id}`, { graph: before }); viewFollowupFlow(id); });
    void pk;
  }; });
  // + : add after this step.
  $$('[data-ffadd]').forEach((b) => { b.onclick = async () => {
    const after = b.dataset.ffadd;
    const r = await modal('Add a step', `<div class="choices">
      <label class="choice"><input type="radio" name="kind" value="email" checked hidden><span class="ci">${icon('mail')}</span><span><b>Send an email</b></span></label>
      <label class="choice"><input type="radio" name="kind" value="sms" hidden><span class="ci">${icon('chat')}</span><span><b>Send a text</b><small>Only to people who said yes to texts</small></span></label>
      <label class="choice"><input type="radio" name="kind" value="wait" hidden><span class="ci">${icon('clock')}</span><span><b>Wait</b></span></label>
      <label class="choice"><input type="radio" name="kind" value="split" hidden><span class="ci">${icon('branch')}</span><span><b>Yes / no split</b><small>e.g. if they opened the last email, or bought</small></span></label>
      <label class="choice"><input type="radio" name="kind" value="more" hidden><span class="ci">${icon('more')}</span><span><b>Something else</b><small>Tag, notify me, deal, subscribe: in the advanced editor</small></span></label></div>`, { submit: 'Next' });
    if (!r) return;
    if (r.kind === 'more') { location.hash = `#/workflows/${id}`; return; }
    const nk = () => `n${Math.random().toString(36).slice(2, 8)}`;
    const tail = N[after].next || null;
    let node;
    if (r.kind === 'wait') {
      const v = await modal('Wait', '<label class="f">Days<input name="days" type="number" min="0" max="3650" value="2"></label>', { submit: 'Add wait' });
      if (!v) return; node = { type: 'wait', config: { days: Number(v.days) || 0, hours: 0 } };
    } else if (r.kind === 'email' || r.kind === 'sms') {
      const v = await modal(r.kind === 'email' ? 'New email' : 'New text', r.kind === 'email'
        ? '<label class="f">Subject<input name="subject" required placeholder="e.g. A quick thank-you"></label><label class="f">Message<textarea name="body" rows="7" required>Hi {{first_name|there}},\n\n</textarea></label>'
        : '<label class="f">Text message <span class="hint">only to people who said yes to texts</span><textarea name="body" rows="3" maxlength="480" required>Hi {{first_name|there}}, it’s {{business}}. </textarea></label>', { submit: 'Add' });
      if (!v) return; node = r.kind === 'email' ? { type: 'email', config: { subject: v.subject, body: v.body } } : { type: 'sms', config: { body: v.body } };
    } else {
      const v = await modal('Yes / no split', `<label class="f">Check<select name="check">${['opened', 'clicked', 'purchased_since', 'has_tag'].map((k) => `<option value="${k}">${esc(CONDITION_UI[k])}</option>`).join('')}</select></label>
        <label class="f">Tag <span class="hint">only for “Has a tag?”</span><input name="value"></label>
        <label class="f">If no, send this email <span class="hint">optional</span><input name="subject" placeholder="Subject, e.g. Did you see this, {{first_name|there}}?"></label>
        <textarea name="body" rows="3" placeholder="Message">Hi {{first_name|there}},\n\n</textarea>`, { submit: 'Add split' });
      if (!v) return;
      let no = null;
      if (String(v.subject || '').trim()) { no = nk(); N[no] = { type: 'email', config: { subject: v.subject, body: v.body }, next: null }; }
      node = { type: 'condition', config: { check: v.check, value: String(v.value || '').trim().toLowerCase() }, yes: tail, no };
    }
    const key = nk();
    N[key] = node.type === 'condition' ? node : { ...node, next: tail };
    N[after].next = key;
    save(g, `${STEP_WORD[node.type]} added`);
  }; });
}

// Which page-based flows a shared follow-up also runs for (shown on pageflow maps).
async function sharedFollowupsFor(funnelId) {
  const list = await api('GET', '/api/workflows').catch(() => []);
  return list.filter((w) => w.status === 'active' && !w.funnel_id && ['signup', 'inquiry', 'purchase', 'booking', 'subscribe'].includes(w.trigger) && (!w.triggerFunnel || w.triggerFunnel === funnelId));
}
