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
    <div class="head"><div><h1>Pages</h1><div class="muted">Your pages and websites, each shown as the pages visitors move through.</div></div>
      <div class="row"><button class="btn" data-newsite>+ Website</button><button class="btn primary" data-newfunnel>+ Page</button></div></div>
    ${PAGES_TABS('pages')}
    <input data-q placeholder="Search pages and pages…" value="${esc(q)}" style="max-width:340px;margin-bottom:14px">
    ${groups.length ? groups.map((g) => `<section class="pgroup card">
      <header class="pg-head">
        <div><a class="pg-name" href="#/${({ website: 'websites', members: 'members' })[g.kind] || 'funnels'}/${g.id}">${esc(g.name)}</a>
          <span class="muted small">${({ website: 'Website', members: 'Course' })[g.kind] || 'Page'} · ${g.pages.length} page${g.pages.length === 1 ? '' : 's'}${g.followups ? ` · ${g.followups} follow-up${g.followups === 1 ? '' : 's'}` : ''}</span></div>
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
// Name, title and photo fields for a testimonial (their words are kept as they said them).
const testiWhoFields = (t = {}) => `<div class="colors" style="grid-template-columns:1fr 1fr"><label class="f">Name as shown<input name="name" value="${esc(t.name || '')}" required></label>
  <label class="f">Title <span class="hint">optional</span><input name="detail" value="${esc(t.detail || '')}" placeholder="e.g. Owner, Bloom Bakery"></label></div>
  <label class="f">Photo of them <span class="hint">optional · a square face photo looks best</span>
    <span class="row" style="gap:10px;align-items:center">${t.photo ? `<img src="${esc(t.photo)}" alt="" class="tp-photo">` : ''}<input type="file" name="photofile" accept="image/jpeg,image/png,image/webp"></span></label>
  ${t.photo ? '<label class="check"><input type="checkbox" name="nophoto"> Remove the photo</label>' : ''}`;
async function testiPhoto(v, current = '') {
  if (v.nophoto) return '';
  if (v.photofile && v.photofile.size) return uploadImage(v.photofile);
  return current;
}
const ratingStars = (n) => (n ? `<span class="stars-sm" title="${n} of 5">${'★'.repeat(n)}<i>${'★'.repeat(5 - n)}</i></span> ` : '');
async function viewTestimonials() {
  const list = await api('GET', '/api/testimonials');
  const rated = list.filter((t) => t.rating);
  const avg = rated.length ? (rated.reduce((s, t) => s + t.rating, 0) / rated.length).toFixed(1) : null;
  shell('people', `
    <div class="head"><div><h1>Testimonials</h1><div class="muted">Only real customers’ words, shared with their permission. Pages show approved ones; nothing is ever made up.</div></div>
      <div class="row"><a class="btn" href="#/people">← People</a><button class="btn primary" data-addtesti>${icon('plus')} Add testimonial</button></div></div>
    ${avg ? `<div class="card row" style="gap:14px;margin-bottom:14px"><b style="font-size:28px">${avg}</b>${ratingStars(Math.round(avg))}<span class="muted small">from ${rated.length} review request${rated.length === 1 ? '' : 's'}. Set them up in Settings → Email → Reviews.</span></div>` : ''}
    ${list.length ? `<div class="card">${list.map((t) => `<div class="li"><span style="max-width:70%;display:flex;gap:12px;align-items:flex-start">${t.photo ? `<img src="${esc(t.photo)}" alt="" class="tp-photo">` : `<span class="tp-ini tp-photo">${esc(String(t.name || '?').split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join(''))}</span>`}<span>${ratingStars(t.rating)}<b>“${esc(t.quote)}”</b><br>
        <span class="muted small">${esc(t.name)}${t.detail ? ` · ${esc(t.detail)}` : ''} · ${esc(t.source)}${t.person_id ? ` · <a href="#/people/${t.person_id}">${esc(t.person_name || 'person')}</a>` : ''} · ${fmtDate(t.created_at)}</span></span></span>
      <span class="row">${!t.shareable ? '<span class="pill">private: for your eyes only</span>' : t.approved ? '<span class="pill ok">shown on pages</span><button class="btn sm" data-ap="' + t.id + ':0">Hide</button>' : '<span class="pill warn">waiting for approval</span><button class="btn sm primary" data-ap="' + t.id + ':1">Approve</button>'}
        <button class="btn sm" data-editt="${t.id}">${icon('pencil')} Name, title &amp; photo</button><button class="btn sm danger" data-delt="${t.id}">Delete</button></span></div>`).join('')}</div>`
      : '<div class="card empty"><div class="big">' + icon('quote') + '</div><h2>No testimonials yet</h2><p>Add one from a customer’s page (People → a person → Add testimonial), or put a Review form on your website. Reviews wait here for your approval.</p></div>'}`);
  $$('[data-ap]').forEach((b) => { b.onclick = async () => { const [tid, v] = b.dataset.ap.split(':'); await api('PUT', `/api/testimonials/${tid}`, { approved: v === '1' }); viewTestimonials(); }; });
  $$('[data-delt]').forEach((b) => { b.onclick = async () => { deleteWithUndo('Testimonial deleted', { url: `/api/testimonials/${b.dataset.delt}`, hide: hideEl(b.closest('.li')) }); }; });
  $$('[data-editt]').forEach((b) => { b.onclick = async () => {
    const t = list.find((x) => String(x.id) === b.dataset.editt);
    const r = await modal('Name, title and photo', `<p class="muted small">Their words stay exactly as they said them.</p>${testiWhoFields(t)}`,
      { onSubmit: async (v) => api('PUT', `/api/testimonials/${t.id}`, { name: v.name, detail: v.detail, photo: await testiPhoto(v, t.photo) }) });
    if (r) { toast('Saved. Pages using it update too'); viewTestimonials(); }
  }; });
  $('[data-addtesti]').onclick = async () => {
    const r = await modal('Add a testimonial', `
      <label class="f">What they said <span class="hint">their words, not a summary</span><textarea name="quote" rows="4" required></textarea></label>
      ${testiWhoFields()}
      <label class="f">Where it came from<input name="source" placeholder="e.g. email, Google review, in person"></label>
      <label class="check"><input type="checkbox" name="consent" required> These are a real customer’s words, and they agreed to share them.</label>`,
    { submit: 'Save testimonial', onSubmit: async (v) => api('POST', '/api/testimonials', { quote: v.quote, name: v.name, detail: v.detail, source: v.source, consent: v.consent, photo: await testiPhoto(v) }) });
    if (r) { toast('Saved. Drag it onto any page from the editor’s Testimonials tray'); viewTestimonials(); }
  };
}
