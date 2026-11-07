'use strict';

// ---------------- Community ----------------
// A members' community the business runs for its customers (a tab in Flows).
// The owner sets it up here: spaces, who can join, the welcome post, and
// keeps it tidy (pin, delete, remove people). Opening the community while
// signed in here shows it as the host, to post and reply as the business.
const COMM_JOIN = [
  ['open', 'Anyone with an email', 'Free. People join with a link we email them.'],
  ['buyers', 'People who bought…', 'Buyers of the products you pick get in automatically.'],
  ['members', 'Members of…', 'People in the members areas you pick get in automatically.'],
];
const commInitials = (n) => String(n || '?').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

async function viewCommunityAdmin() {
  const d = await api('GET', '/api/community');
  const head = (btn) => `<div class="head"><div><h1>Flows</h1><div class="muted">Everything that brings people in and follows up with them: your pages, the emails between them, and follow-ups that start on their own.</div></div>${btn}</div>${flowTabs('community')}`;
  if (!d.community) {
    shell('flows', `${head('')}<div class="card empty cma-empty"><div class="big">${icon('people')}</div><h2>Start your community</h2>
      <p>A friendly place for your customers to meet, share wins and ask questions, with you as the host. Spaces like “Introductions” and “Wins”, events with reminders, and a weekly email of the best posts.</p>
      <button class="btn primary" data-cstart>${icon('plus')} Start your community</button></div>`);
    $('[data-cstart]').onclick = async (e) => {
      e.target.disabled = true;
      try { await api('POST', '/api/community', {}); toast('Your community is ready. Say hello in it, then invite people'); viewCommunityAdmin(); } catch (err) { e.target.disabled = false; toast(err.message, true); }
    };
    return;
  }
  const c = d.community;
  const open = publicUrl(`/my/${state.me.account.id}/community`);
  const color = c.brand_color || d.brand_default;
  const joinWord = { open: 'Anyone with an email can join', buyers: 'Buyers only', members: 'Members areas only' }[c.join_rule];
  shell('flows', `${head(`<button class="btn primary" data-cspace>${icon('plus')} New space</button>`)}
    <section class="card cma-hero" style="--cc:${esc(color)}">
      <div class="cma-cover">${c.cover_url ? `<img src="${esc(c.cover_url)}" alt="">` : ''}<span class="cma-logo">${esc(commInitials(c.name))}</span></div>
      <div class="cma-hero-main"><div><h2>${esc(c.name)}</h2><span class="muted small">${esc(joinWord)} · <a href="${esc(open)}" target="_blank" rel="noopener">${esc(open.replace(/^https?:\/\//, ''))}</a></span></div>
        <a class="btn primary" href="${esc(open)}" target="_blank" rel="noopener">${icon('external')} Open as host</a></div>
      <div class="cma-stats"><div><b>${d.stats.members}</b><span>members</span></div><div><b>${d.stats.posts_week}</b><span>posts this week</span></div><div><b>${d.stats.active_week}</b><span>active this week</span></div></div>
    </section>
    <div class="cma-grid">
      <div class="cma-col">
        <section class="card cma-card"><div class="cma-h"><h3>Spaces</h3><span class="muted small">Drag to reorder</span></div>
          <div class="cma-spaces">${d.spaces.map((s) => `<div class="cma-space" data-space="${s.id}">
            <button type="button" class="pg-grip" data-sgrip title="Drag to reorder (or use the arrow keys)" aria-label="Move “${esc(s.name)}”">${icon('grip')}</button>
            <span class="cma-hash">#</span><button type="button" class="cma-sname" data-srename="${s.id}" title="Rename">${esc(s.name)}</button>
            ${s.owner_only ? '<span class="pill">Only you post</span>' : ''}<span class="muted small cma-n">${s.posts} post${s.posts === 1 ? '' : 's'}</span>
            ${moreMenu(`<button role="menuitem" data-srename="${s.id}">${icon('pencil')} Rename</button>
              <button role="menuitem" data-sowner="${s.id}">${icon(s.owner_only ? 'people' : 'bell')} ${s.owner_only ? 'Let everyone post' : 'Only I post (announcements)'}</button>
              <button role="menuitem" class="danger" data-sdel="${s.id}">${icon('trash')} Delete</button>`)}</div>`).join('') || '<p class="muted">No spaces yet. Add one with “New space”.</p>'}</div>
        </section>
        <section class="card cma-card"><div class="cma-h"><h3>Recent posts</h3><a class="small" href="${esc(open)}" target="_blank" rel="noopener">See all</a></div>
          ${d.posts.length ? d.posts.map((p) => `<div class="cma-post" data-cpost="${p.id}">
            <span class="cma-av ${p.member_id ? '' : 'host'}">${esc(commInitials(p.member_id ? p.author_name : state.me.account.name))}</span>
            <div class="cma-post-main"><b>${esc(p.title || p.body.split('\n')[0].slice(0, 80) || 'Picture')}</b>
              <span class="muted small">${p.member_id ? esc(p.author_name || 'Member') : 'You (host)'} · # ${esc(p.space_name)} · ${fmtDate(p.created_at)}${p.event_at ? ' · Event' : ''}${p.likes ? ` · ${p.likes} ♥` : ''}${p.comments ? ` · ${p.comments} comment${p.comments === 1 ? '' : 's'}` : ''}</span></div>
            ${p.pinned ? '<span class="pill ok">Pinned</span>' : ''}
            ${moreMenu(`<a role="menuitem" href="${esc(open)}/p/${p.id}" target="_blank" rel="noopener">${icon('external')} Open</a>
              <button role="menuitem" data-cpin="${p.id}" data-on="${p.pinned ? 0 : 1}">${icon('flag')} ${p.pinned ? 'Unpin' : 'Pin to top'}</button>
              <button role="menuitem" class="danger" data-cpdel="${p.id}">${icon('trash')} Delete</button>`)}</div>`).join('')
    : `<p class="muted">No posts yet. <a href="${esc(open)}" target="_blank" rel="noopener">Open your community</a> and write the first one: people post more when the host goes first.</p>`}
        </section>
      </div>
      <div class="cma-col">
        <form class="card cma-card" data-csettings><div class="cma-h"><h3>Settings</h3></div>
          <label class="f">Name<input name="name" required maxlength="80" value="${esc(c.name)}"></label>
          <div class="f cma-coverf"><span>Cover picture</span><div class="cma-coverprev" data-coverprev>${c.cover_url ? `<img src="${esc(c.cover_url)}" alt="">` : '<span class="muted small">No picture yet</span>'}</div>
            <input type="hidden" name="cover_url" value="${esc(c.cover_url)}"><span class="row" style="gap:6px"><label class="btn sm">${icon('image')} ${c.cover_url ? 'Change' : 'Add a picture'}<input type="file" accept="image/*" data-cover hidden></label>
            ${c.cover_url ? '<button type="button" class="btn sm" data-uncover>Remove</button>' : ''}</span></div>
          <label class="f cma-color">Color <span class="row" style="gap:8px"><input type="color" name="brand_color" value="${esc(color)}"><button type="button" class="btn sm" data-cdefault ${c.brand_color ? '' : 'hidden'}>Use my brand color</button></span></label>
          <div class="f"><span>Who can join</span><div class="choices cma-join">${COMM_JOIN.map(([k, l, h]) => `<label class="choice"><input type="radio" name="join_rule" value="${k}" ${c.join_rule === k ? 'checked' : ''} hidden><span><b>${l}</b><small>${h}</small></span></label>`).join('')}</div></div>
          <div class="cma-picks" data-pick="buyers" ${c.join_rule === 'buyers' ? '' : 'hidden'}>${d.products.length ? d.products.map((p) => `<label class="cma-pick"><input type="checkbox" name="join_products" value="${p.id}" ${c.join_products.includes(p.id) ? 'checked' : ''}> ${esc(p.name)}</label>`).join('') : '<p class="muted small">Add a product first (Products), then pick it here.</p>'}</div>
          <div class="cma-picks" data-pick="members" ${c.join_rule === 'members' ? '' : 'hidden'}>${d.areas.length ? d.areas.map((a) => `<label class="cma-pick"><input type="checkbox" name="join_areas" value="${a.id}" ${c.join_areas.includes(a.id) ? 'checked' : ''}> ${esc(a.name)}</label>`).join('') : '<p class="muted small">Make a members area first (Flows › New › Members area).</p>'}</div>
          <label class="f">Welcome post <span class="muted small">at the top of the community; **bold** and links work</span><textarea name="welcome" rows="5" maxlength="5000">${esc(c.welcome)}</textarea></label>
          <button class="btn primary">Save</button></form>
        <section class="card cma-card"><div class="cma-h"><h3>Members</h3><span class="muted small">${d.stats.members}</span></div>
          ${d.members.length ? `<div class="cma-members">${d.members.map((m) => `<div class="cma-member" data-cmem="${m.id}">${m.photo_url ? `<img class="cma-av" src="${esc(m.photo_url)}" alt="">` : `<span class="cma-av">${esc(commInitials(m.name))}</span>`}
            <div class="cma-post-main"><a href="#/people/${m.contact_id}"><b>${esc(m.name)}</b></a><span class="muted small">${esc(m.email)} · joined ${fmtDate(m.joined_at)}</span></div>
            <button class="btn sm" data-cremove="${m.id}" title="Remove from the community (they can’t come back unless you undo)">Remove</button></div>`).join('')}</div>`
    : `<p class="muted small">No members yet. Share the link: <a href="${esc(open)}" target="_blank" rel="noopener">${esc(open.replace(/^https?:\/\//, ''))}</a></p>`}
        </section>
      </div>
    </div>`);
  bindMoreMenus();
  bindCommunityAdmin(d);
}

function bindCommunityAdmin(d) {
  const c = d.community;
  $('[data-cspace]').onclick = async () => {
    const r = await modal('New space', `<label class="f">Name <span class="hint">e.g. Wins, Questions, Show and tell</span><input name="name" required maxlength="60"></label>
      <label class="row" style="gap:8px;font-size:.9rem"><input type="checkbox" name="owner_only" style="width:auto"> Only I post here (announcements). Members can still comment.</label>`,
    { submit: 'Add space', onSubmit: (v) => api('POST', '/api/community/spaces', { name: v.name, owner_only: Boolean(v.owner_only) }) });
    if (r) { toast(`“${r.name}” added`); viewCommunityAdmin(); }
  };
  const space = (sid) => d.spaces.find((s) => String(s.id) === String(sid));
  $$('[data-srename]').forEach((b) => { b.onclick = async () => {
    const s = space(b.dataset.srename);
    const menu = b.closest('.more-menu'); if (menu) menu.hidden = true;
    const r = await modal('Rename space', `<label class="f">Name<input name="name" required maxlength="60" value="${esc(s.name)}"></label>`,
      { submit: 'Save', onSubmit: (v) => api('PUT', `/api/community/spaces/${s.id}`, { name: v.name }) });
    if (r) viewCommunityAdmin();
  }; });
  $$('[data-sowner]').forEach((b) => { b.onclick = async () => {
    const s = space(b.dataset.sowner);
    try { await api('PUT', `/api/community/spaces/${s.id}`, { owner_only: !s.owner_only }); toast(s.owner_only ? `Everyone can post in “${s.name}”` : `Only you post in “${s.name}” now`); viewCommunityAdmin(); } catch (e) { toast(e.message, true); }
  }; });
  $$('[data-sdel]').forEach((b) => { b.onclick = () => {
    const s = space(b.dataset.sdel);
    b.closest('.more-menu').hidden = true;
    deleteWithUndo(`“${s.name}” deleted`, { url: `/api/community/spaces/${s.id}`, hide: hideEl(b.closest('.cma-space')) });
  }; });
  bindCommunitySpaceOrder();

  $$('[data-cpin]').forEach((b) => { b.onclick = async () => {
    try { await api('PUT', `/api/community/posts/${b.dataset.cpin}/pin`, { pinned: b.dataset.on === '1' }); toast(b.dataset.on === '1' ? 'Pinned to the top' : 'Unpinned'); viewCommunityAdmin(); } catch (e) { toast(e.message, true); }
  }; });
  $$('[data-cpdel]').forEach((b) => { b.onclick = () => {
    b.closest('.more-menu').hidden = true;
    deleteWithUndo('Post deleted', { url: `/api/community/posts/${b.dataset.cpdel}`, hide: hideEl(b.closest('.cma-post')) });
  }; });
  $$('[data-cremove]').forEach((b) => { b.onclick = () => {
    const m = d.members.find((x) => String(x.id) === b.dataset.cremove);
    deleteWithUndo(`${m.name} removed from the community`, { url: `/api/community/members/${m.id}`, hide: hideEl(b.closest('.cma-member')) });
  }; });

  // Settings
  const f = $('[data-csettings]');
  const showPicks = () => { const rule = $('input[name=join_rule]:checked', f).value; $$('[data-pick]', f).forEach((x) => { x.hidden = x.dataset.pick !== rule; }); };
  $$('input[name=join_rule]', f).forEach((r) => { r.onchange = showPicks; });
  let color = c.brand_color;
  $('input[name=brand_color]', f).oninput = (e) => { color = e.target.value; $('[data-cdefault]', f).hidden = false; };
  $('[data-cdefault]', f).onclick = (e) => { color = ''; $('input[name=brand_color]', f).value = d.brand_default; e.target.hidden = true; f.dispatchEvent(new Event('input')); };
  $('[data-cover]', f).onchange = async (e) => {
    try {
      const url = await uploadImage(e.target.files[0]);
      $('input[name=cover_url]', f).value = url;
      $('[data-coverprev]', f).innerHTML = `<img src="${esc(url)}" alt="">`;
      f.dispatchEvent(new Event('input'));
    } catch (err) { toast(err.message, true); }
  };
  const un = $('[data-uncover]', f);
  if (un) un.onclick = () => { $('input[name=cover_url]', f).value = ''; $('[data-coverprev]', f).innerHTML = '<span class="muted small">No picture yet</span>'; un.remove(); f.dispatchEvent(new Event('input')); };
  trackDirty(f);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const rule = $('input[name=join_rule]:checked', f).value;
    const body = { name: f.name.value, cover_url: f.cover_url.value, brand_color: color, welcome: f.welcome.value, join_rule: rule,
      join_products: $$('input[name=join_products]:checked', f).map((x) => Number(x.value)), join_areas: $$('input[name=join_areas]:checked', f).map((x) => Number(x.value)) };
    try { await api('PUT', '/api/community', body); toast('Saved'); viewCommunityAdmin(); } catch (err) { toast(err.message, true); }
  };
}

function bindCommunitySpaceOrder() {
  const save = () => api('PUT', '/api/community/spaces/order', { ids: $$('.cma-space[data-space]').map((x) => Number(x.dataset.space)) }).catch((e) => toast(e.message, true));
  let dragging = null;
  $$('[data-sgrip]').forEach((h) => {
    const row = h.closest('.cma-space');
    h.onpointerdown = () => { row.draggable = true; };
    row.ondragstart = (e) => { dragging = row; row.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', row.dataset.space); };
    row.ondragend = () => { row.draggable = false; row.classList.remove('dragging'); if (dragging) { dragging = null; save(); } };
    row.ondragover = (e) => {
      if (!dragging || dragging === row) return;
      e.preventDefault();
      const r = row.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) row.before(dragging); else row.after(dragging);
    };
    h.onkeydown = (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const other = e.key === 'ArrowUp' ? row.previousElementSibling : row.nextElementSibling;
      if (!other?.matches('.cma-space')) return;
      if (e.key === 'ArrowUp') other.before(row); else other.after(row);
      h.focus(); save();
    };
  });
}
