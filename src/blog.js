// Blog: articles a business publishes over time, so people find it in search.
// Posts are written with the same simple marks as emails (see emailformat.js),
// and each published post gets a clean address, sharing tags, BlogPosting
// structured data, a place in the sitemap and llms.txt, and an RSS feed.
//
// Addresses: on Rilly /blog/<account id>-<name>/ and /blog/<…>/<post>;
// on the business's own domain /blog and /blog/<post> (see app.js).
const crypto = require('node:crypto');
const { emailBodyHtml } = require('../public/js/emailformat.js');
const seo = require('./seo');
const auth = require('./auth');
const { esc, trackingTags } = require('./render');

const LIMITS = { title: 200, slug: 60, excerpt: 400, cover: 500, body: 100000, author: 80, tags: 200, seo_title: 80, seo_description: 220 };
const IMG_LINE = /^!\[[^\]]*\]\([^)]*\)$/;
const BTN_LINE = /^\[[^\]]+\]\([^)]*\)$/;

// The words of a post without its marks (pictures, buttons and dividers dropped).
function plainWords(body) {
  return String(body || '').split(/\n{2,}/).map((p) => p.trim())
    .filter((p) => p && !IMG_LINE.test(p) && !BTN_LINE.test(p) && !/^-{3,}$/.test(p))
    .map((p) => p.replace(/^#{1,3}\s+/, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\s+/g, ' '))
    .join('\n\n');
}
// A short summary for cards, feeds and search: the writer's own, or the opening sentences.
const summaryOf = (p, n = 200) => p.excerpt || seo.cut(plainWords(String(p.body || '').split(/\n{2,}/).filter((x) => !/^#{1,3}\s/.test(x.trim())).join('\n\n')), n);
const readingMinutes = (body) => Math.max(1, Math.round(plainWords(body).split(/\s+/).filter(Boolean).length / 220));
const firstPicture = (body) => String(body || '').match(/^!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)$/m)?.[1] || '';
const parseTagList = (t) => [...new Set(String(t || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean))].slice(0, 10);
const blogKey = (account) => `${account.id}-${seo.slugify(account.name) || 'blog'}`.replace(/-+$/, '');
const xml = (v) => String(v ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
const color = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : '#1b736d');
const dateText = (d) => new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const isoDate = (d) => (d ? new Date(d).toISOString() : undefined);

function registerBlog(app, api, { getDb, HttpError, id, publicBase }) {
  const db = () => getDb();

  const out = (p) => ({
    id: p.id, title: p.title, slug: p.slug, excerpt: p.excerpt, cover: p.cover, body: p.body, author: p.author,
    tags: p.tags, status: p.status, published_at: isoDate(p.published_at) || null, updated_at: isoDate(p.updated_at),
    created_at: isoDate(p.created_at), views: p.views, seo_title: p.seo_title, seo_description: p.seo_description,
    reading_minutes: readingMinutes(p.body), summary: summaryOf(p),
  });
  const getPost = async (accountId, postId) => {
    const p = await db().get('SELECT * FROM blog_posts WHERE id = ? AND account_id = ?', id(postId), accountId);
    if (!p) throw new HttpError(404, 'Post not found');
    return p;
  };
  const uniqueSlug = async (accountId, want, exceptId = 0) => {
    const base = seo.slugify(want) || 'post';
    let slug = base;
    for (let n = 2; await db().get('SELECT 1 FROM blog_posts WHERE account_id = ? AND slug = ? AND id <> ?', accountId, slug, exceptId); n++) slug = `${base.slice(0, 55)}-${n}`;
    return slug;
  };
  // Where the blog lives: the business's own domain when one is connected, else Rilly.
  const blogUrls = async (accountId) => {
    const a = await db().get('SELECT id, name, domain, brand_color FROM accounts WHERE id = ?', accountId);
    return { rilly: `${publicBase()}/blog/${blogKey(a)}`, domain: a.domain ? `https://${a.domain}/blog` : null, color: color(a.brand_color) };
  };
  // Search title and description for a post: from AI when connected, else from its own words.
  const suggestFor = async (accountId, p) => {
    const account = await db().get('SELECT * FROM accounts WHERE id = ?', accountId);
    const blocks = [{ type: 'hero', text: p.title, subtext: p.excerpt }, { type: 'text', text: plainWords(p.body).slice(0, 6000) }];
    return seo.suggest({ account, business: account.name, pageName: p.title || 'Article', blocks, isHome: false, kind: 'website' });
  };

  // ---------- the app ----------
  api.get('/blog', async (req, res) => {
    const rows = await db().all('SELECT * FROM blog_posts WHERE account_id = ? ORDER BY (status = \'draft\') DESC, COALESCE(published_at, created_at) DESC, id DESC', req.accountId);
    res.json({ posts: rows.map(out), ...(await blogUrls(req.accountId)) });
  });

  api.post('/blog', async (req, res) => {
    const title = String(req.body?.title || '').trim().slice(0, LIMITS.title);
    const slug = await uniqueSlug(req.accountId, title || `post-${crypto.randomBytes(2).toString('hex')}`);
    const p = await db().get(`INSERT INTO blog_posts (account_id, title, slug, author) VALUES (?, ?, ?, ?) RETURNING *`,
      req.accountId, title, slug, String(req.user?.name || '').slice(0, LIMITS.author));
    res.status(201).json(out(p));
  });

  api.get('/blog/:id', async (req, res) => {
    const p = await getPost(req.accountId, req.params.id);
    res.json({ ...out(p), ...(await blogUrls(req.accountId)) });
  });

  api.put('/blog/:id', async (req, res) => {
    const p = await getPost(req.accountId, req.params.id);
    const b = req.body || {};
    const v = {};
    for (const k of ['title', 'excerpt', 'body', 'author', 'seo_title', 'seo_description']) v[k] = b[k] === undefined ? p[k] : String(b[k]).slice(0, LIMITS[k]);
    v.cover = b.cover === undefined ? p.cover : String(b.cover || '').trim().slice(0, LIMITS.cover);
    if (v.cover && !/^https?:\/\//.test(v.cover)) throw new HttpError(400, 'Upload a cover picture, or paste a link that starts with https://');
    v.tags = b.tags === undefined ? p.tags : parseTagList(b.tags).join(', ').slice(0, LIMITS.tags);
    v.slug = b.slug !== undefined && String(b.slug).trim() && b.slug !== p.slug ? await uniqueSlug(req.accountId, b.slug, p.id) : p.slug;
    if (p.status === 'published' && !v.title.trim()) throw new HttpError(400, 'A published post needs a title');
    const r = await db().get(`UPDATE blog_posts SET title = ?, slug = ?, excerpt = ?, cover = ?, body = ?, author = ?, tags = ?, seo_title = ?, seo_description = ?, updated_at = now()
      WHERE id = ? AND account_id = ? RETURNING *`, v.title, v.slug, v.excerpt, v.cover, v.body, v.author, v.tags, v.seo_title, v.seo_description, p.id, req.accountId);
    res.json(out(r));
  });

  api.post('/blog/:id/seo', async (req, res) => {
    const p = await getPost(req.accountId, req.params.id);
    res.json({ ...(await suggestFor(req.accountId, p)), live: p.status === 'published' });
  });

  api.post('/blog/:id/publish', async (req, res) => {
    const p = await getPost(req.accountId, req.params.id);
    if (!p.title.trim()) throw new HttpError(400, 'Give the post a title first');
    if (!plainWords(p.body).trim()) throw new HttpError(400, 'Write the post first');
    // Fill in what search needs, if it's missing.
    let { seo_title: st, seo_description: sd } = p;
    if (!st || !sd) {
      const g = await suggestFor(req.accountId, p).catch(() => null);
      if (g) { st ||= g.title; sd ||= g.description; }
    }
    const r = await db().get(`UPDATE blog_posts SET status = 'published', published_at = COALESCE(published_at, now()), seo_title = ?, seo_description = ?, updated_at = now()
      WHERE id = ? AND account_id = ? RETURNING *`, st || '', sd || '', p.id, req.accountId);
    res.json(out(r));
  });

  api.post('/blog/:id/unpublish', async (req, res) => {
    const p = await getPost(req.accountId, req.params.id);
    const r = await db().get("UPDATE blog_posts SET status = 'draft', updated_at = now() WHERE id = ? AND account_id = ? RETURNING *", p.id, req.accountId);
    res.json(out(r));
  });

  api.delete('/blog/:id', async (req, res) => {
    await getPost(req.accountId, req.params.id);
    await db().run('DELETE FROM blog_posts WHERE id = ? AND account_id = ?', id(req.params.id), req.accountId);
    res.json({ ok: true });
  });

  // ---------- public pages ----------
  const accountForKey = async (key) => {
    const m = String(key || '').match(/^(\d{1,9})(?:-[a-z0-9-]*)?$/);
    return m ? db().get('SELECT id, name, domain, home_funnel_id, page_code, brand_color FROM accounts WHERE id = ?', Number(m[1])) : null;
  };
  const ownerViewing = async (req, accountId) => {
    const token = auth.parseCookies(req.headers.cookie).sid;
    if (!token) return false;
    const s = await db().get('SELECT account_id FROM sessions WHERE token = ? AND expires_at > now()', token);
    return s?.account_id === accountId;
  };
  // Links on this request: /blog on the business's own domain, /blog/<key> on Rilly.
  const placeOf = (req, account) => {
    const own = Boolean(req.blogOnDomain && req.publicHost);
    const origin = own ? `https://${req.publicHost}` : publicBase();
    const path = own ? '/blog' : `/blog/${blogKey(account)}`;
    return { own, origin, path, abs: `${origin}${path}`, home: own ? path : `${path}/`, homeAbs: own ? `${origin}${path}` : `${origin}${path}/` };
  };
  // Where a reader can sign up: a live page with a form (a lead page), else the home website.
  const callToAction = async (account, place) => {
    const funnels = await db().all("SELECT id, name, slug, kind, entry_step_id FROM funnels WHERE account_id = ? AND status = 'live' AND kind <> 'members' ORDER BY (kind = 'website'), id DESC LIMIT 20", account.id);
    for (const f of funnels) {
      if (f.kind === 'website') continue;
      const st = await db().get('SELECT blocks, settings FROM funnel_steps WHERE id = ?', f.entry_step_id);
      let blocks = []; try { blocks = JSON.parse(st?.blocks || '[]'); } catch { /* none */ }
      const form = blocks.find((b) => b.type === 'form');
      if (!form) continue;
      const hero = blocks.find((b) => b.type === 'hero') || {};
      const filled = (t) => (t && !/\[|\{\{/.test(t) ? t : ''); // template words not filled in yet stay out
      const href = place.own ? (f.id === account.home_funnel_id ? '/' : `/${f.slug}`) : `/f/${f.slug}`;
      return { href, heading: seo.cut(filled(hero.text) || `Get more from ${account.name}`, 90), text: seo.cut(filled(hero.subtext), 160), button: String(form.buttonLabel || 'Sign up').slice(0, 40) };
    }
    const home = funnels.find((f) => f.id === account.home_funnel_id) || funnels.find((f) => f.kind === 'website');
    if (home) return { href: place.own && home.id === account.home_funnel_id ? '/' : `/f/${home.slug}`, heading: `Enjoyed this? There’s more from ${account.name}.`, text: '', button: `Visit ${account.name}` };
    return null;
  };

  const page = ({ account, place, title, description, canonical, jsonLd, ogType = 'website', image = '', body, noindex = false, banner = '' }) => {
    let code = {}; try { code = JSON.parse(account.page_code || '{}'); } catch { /* none */ }
    const accent = color(account.brand_color);
    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${description ? `<meta name="description" content="${esc(description)}">` : ''}
${noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${esc(canonical)}">`}
<meta property="og:type" content="${ogType}"><meta property="og:title" content="${esc(title)}">
${description ? `<meta property="og:description" content="${esc(description)}">` : ''}
<meta property="og:url" content="${esc(canonical)}"><meta property="og:site_name" content="${esc(account.name)}">
${image ? `<meta property="og:image" content="${esc(image)}"><meta name="twitter:card" content="summary_large_image">` : '<meta name="twitter:card" content="summary">'}
<link rel="alternate" type="application/rss+xml" title="${esc(account.name)}" href="${esc(place.abs)}/feed.xml">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>` : ''}
<style>${BLOG_CSS.replace(/__ACCENT__/g, accent)}</style>
${noindex ? '' : trackingTags(code, place.own)}
</head><body>${banner}
<header class="bh"><div class="in"><a class="brand" href="${esc(place.home)}">${esc(account.name)}</a><nav><a href="${esc(place.home)}">Articles</a>${place.own && account.home_funnel_id ? '<a href="/">Home</a>' : ''}</nav></div></header>
${body}
<footer class="bf"><div class="in"><span>© ${new Date().getFullYear()} ${esc(account.name)}</span><a href="${esc(place.path)}/feed.xml">RSS</a></div></footer>
</body></html>`;
  };

  const card = (place, p) => `<article class="pc">
    ${p.cover ? `<a class="pc-img" href="${esc(place.path)}/${esc(p.slug)}" tabindex="-1" aria-hidden="true"><img src="${esc(p.cover)}" alt="" loading="lazy"></a>` : ''}
    <div class="pc-t"><div class="meta"><time datetime="${isoDate(p.published_at)}">${dateText(p.published_at)}</time> · ${readingMinutes(p.body)} min read</div>
    <h2><a href="${esc(place.path)}/${esc(p.slug)}">${esc(p.title)}</a></h2>
    ${summaryOf(p) ? `<p>${esc(summaryOf(p))}</p>` : ''}</div></article>`;

  async function blogIndex(req, res) {
    const account = await accountForKey(req.params.key);
    if (!account) return notFound(res);
    const place = placeOf(req, account);
    const posts = await db().all("SELECT * FROM blog_posts WHERE account_id = ? AND status = 'published' ORDER BY published_at DESC, id DESC LIMIT 200", account.id);
    const title = `Articles | ${account.name}`;
    const description = posts.length ? seo.cut(`Articles from ${account.name}: ${posts.slice(0, 3).map((p) => p.title).join(', ')}.`, 158) : `Articles from ${account.name}.`;
    const ld = { '@context': 'https://schema.org', '@type': 'Blog', name: title, url: place.homeAbs, publisher: { '@type': 'Organization', name: account.name },
      blogPost: posts.slice(0, 20).map((p) => ({ '@type': 'BlogPosting', headline: p.title, url: `${place.abs}/${p.slug}`, datePublished: isoDate(p.published_at) })) };
    const [lead, ...rest] = posts;
    res.type('html').send(page({ account, place, title, description, canonical: place.homeAbs, jsonLd: ld, body: `<main class="idx">
      <h1 class="idx-h">Articles</h1><p class="idx-sub">Ideas, guides and news from ${esc(account.name)}.</p>
      ${posts.length ? `${lead ? `<div class="lead">${card(place, lead)}</div>` : ''}<div class="grid">${rest.map((p) => card(place, p)).join('')}</div>`
        : '<p class="empty">No articles yet. Check back soon.</p>'}</main>` }));
  }

  async function blogPost(req, res) {
    const account = await accountForKey(req.params.key);
    if (!account) return notFound(res);
    const p = await db().get('SELECT * FROM blog_posts WHERE account_id = ? AND slug = ?', account.id, String(req.params.slug).slice(0, 80));
    if (!p) return notFound(res);
    const draft = p.status !== 'published';
    if (draft && !await ownerViewing(req, account.id)) return notFound(res);
    if (!draft && !/bot|crawl|spider|slurp|preview/i.test(req.headers['user-agent'] || '')) await db().run('UPDATE blog_posts SET views = views + 1 WHERE id = ?', p.id);
    if (draft) res.set('X-Robots-Tag', 'noindex');
    const place = placeOf(req, account);
    const url = `${place.abs}/${p.slug}`;
    const title = p.seo_title || `${p.title} | ${account.name}`;
    const description = p.seo_description || summaryOf(p, 158);
    const image = p.cover || firstPicture(p.body);
    const tags = parseTagList(p.tags);
    const ld = { '@context': 'https://schema.org', '@type': 'BlogPosting', headline: seo.cut(p.title, 110), description, url, mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      datePublished: isoDate(p.published_at || p.created_at), dateModified: isoDate(p.updated_at), ...(image ? { image: [image] } : {}),
      author: p.author ? { '@type': 'Person', name: p.author } : { '@type': 'Organization', name: account.name },
      publisher: { '@type': 'Organization', name: account.name }, ...(tags.length ? { keywords: tags.join(', ') } : {}),
      wordCount: plainWords(p.body).split(/\s+/).filter(Boolean).length, isPartOf: { '@type': 'Blog', name: `Articles | ${account.name}`, url: place.homeAbs } };
    // Keep reading: posts sharing a tag first, then the newest others.
    const others = draft ? [] : await db().all("SELECT * FROM blog_posts WHERE account_id = ? AND status = 'published' AND id <> ? ORDER BY published_at DESC LIMIT 50", account.id, p.id);
    const shared = (o) => parseTagList(o.tags).filter((t) => tags.includes(t)).length;
    const more = others.map((o, i) => ({ o, s: shared(o) * 100 - i })).sort((a, b) => b.s - a.s).slice(0, 3).map((x) => x.o);
    const cta = await callToAction(account, place);
    const when = p.published_at || p.created_at;
    res.type('html').send(page({ account, place, title, description, canonical: url, jsonLd: ld, ogType: 'article', image, noindex: draft,
      banner: draft ? '<div class="draft">Draft preview: only you can see this post until it’s published.</div>' : '',
      body: `<main class="post"><article>
      <header class="ph"><a class="back" href="${esc(place.home)}">← All articles</a>
        <h1>${esc(p.title)}</h1>
        ${p.excerpt ? `<p class="dek">${esc(p.excerpt)}</p>` : ''}
        <div class="meta">${p.author ? `<span>By ${esc(p.author)}</span> · ` : ''}<time datetime="${isoDate(when)}">${dateText(when)}</time> · ${readingMinutes(p.body)} min read</div></header>
      ${p.cover ? `<figure class="cover"><img src="${esc(p.cover)}" alt=""></figure>` : ''}
      <div class="prose">${emailBodyHtml(p.body, { color: color(account.brand_color) })}</div>
      ${tags.length ? `<div class="tags">${tags.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
      </article>
      ${cta ? `<aside class="cta"><h2>${esc(cta.heading)}</h2>${cta.text ? `<p>${esc(cta.text)}</p>` : ''}<a class="btn" href="${esc(cta.href)}">${esc(cta.button)}</a></aside>` : ''}
      ${more.length ? `<section class="more"><h2>Keep reading</h2><div class="grid">${more.map((o) => card(place, o)).join('')}</div></section>` : ''}
      </main>` }));
  }

  async function blogFeed(req, res) {
    const account = await accountForKey(req.params.key);
    if (!account) return notFound(res);
    const place = placeOf(req, account);
    const posts = await db().all("SELECT * FROM blog_posts WHERE account_id = ? AND status = 'published' ORDER BY published_at DESC, id DESC LIMIT 50", account.id);
    const items = posts.map((p) => `    <item>
      <title>${xml(p.title)}</title>
      <link>${xml(`${place.abs}/${p.slug}`)}</link>
      <guid isPermaLink="true">${xml(`${place.abs}/${p.slug}`)}</guid>
      <pubDate>${new Date(p.published_at).toUTCString()}</pubDate>
      ${p.author ? `<dc:creator>${xml(p.author)}</dc:creator>` : ''}
      <description>${xml(summaryOf(p, 300))}</description>
      <content:encoded><![CDATA[${(p.cover ? `<p><img src="${esc(p.cover)}" alt=""></p>` : '') + emailBodyHtml(p.body).replace(/]]>/g, ']]&gt;')}]]></content:encoded>
    </item>`).join('\n');
    res.type('application/rss+xml; charset=utf-8').send(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${xml(account.name)}</title>
    <link>${xml(place.homeAbs)}</link>
    <atom:link href="${xml(`${place.abs}/feed.xml`)}" rel="self" type="application/rss+xml"/>
    <description>${xml(`Articles from ${account.name}`)}</description>
    <language>en</language>
${posts.length ? `    <lastBuildDate>${new Date(posts[0].published_at).toUTCString()}</lastBuildDate>\n` : ''}${items}
  </channel>
</rss>
`);
  }

  const notFound = (res) => res.status(404).type('html').send('<!doctype html><meta name="viewport" content="width=device-width"><title>Not found</title><p style="font:18px system-ui;text-align:center;margin-top:20vh;padding:0 20px">This article isn’t here.</p>');
  app.get('/blog/:key/feed.xml', blogFeed);
  app.get('/blog/:key', (req, res, next) => (req.path.endsWith('/') || req.blogOnDomain ? blogIndex(req, res).catch(next)
    : res.redirect(301, `${req.path}/${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`)));
  app.get('/blog/:key/:slug', blogPost);

  return {
    // Does this business have anything published (so its domain's /blog answers)?
    hasPosts: async (accountId) => Boolean(await db().get("SELECT 1 FROM blog_posts WHERE account_id = ? AND status = 'published' LIMIT 1", accountId)),
    // Published posts for a custom domain's sitemap and llms.txt.
    sitePages: async (accountId, base) => {
      const posts = await db().all("SELECT title, slug, excerpt, body, seo_description, updated_at, published_at FROM blog_posts WHERE account_id = ? AND status = 'published' ORDER BY published_at DESC LIMIT 1000", accountId);
      if (!posts.length) return [];
      return [{ loc: `${base}/blog`, title: 'Articles', about: '', updated: posts[0].updated_at },
        ...posts.map((p) => ({ loc: `${base}/blog/${p.slug}`, title: p.title, about: p.seo_description || summaryOf(p, 200), updated: p.updated_at }))];
    },
  };
}

const BLOG_CSS = `*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:#fff;color:#1f2328;font:18px/1.7 Charter,"Iowan Old Style","Palatino Linotype",Georgia,serif;-webkit-font-smoothing:antialiased}
a{color:__ACCENT__}img{max-width:100%;height:auto}
.in{max-width:1080px;margin:0 auto;padding:0 20px;display:flex;align-items:center;justify-content:space-between;gap:16px}
.bh{border-bottom:1px solid #eceef0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}.bh .in{height:62px}
.bh .brand{font-weight:700;font-size:1.05rem;color:#111;text-decoration:none;letter-spacing:-.01em}
.bh nav{display:flex;gap:18px}.bh nav a{color:#57606a;text-decoration:none;font-size:.92rem}.bh nav a:hover{color:#111}
.bf{border-top:1px solid #eceef0;margin-top:72px;font:14px system-ui,-apple-system,sans-serif;color:#6e7781}.bf .in{height:70px}.bf a{color:#6e7781}
.draft{position:sticky;top:0;z-index:9;background:#fef3c7;color:#92400e;font:600 14px system-ui;text-align:center;padding:8px}
.meta{font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#6e7781}
h1,h2,h3{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;letter-spacing:-.02em;color:#111;line-height:1.2}
.idx{max-width:1080px;margin:0 auto;padding:56px 20px 0}
.idx-h{font-size:clamp(2.2rem,5vw,3.2rem);margin:0 0 8px}.idx-sub{color:#57606a;margin:0 0 40px;font-size:1.1rem}
.empty{color:#6e7781}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:36px 28px}
.pc{display:flex;flex-direction:column;gap:14px}
.pc-img{display:block;aspect-ratio:16/9;border-radius:12px;overflow:hidden;background:#f3f4f6}.pc-img img{width:100%;height:100%;object-fit:cover;transition:transform .3s}.pc:hover .pc-img img{transform:scale(1.03)}
.pc h2{font-size:1.3rem;margin:6px 0 8px}.pc h2 a{color:#111;text-decoration:none}.pc h2 a:hover{color:__ACCENT__}
.pc p{margin:0;color:#57606a;font-size:1rem;line-height:1.6;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.lead{margin-bottom:48px;padding-bottom:48px;border-bottom:1px solid #eceef0}
.lead .pc{display:grid;grid-template-columns:1.3fr 1fr;gap:36px;align-items:center}.lead .pc:not(:has(.pc-img)){grid-template-columns:1fr}
.lead .pc h2{font-size:clamp(1.6rem,3vw,2.2rem)}.lead .pc p{-webkit-line-clamp:4;font-size:1.08rem}
@media (max-width:760px){.lead .pc{grid-template-columns:1fr;gap:16px}}
.post{max-width:720px;margin:0 auto;padding:44px 20px 0}
.back{font:14px system-ui,-apple-system,sans-serif;color:#6e7781;text-decoration:none}.back:hover{color:__ACCENT__}
.ph h1{font-size:clamp(2rem,5.2vw,2.9rem);margin:18px 0 14px}
.dek{font-size:1.25rem;line-height:1.5;color:#57606a;margin:0 0 18px}
.cover{margin:32px -20px 8px}.cover img{display:block;width:100%;border-radius:14px}
@media (max-width:799px){.cover img{border-radius:0}}@media (min-width:800px){.cover{margin:36px -60px 8px}}
.prose{margin-top:32px;font-size:1.13rem;line-height:1.78}
.prose p{margin:0 0 1.35em!important}.prose h2{font-size:1.6rem!important;margin:1.9em 0 .6em!important;line-height:1.25!important}
.prose img{border-radius:10px!important;margin:.4em auto}.prose hr{margin:2.4em 0!important}
.prose table a{font-family:system-ui,-apple-system,sans-serif;font-size:1rem}
.tags{display:flex;flex-wrap:wrap;gap:8px;margin-top:28px}.tags span{font:13px system-ui,sans-serif;background:#f3f4f6;color:#57606a;border-radius:99px;padding:4px 12px}
.cta{margin:48px 0 0;padding:32px;border-radius:16px;background:color-mix(in srgb,__ACCENT__ 8%,#fff);border:1px solid color-mix(in srgb,__ACCENT__ 22%,#fff);text-align:center}
.cta h2{margin:0 0 8px;font-size:1.45rem}.cta p{margin:0 0 18px;color:#57606a;font-size:1.02rem}
.btn{display:inline-block;background:__ACCENT__;color:#fff;text-decoration:none;font:600 16px system-ui,-apple-system,sans-serif;padding:13px 26px;border-radius:10px}.btn:hover{filter:brightness(1.08)}
.more{margin-top:64px;padding-top:40px;border-top:1px solid #eceef0}.more>h2{font-size:1.4rem;margin:0 0 24px}
.more .grid{grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:28px}.more .pc h2{font-size:1.08rem}.more .pc p{display:none}`;

module.exports = { registerBlog, plainWords, readingMinutes, blogKey };
