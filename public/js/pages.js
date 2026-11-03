'use strict';

// ---------------- Pages ----------------
// One place for every page, whoever built it: website, funnel, template or AI.
const PAGES_TABS = (on) => `<div class="tabs" style="margin-top:-6px">${[['', 'All pages'], ['websites', 'Websites'], ['funnels', 'Funnels']]
  .map(([k, l]) => `<a href="#/${k || 'pages'}" class="${on === (k || 'pages') ? 'active' : ''}">${l}</a>`).join('')}</div>`;

async function viewPages() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const q = (params.get('q') || '').toLowerCase();
  const all = await api('GET', '/api/pages');
  const pages = q ? all.filter((p) => `${p.name} ${p.funnel_name} ${p.address}`.toLowerCase().includes(q)) : all;
  shell('pages', `
    <div class="head"><div><h1>Pages</h1><div class="muted">Every page in one place, whoever built it: websites, funnels, templates or AI.</div></div>
      <div class="row"><button class="btn" data-newsite>+ Website</button><button class="btn primary" data-newfunnel>+ Funnel</button></div></div>
    ${PAGES_TABS('pages')}
    <input data-q placeholder="Search pages…" value="${esc(q)}" style="max-width:340px;margin-bottom:14px">
    ${pages.length ? `<div class="card table-wrap"><table>
      <tr><th>Page</th><th>Part of</th><th>Address</th><th>Status</th><th>Visits</th><th>Leads</th><th>Edited</th><th></th></tr>
      ${pages.map((p) => `<tr><td><strong>${esc(p.name)}</strong>${p.testing ? ' <span class="pill">A/B</span>' : ''}</td>
        <td><a href="#/${p.kind === 'website' ? 'websites' : 'funnels'}/${p.funnel_id}">${esc(p.funnel_name)}</a> <span class="muted small">${p.kind === 'website' ? 'website' : 'funnel'}</span></td>
        <td class="muted small">${esc(p.address)}</td><td>${p.status === 'live' ? '<span class="pill ok">Live</span>' : '<span class="pill warn">Draft</span>'}</td>
        <td>${p.views}</td><td>${p.leads}</td><td class="muted small">${fmtDate(p.updated_at)}</td>
        <td style="text-align:right;white-space:nowrap"><a class="btn sm primary" href="#/editor/${p.id}">Edit</a>
          <a class="btn sm" href="${esc(p.address.startsWith('http') ? p.address : publicUrl(p.address))}" target="_blank" rel="noopener">View ${icon('external')}</a></td></tr>`).join('')}
    </table></div>` : `<div class="card empty"><div class="big">${icon('page')}</div><h2>${q ? 'No matching pages' : 'No pages yet'}</h2>
      <p>${q ? 'Try a different search.' : 'Start a website for your business, or a funnel for one offer.'}</p></div>`}`);
  let t; $('[data-q]').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { location.hash = `#/pages?q=${encodeURIComponent(e.target.value)}`; }, 350); };
  if (q) { const el = $('[data-q]'); el.focus(); el.setSelectionRange(q.length, q.length); }
  $('[data-newsite]').onclick = newWebsite;
  $('[data-newfunnel]').onclick = newFunnel;
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
  $$('[data-delt]').forEach((b) => { b.onclick = async () => { if (await confirmBox('Delete testimonial?', 'It will be removed from every page.')) { await api('DELETE', `/api/testimonials/${b.dataset.delt}`); viewTestimonials(); } }; });
}
