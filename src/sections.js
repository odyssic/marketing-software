'use strict';
// Rich page sections for high-converting templates: a cover banner with a
// product mockup (and the sign-up form beside it), image-and-words features,
// before/after, FAQ, guarantee seal, bio, proof numbers and a notice bar.
// Mockups are drawn in HTML/CSS from the page's own words and colours, so a
// new page looks finished before the owner has a single photo.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (/^(https?:\/\/|\/|#)/i.test(u || '') ? u : '#');
const lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);
const pairs = (s) => lines(s).map((l) => { const i = l.indexOf('|'); return i < 0 ? [l, ''] : [l.slice(0, i).trim(), l.slice(i + 1).trim()]; });
// *Words between stars* are highlighted in headlines.
const hl = (s) => esc(s).replace(/\n/g, '<br>').replace(/\*([^*<\n]+)\*/g, '<em class="hl">$1</em>');
const plain = (s) => String(s || '').replace(/\*/g, '');
const TICK = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
const CROSS = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const ARROW = '<svg class="arr" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

const MOCKUPS = ['book', 'workbook', 'video', 'coupon', 'phone'];
// A drawn product: an e-book cover, a workbook, a class on a laptop, a coupon or a phone.
function mockup(kind, { title = '', label = '', by = '' } = {}) {
  const t = esc(plain(title).slice(0, 90));
  const l = esc(label), b = esc(by);
  switch (kind) {
    case 'book': return `<div class="mk mk-book" aria-hidden="true"><div class="mk-cover"><span class="mk-k">${l || 'Free guide'}</span><b>${t}</b><span class="mk-rule"></span><span class="mk-by">${b}</span></div></div>`;
    case 'workbook': return `<div class="mk mk-wb" aria-hidden="true"><div class="mk-sheet back"></div><div class="mk-sheet mid"></div><div class="mk-sheet"><span class="mk-k">${l || 'Checklist'}</span><b>${t}</b>${[1, 2, 3, 4, 5].map((i) => `<span class="mk-line"><i class="${i < 3 ? 'on' : ''}"></i><s style="width:${[78, 64, 84, 58, 70][i - 1]}%"></s></span>`).join('')}<span class="mk-by">${b}</span></div></div>`;
    case 'video': return `<div class="mk mk-video" aria-hidden="true"><div class="mk-screen"><span class="mk-k">${l || 'Free class'}</span><b>${t}</b><span class="mk-play"><svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg></span><span class="mk-bar"><i></i></span></div><div class="mk-base"></div></div>`;
    case 'coupon': return `<div class="mk mk-coupon" aria-hidden="true"><div class="mk-tk"><span class="mk-k">${b || 'Welcome offer'}</span><b>${l || '10% OFF'}</b><span class="mk-t">${t}</span><span class="mk-code">WELCOME</span></div></div>`;
    case 'phone': return `<div class="mk mk-phone" aria-hidden="true"><div class="mk-ph"><span class="mk-notch"></span><span class="mk-k">${l || 'Members area'}</span><b>${t}</b>
      <span class="mk-feat"><i></i><s></s><s class="short"></s></span>
      ${[0, 1, 2, 3].map((i) => `<span class="mk-mail"><i>${esc((b || 'R').trim()[0] || 'R')}</i><span><s style="width:${[62, 74, 55, 68][i]}%"></s><s class="dim" style="width:${[86, 70, 80, 64][i]}%"></s></span>${i === 0 ? '<em>New</em>' : ''}</span>`).join('')}
      <span class="mk-by">${b}</span></div></div>`;
    default: return '';
  }
}
const media = (b, ctx, fallbackTitle) => {
  // A guide's real cover, shown as a book.
  if (b.image && b.mockup === 'book') return `<div class="mk mk-book"><div class="mk-cover has-img"><img src="${esc(safeUrl(b.image))}" alt="${esc(b.imageAlt || '')}" loading="lazy"></div></div>`;
  if (b.image) return `<img class="sec-img" src="${esc(safeUrl(b.image))}" alt="${esc(b.imageAlt || '')}" loading="lazy">`;
  if (MOCKUPS.includes(b.mockup)) return mockup(b.mockup, { title: b.mockupTitle || fallbackTitle, label: b.mockupLabel, by: ctx.business });
  // In the editor: a clear box to drop a picture onto, or click to choose one.
  return ctx.preview ? `<div class="sec-ph ph-image" data-pickphoto role="button" tabindex="0"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="9.5" r="1.6"/><path d="m4 17.5 4.8-4.6a1.2 1.2 0 0 1 1.6 0l3.1 2.9 2.3-2.1a1.2 1.2 0 0 1 1.6 0l3.1 2.8"/></svg><b>Drop a photo here</b><small>or click to choose one · or pick a drawn mockup in the panel</small></div>` : '';
};

function button(label, sub, href, extra = '', f = () => '') {
  if (!label) return '';
  return `<a class="btn big${extra}" href="${esc(href)}"><span${f('button')}>${esc(label)}</span>${ARROW}${sub ? `<small${f('buttonSub')}>${esc(sub)}</small>` : ''}</a>`;
}

// One of the new section types, or null when the type isn't ours.
function renderSection(b, ctx, index, { href, formHtml = '' } = {}) {
  const f = (field) => (ctx.preview ? ` data-f="${field}"` : '');
  const to = (u) => href(u);
  switch (b.type) {
    case 'cover': return null; // (handled as a hero style)
    case 'notice': {
      if (!b.text) return '';
      const link = b.link ? ` <a href="${esc(to(b.url))}">${esc(b.link)} →</a>` : '';
      return `<div class="notice${index === 0 ? ' first' : ''}"><span${f('text')}>${esc(b.text)}</span>${link}</div>`;
    }
    case 'feature': {
      const items = lines(b.items);
      const m = media(b, ctx, b.title);
      return `<div class="feat${b.flip ? ' flip' : ''}${m ? '' : ' solo'}">${m ? `<div class="ft-media">${m}</div>` : ''}<div class="ft-words">
        ${b.eyebrow ? `<div class="kick"${f('eyebrow')}>${esc(b.eyebrow)}</div>` : ''}${b.title ? `<h2${f('title')}>${hl(b.title)}</h2>` : ''}
        ${b.text ? `<p${f('text')}>${esc(b.text).replace(/\n/g, '<br>')}</p>` : ''}
        ${items.length ? `<ul class="ticks">${items.map((x) => `<li><span class="tick">${TICK}</span><span>${hl(x)}</span></li>`).join('')}</ul>` : ''}
        ${button(b.button, b.buttonSub, to(b.url), '', f)}</div></div>`;
    }
    case 'compare': {
      const col = (title, items, good) => `<div class="cmp-col ${good ? 'good' : 'bad'}"><h3>${esc(title)}</h3><ul>${lines(items).map((x) => `<li><span class="ci">${good ? TICK : CROSS}</span>${esc(x)}</li>`).join('')}</ul></div>`;
      return `<div class="cmp">${b.title ? `<h2 class="sec-t"${f('title')}>${hl(b.title)}</h2>` : ''}<div class="cmp-grid">${col(b.leftTitle || 'Before', b.left, false)}${col(b.rightTitle || 'After', b.right, true)}</div></div>`;
    }
    case 'faq': {
      const qs = pairs(b.items).filter(([q]) => q);
      if (!qs.length) return '';
      return `<div class="faq">${b.title ? `<h2 class="sec-t"${f('title')}>${hl(b.title)}</h2>` : ''}${qs.map(([q, a], i) => `<details${i === 0 ? ' open' : ''}><summary>${esc(q)}<span class="pm" aria-hidden="true"></span></summary><p>${esc(a)}</p></details>`).join('')}</div>`;
    }
    case 'guarantee': {
      const days = Math.max(0, Math.min(365, Number(b.days) || 0));
      return `<div class="guar"><div class="seal" aria-hidden="true"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="56" class="s1"/><circle cx="60" cy="60" r="47" class="s2"/></svg><span>${days ? `<b>${days}</b>DAY` : `<b>${TICK}</b>`}</span></div>
        <div><h3${f('title')}>${esc(b.title || 'Our promise')}</h3><p${f('text')}>${esc(b.text)}</p></div></div>`;
    }
    case 'bio': {
      const initials = esc(String(b.name || ctx.business || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase());
      const pic = b.image ? `<img src="${esc(safeUrl(b.image))}" alt="${esc(b.name || '')}" loading="lazy">` : `<span class="bio-ini" aria-hidden="true">${initials}</span>`;
      return `<div class="bio"><div class="bio-pic">${pic}</div><div class="bio-words">${b.eyebrow ? `<div class="kick"${f('eyebrow')}>${esc(b.eyebrow)}</div>` : ''}
        <h2${f('name')}>${esc(b.name || ctx.business || '')}</h2>${b.role ? `<p class="bio-role"${f('role')}>${esc(b.role)}</p>` : ''}<p${f('text')}>${esc(b.text).replace(/\n/g, '<br>')}</p>
        ${b.signature ? `<p class="sig">${esc(b.signature)}</p>` : ''}</div></div>`;
    }
    case 'stats': {
      const items = pairs(b.items).filter(([n]) => n);
      const lf = (r, c) => (ctx.preview ? ` data-f="items" data-row="${r}" data-col="${c}"` : '');
      return items.length ? `<div class="stats">${items.map(([n, l], r) => `<div><b${lf(r, 0)}>${esc(n)}</b><span${lf(r, 1)}>${esc(l)}</span></div>`).join('')}</div>` : '';
    }
    case 'cta': {
      return `<div class="cta-sec">${b.title ? `<h2${f('title')}>${hl(b.title)}</h2>` : ''}${b.text ? `<p${f('text')}>${esc(b.text)}</p>` : ''}${button(b.button || 'Get started', b.buttonSub, to(b.url), '', f)}${b.note ? `<p class="cta-note">${esc(b.note)}</p>` : ''}</div>`;
    }
    default: return null;
  }
}

// The cover banner: words and a call to action on a deep band, with a photo or a
// drawn mockup beside them. With the form brought in, the mockup sits on the
// left and the headline and form on the right.
function renderCover(b, ctx, index, { href, formHtml = '' }) {
  const f = (field) => (ctx.preview ? ` data-f="${field}"` : '');
  const bg = /^#[0-9a-f]{3,8}$/i.test(b.background || '') ? b.background : 'var(--accent)';
  const fg = /^#[0-9a-f]{3,8}$/i.test(b.textColor || '') ? b.textColor : '#ffffff';
  const items = lines(b.items);
  const m = media(b, ctx, b.text);
  const words = `${b.eyebrow ? `<div class="cv-eye"${f('eyebrow')}>${esc(b.eyebrow)}</div>` : ''}<h1${f('text')}>${hl(b.text)}</h1>
    ${b.subtext ? `<p class="cv-sub"${f('subtext')}>${esc(b.subtext).replace(/\n/g, '<br>')}</p>` : ''}
    ${items.length ? `<ul class="ticks">${items.map((x) => `<li><span class="tick">${TICK}</span><span>${hl(x)}</span></li>`).join('')}</ul>` : ''}
    ${formHtml || button(b.button, b.buttonSub, href(b.url), ' light', f)}${b.note ? `<p class="cv-note"${f('note')}>${esc(b.note)}</p>` : ''}`;
  return `<section class="cover${index === 0 ? ' first' : ''}${formHtml ? ' with-form' : ''}${m ? '' : ' solo'}" style="--cv-bg:${bg};--cv-fg:${fg}"><div class="cv-in">
    ${m ? `<div class="cv-media">${m}</div>` : ''}<div class="cv-words">${words}</div></div></section>`;
}

// Sections share these styles. Colours come from the page: --bg, --fg, --accent.
const SECTION_CSS = `
.hl{font-style:normal;background:linear-gradient(transparent 60%,color-mix(in srgb,var(--hl) 55%,transparent) 60%);padding:0 .08em}
.btn.big{display:inline-flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:4px 10px;padding:18px 34px;font-size:1.12rem;font-weight:700;border-radius:12px;box-shadow:0 14px 30px -14px color-mix(in srgb,var(--accent) 80%,transparent);transition:transform .15s,box-shadow .15s;text-align:center}
.btn.big:hover{transform:translateY(-2px)}.btn.big .arr{transition:transform .15s}.btn.big:hover .arr{transform:translateX(3px)}
.btn.big small{flex-basis:100%;font-size:.8rem;font-weight:500;opacity:.85;margin-top:2px}
.kick{font:700 .78rem/1.2 system-ui,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:var(--accent);margin-bottom:10px}
.ticks{list-style:none;padding:0;margin:18px 0 0;display:grid;gap:10px;text-align:left}
.ticks li{display:flex;gap:10px;align-items:flex-start;line-height:1.5}
.ticks .tick{flex:none;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;background:color-mix(in srgb,var(--accent) 15%,transparent);color:var(--accent);margin-top:2px}
.sec-t{text-align:center;font-size:clamp(1.7rem,3.6vw,2.4rem);line-height:1.15;letter-spacing:-.02em;margin:0 auto 28px;max-width:760px}
.sec-img{width:100%;border-radius:18px;display:block;box-shadow:0 30px 60px -30px rgba(0,0,0,.35)}
.sec-ph{aspect-ratio:4/3;width:100%;border:2px dashed color-mix(in srgb,var(--accent) 45%,transparent);border-radius:18px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;text-align:center;padding:20px;color:var(--accent);background:color-mix(in srgb,var(--accent) 6%,#fff);cursor:pointer;transition:background .15s,border-color .15s;font-family:system-ui,sans-serif}
.sec-ph b{font-size:1.05rem}.sec-ph small{font-size:.82rem;opacity:.8;max-width:280px}.sec-ph:hover{border-color:var(--accent)}
.cover .sec-ph,.band-dark .sec-ph,.band-brand .sec-ph{color:#fff;border-color:rgba(255,255,255,.55);background:rgba(255,255,255,.08)}
.cover .sec-ph:hover,.band-dark .sec-ph:hover,.band-brand .sec-ph:hover{border-color:#fff;background:rgba(255,255,255,.14)}
.sec-ph.ph-over{background:rgba(255,255,255,.22)!important;border-color:#fff!important;border-style:solid}

/* Full-width bands */
.band{margin-left:calc(50% - 50vw);margin-right:calc(50% - 50vw);padding:72px 20px}
.band>.band-in{max-width:var(--w);margin:0 auto}.band-in>*+*{margin-top:28px}.band-in>*:first-child{margin-top:0}
main>.band{margin-top:56px}main>.band+.band,main>.cover+.band,main>.notice+.band{margin-top:0}main>.band+*{margin-top:56px}main>.band.first{margin-top:-48px}main>.band.last{margin-bottom:-48px}
.band-soft{background:color-mix(in srgb,var(--accent) 7%,var(--bg))}
.band-dark{background:var(--deep);color:#fff}.band-brand{background:var(--accent);color:#fff}
.band-dark .kick,.band-brand .kick{color:color-mix(in srgb,var(--accent) 30%,#fff)}
.band-dark .ticks .tick,.band-brand .ticks .tick{background:rgba(255,255,255,.16);color:#fff}
.band-dark .hl,.band-brand .hl,.cover .hl{background:none;padding:0;color:var(--hl)}
.cover .ticks .tick{background:color-mix(in srgb,var(--hl) 22%,transparent);color:var(--hl)}
.band-dark .kick,.band-brand .kick,.cover .cv-note b{color:var(--hl)}
.band-dark .btn,.band-brand .btn{background:#fff;color:var(--deep)}
.band-dark :is(.offer,.optin,.pricing,.booking) .btn,.band-brand :is(.offer,.optin,.pricing,.booking) .btn{background:var(--accent);color:#fff}
main>.feat+.feat,.band-in>.feat+.feat{margin-top:88px}
.band-dark .cards .card,.band-brand .cards .card{background:rgba(255,255,255,.07);border-color:rgba(255,255,255,.14)}
.band-dark hr,.band-brand hr{border-color:rgba(255,255,255,.2)}
.offer,.optin,.pricing,.booking,.guar,.faq details,.cmp-col,.testimonial{color:var(--fg)}
.band-dark .testimonial,.band-brand .testimonial{color:#fff}
.tcards{display:grid;gap:20px;margin:28px 0;align-items:stretch}.tcards.n2{grid-template-columns:repeat(2,1fr)}.tcards.n3{grid-template-columns:repeat(3,1fr)}
@media(max-width:760px){.tcards.n2,.tcards.n3{grid-template-columns:1fr}}
.tcard{margin:28px auto;max-width:620px;text-align:left;display:flex;flex-direction:column;gap:18px;background:#fff;border:1px solid color-mix(in srgb,var(--fg) 9%,transparent);border-radius:18px;padding:26px 26px 22px;box-shadow:0 1px 2px rgba(16,24,40,.04),0 18px 36px -24px color-mix(in srgb,var(--accent) 45%,transparent);position:relative}
.tcards .tcard{margin:0;max-width:none}
.tcard::before{content:"\\201C";position:absolute;top:6px;right:18px;font:700 64px/1 Georgia,serif;color:color-mix(in srgb,var(--accent) 22%,transparent)}
.tcard blockquote{margin:0;font-size:1.05rem;line-height:1.6;flex:1}
.tcard figcaption{display:flex;align-items:center;gap:12px;font-size:.92rem}
.tcard .tc-ph{width:46px;height:46px;border-radius:50%;object-fit:cover;flex:none;border:2px solid #fff;box-shadow:0 0 0 1px color-mix(in srgb,var(--fg) 10%,transparent)}
.tcard .tc-ini{display:grid;place-items:center;background:color-mix(in srgb,var(--accent) 14%,#fff);color:var(--accent);font-weight:700;font-size:.95rem}
.tcard .tc-who{display:grid;line-height:1.3}.tcard .tc-who span{opacity:.65;font-size:.85rem}
.band-dark .tcard,.band-brand .tcard{background:rgba(255,255,255,.07);border-color:rgba(255,255,255,.14);box-shadow:none}
.band-dark .tcard::before,.band-brand .tcard::before{color:rgba(255,255,255,.18)}

/* Notice bar */
.notice{margin:0 calc(50% - 50vw);padding:10px 20px;text-align:center;background:var(--deep);color:#fff;font-size:.92rem;font-weight:500}
.notice a{color:#fff;font-weight:700;text-underline-offset:3px}.notice.first{margin-top:-48px}main>.notice+*{margin-top:0}

/* Cover banner */
.cover{margin:0 calc(50% - 50vw);padding:104px 20px 84px;background:radial-gradient(1200px 500px at 85% -10%,color-mix(in srgb,var(--cv-bg) 70%,#fff) 0%,transparent 60%),linear-gradient(160deg,color-mix(in srgb,var(--cv-bg) 82%,#000),var(--cv-bg));color:var(--cv-fg);position:relative;overflow:hidden}
.cover.first{margin-top:-48px}main>.cover+*{margin-top:56px}
.cover::after{content:"";position:absolute;inset:auto -10% -60% auto;width:620px;height:620px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.08),transparent 65%);pointer-events:none}
.cv-in{max-width:var(--w);margin:0 auto;display:grid;grid-template-columns:1.1fr .9fr;gap:56px;align-items:center;position:relative;z-index:1}
.cover.solo .cv-in{grid-template-columns:1fr;max-width:820px;text-align:center}.cover.solo .ticks{display:grid;width:max-content;max-width:100%;margin-left:auto;margin-right:auto}
.cv-words{order:-1}.cover.with-form .cv-in{grid-template-columns:.95fr 1.05fr}.cover.with-form .cv-words{order:0}
.cv-eye{display:inline-block;font:700 .78rem/1 system-ui,sans-serif;letter-spacing:.16em;text-transform:uppercase;padding:8px 14px;border-radius:99px;background:rgba(255,255,255,.14);margin-bottom:18px}
.cover h1{font-size:clamp(2.1rem,4.8vw,3.5rem);line-height:1.06;letter-spacing:-.025em;margin:0 0 16px;font-weight:800;color:inherit}
.cv-sub{font-size:1.18rem;line-height:1.55;opacity:.9;margin:0;max-width:600px}.cover.solo .cv-sub{margin:0 auto}
.cover .ticks{margin:22px 0 4px}.cover .ticks .tick{background:rgba(255,255,255,.16);color:inherit}
.cover .btn.big{margin-top:28px}.btn.light{background:#fff;color:var(--cv-bg);box-shadow:0 18px 36px -16px rgba(0,0,0,.5)}
.cv-note{font-size:.88rem;opacity:.75;margin:12px 0 0}
.cover .optin{margin:24px 0 0;max-width:460px;box-shadow:0 30px 60px -24px rgba(0,0,0,.5);border:0}.cover .optin .btn{padding:16px;font-size:1.08rem}
.cv-media{display:grid;place-items:center;position:relative}
.cover::before{content:"";position:absolute;inset:0;background-image:radial-gradient(rgba(255,255,255,.09) 1.2px,transparent 1.2px);background-size:22px 22px;-webkit-mask-image:linear-gradient(90deg,#000 0%,transparent 55%);mask-image:linear-gradient(90deg,#000 0%,transparent 55%);pointer-events:none}
.cover.with-form::before{-webkit-mask-image:linear-gradient(90deg,#000 0%,transparent 50%);mask-image:linear-gradient(90deg,#000 0%,transparent 50%)}
.cv-media::before{content:"";position:absolute;width:min(560px,120%);aspect-ratio:1;border-radius:50%;background:radial-gradient(circle,color-mix(in srgb,var(--accent) 60%,#fff) 0%,color-mix(in srgb,var(--accent) 40%,transparent) 35%,transparent 68%);opacity:.5;filter:blur(8px);z-index:0}
.cv-media>*{position:relative;z-index:1}
.cover .mk{animation:mkfloat 7s ease-in-out infinite}
@keyframes mkfloat{50%{transform:translateY(-10px)}}
@media(prefers-reduced-motion:reduce){.cover .mk{animation:none}}
.cover .cv-eye{background:color-mix(in srgb,var(--hl) 18%,rgba(255,255,255,.08));color:var(--hl);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--hl) 40%,transparent)}
.cover .optin .btn{background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 85%,#fff),var(--accent) 45%,color-mix(in srgb,var(--accent) 75%,#000));box-shadow:0 14px 28px -12px color-mix(in srgb,var(--accent) 90%,#000);font-weight:700;letter-spacing:.01em;transition:transform .15s,box-shadow .15s}
.cover .optin .btn:hover{transform:translateY(-1px);box-shadow:0 18px 32px -12px color-mix(in srgb,var(--accent) 90%,#000)}
@media(max-width:820px){.cv-in,.cover.with-form .cv-in{grid-template-columns:1fr;gap:36px;text-align:center}.cv-words{order:0}.cv-media{order:1}.cover.with-form .cv-media{order:-1}.cover .ticks{display:grid;width:max-content;max-width:100%;margin-left:auto;margin-right:auto}.cv-sub{margin:0 auto}.cover .optin{margin:24px auto 0}.cover{padding:52px 20px 60px}}

/* Mockups */
.mk{width:min(340px,82%);margin:0 auto;font-family:system-ui,sans-serif;perspective:1400px}
.mk-k{display:block;font:700 .62rem/1 system-ui,sans-serif;letter-spacing:.2em;text-transform:uppercase;opacity:.75}
.mk b{display:block;font-weight:800;line-height:1.12;letter-spacing:-.01em}
.mk-by{display:block;font-size:.66rem;letter-spacing:.14em;text-transform:uppercase;opacity:.7}
.mk-cover{aspect-ratio:3/4;border-radius:4px 12px 12px 4px;padding:13% 12% 10% 16%;display:flex;flex-direction:column;gap:14px;color:#fff;position:relative;
  background:radial-gradient(120% 80% at 100% 0%,rgba(255,255,255,.22),transparent 55%),linear-gradient(155deg,color-mix(in srgb,var(--accent) 88%,#fff),color-mix(in srgb,var(--accent) 60%,#000));
  transform:rotateY(-16deg) rotateX(3deg);transform-origin:left center;box-shadow:inset 7px 0 10px -4px rgba(0,0,0,.35),2px 0 0 #f4f1ea,5px 1px 0 #e7e2d8,8px 2px 0 #f4f1ea,10px 3px 0 #ddd6c9,30px 40px 60px -16px rgba(0,0,0,.55)}
.mk-cover b{font-family:"Iowan Old Style",Palatino,Georgia,serif;font-size:clamp(1.3rem,3vw,1.85rem);margin-top:auto}
.mk-cover.has-img{padding:0;overflow:hidden;background:#fff}.mk-cover.has-img img{width:100%;height:100%;object-fit:cover;display:block;border-radius:0}
.mk-rule{display:block;width:44px;height:3px;background:rgba(255,255,255,.7);border-radius:2px}.mk-cover .mk-by{margin-top:auto}
.mk-wb{position:relative;aspect-ratio:4/5}.mk-sheet{position:absolute;inset:0;background:#fff;border-radius:14px;box-shadow:0 26px 50px -20px rgba(0,0,0,.45);padding:12% 11%;color:#1f2328;display:flex;flex-direction:column;gap:12px}
.mk-sheet.back{transform:rotate(7deg) translate(14px,6px);background:#f1efe9}.mk-sheet.mid{transform:rotate(-4deg) translate(-8px,4px);background:#f8f7f3}
.mk-sheet .mk-k{color:var(--accent);opacity:1}.mk-sheet b{font-size:clamp(1.1rem,2.5vw,1.45rem);margin-bottom:6px}
.mk-line{display:flex;gap:10px;align-items:center}.mk-line i{width:16px;height:16px;border-radius:5px;border:2px solid color-mix(in srgb,var(--accent) 60%,#ccc);flex:none}.mk-line i.on{background:var(--accent);border-color:var(--accent)}.mk-line s{height:8px;border-radius:4px;background:#e6e3dc;text-decoration:none;display:block}
.mk-sheet .mk-by{margin-top:auto;color:#6b7280}
.mk-video{width:min(460px,92%)}.mk-screen{aspect-ratio:16/10;border-radius:14px 14px 4px 4px;border:10px solid #15171c;border-bottom-width:12px;background:linear-gradient(150deg,color-mix(in srgb,var(--accent) 70%,#000),#0b0d12);color:#fff;padding:7% 8%;position:relative;display:flex;flex-direction:column;gap:8px;box-shadow:0 30px 60px -24px rgba(0,0,0,.6)}
.mk-screen b{font-size:clamp(1rem,2.4vw,1.4rem);max-width:70%}.mk-play{position:absolute;right:9%;bottom:24%;width:56px;height:56px;border-radius:50%;background:#fff;color:var(--accent);display:grid;place-items:center;box-shadow:0 0 0 10px rgba(255,255,255,.18)}
.mk-bar{position:absolute;left:8%;right:8%;bottom:9%;height:4px;border-radius:2px;background:rgba(255,255,255,.25)}.mk-bar i{display:block;width:38%;height:100%;background:#fff;border-radius:2px}
.mk-base{height:14px;margin:0 -7%;background:linear-gradient(#d9dce2,#a9adb6);border-radius:0 0 14px 14px}
.mk-tk{position:relative;border-radius:18px;padding:30px 26px;text-align:center;color:var(--accent);background:linear-gradient(160deg,#fff 55%,color-mix(in srgb,var(--accent) 8%,#fff));box-shadow:0 30px 60px -24px rgba(0,0,0,.55);transform:rotate(-4deg);
  -webkit-mask:radial-gradient(circle 16px at 0 50%,#0000 98%,#000) left/51% 100% no-repeat,radial-gradient(circle 16px at 100% 50%,#0000 98%,#000) right/51% 100% no-repeat;mask:radial-gradient(circle 16px at 0 50%,#0000 98%,#000) left/51% 100% no-repeat,radial-gradient(circle 16px at 100% 50%,#0000 98%,#000) right/51% 100% no-repeat}
.mk-tk b{font-size:clamp(2.6rem,7vw,3.6rem);margin:10px 0 6px}.mk-t{display:block;font-size:.9rem;opacity:.9}
.mk-tk .mk-k,.mk-tk .mk-t{color:#4b5563}.mk-code{display:inline-block;margin-top:16px;padding:8px 16px;border:2px dashed color-mix(in srgb,var(--accent) 55%,#fff);border-radius:8px;font:700 .9rem/1 ui-monospace,monospace;letter-spacing:.18em}
.mk-phone{width:min(260px,70%)}.mk-ph{aspect-ratio:9/18;border-radius:36px;border:10px solid #15171c;background:#fff;color:#1f2328;padding:34px 18px 18px;display:flex;flex-direction:column;gap:12px;position:relative;box-shadow:0 30px 60px -24px rgba(0,0,0,.6)}
.mk-notch{position:absolute;top:8px;left:50%;transform:translateX(-50%);width:70px;height:18px;border-radius:10px;background:#15171c}
.mk-ph .mk-k{color:var(--accent);opacity:1}.mk-ph b{font-size:1.1rem}.mk-row{display:flex;gap:10px;align-items:center;padding:10px;border-radius:12px;background:color-mix(in srgb,var(--accent) 8%,#fff)}
.mk-row i{width:26px;height:26px;border-radius:50%;background:var(--accent);color:#fff;font:700 .75rem/26px system-ui;text-align:center;font-style:normal;flex:none}.mk-row s{flex:1;height:8px;border-radius:4px;background:#e2e5ea;text-decoration:none}
.mk-ph .mk-by{margin-top:auto;text-align:center;color:#6b7280}
.mk-feat{display:grid;gap:7px;padding:10px;border-radius:14px;background:color-mix(in srgb,var(--accent) 8%,#fff)}
.mk-feat i{display:block;height:74px;border-radius:10px;background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 80%,#fff),color-mix(in srgb,var(--accent) 70%,#000))}
.mk-feat s,.mk-mail s{display:block;height:7px;border-radius:4px;background:#d9dde3;text-decoration:none}.mk-feat s.short{width:60%}
.mk-mail{display:flex;gap:9px;align-items:center;padding:6px 2px;border-bottom:1px solid #eef0f3;position:relative}
.mk-mail>i{width:24px;height:24px;border-radius:50%;background:var(--accent);color:#fff;font:700 .68rem/24px system-ui;text-align:center;font-style:normal;flex:none}
.mk-mail>span{flex:1;display:grid;gap:5px}.mk-mail s.dim{background:#eceef2}
.mk-mail em{position:absolute;right:0;top:6px;font:700 .55rem/1 system-ui;font-style:normal;color:#fff;background:#e0533d;border-radius:99px;padding:3px 6px}

@media(max-width:820px){.cover .mk{width:min(210px,60%)}.cover .mk-video{width:min(320px,86%)}.cover .mk-coupon{width:min(260px,72%)}.feat .mk{width:min(260px,72%)}.cover .cv-eye{margin-bottom:12px}}
/* Feature: picture beside words */
.feat{display:grid;grid-template-columns:1fr 1fr;gap:56px;align-items:center;text-align:left}
.feat.flip .ft-media{order:2}.feat.solo{grid-template-columns:1fr;max-width:720px;margin-left:auto;margin-right:auto;text-align:center}.feat.solo .ticks{display:grid;width:max-content;max-width:100%;margin-left:auto;margin-right:auto}
.feat h2{font-size:clamp(1.6rem,3.4vw,2.3rem);line-height:1.15;letter-spacing:-.02em;margin:0 0 14px}.feat p{font-size:1.08rem;opacity:.85;margin:0}
.feat .btn.big{margin-top:26px}
@media(max-width:820px){.feat{grid-template-columns:1fr;gap:28px}.feat.flip .ft-media{order:0}}

/* Before and after */
.cmp-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;max-width:900px;margin:0 auto}
.cmp-col{border-radius:18px;padding:26px 26px 22px;background:#fff;border:1px solid color-mix(in srgb,var(--fg) 10%,transparent);text-align:left}
.cmp-col h3{margin:0 0 14px;font-size:1.15rem}.cmp-col ul{list-style:none;padding:0;margin:0;display:grid;gap:11px}
.cmp-col li{display:flex;gap:10px;align-items:flex-start;line-height:1.45}.ci{flex:none;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;margin-top:1px}
.cmp-col.bad{background:color-mix(in srgb,var(--fg) 3%,#fff)}.cmp-col.bad li{opacity:.75}.cmp-col.bad .ci{background:#fde2e1;color:#b42318}
.cmp-col.good{border:2px solid var(--accent);box-shadow:0 24px 50px -28px color-mix(in srgb,var(--accent) 70%,transparent)}.cmp-col.good .ci{background:var(--accent);color:#fff}
@media(max-width:700px){.cmp-grid{grid-template-columns:1fr}}

/* FAQ */
.faq{max-width:780px;margin-left:auto;margin-right:auto}
.faq details{background:#fff;border:1px solid color-mix(in srgb,var(--fg) 10%,transparent);border-radius:14px;margin:0 0 10px;padding:0 22px;text-align:left}
.faq summary{list-style:none;cursor:pointer;padding:18px 0;font-weight:650;font-size:1.05rem;display:flex;justify-content:space-between;gap:16px;align-items:center}
.faq summary::-webkit-details-marker{display:none}
.pm{flex:none;width:26px;height:26px;border-radius:50%;background:color-mix(in srgb,var(--accent) 12%,transparent);position:relative}
.pm::before,.pm::after{content:"";position:absolute;left:8px;right:8px;top:12px;height:2px;background:var(--accent);border-radius:1px;transition:transform .2s}.pm::after{transform:rotate(90deg)}
details[open] .pm::after{transform:rotate(0)}.faq details p{margin:0 0 18px;opacity:.82;line-height:1.6}

/* Two columns: any blocks on each side; they stack on phones */
.cols{display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center;text-align:left}
.cols.v-top{align-items:start}.cols.r-wide-left{grid-template-columns:3fr 2fr}.cols.r-wide-right{grid-template-columns:2fr 3fr}
.col{min-width:0}.col>*+*{margin-top:22px}.col>[data-bi]+[data-bi]{margin-top:22px}
.col .optin,.col .offer,.col .guar,.col .faq,.col .cmp-grid{margin-left:0;margin-right:0;max-width:none}
.col .feat{grid-template-columns:1fr;gap:20px}.col .sec-img,.col img{width:100%}
.col-ph{min-height:160px;display:flex;flex-direction:column;align-items:center;justify-content:center}
@media(max-width:760px){.cols,.cols.r-wide-left,.cols.r-wide-right{grid-template-columns:1fr;gap:28px}}

/* Cards: quiet, but designed: soft depth, an accent mark, room to breathe */
.cards{gap:18px}
.cards .card{position:relative;background:#fff;border:1px solid color-mix(in srgb,var(--fg) 8%,transparent);border-radius:18px;padding:26px 24px 24px;
  box-shadow:0 1px 2px rgba(16,24,40,.04),0 14px 32px -20px color-mix(in srgb,var(--accent) 45%,transparent);transition:transform .2s,box-shadow .2s;color:var(--fg)}
.cards .card:hover{transform:translateY(-3px);box-shadow:0 1px 2px rgba(16,24,40,.04),0 22px 40px -22px color-mix(in srgb,var(--accent) 55%,transparent)}
.cards:not(.numbered) .card::before{content:"";display:block;width:36px;height:36px;border-radius:11px;margin-bottom:16px;
  background:radial-gradient(circle at 50% 50%,var(--accent) 0 5px,transparent 5.5px),linear-gradient(145deg,color-mix(in srgb,var(--accent) 16%,#fff),color-mix(in srgb,var(--accent) 7%,#fff))}
.cards .card h3{font-size:1.12rem;letter-spacing:-.01em;margin:0 0 6px}.cards .card p{opacity:.72;line-height:1.55}
.cards.numbered .card::before{width:38px;height:38px;border-radius:12px;font:700 .95rem/38px system-ui,sans-serif;margin-bottom:16px;
  background:linear-gradient(145deg,color-mix(in srgb,var(--accent) 85%,#fff),var(--accent));box-shadow:0 8px 16px -8px var(--accent)}
.band-dark .cards .card,.band-brand .cards .card{color:#fff;box-shadow:none}
.cards.ic-line .card::before,.cards.ic-solid .card::before,.cards.ic-none .card::before{display:none}
.cards .ci svg{width:24px;height:24px}
.cards .ci{display:grid;place-items:center;width:46px;height:46px;border-radius:13px;margin-bottom:16px;color:var(--accent);background:linear-gradient(145deg,color-mix(in srgb,var(--accent) 16%,#fff),color-mix(in srgb,var(--accent) 7%,#fff))}
.cards.ic-solid .ci{color:#fff;background:linear-gradient(145deg,color-mix(in srgb,var(--accent) 80%,#fff),var(--accent));box-shadow:0 10px 18px -10px var(--accent)}
.band-dark .cards .ci,.band-brand .cards .ci{color:#fff;background:rgba(255,255,255,.12);box-shadow:none}
.band-dark .cards:not(.numbered) .card::before,.band-brand .cards:not(.numbered) .card::before{background:radial-gradient(circle,#fff 0 5px,transparent 5.5px),rgba(255,255,255,.12)}

/* Guarantee */
.guar{display:flex;gap:30px;align-items:center;max-width:760px;margin-left:auto;margin-right:auto;padding:30px 34px;border-radius:22px;text-align:left;
  background:linear-gradient(120deg,color-mix(in srgb,var(--accent) 9%,#fff),#fff 55%);border:1px solid color-mix(in srgb,var(--accent) 18%,transparent);
  box-shadow:0 22px 44px -30px color-mix(in srgb,var(--accent) 70%,transparent)}
.guar h3::before{content:"Our promise";display:block;font:700 .7rem/1 system-ui,sans-serif;letter-spacing:.18em;text-transform:uppercase;color:var(--accent);margin-bottom:8px}
.seal{flex:none;width:118px;height:118px;position:relative;display:grid;place-items:center;color:#fff;border-radius:50%;
  box-shadow:0 0 0 8px color-mix(in srgb,var(--accent) 12%,transparent),0 14px 28px -10px color-mix(in srgb,var(--accent) 80%,transparent)}
.seal>svg{position:absolute;inset:0}.seal .s1{fill:var(--accent)}.seal .s2{fill:none;stroke:rgba(255,255,255,.55);stroke-width:2;stroke-dasharray:4 5}
.seal span{position:relative;text-align:center;font:700 .72rem/1 system-ui,sans-serif;letter-spacing:.2em}.seal b{display:block;font-size:2.4rem;letter-spacing:-.02em;margin-bottom:2px}.seal b svg{width:46px;height:46px;display:block;margin:0 auto;position:static}
.guar h3{margin:0 0 8px;font-size:1.35rem;letter-spacing:-.01em}.guar p{margin:0;opacity:.78;line-height:1.6}
@media(max-width:600px){.guar{flex-direction:column;text-align:center}}

/* Bio */
.bio{display:grid;grid-template-columns:260px 1fr;gap:44px;align-items:center;max-width:900px;margin-left:auto;margin-right:auto;text-align:left}
.bio-pic img,.bio-ini{width:100%;aspect-ratio:1;border-radius:50%;object-fit:cover;display:grid;place-items:center;box-shadow:0 0 0 10px color-mix(in srgb,var(--accent) 12%,transparent)}
.bio-ini{background:linear-gradient(150deg,color-mix(in srgb,var(--accent) 80%,#fff),color-mix(in srgb,var(--accent) 70%,#000));color:#fff;font:800 4.4rem/1 system-ui,sans-serif}
.bio h2{margin:0;font-size:2rem;letter-spacing:-.02em}.bio-role{margin:4px 0 14px;opacity:.65;font-weight:500}.bio p{line-height:1.7}
.sig{font-family:"Brush Script MT","Segoe Script","Snell Roundhand",cursive;font-size:1.9rem;color:var(--accent);margin:14px 0 0}
@media(max-width:700px){.bio{grid-template-columns:1fr;text-align:center;gap:24px}.bio-pic{width:200px;margin:0 auto}}

/* Proof numbers */
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px;text-align:center}
.stats b{display:block;font-size:clamp(2rem,4.4vw,2.8rem);font-weight:800;letter-spacing:-.03em;color:var(--accent);line-height:1.1}
.band-dark .stats b,.band-brand .stats b{color:#fff}.stats span{opacity:.75;font-size:.95rem}

/* Closing call to action */
.cta-sec{text-align:center;max-width:760px;margin-left:auto;margin-right:auto}
.cta-sec h2{font-size:clamp(1.8rem,4vw,2.7rem);line-height:1.12;letter-spacing:-.02em;margin:0 0 12px}.cta-sec p{font-size:1.12rem;opacity:.85;margin:0}
.cta-sec .btn.big{margin-top:28px}.cta-sec .cta-note{font-size:.88rem;opacity:.7;margin-top:12px}
`;

module.exports = { renderSection, renderCover, mockup, SECTION_CSS, MOCKUPS, hl, plain };
