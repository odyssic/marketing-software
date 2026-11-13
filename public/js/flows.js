'use strict';

// ---------------- Flows ----------------
// One place for everything that brings people in and follows up with them:
// websites, pages and members areas (pages, with their follow-up emails on
// the same map), and follow-ups that start on their own (someone buys, goes
// quiet, gets a tag). Set things up once, where you see them.
const FLOW_TABS = [['', 'All'], ['websites', 'Websites'], ['pageflows', 'Pages'], ['members', 'Courses'], ['followups', 'Follow-ups'], ['blog', 'Blog'], ['community', 'Community']];
const FLOW_OPEN = { website: 'websites', members: 'members', funnel: 'funnels' };
const STEP_WORD = { email: 'Email', sms: 'Text', wait: 'Wait', condition: 'Split', tag: 'Tag', notify: 'Notify me', subscribe: 'Subscribe', deal: 'Deal' };
const STEP_ICON = { email: 'mail', sms: 'chat', wait: 'clock', condition: 'branch', tag: 'tag', notify: 'bell', subscribe: 'inbox', deal: 'briefcase' };
const flowText = (t) => previewMerge(t);

function flowTabs(on) {
  const off = state.me.account.hidden_sections || [];
  return `<div class="tabs" style="margin-top:-6px">${FLOW_TABS.filter(([k]) => !off.includes(k)).map(([k, l]) => `<a href="#/flows${k ? `?show=${k}` : ''}" class="${on === k ? 'active' : ''}">${l}</a>`).join('')}</div>`;
}

async function viewFlows() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const show = FLOW_TABS.some(([k]) => k === params.get('show')) ? params.get('show') : '';
  if (show === 'blog') return viewBlog();
  if (show === 'community') return viewCommunityAdmin();
  const q = (params.get('q') || '').toLowerCase();
  const [groupsAll, wfs] = await Promise.all([api('GET', '/api/page-groups'), api('GET', '/api/workflows')]);
  const kindOk = (g) => !show || (show === 'websites' && g.kind === 'website') || (show === 'members' && g.kind === 'members') || (show === 'pageflows' && g.kind !== 'website' && g.kind !== 'members');
  const groups = show === 'followups' ? [] : groupsAll.filter(kindOk)
    .filter((g) => !q || `${g.name} ${g.pages.map((p) => `${p.name} ${p.slug}`).join(' ')}`.toLowerCase().includes(q));
  // Follow-ups that belong to a flow show with it; the rest start on their own (Follow-ups tab only).
  const standalone = show === 'followups' ? wfs.filter((w) => !w.funnel_id)
    .filter((w) => !q || `${w.name} ${w.triggerLabel} ${(w.preview || []).map((x) => x.text).join(' ')}`.toLowerCase().includes(q)) : [];
  const same = {};
  wfs.filter((w) => w.status === 'active').forEach((w) => { (same[w.triggerKey] = same[w.triggerKey] || []).push(w); });
  const twins = (w) => (w.status === 'active' ? (same[w.triggerKey] || []).filter((x) => x.id !== w.id) : []);
  const link = (g, p, i) => publicUrl(`/f/${g.slug}${i === 0 && g.kind !== 'website' ? '' : `/${p.slug}`}`);
  const pageFig = (g, p, i, badge) => `<figure class="pg-page">
          <a class="pg-thumb" href="#/editor/${p.id}" title="Edit “${esc(p.name)}”"><iframe tabindex="-1" aria-hidden="true" sandbox="" loading="lazy" data-pthumb="${p.id}"></iframe>
            ${badge ? `<span class="pg-start">${badge}</span>` : ''}${p.testing ? '<span class="pg-ab">A/B</span>' : ''}</a>
          <figcaption><b>${esc(p.name)}</b><span class="muted small">${p.views} views${p.leads ? ` · ${p.leads} ${p.leads === 1 ? 'lead' : 'leads'}` : ''}</span>
            <span class="pg-links"><a href="#/editor/${p.id}">Edit</a> · <a href="${esc(link(g, p, i))}" target="_blank" rel="noopener">View</a></span></figcaption>
        </figure>`;
  // A flow's own follow-ups, as cards you can open.
  const fuOf = (g) => wfs.filter((w) => w.funnel_id === g.id && w.status !== 'archived');
  const fuCard = (w) => {
    const on = w.status === 'active', steps = w.preview || [];
    return `<a class="pg-fu ${on ? '' : 'off'}" href="#/flows/followup/${w.id}" title="Open “${esc(w.name)}”">
      <span class="pg-fu-h">${icon('mail')}<b>${esc(w.name.replace(/^.*?: /, ''))}</b><span class="pill ${on ? 'ok' : ''}">${on ? 'On' : 'Off'}</span></span>
      <span class="pg-fu-when">${icon('bolt')} When someone ${esc((w.triggerLabel || '').toLowerCase())}</span>
      <ol>${steps.slice(0, 3).map((x) => `<li>${icon(STEP_ICON[x.type] || 'bolt')}<span>${stepSay(x)}</span></li>`).join('')}</ol>
      <span class="pg-fu-foot">${steps.length > 3 ? `${steps.length - 3} more step${steps.length - 3 === 1 ? '' : 's'} · ` : ''}<u>Open</u></span></a>`;
  };
  const kindWord = (g) => ({ website: 'Website', members: 'Course' })[g.kind] || 'Page';

  shell('flows', `
    <div class="head"><div><h1>Flows</h1><div class="muted">Everything that brings people in and follows up with them: your pages, the emails between them, and follow-ups that start on their own.</div></div>
      ${!groupsAll.length && !wfs.filter((w) => !w.funnel_id).length ? '' : `<button class="btn primary" data-newflow>${icon('plus')} New</button>`}</div>
    ${flowTabs(show)}
    <div class="flows-tools"><input data-q placeholder="Search flows, pages and emails…" value="${esc(q)}" style="max-width:340px" aria-label="Search">
      ${(() => { const off = standalone.filter((w) => w.status !== 'active'); return off.length > 1 ? `<button type="button" class="btn sm" data-allon>${icon('bolt')} Turn all on (${off.length})</button>` : ''; })()}</div>
    ${groups.map((g) => `<section class="pgroup card" data-group="${g.id}">
      <header class="pg-head">${q ? '' : `<button type="button" class="pg-grip" data-grip title="Drag to reorder (or use the arrow keys)" aria-label="Move “${esc(g.name)}”: drag, or press the up and down arrow keys">${icon('grip')}</button>`}
        <div><a class="pg-name" href="#/${FLOW_OPEN[g.kind] || 'funnels'}/${g.id}">${esc(g.name)}</a>
          <span class="muted small">${g.kind === 'website' || g.kind === 'members' ? `${kindWord(g)} · ` : ''}${g.pages.length} page${g.pages.length === 1 ? '' : 's'}${g.followups ? ` · ${g.followups} follow-up${g.followups === 1 ? '' : 's'}` : ''}</span></div>
        ${purposeTag(g)}
        ${g.status === 'live' ? '<span class="pill ok">Live</span>' : '<span class="pill warn">Draft</span>'}
        ${g.status !== 'live' && !g.views ? '<div class="pg-stats"><span class="muted small">Not live yet: open it and press Publish when it looks right.</span></div>'
    : `<div class="pg-stats"><span><b>${g.views}</b> visitors</span><span><b>${g.leads}</b> sign-ups &amp; sales</span>${g.rate === null ? '' : `<span><b>${g.rate}%</b> of visitors</span>`}<span class="muted small">last 30 days</span></div>`}
        <span class="row" style="gap:6px"><a class="btn sm" href="#/${FLOW_OPEN[g.kind] || 'funnels'}/${g.id}">Open</a>
          ${moreMenu(`<button role="menuitem" data-gdup="${g.id}">${icon('copy')} Duplicate</button><button role="menuitem" class="danger" data-gdel="${g.id}">${icon('trash')} Delete</button>`)}</span>
      </header>
      ${g.kind === 'website' ? `${siteTree(g, pageFig)}${fuOf(g).length ? `<div class="st-fus"><span class="muted small">Emails that follow its forms</span><div class="pg-fus">${fuOf(g).map(fuCard).join('')}</div></div>` : ''}`
        : `<div class="pg-strip">${g.pages.map((p, i) => `${i ? `<span class="pg-arrow" aria-hidden="true">${icon('arrowRight')}</span>` : ''}${pageFig(g, p, i, i === 0 ? 'Start' : '')}`).join('')}
          ${fuOf(g).length ? `<span class="pg-arrow fu" aria-hidden="true">${icon('mail')}</span>${fuOf(g).map(fuCard).join('')}` : ''}</div>`}
    </section>`).join('')}
    ${standalone.length ? `${groups.length ? '<h2 class="section-h">Follow-ups that start on their own</h2>' : ''}
      <section class="card fl-list">${standalone.map((w) => `<div class="fl-row ${w.status === 'active' ? '' : 'off'}" data-ffrow="${w.id}">
        <label class="switch" title="${w.status === 'active' ? 'On: click to turn off' : 'Off: click to turn on'}"><input type="checkbox" data-fftoggle="${w.id}" ${w.status === 'active' ? 'checked' : ''} aria-label="${esc(w.name)} is ${w.status === 'active' ? 'on' : 'off'}"><span></span></label>
        <div class="fl-main">
          <a class="fl-name" href="#/flows/followup/${w.id}">${esc(w.name)}</a>
          <div class="fl-line"><span class="fl-when">${icon('bolt')} When someone ${esc((w.triggerLabel || '').toLowerCase())}</span>${(w.preview || []).slice(0, 4).map((x) => `<span class="fl-sep" aria-hidden="true">›</span><span class="fl-step">${icon(STEP_ICON[x.type] || 'bolt')} ${stepSay(x)}</span>`).join('')}${(w.preview || []).length > 4 ? `<span class="fl-sep" aria-hidden="true">›</span><span class="muted">${w.preview.length - 4} more</span>` : ''}</div>
          ${twins(w).length ? `<div class="fl-twin">${icon('alert')} “${esc(twins(w)[0].name)}” starts on the same thing, so people get both. <button type="button" class="linkbtn" data-ffoff="${w.id}">Turn this one off</button></div>` : ''}
        </div>
        <span class="muted small fl-count">${w.emails_sent} sent</span>
        <span class="row" style="gap:6px"><a class="btn sm" href="#/flows/followup/${w.id}">Open</a>
          ${moreMenu(`<button role="menuitem" class="danger" data-ffdelete="${w.id}">${icon('trash')} Delete</button>`)}</span>
      </div>`).join('')}</section>` : ''}
    ${!groups.length && !standalone.length ? `<div class="card empty"><div class="big">${icon('branch')}</div><h2>${q ? 'Nothing matches' : 'Nothing here yet'}</h2>
      <p>${q ? 'Try a different search.' : show === 'followups' ? 'A follow-up starts on its own when something happens: someone buys, goes quiet, or gets a tag.' : 'Answer three quick questions and Rilly builds your first page with its follow-ups.'}</p>
      ${q || (show === 'followups' ? false : groupsAll.length || wfs.some((w) => !w.funnel_id)) ? '' : show === 'followups' ? '<button class="btn primary" data-newfu>New follow-up</button>' : '<button class="btn primary" data-newflow>Make my first flow</button>'}</div>` : ''}`);

  let t; $('[data-q]').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { const p = new URLSearchParams(); if (show) p.set('show', show); if (e.target.value) p.set('q', e.target.value); location.hash = `#/flows${p.toString() ? `?${p}` : ''}`; }, 350); };
  if (q) { const el = $('[data-q]'); el.focus(); el.setSelectionRange(q.length, q.length); }
  $$('[data-newflow]').forEach((b) => { b.onclick = newFlow; });
  const nf = $('[data-newfu]'); if (nf) nf.onclick = newWorkflow;
  bindPurposeTags(groups, viewFlows);
  bindMoreMenus();
  $$('[data-gdel]').forEach((b) => { b.onclick = () => {
    const g = groups.find((x) => String(x.id) === b.dataset.gdel);
    b.closest('.more-menu').hidden = true;
    deleteWithUndo(`“${g.name}” deleted`, { url: `/api/funnels/${g.id}`, hide: hideEl(b.closest('.pgroup')) });
  }; });
  bindFlowOrder(groupsAll);
  // Turn every follow-up shown on, except ones that still need something (said by name).
  const allOn = $('[data-allon]');
  if (allOn) allOn.onclick = async () => {
    allOn.disabled = true;
    const sample = (w) => w.sample;
    const on = [], skipped = [];
    for (const w of standalone.filter((x) => x.status !== 'active')) {
      if (sample(w)) { skipped.push(`“${w.name}” still has [sample words] to replace`); continue; }
      try { await api('PUT', `/api/workflows/${w.id}/status`, { status: 'active' }); on.push(w); } catch (err) { skipped.push(`“${w.name}”: ${err.message}`); }
    }
    toast(`${on.length ? `Turned on ${on.length} follow-up${on.length === 1 ? '' : 's'}. They run from now on.` : 'Nothing turned on.'}${skipped.length ? ` Left off: ${skipped.join('; ')}.` : ''}`, !on.length);
    viewFlows();
  };
  $$('[data-ffoff]').forEach((b) => { b.onclick = () => { const c = $(`[data-fftoggle="${b.dataset.ffoff}"]`); c.checked = false; c.onchange(); }; });
  $$('[data-ffdelete]').forEach((b) => { b.onclick = () => {
    const w = standalone.find((x) => String(x.id) === b.dataset.ffdelete);
    b.closest('.more-menu').hidden = true;
    deleteWithUndo(`“${w.name}” deleted`, { url: `/api/workflows/${w.id}`, hide: hideEl(b.closest('.fl-row')) });
  }; });
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
    <label class="choice"><input type="radio" name="kind" value="pageflow" hidden><span class="ci">${icon('arrowRight')}</span><span><b>Page</b><small>A page or a few in a row, for one goal: collect leads, take bookings, sell something</small></span></label>
    <label class="choice"><input type="radio" name="kind" value="website" hidden><span class="ci">${icon('globe')}</span><span><b>Website</b><small>Your business site: pages with a menu</small></span></label>
    <label class="choice"><input type="radio" name="kind" value="followup" hidden><span class="ci">${icon('bolt')}</span><span><b>Follow-up</b><small>Emails or texts that start on their own: when someone buys, goes quiet, gets a tag</small></span></label>
    <label class="choice"><input type="radio" name="kind" value="members" hidden><span class="ci">${icon('door')}</span><span><b>Course or members area</b><small>Lessons and downloads only members can open</small></span></label></div>`, { submit: 'Next' });
  if (!r) return;
  if (r.kind === 'wizard') { location.hash = '#/setup'; return; }
  if (r.kind === 'pageflow') return newFunnel();
  if (r.kind === 'website') return newWebsite();
  if (r.kind === 'followup') return newWorkflow();
  const m = await modal('New members area', '<label class="f">Name <span class="hint">members see this</span><input name="name" required placeholder="e.g. Pottery Basics course, Client portal"></label>',
    { submit: 'Create', onSubmit: (v) => api('POST', '/api/members-areas', v) });
  if (m?.id) { toast('Course created. Fill in the lessons, then publish'); location.hash = `#/members/${m.id}`; }
}

// ---------------- A follow-up that starts on its own, as a flow ----------------
// The same picture as a page: what starts it, then each step left to right,
// with + between steps. Splits show both paths; deeper branching opens the
// advanced editor.
async function viewFollowupFlow(id) {
  const [w, funnels] = await Promise.all([api('GET', `/api/workflows/${id}`), api('GET', '/api/funnels').catch(() => [])]);
  const g = w.graph, N = g.nodes;
  const t = N[g.root].config || {};
  const chainKeys = [];
  // Steps in order; after a split, "then, for everyone" carries on along its next.
  for (let k = N[g.root].next, guard = 0; k && N[k] && guard < 80; guard++) { chainKeys.push(k); k = N[k].next; }
  const stat = (k) => w.stats?.[k];
  const where = t.funnel_id ? funnels.find((f) => f.id === t.funnel_id)?.name : '';
  const triggerText = `${(TRIGGER_UI[t.event] || w.triggerLabel || 'Something happens').replace(/^./, (x) => x.toLowerCase())}${t.event === 'tag_added' && t.tag ? ` “${t.tag}”` : ''}${t.event === 'silent' ? ` for ${t.days} days` : ''}${['birthday', 'anniversary', 'renewal'].includes(t.event) && t.before ? ` (${t.before} day${t.before > 1 ? 's' : ''} ahead)` : ''}${where ? ` on “${where}”` : ''}`;
  let day = 0;
  const card = (k) => {
    const n = N[k], c = n.config || {};
    if (n.type === 'wait') day += Number(c.days || 0) + Number(c.hours || 0) / 24;
    const when = day < 0.5 ? 'Right away' : `Day ${Math.round(day)}`;
    const s = stat(k);
    if (n.type === 'condition') {
      const side = (start, yes) => {
        const rows = [];
        for (let p = start, guard = 0; p && N[p] && guard < 40; guard++, p = N[p].next) {
          const b = N[p], bc = b.config || {};
          if (b.type === 'condition') { rows.push(`<div class="ffp-row"><span class="ffp-ico">${icon('branch')}</span><a class="ffp-t" href="#/workflows/${id}">Another split: open the advanced editor</a></div>`); break; }
          const text = b.type === 'email' ? flowText(bc.subject) || 'Email' : b.type === 'sms' ? flowText(bc.body) || 'Text'
            : b.type === 'wait' ? `Wait ${bc.days || 0} day${bc.days === 1 ? '' : 's'}${bc.hours ? ` ${bc.hours}h` : ''}` : b.type === 'tag' ? `Tag: ${bc.add || bc.remove || ''}` : b.type === 'notify' ? `Notify me${bc.message ? `: ${flowText(bc.message)}` : ''}` : STEP_WORD[b.type] || b.type;
          const s = stat(p);
          rows.push(`<div class="ffp-row"><span class="ffp-ico">${icon(STEP_ICON[b.type] || 'bolt')}</span><span class="ffp-t">${esc(text)}${s && ['email', 'sms'].includes(b.type) ? ` <span class="muted">· ${s.sent || 0} sent</span>` : ''}</span>
            ${['email', 'sms', 'wait', 'tag', 'notify'].includes(b.type) ? `<button type="button" class="ffp-b" data-ffedit="${p}" aria-label="Edit">${icon('pencil')}</button>` : `<a class="ffp-b" href="#/workflows/${id}" aria-label="Edit">${icon('pencil')}</a>`}
            <button type="button" class="ffp-b" data-ffdel="${p}" aria-label="Remove">${icon('x')}</button></div>`);
          if (b.type === 'condition') break;
        }
        return `<div class="ffs-side ${yes ? 'yes' : 'no'}"><b>${yes ? 'Yes' : 'No'}</b><div class="ffp">${rows.join('') || `<span class="muted small">${yes ? 'Nothing more' : 'Nothing: they stop here'}</span>`}
          <button type="button" class="ffp-add" data-ffaddpath="${k}:${yes ? 'yes' : 'no'}">${icon('plus')} Add a step</button></div></div>`;
      };
      return `<div class="ff-step split"><div class="ffs-top">${icon('branch')}<span>${when} · ${esc((CONDITION_UI[c.check] || 'Check').replace(/\?$/, ''))}${c.value ? ` “${esc(c.value)}”` : ''}</span><button type="button" class="ffs-x" data-ffdel="${k}" aria-label="Remove this split">${icon('x')}</button></div>
        ${side(n.yes, true)}${side(n.no, false)}</div>`;
    }
    const body = n.type === 'email' ? `<div class="fc-subj">${esc(flowText(c.subject) || 'Untitled email')}</div><div class="fc-pre">${esc(flowText(c.body).split('\n').map((x) => x.trim()).filter((x) => x && !/^(hi|hello|hey|dear)\b.{0,30},?$/i.test(x))[0] || '')}</div>`
      : n.type === 'sms' ? `<div class="fc-pre">${esc(flowText(c.body))}</div>`
        : n.type === 'wait' ? `<div class="fc-subj">${c.days || 0} day${c.days === 1 ? '' : 's'}${c.hours ? ` ${c.hours}h` : ''}</div>`
          : `<div class="fc-pre">${esc(flowText(c.message || c.add || c.product || c.title || ''))}</div>`;
    return `<div class="ff-step ${n.type}"><div class="ffs-top">${icon(STEP_ICON[n.type] || 'bolt')}<span>${n.type === 'wait' ? 'Wait' : `${when} · ${STEP_WORD[n.type] || n.type}${c.sendIf ? ` · ${SEND_IF_WORDS[c.sendIf] || ''}` : ''}`}</span><button type="button" class="ffs-x" data-ffdel="${k}" aria-label="Remove this step">${icon('x')}</button></div>
      ${body}${s && (n.type === 'email' || n.type === 'sms') ? `<div class="muted small">${s.sent || 0} sent${n.type === 'email' && s.sent ? ` · ${Math.round(((s.opened || 0) / s.sent) * 100)}% opened` : ''}</div>` : ''}
      ${['email', 'sms', 'wait', 'tag', 'notify'].includes(n.type) ? `<button type="button" class="fc-edit" data-ffedit="${k}">${icon('pencil')} Edit</button>` : `<a class="fc-edit" href="#/workflows/${id}">${icon('pencil')} Edit</a>`}</div>`;
  };
  const plus = (after) => `<button type="button" class="edge-add ff-plus" data-ffadd="${after}" aria-label="Add a step here" title="Add an email, a text, a wait or a split">${icon('plus')}</button>`;
  // After a split: one + for what everyone does next, whichever path they took.
  const thenPlus = (k) => `<div class="ff-then"><button type="button" class="edge-add ff-plus" data-ffadd="${k}" aria-label="Then, for everyone: add a step" title="Then, for everyone (after either path)">${icon('plus')}</button><span>Then, for everyone</span></div>`;
  const steps = chainKeys.map((k) => `${card(k)}${N[k].type === 'condition' ? thenPlus(k) : plus(k)}`).join('');
  shell('flows', `
    <div class="head"><div><a href="#/flows?show=followups" class="small">← Flows</a>
      <h1 style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span data-ffname>${esc(w.name)}</span>
        <label class="switch" title="${w.status === 'active' ? 'On: turn off' : 'Off: turn on'}"><input type="checkbox" data-fftoggle ${w.status === 'active' ? 'checked' : ''} aria-label="${w.status === 'active' ? 'On' : 'Off'}"><span></span></label>
        <span class="muted small">${w.status === 'active' ? 'On: runs every time its trigger happens' : 'Off: nothing sends'}</span></h1></div>
      <div class="row">${moreMenu(`<button role="menuitem" data-ffrename>${icon('pencil')} Rename</button><a role="menuitem" href="#/workflows/${id}">${icon('branch')} Advanced editor</a>
        <button role="menuitem" class="danger" data-ffdelete>${icon('trash')} Delete</button>`)}</div></div>
    ${w.status === 'active' ? `<div class="wf-livebar">${icon('lock')}<span><b>This follow-up is live.</b> Pause it to make changes.</span><button type="button" class="btn sm primary" data-ffpause>${icon('pause')} Pause to edit</button></div>` : ''}
    <div class="ff-canvas card ${w.status === 'active' ? 'locked' : ''}"><div class="ff-row">
      <button type="button" class="ff-step start" data-fftrigger><div class="ffs-top">${icon('bolt')}<span>Starts when</span></div><div class="fc-subj">Someone ${esc(triggerText)}</div><span class="fc-edit">${icon('pencil')} Change</span></button>
      ${plus(g.root)}${steps}
    </div></div>
    <p class="muted small">Tap <b>+</b> to add an email, a text, a wait or a yes/no split (for example: clicked? send a text; didn’t? send another email). Changes save straight away.</p>`);
  bindMoreMenus();
  const save = async (graph, msg) => { if (w.status === 'active') { toast('It’s live. Pause it to edit', true); return; } try { await api('PUT', `/api/workflows/${id}`, { graph }); if (msg) toast(msg); viewFollowupFlow(id); } catch (e) { toast(e.message, true); } };
  const fp = $('[data-ffpause]'); if (fp) fp.onclick = () => { const t = $('[data-fftoggle]'); t.checked = false; t.onchange({ target: t }); };
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
      <label class="f" data-td>Quiet for (days)<input name="days" type="number" min="1" value="${t.days || 180}"></label>
      <label class="f" data-tb>When<select name="before">${[[0, 'On the day'], [1, '1 day before'], [3, '3 days before'], [7, 'A week before'], [14, 'Two weeks before']].map(([x, l]) => `<option value="${x}" ${Number(t.before || 0) === x ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`, { submit: 'Save' });
    if (!v) return;
    N[g.root].config = { ...t, event: v.event, funnel_id: v.funnel_id ? Number(v.funnel_id) : null, tag: v.tag || '', days: Number(v.days) || 180, before: Number(v.before) || 0 };
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
    pn[port] = n.type === 'condition' ? n.next || n.yes || null : n.next || null;
    delete N[key];
    try { await api('PUT', `/api/workflows/${id}`, { graph: g }); } catch (e) { toast(e.message, true); return viewFollowupFlow(id); }
    viewFollowupFlow(id);
    undoToast(`${STEP_WORD[n.type]} removed`, async () => { await api('PUT', `/api/workflows/${id}`, { graph: before }); viewFollowupFlow(id); });
    void pk;
  }; });
  // + : add after this step.
  const addStep = async (where) => {
    const onPath = Boolean(where.cond);
    const r = await modal(onPath ? `If ${where.side === 'yes' ? 'yes' : 'no'}, then…` : 'Add a step', `<div class="choices">
      <label class="choice"><input type="radio" name="kind" value="email" checked hidden><span class="ci">${icon('mail')}</span><span><b>Send an email</b></span></label>
      <label class="choice"><input type="radio" name="kind" value="sms" hidden><span class="ci">${icon('chat')}</span><span><b>Send a text</b><small>Only to people who said yes to texts</small></span></label>
      <label class="choice"><input type="radio" name="kind" value="wait" hidden><span class="ci">${icon('clock')}</span><span><b>Wait</b></span></label>
      ${onPath ? '' : `<label class="choice"><input type="radio" name="kind" value="split" hidden><span class="ci">${icon('branch')}</span><span><b>Yes / no split</b><small>e.g. if they clicked: send a text; if not: another email</small></span></label>`}
      <label class="choice"><input type="radio" name="kind" value="guide" hidden><span class="ci">${icon('download')}</span><span><b>Reminder if they haven’t opened the guide</b><small>Goes only to people who haven’t opened what their sign-up form sent</small></span></label>
      <label class="choice"><input type="radio" name="kind" value="tag" hidden><span class="ci">${icon('tag')}</span><span><b>Add a tag</b></span></label>
      <label class="choice"><input type="radio" name="kind" value="notify" hidden><span class="ci">${icon('bell')}</span><span><b>Notify me</b><small>A reminder to follow up personally</small></span></label>
      <label class="choice"><input type="radio" name="kind" value="more" hidden><span class="ci">${icon('more')}</span><span><b>Something else</b><small>Deal, subscribe: in the advanced editor</small></span></label></div>`, { submit: 'Next' });
    if (!r) return;
    if (r.kind === 'more') { location.hash = `#/workflows/${id}`; return; }
    const nk = () => `n${Math.random().toString(36).slice(2, 8)}`;
    // Where it goes: after a step (what followed comes after it), or at the end of a split's path.
    let last = null;
    if (onPath) { for (let p = N[where.cond][where.side], guard = 0; p && N[p] && N[p].type !== 'condition' && guard < 40; guard++) { last = p; p = N[p].next; } }
    const tail = onPath ? null : N[where.after].next || null;
    let node;
    if (r.kind === 'wait') {
      const v = await modal('Wait', '<label class="f">Days<input name="days" type="number" min="0" max="3650" value="2"></label>', { submit: 'Add wait' });
      if (!v) return; node = { type: 'wait', config: { days: Number(v.days) || 0, hours: 0 } };
    } else if (r.kind === 'email' || r.kind === 'sms') {
      const v = await modal(r.kind === 'email' ? 'New email' : 'New text', r.kind === 'email'
        ? '<label class="f">Subject<input name="subject" required placeholder="e.g. A quick thank-you"></label><label class="f">Message<textarea name="body" rows="7" required>Hi {{first_name|there}},\n\n</textarea></label>'
        : '<label class="f">Text message <span class="hint">only to people who said yes to texts</span><textarea name="body" rows="3" maxlength="480" required>Hi {{first_name|there}}, it’s {{business}}. </textarea></label>', { submit: 'Add' });
      if (!v) return; node = r.kind === 'email' ? { type: 'email', config: { subject: v.subject, body: v.body } } : { type: 'sms', config: { body: v.body } };
    } else if (r.kind === 'guide') {
      node = { type: 'email', config: { subject: 'Did you get {{guide_name|your guide}}?', body: 'Hi {{first_name|there}},\n\nJust checking it reached you. Here’s your link again: [{{guide_name|your guide}}]({{guide_link}})\n\nIt only takes a few minutes, and I think you’ll find it useful.\n\n{{business}}', sendIf: 'guide_unopened' } };
    } else if (r.kind === 'tag') {
      const v = await modal('Add a tag', '<label class="f">Tag<input name="add" required placeholder="e.g. clicked-offer"></label>', { submit: 'Add' });
      if (!v) return; node = { type: 'tag', config: { add: v.add, remove: '' } };
    } else if (r.kind === 'notify') {
      const v = await modal('Notify me', '<label class="f">Your note to yourself<textarea name="message" rows="3" placeholder="e.g. They clicked but didn’t buy: give them a call"></textarea></label>', { submit: 'Add' });
      if (!v) return; node = { type: 'notify', config: { message: v.message } };
    } else {
      const pendSplit = modal('Yes / no split', `<label class="f">Did they…<select name="check">${[['clicked_last', 'click a link in the last email'], ['opened_last', 'open the last email'], ['replied', 'reply (text, email or chat)'], ['purchased_since', 'buy something'], ['booked_since', 'book a call'], ['has_tag', 'get a tag']].map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
        <label class="f" data-splittag hidden>Tag<input name="value" placeholder="e.g. vip"></label>
        <label class="f">Give them<select name="give">${[[0, 'No time: check straight away'], [1, '1 day'], [2, '2 days'], [3, '3 days'], [7, 'A week']].map(([d, l]) => `<option value="${d}" ${d === 2 ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <p class="hint">Then you choose what happens on each path, for example: if yes, send a text; if no, send a different email.</p>`, { submit: 'Add split' });
      setTimeout(() => { const m = $('.modal'); const sel = m && $('[name=check]', m); if (sel) sel.onchange = () => { $('[data-splittag]', m).hidden = sel.value !== 'has_tag'; }; });
      const v = await pendSplit;
      if (!v) return;
      node = { type: 'condition', config: { check: v.check, value: String(v.value || '').trim().toLowerCase() }, yes: null, no: null, next: tail };
      const give = Number(v.give) || 0;
      if (give) {
        // The wait comes first, so they have time to open, click or reply.
        const ck = nk(), wk = nk();
        N[ck] = node; N[wk] = { type: 'wait', config: { days: give, hours: 0 }, next: ck };
        N[where.after].next = wk;
        return save(g, 'Split added. Now add what happens on each path.');
      }
    }
    const key = nk();
    N[key] = node.type === 'condition' ? node : { ...node, next: tail };
    if (onPath) { if (last) N[last].next = key; else N[where.cond][where.side] = key; }
    else N[where.after].next = key;
    save(g, node.type === 'condition' ? 'Split added. Now add what happens on each path.' : `${STEP_WORD[node.type]} added`);
  };
  $$('[data-ffadd]').forEach((b) => { b.onclick = () => addStep({ after: b.dataset.ffadd }); });
  $$('[data-ffaddpath]').forEach((b) => { b.onclick = () => { const [cond, side] = b.dataset.ffaddpath.split(':'); addStep({ cond, side }); }; });
}

// Which page-based flows a shared follow-up also runs for (shown on page maps).
async function sharedFollowupsFor(funnelId) {
  const list = await api('GET', '/api/workflows').catch(() => []);
  return list.filter((w) => w.status === 'active' && !w.funnel_id && ['signup', 'inquiry', 'purchase', 'booking', 'subscribe'].includes(w.trigger) && (!w.triggerFunnel || w.triggerFunnel === funnelId));
}

// A website is not a path people walk through: show it as a site map.
// Home on top, the pages in its menu under it, pages left out of the menu to the side.
function sitePages(pages, entryId) {
  const home = pages.find((p) => p.id === entryId) || pages[0];
  const rest = pages.filter((p) => p !== home);
  return { home, menu: rest.filter((p) => !p.settings?.hideInMenu), off: rest.filter((p) => p.settings?.hideInMenu) };
}
function siteTree(g, fig) {
  if (!g.pages.length) return '';
  const { home, menu, off } = sitePages(g.pages, g.entry_step_id);
  const at = (p) => g.pages.indexOf(p);
  return `<div class="pg-strip site"><div class="st" role="group" aria-label="Site map">
    <div class="st-home ${menu.length ? 'has-kids' : ''}">${fig(g, home, at(home), 'Home')}</div>
    ${menu.length ? `<div class="st-kids" aria-label="In the menu">${menu.map((p) => `<div class="st-kid">${fig(g, p, at(p), '')}</div>`).join('')}</div>` : ''}
    ${off.length ? `<div class="st-off"><span class="muted small">Not in the menu (reached by a link)</span><div class="st-offrow">${off.map((p) => fig(g, p, at(p), '')).join('')}</div></div>` : ''}
  </div></div>`;
}

// Drag a flow by its handle to change the order (arrow keys work too).
function bindFlowOrder(all) {
  const save = () => {
    const shown = $$('.pgroup[data-group]').map((x) => Number(x.dataset.group));
    // Flows hidden by the tab keep their places; the shown ones take the new order.
    const set = new Set(shown); let k = 0;
    const ids = all.map((g) => (set.has(g.id) ? shown[k++] : g.id));
    api('PUT', '/api/page-groups/order', { ids }).catch((e) => toast(e.message, true));
  };
  let dragging = null;
  $$('[data-grip]').forEach((h) => {
    const sec = h.closest('.pgroup');
    h.onpointerdown = () => { sec.draggable = true; };
    sec.ondragstart = (e) => { dragging = sec; sec.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', sec.dataset.group); };
    sec.ondragend = () => { sec.draggable = false; sec.classList.remove('dragging'); if (dragging) { dragging = null; save(); } };
    h.onkeydown = (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const other = e.key === 'ArrowUp' ? sec.previousElementSibling : sec.nextElementSibling;
      if (!other?.matches('.pgroup[data-group]')) return;
      if (e.key === 'ArrowUp') other.before(sec); else other.after(sec);
      h.focus(); save();
    };
  });
  $$('.pgroup[data-group]').forEach((sec) => { sec.ondragover = (e) => {
    if (!dragging || dragging === sec) return;
    e.preventDefault();
    const r = sec.getBoundingClientRect();
    if (e.clientY < r.top + r.height / 2) sec.before(dragging); else sec.after(dragging);
  }; });
}

// One step of a follow-up in a few plain words.
function stepSay(x) {
  const t = esc(flowText(x.text || '').slice(0, 48));
  if (x.type === 'wait') return `Wait ${t}`;
  if (x.type === 'email') return `Email “${t}”`;
  if (x.type === 'sms') return `Text “${t}”`;
  if (x.type === 'condition') return `Then splits: ${t.charAt(0).toLowerCase()}${t.slice(1)}?`;
  return `${esc(STEP_WORD[x.type] || x.type)}${t ? `: ${t}` : ''}`;
}
