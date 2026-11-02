'use strict';

// ---------------- Websites ----------------
// Multi-page sites with a menu, built from templates. Pages are edited in the
// same page editor as funnels; publishing runs the same pre-flight check.
async function viewWebsites() {
  const sites = await api('GET', '/api/websites');
  shell('websites', `
    <div class="head"><div><h1>Websites</h1><div class="muted">Your business website: pages with a menu, ready-made for your kind of business.</div></div>
      <button class="btn primary" data-new>+ New website</button></div>
    ${sites.length ? `<div class="wf-grid">${sites.map((s) => `<article class="wf-card" data-go="#/websites/${s.id}" tabindex="0">
      <div class="row" style="justify-content:space-between"><h3>${esc(s.name)}</h3>${s.status === 'live' ? '<span class="pill ok">Live</span>' : '<span class="pill warn">Draft</span>'}</div>
      <p class="muted small">${s.domain ? esc(s.domain) : esc(publicUrl(`/f/${s.slug}`))}</p>
      <div class="wf-meta"><span>${s.pages} pages</span><span>${s.views} visits</span><span>${s.leads} inquiries & signups</span><span class="muted">last 30 days</span></div></article>`).join('')}</div>`
      : `<div class="card empty"><div class="big">🌐</div><h2>No website yet</h2><p>Pick a template for your kind of business and edit the words. It’s live in minutes.</p>
        <button class="btn primary" data-new>Choose a template</button></div>`}`);
  bindRowLinks();
  $$('[data-go]').forEach((c) => { c.onkeydown = (e) => { if (e.key === 'Enter') location.hash = c.dataset.go; }; });
  $$('[data-new]').forEach((b) => { b.onclick = newWebsite; });
}

async function newWebsite() {
  const templates = await api('GET', '/api/website-templates');
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<form class="modal wide"><h2>New website</h2>
    <label class="f">Business name <span class="hint">shown at the top of every page</span><input name="name" required value="${esc(state.me.account.name)}"></label>
    <div class="f" style="margin-bottom:6px;font-size:.85rem;font-weight:500">Template</div>
    <div class="tpl-grid">${templates.map((t, i) => `<label class="tpl ${i === 0 ? 'on' : ''}"><input type="radio" name="template" value="${t.key}" ${i === 0 ? 'checked' : ''} class="sr">
      <span class="swatch" style="background:${esc(t.accent)}"></span><b>${esc(t.label)}</b><span class="muted small">${esc(t.description)}</span>
      <span class="small">${t.pages.map(esc).join(' · ')}</span>${t.workflows.length ? `<span class="small">⚡ ${t.workflows.map(esc).join(', ')}</span>` : ''}</label>`).join('')}</div>
    <p class="hint">Words in [brackets] are yours to fill in. Click any text in the page editor to change it.</p>
    <div class="err"></div><div class="actions"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary">Create website</button></div></form>`;
  document.body.append(bg);
  const close = () => bg.remove();
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
  $('[data-x]', bg).onclick = close;
  $$('input[name=template]', bg).forEach((r) => { r.onchange = () => $$('.tpl', bg).forEach((l) => l.classList.toggle('on', l.contains(r) && r.checked)); });
  $('form', bg).onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api('POST', '/api/websites', Object.fromEntries(new FormData(e.target)));
      close();
      toast('Website created. Edit the pages, then publish');
      location.hash = `#/websites/${r.id}`;
    } catch (err) { $('.err', bg).textContent = err.message; }
  };
}

async function viewWebsite(id) {
  const f = await api('GET', `/api/funnels/${id}`);
  const link = f.domain ? `https://${f.domain}` : publicUrl(`/f/${f.slug}`);
  const pages = [...f.steps].sort((a, b) => a.position - b.position || a.id - b.id);
  shell('websites', `
    <div class="head"><div><a href="#/websites" class="small">← Websites</a>
      <h1 style="display:flex;gap:10px;align-items:center">${esc(f.name)} ${f.status === 'live' ? '<span class="pill ok">Live</span>' : '<span class="pill warn">Draft</span>'}</h1>
      <div class="muted small">${esc(link)}</div></div>
      <div class="row"><a class="btn" href="${esc(publicUrl(`/f/${f.slug}`))}" target="_blank" rel="noopener">View site ↗</a><button class="btn" data-settings>Settings</button>
        ${f.status === 'live' ? '<button class="btn" data-unpublish>Unpublish</button>' : '<button class="btn primary" data-publish>Publish</button>'}</div></div>
    ${f.workflows?.length ? `<div class="wf-strip"><span class="muted small">⚡ Follow-ups:</span>${f.workflows.map((w) => `<a class="chip" href="#/workflows/${w.id}">${esc(w.name.replace(`${f.name}: `, ''))} <span class="pill ${w.status === 'active' ? 'ok' : ''}">${w.status === 'active' ? 'Live' : 'Off'}</span></a>`).join('')}</div>` : ''}
    <div class="card table-wrap"><table>
      <tr><th>Menu order</th><th>Page</th><th>Address</th><th>Visits</th><th>Leads</th><th></th></tr>
      ${pages.map((p, i) => `<tr><td style="white-space:nowrap"><button class="btn sm icon" data-mv="${i}:-1" ${i ? '' : 'disabled'} aria-label="Move up">↑</button>
          <button class="btn sm icon" data-mv="${i}:1" ${i < pages.length - 1 ? '' : 'disabled'} aria-label="Move down">↓</button></td>
        <td><strong>${esc(p.name)}</strong>${i === 0 ? ' <span class="pill">home</span>' : ''}${p.settings.hideInMenu ? ' <span class="pill warn">hidden from menu</span>' : ''}</td>
        <td class="muted small">/${i === 0 ? '' : esc(p.slug)}</td><td>${p.views}</td><td>${p.optins}</td>
        <td style="text-align:right;white-space:nowrap"><a class="btn sm primary" href="#/editor/${p.id}">Edit</a>
          <button class="btn sm" data-pmenu="${p.id}">⋯</button></td></tr>`).join('')}
    </table></div>
    <button class="btn" data-addpage style="margin-top:12px">+ Add page</button>`);

  const order = async (ids) => { await api('PUT', `/api/websites/${id}/order`, { ids }); viewWebsite(id); };
  $$('[data-mv]').forEach((b) => { b.onclick = () => {
    const [i, d] = b.dataset.mv.split(':').map(Number);
    const ids = pages.map((p) => p.id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    order(ids);
  }; });
  $('[data-addpage]').onclick = async () => {
    const r = await modal('Add a page', '<label class="f">Page name <span class="hint">shown in the menu</span><input name="name" required placeholder="e.g. FAQ"></label>',
      { submit: 'Add page', onSubmit: (v) => api('POST', `/api/funnels/${id}/steps`, { name: v.name }) });
    if (r) { await api('PUT', `/api/steps/${r.id}`, { blocks: [{ id: Math.random().toString(36).slice(2, 10), type: 'heading', text: r.name || 'New page', size: 'large', align: 'center' }] }).catch(() => {}); location.hash = `#/editor/${r.id}`; }
  };
  $$('[data-pmenu]').forEach((b) => { b.onclick = async () => {
    const p = pages.find((x) => x.id === Number(b.dataset.pmenu));
    const pending = modal(`Page: ${p.name}`, `
      <label class="f">Name in the menu<input name="name" value="${esc(p.name)}" required></label>
      <label class="f">Address <span class="hint">/${esc(p.slug)}</span><input name="slug" value="${esc(p.slug)}"></label>
      <label class="check"><input type="checkbox" name="hide" ${p.settings.hideInMenu ? 'checked' : ''}> Hide from the menu (still reachable by link)</label>
      <button type="button" class="btn danger sm" data-delpage>Delete page</button>`,
    { onSubmit: (v) => api('PUT', `/api/steps/${p.id}`, { name: v.name, slug: v.slug, settings: { ...p.settings, hideInMenu: v.hide } }) });
    $('[data-delpage]').onclick = async () => {
      $('.modal-bg [data-x]').click();
      if (pages.length < 2) { toast('A website needs at least one page', true); return; }
      if (await confirmBox('Delete this page?', `“${p.name}” will be removed from the site.`)) { await api('DELETE', `/api/steps/${p.id}`); viewWebsite(id); }
    };
    if (await pending) { toast('Saved'); viewWebsite(id); }
  }; });
  $('[data-settings]').onclick = async () => {
    const r = await modal('Website settings', `<label class="f">Business name<input name="name" required value="${esc(f.name)}"></label>
      <label class="f">Your own domain <span class="hint">e.g. www.yourbusiness.com</span><input name="domain" value="${esc(f.domain || '')}"></label>
      <p class="hint">Point the domain’s CNAME at ${esc(new URL(state.me.baseUrl).hostname)} and add it as a domain alias in Netlify (HTTPS is automatic). Publish, and the site opens at your domain.</p>`,
    { onSubmit: (v) => api('PUT', `/api/funnels/${id}`, v) });
    if (r) { toast('Saved'); viewWebsite(id); }
  };
  const pub = $('[data-publish]');
  if (pub) pub.onclick = async () => {
    const pre = await api('GET', `/api/funnels/${id}/preflight`);
    const list = pre.problems.map((p) => `<div class="li"><span>${p.severity === 'block' ? '⛔' : '⚠️'} ${esc(p.text)}</span>${p.fix ? `<a class="btn sm" href="${esc(p.fix.href.replace('#/funnels/', '#/websites/'))}">${esc(p.fix.label)}</a>` : ''}</div>`).join('');
    if (!pre.ready) { modal('Fix these before publishing', list, { submit: 'OK' }); return; }
    if (!await modal('Publish this website?', `${list}<p class="muted small">Your pages go live now. You can unpublish any time.</p>`, { submit: 'Publish' })) return;
    await api('POST', `/api/funnels/${id}/publish`); toast('Your website is live!'); viewWebsite(id);
  };
  const un = $('[data-unpublish]');
  if (un) un.onclick = async () => { if (await confirmBox('Unpublish this website?', 'Visitors will see “not published yet”.', 'Unpublish')) { await api('POST', `/api/funnels/${id}/unpublish`); viewWebsite(id); } };
}
