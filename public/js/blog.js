'use strict';

// ---------------- Blog ----------------
// Articles a business publishes over time so people find it in search.
// A tab in Flows lists the posts; each post opens in a writer with the same
// simple marks as emails (pictures, headings, buttons, links) and a live preview.
const BLOG_SAMPLE = 'Start with the question your customers ask most, and answer it plainly.\n\n## A heading for each idea\n\nShort paragraphs are easier to read. Use **bold** for the one thing to remember.';

async function viewBlog() {
  const { posts, rilly, domain } = await api('GET', '/api/blog');
  const home = domain && posts.some((p) => p.status === 'published') ? domain : `${rilly}/`;
  const live = posts.filter((p) => p.status === 'published').length;
  shell('flows', `
    <div class="head"><div><h1>Flows</h1><div class="muted">Everything that brings people in and follows up with them: your pages, the emails between them, and follow-ups that start on their own.</div></div>
      <button class="btn primary" data-newpost>${icon('plus')} New post</button></div>
    ${flowTabs('blog')}
    ${posts.length ? `<div class="blog-top"><span class="muted small">${live} published · ${posts.length - live} draft${posts.length - live === 1 ? '' : 's'}</span>
      ${live ? `<a class="btn sm" href="${esc(home)}" target="_blank" rel="noopener">${icon('external')} View your blog</a>` : ''}</div>
      <section class="card blog-list">${posts.map((p) => `<div class="blog-row" data-postrow="${p.id}">
        <a class="blog-thumb" href="#/blog/${p.id}" tabindex="-1" aria-hidden="true">${p.cover ? `<img src="${esc(p.cover)}" alt="" loading="lazy">` : icon('note')}</a>
        <div class="blog-main"><a class="blog-name" href="#/blog/${p.id}">${esc(p.title || 'Untitled post')}</a>
          <span class="muted small">${p.status === 'published' ? `Published ${fmtDate(p.published_at)}` : `Edited ${fmtDate(p.updated_at)}`} · ${p.reading_minutes} min read${p.summary ? ` · ${esc(p.summary.slice(0, 90))}${p.summary.length > 90 ? '…' : ''}` : ''}</span></div>
        ${p.status === 'published' ? '<span class="pill ok">Published</span>' : '<span class="pill warn">Draft</span>'}
        <span class="blog-views"><b>${p.views}</b> <span class="muted small">views</span></span>
        <span class="row" style="gap:6px"><a class="btn sm" href="#/blog/${p.id}">Edit</a>
          ${moreMenu(`<button role="menuitem" class="danger" data-postdel="${p.id}">${icon('trash')} Delete</button>`)}</span>
      </div>`).join('')}</section>`
    : `<div class="card empty"><div class="big">${icon('note')}</div><h2>Write your first article</h2>
      <p>Most people find small businesses by searching a question. Answer one well, and Google and AI assistants send readers your way, for years.</p>
      <button class="btn primary" data-newpost>${icon('plus')} New post</button></div>`}`);
  $$('[data-newpost]').forEach((b) => { b.onclick = async () => {
    b.disabled = true;
    try { const p = await api('POST', '/api/blog', { title: '' }); location.hash = `#/blog/${p.id}`; } catch (e) { toast(e.message, true); b.disabled = false; }
  }; });
  bindMoreMenus();
  $$('[data-postdel]').forEach((b) => { b.onclick = () => {
    const row = $(`[data-postrow="${b.dataset.postdel}"]`);
    deleteWithUndo('Post deleted', { url: `/api/blog/${b.dataset.postdel}`, hide: hideEl(row) });
  }; });
}

async function viewBlogPost(postId) {
  const p = await api('GET', `/api/blog/${postId}`);
  const { color } = p;
  const isLive = () => p.status === 'published';
  const where = () => (p.domain && isLive() ? p.domain : p.rilly);
  shell('flows', `<div class="compose blog-ed">
    <div class="cmp-bar"><a class="btn sm" href="#/flows?show=blog">${icon('chevronDown').replace('class="i ', 'class="i rot90 ')} Blog</a>
      <span class="muted small" data-bstate></span>
      <span class="cmp-actions"><a class="btn sm" data-bview target="_blank" rel="noopener">${icon('eye')} View</a>
        ${moreMenu(`<button role="menuitem" data-bunpub>${icon('undo')} Unpublish</button><button role="menuitem" class="danger" data-bdel>${icon('trash')} Delete</button>`)}
        <button class="btn sm primary" data-bpub>${icon('globe')} Publish</button></span></div>
    <form class="cmp-form" data-bform onsubmit="return false">
      <label class="f">Title<input name="title" maxlength="200" value="${esc(p.title)}" placeholder="A question your customers ask, answered" class="blog-title-in"></label>
      <div class="f">Article
        <div class="cmp-tools" role="toolbar" aria-label="Insert">
          <label class="tool-file">${icon('image')} Picture<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden data-bimg></label>
          <button type="button" data-bins="\n\n## A heading\n\n">${icon('heading')} Heading</button>
          <button type="button" data-bbtn>${icon('button')} Button</button>
          <button type="button" data-blink>${icon('link')} Link</button>
          <button type="button" data-bins="\n\n---\n\n">${icon('divider')} Divider</button></div>
        <textarea name="body" rows="20" placeholder="${esc(BLOG_SAMPLE)}">${esc(p.body)}</textarea>
        <span class="hint">Leave an empty line between paragraphs. <b>## </b> starts a heading, <b>**bold**</b> for emphasis.</span></div>
      <div class="f">Cover picture <span class="hint">shown at the top and when the article is shared</span>
        <div class="blog-cover" data-bcover>${p.cover ? `<img src="${esc(p.cover)}" alt="">` : ''}
          <label class="btn sm">${icon('upload')} ${p.cover ? 'Change' : 'Upload'} picture<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden data-bcoverin></label>
          ${p.cover ? '<button type="button" class="linkbtn" data-bcoverx>Remove</button>' : ''}</div></div>
      <label class="f">Short summary <span class="hint">optional · shown under the title and on your blog’s front page</span><textarea name="excerpt" rows="2" maxlength="400">${esc(p.excerpt)}</textarea></label>
      <div class="colors" style="grid-template-columns:1fr 1fr"><label class="f">Written by<input name="author" maxlength="80" value="${esc(p.author)}"></label>
        <label class="f">Topics <span class="hint">optional, with commas</span><input name="tags" maxlength="200" value="${esc(p.tags)}" placeholder="e.g. tips, news"></label></div>
      <details class="more-page seo-fold" ${p.seo_title ? '' : 'open'}><summary>Search &amp; AI <span class="muted small" data-bseostate></span></summary>
        <button type="button" class="btn sm primary seo-write" data-bseowrite>${icon('sparkle')} Write these for me</button>
        <div class="serp" aria-label="How it may look in Google"><span class="serp-url" data-bserpurl></span><span class="serp-title" data-bserptitle></span><span class="serp-desc" data-bserpdesc></span></div>
        <label class="f">Search title <span class="hint" data-btlen></span><input name="seo_title" maxlength="70" value="${esc(p.seo_title)}"></label>
        <label class="f">Description <span class="hint" data-bdlen></span><textarea name="seo_description" rows="3" maxlength="200">${esc(p.seo_description)}</textarea></label>
        <label class="f">Address <span class="hint" data-bslughint></span><input name="slug" maxlength="60" value="${esc(p.slug)}"></label>
      </details>
    </form>
    <aside class="cmp-preview"><div class="blog-prev"><article data-bprev></article></div>
      <p class="hint">A preview of how readers see it. Search details are filled in for you when you publish, if they’re empty.</p></aside>
  </div>`);
  const form = $('[data-bform]');
  const val = () => Object.fromEntries(['title', 'body', 'excerpt', 'author', 'tags', 'seo_title', 'seo_description', 'slug'].map((k) => [k, form[k].value]));

  const render = () => {
    const v = val();
    const words = v.body.replace(/!\[[^\]]*\]\([^)]*\)/g, '').split(/\s+/).filter(Boolean).length;
    $('[data-bprev]').innerHTML = `<h1>${esc(v.title || 'Untitled post')}</h1>${v.excerpt ? `<p class="bp-dek">${esc(v.excerpt)}</p>` : ''}
      <div class="bp-meta">${v.author ? `By ${esc(v.author)} · ` : ''}${fmtDate(p.published_at || new Date())} · ${Math.max(1, Math.round(words / 220))} min read</div>
      ${p.cover ? `<img class="bp-cover" src="${esc(p.cover)}" alt="">` : ''}
      <div class="bp-body">${emailBodyHtml(v.body || BLOG_SAMPLE, { color })}</div>`;
    const t = v.seo_title || v.title, d = v.seo_description || v.excerpt;
    $('[data-bserptitle]').textContent = t.length > 60 ? `${t.slice(0, 58)}…` : (t || 'Your title');
    $('[data-bserpdesc]').textContent = d ? (d.length > 158 ? `${d.slice(0, 156)}…` : d) : 'Add a description so search and AI tools know what this article answers.';
    $('[data-bserpurl]').textContent = `${where().replace(/^https?:\/\//, '')}/${v.slug}`;
    const len = (n, lo, hi) => `${n} characters${n === 0 ? '' : n < lo ? ' · a little short' : n > hi ? ' · may be cut off' : ' · good'}`;
    $('[data-btlen]').textContent = len(v.seo_title.length, 30, 60);
    $('[data-bdlen]').textContent = len(v.seo_description.length, 110, 160);
    $('[data-bseostate]').textContent = v.seo_title && v.seo_description ? 'ready' : 'not set yet';
  };
  const showState = (msg) => {
    $('[data-bstate]').innerHTML = `${isLive() ? '<span class="pill ok">Published</span>' : '<span class="pill warn">Draft</span>'} ${msg ? esc(msg) : ''}`;
    $('[data-bpub]').innerHTML = isLive() ? `${icon('check')} Update` : `${icon('globe')} Publish`;
    $('[data-bunpub]').hidden = !isLive();
    $('[data-bview]').href = `${where()}/${p.slug}`;
    $('[data-bview]').innerHTML = `${icon('eye')} ${isLive() ? 'View' : 'Preview'}`;
  };

  // Saves as you type (a moment after you stop).
  let timer = null, saving = null;
  const save = async () => {
    clearTimeout(timer); timer = null;
    await saving;
    saving = (async () => {
      try {
        const r = await api('PUT', `/api/blog/${p.id}`, { ...val(), cover: p.cover });
        Object.assign(p, r);
        if (form.slug.value !== r.slug && document.activeElement !== form.slug) form.slug.value = r.slug;
        showState('Saved');
      } catch (e) { showState(''); toast(e.message, true); throw e; }
    })();
    return saving;
  };
  const later = () => { showState('Saving…'); clearTimeout(timer); timer = setTimeout(() => save().catch(() => {}), 800); };
  form.addEventListener('input', () => { render(); later(); });
  addEventListener('hashchange', () => { if (timer) save().catch(() => {}); }, { once: true });

  const insert = (text) => {
    const ta = form.body, at = ta.selectionStart ?? ta.value.length;
    ta.value = ta.value.slice(0, at) + text + ta.value.slice(ta.selectionEnd ?? at);
    ta.focus(); ta.selectionStart = ta.selectionEnd = at + text.length;
    render(); later();
  };
  $$('[data-bins]').forEach((b) => { b.onclick = () => insert(b.dataset.bins); });
  $('[data-blink]').onclick = async () => {
    const v = await modal('Add a link', `<label class="f">Linked words <span class="hint">optional</span><input name="label" placeholder="e.g. Read the full guide"></label>
      <label class="f">Web address<input name="url" type="url" required placeholder="https://"></label>`, { submit: 'Add link' });
    if (v?.url) insert(v.label ? `[${v.label.replace(/[[\]]/g, '')}](${v.url})` : v.url);
  };
  $('[data-bbtn]').onclick = async () => {
    const v = await modal('Add a button', `<label class="f">Button words<input name="label" required maxlength="40" placeholder="e.g. Book your spot"></label>
      <label class="f">Web address<input name="url" type="url" required placeholder="https://"></label>`, { submit: 'Add button' });
    if (v?.url) insert(`\n\n[${v.label.replace(/[[\]]/g, '')}](${v.url})\n\n`);
  };
  $('[data-bimg]').onchange = async (e) => {
    try {
      toast('Uploading picture…');
      const url = await uploadImage(e.target.files[0]);
      const alt = (await modal('Describe the picture', '<label class="f">What it shows <span class="hint">read aloud to people who can’t see it, and read by search engines</span><input name="alt" maxlength="120" placeholder="e.g. A red 1950s typewriter"></label>', { submit: 'Add picture' }))?.alt ?? '';
      insert(`\n\n![${alt.replace(/[[\]]/g, '')}](${url})\n\n`);
    } catch (err) { toast(err.message, true); }
    e.target.value = '';
  };
  const coverBox = () => {
    const box = $('[data-bcover]');
    box.innerHTML = `${p.cover ? `<img src="${esc(p.cover)}" alt="">` : ''}
      <label class="btn sm">${icon('upload')} ${p.cover ? 'Change' : 'Upload'} picture<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden data-bcoverin></label>
      ${p.cover ? '<button type="button" class="linkbtn" data-bcoverx>Remove</button>' : ''}`;
    $('[data-bcoverin]').onchange = async (e) => {
      try { toast('Uploading picture…'); p.cover = await uploadImage(e.target.files[0]); toast('Cover added'); coverBox(); render(); await save(); } catch (err) { toast(err.message, true); }
    };
    const x = $('[data-bcoverx]');
    if (x) x.onclick = async () => { const was = p.cover; p.cover = ''; coverBox(); render(); await save().catch(() => {}); undoToast('Cover removed', async () => { p.cover = was; coverBox(); render(); await save(); }); };
  };
  coverBox();

  $('[data-bseowrite]').onclick = async (e) => {
    const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Writing…';
    try {
      await save();
      const g = await api('POST', `/api/blog/${p.id}/seo`);
      form.seo_title.value = g.title; form.seo_description.value = g.description;
      const hint = $('[data-bslughint]');
      if (g.slug && g.slug !== p.slug) {
        if (!g.live) { form.slug.value = g.slug; hint.textContent = ''; }
        else hint.innerHTML = `Suggested: <b>${esc(g.slug)}</b> <button type="button" class="linkbtn" data-buseslug="${esc(g.slug)}">Use it</button> <span class="muted">(it’s published, so old links would stop working)</span>`;
      }
      render(); await save();
      toast(g.by === 'ai' ? 'Written for search and AI. Change anything you like' : 'Written from your article’s words. Change anything you like');
    } catch (err) { toast(err.message, true); }
    btn.disabled = false; btn.innerHTML = `${icon('sparkle')} Write these for me`;
  };
  $('.seo-fold').addEventListener('click', (e) => { const b = e.target.closest('[data-buseslug]'); if (b) { form.slug.value = b.dataset.buseslug; $('[data-bslughint]').textContent = ''; render(); later(); } });

  $('[data-bpub]').onclick = async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try {
      const was = isLive();
      await save();
      Object.assign(p, await api('POST', `/api/blog/${p.id}/publish`));
      form.seo_title.value = p.seo_title; form.seo_description.value = p.seo_description;
      render(); showState('');
      toast(was ? 'Updated. Readers see the new version now' : 'Published. It’s on your blog and in your sitemap');
    } catch (err) { toast(err.message, true); }
    btn.disabled = false;
  };
  $('[data-bunpub]').onclick = async () => {
    Object.assign(p, await api('POST', `/api/blog/${p.id}/unpublish`));
    showState('');
    undoToast('Unpublished. Only you can see it now', async () => { Object.assign(p, await api('POST', `/api/blog/${p.id}/publish`)); showState(''); });
  };
  $('[data-bdel]').onclick = async () => {
    clearTimeout(timer); timer = null;
    history.pushState(null, '', '#/flows?show=blog');
    await viewBlog();
    deleteWithUndo(`“${p.title || 'Untitled post'}” deleted`, { url: `/api/blog/${p.id}`, hide: hideEl($(`[data-postrow="${p.id}"]`)) });
  };
  bindMoreMenus();
  render(); showState('');
  if (!p.title) form.title.focus();
}
