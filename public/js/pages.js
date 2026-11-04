'use strict';

// ---------------- Pages ----------------
// One place for every page, whoever built it: website, funnel, template or AI.
// Old screens share the Flows tabs.
const PAGES_TABS = (on) => flowTabs(({ pages: '', websites: 'websites', funnels: 'pageflows', members: 'members' })[on] ?? '');

async function viewPages() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const q = (params.get('q') || '').toLowerCase();
  const all = await api('GET', '/api/page-groups');
  // A search keeps a group if its name or any of its pages match.
  const groups = q ? all.filter((g) => `${g.name} ${g.pages.map((p) => `${p.name} ${p.slug}`).join(' ')}`.toLowerCase().includes(q)) : all;
  const link = (g, p, i) => publicUrl(`/f/${g.slug}${i === 0 && g.kind !== 'website' ? '' : `/${p.slug}`}`);
  shell('pages', `
    <div class="head"><div><h1>Pages</h1><div class="muted">Your pageflows and websites, each shown as the pages visitors move through.</div></div>
      <div class="row"><button class="btn" data-newsite>+ Website</button><button class="btn primary" data-newfunnel>+ Pageflow</button></div></div>
    ${PAGES_TABS('pages')}
    <input data-q placeholder="Search pageflows and pages…" value="${esc(q)}" style="max-width:340px;margin-bottom:14px">
    ${groups.length ? groups.map((g) => `<section class="pgroup card">
      <header class="pg-head">
        <div><a class="pg-name" href="#/${({ website: 'websites', members: 'members' })[g.kind] || 'funnels'}/${g.id}">${esc(g.name)}</a>
          <span class="muted small">${({ website: 'Website', members: 'Members area' })[g.kind] || 'Pageflow'} · ${g.pages.length} page${g.pages.length === 1 ? '' : 's'}${g.followups ? ` · ${g.followups} follow-up${g.followups === 1 ? '' : 's'}` : ''}</span></div>
        ${purposeTag(g)}
        ${g.status === 'live' ? '<span class="pill ok">Live</span>' : '<span class="pill warn">Draft</span>'}
        <div class="pg-stats"><span><b>${g.views}</b> visitors</span><span><b>${g.leads}</b> leads &amp; sales</span><span><b>${g.rate === null ? '—' : `${g.rate}%`}</b> convert</span><span class="muted small">last 30 days</span></div>
        <span class="row" style="gap:6px"><button class="btn sm" data-gdup="${g.id}" title="Duplicate">${icon('copy')} Duplicate</button>
          <a class="btn sm" href="#/${({ website: 'websites', members: 'members' })[g.kind] || 'funnels'}/${g.id}">${g.kind === 'members' ? 'Open area' : g.kind === 'website' ? 'Open site' : 'Open flow'}</a></span>
      </header>
      <div class="pg-strip">${g.pages.map((p, i) => `${i && g.kind !== 'website' ? `<span class="pg-arrow" aria-hidden="true">${icon('arrowRight')}</span>` : ''}
        <figure class="pg-page">
          <a class="pg-thumb" href="#/editor/${p.id}" title="Edit “${esc(p.name)}”"><iframe tabindex="-1" aria-hidden="true" sandbox="" loading="lazy" data-pthumb="${p.id}"></iframe>
            ${i === 0 && g.kind !== 'website' ? '<span class="pg-start">Start</span>' : ''}${p.testing ? '<span class="pg-ab">A/B</span>' : ''}</a>
          <figcaption><b>${esc(p.name)}</b><span class="muted small">${p.views} views${p.leads ? ` · ${p.leads} ${p.leads === 1 ? 'lead' : 'leads'}` : ''}</span>
            <span class="pg-links"><a href="#/editor/${p.id}">Edit</a> · <a href="${esc(link(g, p, i))}" target="_blank" rel="noopener">View</a></span></figcaption>
        </figure>`).join('')}</div>
    </section>`).join('') : `<div class="card empty"><div class="big">${icon('page')}</div><h2>${q ? 'Nothing matches' : 'No pages yet'}</h2>
      <p>${q ? 'Try a different search.' : 'Answer three quick questions and Rilly builds your first page: booking, quote requests, a sign-up list or a simple shop.'}</p>
      ${q ? '' : '<a class="btn primary" href="#/setup">Build my first page</a>'}</div>`}`);
  let t; $('[data-q]').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { location.hash = `#/pages?q=${encodeURIComponent(e.target.value)}`; }, 350); };
  if (q) { const el = $('[data-q]'); el.focus(); el.setSelectionRange(q.length, q.length); }
  $('[data-newsite]').onclick = newWebsite;
  $('[data-newfunnel]').onclick = newFunnel;
  bindPurposeTags(groups, viewPages);
  $$('[data-gdup]').forEach((b) => { b.onclick = () => duplicateFunnel(groups.find((g) => String(g.id) === b.dataset.gdup), { stay: true }); });
  // Page pictures, a few at a time.
  const queue = groups.flatMap((g) => g.pages);
  const next = async () => {
    const p = queue.shift();
    if (!p || !$('.pgroup')) return;
    try {
      const { html } = await api('POST', '/api/preview', { blocks: p.blocks, settings: p.settings, name: p.name });
      const fr = $(`[data-pthumb="${p.id}"]`); if (fr) fr.srcdoc = html;
    } catch { /* the card still works without its picture */ }
    return next();
  };
  for (let i = 0; i < 4; i++) next();
}

// ---------------- Testimonials (real records only) ----------------
async function viewTestimonials() {
  const list = await api('GET', '/api/testimonials');
  shell('people', `
    <div class="head"><div><h1>Testimonials</h1><div class="muted">Only real customers’ words, shared with their permission. Pages show approved ones; nothing is ever made up.</div></div>
      <a class="btn" href="#/people">← People</a></div>
    ${list.length ? `<div class="card">${list.map((t) => `<div class="li"><span style="max-width:70%"><b>“${esc(t.quote)}”</b><br>
        <span class="muted small">${esc(t.name)}${t.detail ? ` · ${esc(t.detail)}` : ''} · ${esc(t.source)}${t.person_id ? ` · <a href="#/people/${t.person_id}">${esc(t.person_name || 'person')}</a>` : ''} · ${fmtDate(t.created_at)}</span></span>
      <span class="row">${t.approved ? '<span class="pill ok">shown on pages</span><button class="btn sm" data-ap="' + t.id + ':0">Hide</button>' : '<span class="pill warn">waiting for approval</span><button class="btn sm primary" data-ap="' + t.id + ':1">Approve</button>'}
        <button class="btn sm danger" data-delt="${t.id}">Delete</button></span></div>`).join('')}</div>`
      : '<div class="card empty"><div class="big">' + icon('quote') + '</div><h2>No testimonials yet</h2><p>Add one from a customer’s page (People → a person → Add testimonial), or put a Review form on your website. Reviews wait here for your approval.</p></div>'}`);
  $$('[data-ap]').forEach((b) => { b.onclick = async () => { const [tid, v] = b.dataset.ap.split(':'); await api('PUT', `/api/testimonials/${tid}`, { approved: v === '1' }); viewTestimonials(); }; });
  $$('[data-delt]').forEach((b) => { b.onclick = async () => { deleteWithUndo('Testimonial deleted', { url: `/api/testimonials/${b.dataset.delt}`, hide: hideEl(b.closest('.li')) }); }; });
}
