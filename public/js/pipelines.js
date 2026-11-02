'use strict';

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
