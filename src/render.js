// Turns a step's block list into a standalone HTML page. Used both for the
// public funnel pages and the live preview inside the page builder.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const color = (c, fallback) => (/^#[0-9a-f]{3,8}$/i.test(c || '') ? c : fallback);
const align = (a) => (['left', 'center', 'right'].includes(a) ? a : 'center');
const safeUrl = (u) => (/^(https?:\/\/|\/|#)/i.test(u || '') ? u : '#');
const multiline = (s) => esc(s).replace(/\n/g, '<br>');

const BILLING_TEXT = { one_time: 'one-time payment', monthly: 'per month', yearly: 'per year' };

// Splits a price into symbol and amount so the card can style them apart:
// (4700, 'usd') → { symbol: '$', amount: '47' }.
function moneyParts(cents, currency = 'usd') {
  const fmt = new Intl.NumberFormat('en-US', {
    style: 'currency', currency: currency.toUpperCase(),
    minimumFractionDigits: cents % 100 ? 2 : 0,
  });
  const parts = fmt.formatToParts(cents / 100);
  return {
    symbol: parts.filter((p) => p.type === 'currency').map((p) => p.value).join(''),
    amount: parts.filter((p) => !['currency', 'literal'].includes(p.type)).map((p) => p.value).join(''),
  };
}
const formatMoney = (cents, currency) => { const m = moneyParts(cents, currency); return m.symbol + m.amount; };

function renderPricing(b, ctx) {
  const product = ctx.products?.[b.productId];
  const price = product ? moneyParts(product.price_cents, product.currency) : null;
  const billing = b.billingText || (product ? BILLING_TEXT[product.billing] : '');
  const features = String(b.features || '').split('\n').map((f) => f.trim()).filter(Boolean);
  const btnStyle = `background:${color(b.buttonColor, ctx.accent)}`;
  const label = `${esc(b.buttonLabel || 'Buy now')}&nbsp;&rarr;${b.buttonSubtext ? `<small>${esc(b.buttonSubtext)}</small>` : ''}`;
  let cta;
  // One-click upsell: the buyer just paid, so "Yes" charges the same card.
  if (product && ctx.oneClick && product.billing === 'one_time') {
    return `<div class="pricing">
    ${product.image_url ? `<img class="pimg" src="${esc(product.image_url)}" alt="${esc(product.name)}" loading="lazy">` : ''}
    ${b.badge ? `<span class="badge">${esc(b.badge)}</span>` : ''}
    <div class="price">${price ? `<sup>${esc(price.symbol)}</sup>${esc(price.amount)}` : ''}</div>
    ${b.featuresTitle ? `<h3>${esc(b.featuresTitle)}</h3>` : ''}
    ${features.length ? `<ul class="features">${features.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    <form method="post" action="${esc(ctx.oneClick)}"><input type="hidden" name="block" value="${esc(b.id)}">
      <button class="btn cta" style="${btnStyle}">${label}</button></form>
    <p class="oneclick">One click: added to the card you just used. No need to enter it again.</p></div>`;
  }
  if (product) {
    const blocked = ctx.preview ? ' onsubmit="event.preventDefault();alert(\'Checkout is disabled in preview\')"' : '';
    // Order bump: one checkbox that adds a second item to the same payment.
    const bump = b.bumpProductId && ctx.products?.[b.bumpProductId];
    const bumpHtml = bump ? `<label class="bump"><input type="checkbox" name="bump" value="1">
      <span><b>${esc(b.bumpLabel || `Yes, add ${bump.name}`)}</b> for ${esc(formatMoney(bump.price_cents, bump.currency))}${bump.description ? `<br><small>${esc(bump.description)}</small>` : ''}</span></label>` : '';
    cta = `<form method="post" action="${esc(ctx.buyAction)}"${blocked}><input type="hidden" name="block" value="${esc(b.id)}">
      ${bumpHtml}<button class="btn cta" style="${btnStyle}">${label}</button></form>`;
  } else {
    cta = `<a class="btn cta" style="${btnStyle}" href="${esc(ctx.nextUrl)}">${label}</a>`
      + (ctx.preview ? '<p class="warn">Choose a product for this pricing card so the button takes payment.</p>' : '');
  }
  return `<div class="pricing">
    ${product?.image_url ? `<img class="pimg" src="${esc(product.image_url)}" alt="${esc(product.name)}" loading="lazy">` : ''}
    ${b.badge ? `<span class="badge"${ctx.preview ? ' data-f="badge"' : ''}>${esc(b.badge)}</span>` : ''}
    ${b.compareText ? `<div class="was">${esc(b.compareText)}</div>` : ''}
    <div class="price">${price ? `<sup>${esc(price.symbol)}</sup>${esc(price.amount)}` : esc(b.priceText || '$0')}</div>
    ${billing ? `<div class="billing">${esc(billing)}</div>` : ''}
    ${b.note ? `<div class="note">${esc(b.note)}</div>` : ''}
    ${b.featuresTitle ? `<h3${ctx.preview ? ' data-f="featuresTitle"' : ''}>${esc(b.featuresTitle)}</h3>` : ''}
    ${features.length ? `<ul class="features">${features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    ${cta}</div>`;
}

function youtubeEmbed(url) {
  const m = String(url || '').match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/);
  return m ? `https://www.youtube-nocookie.com/embed/${m[1]}` : null;
}

const testimonialHtml = (t) => `<figure class="testimonial"><blockquote>“${esc(t.quote)}”</blockquote>
  <figcaption>${esc(t.name)}${t.detail ? ` · <span>${esc(t.detail)}</span>` : ''}</figcaption></figure>`;

function renderBlock(b, ctx, index) {
  const a = align(b.align);
  // In the editor preview, text marked with data-f can be clicked and typed into.
  const f = (field) => (ctx.preview ? ` data-f="${field}"` : '');
  switch (b.type) {
    case 'hero': {
      const bg = color(b.background, '#0f766e');
      const fg = color(b.textColor, '#ffffff');
      // The wave is filled with the page background so the band blends into the page below it.
      return `<section class="hero${index === 0 ? ' first' : ''}" style="background:linear-gradient(180deg,color-mix(in srgb,${bg} 75%,#000) 0%,${bg} 100%);color:${fg}">
        ${b.eyebrow ? `<div class="eyebrow"${f('eyebrow')}>${esc(b.eyebrow)}</div>` : ''}
        <h1${f('text')}>${multiline(b.text)}</h1>${b.subtext ? `<p${f('subtext')}>${multiline(b.subtext)}</p>` : ''}
        <svg class="wave" viewBox="0 0 1440 90" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 40 C 300 0 500 70 800 45 S 1200 10 1440 40 V90 H0Z" fill="${ctx.background}" opacity=".45"/>
          <path d="M0 60 C 350 25 600 85 900 60 S 1250 40 1440 55 V90 H0Z" fill="${ctx.background}"/></svg></section>`;
    }
    case 'pricing':
      return renderPricing(b, ctx);
    case 'heading': {
      const tag = b.size === 'small' ? 'h3' : b.size === 'medium' ? 'h2' : 'h1';
      return `<${tag} style="text-align:${a}"${f('text')}>${multiline(b.text)}</${tag}>`;
    }
    case 'text':
      return `<p class="txt" style="text-align:${a}"${f('text')}>${multiline(b.text)}</p>`;
    case 'image':
      return b.url ? `<div style="text-align:${a}"><img src="${esc(safeUrl(b.url))}" alt="${esc(b.alt)}"></div>` : (ctx.preview ? `<div class="ph">🖼 Image: paste an image link in the panel on the left</div>` : '');
    case 'button': {
      // "page:<slug>" links to another page of the same website or funnel.
      const href = String(b.url || '').startsWith('page:') ? ctx.pageHref(String(b.url).slice(5))
        : b.url === '#next' || !b.url ? ctx.nextUrl : b.url === '#no' ? ctx.noUrl : safeUrl(b.url);
      return `<div style="text-align:${a}"><a class="btn" href="${esc(href)}"${f('label')}>${esc(b.label || 'Continue')}</a></div>`;
    }
    case 'video': {
      const src = youtubeEmbed(b.url);
      return src ? `<div class="video"><iframe src="${src}" allowfullscreen loading="lazy" title="Video"></iframe></div>` : (ctx.preview ? `<div class="ph">▶ Video: paste a YouTube link in the panel on the left</div>` : '');
    }
    case 'form': {
      const fields = [
        b.collectName ? '<input name="first_name" placeholder="First name" autocomplete="given-name">' : '',
        '<input name="email" type="email" placeholder="Your email address" required autocomplete="email">',
        b.collectPhone && !b.smsOptIn ? '<input name="phone" type="tel" placeholder="Phone number" autocomplete="tel">' : '',
        b.collectMessage || String(b.purpose || '').toLowerCase() === 'review' ? `<textarea name="message" rows="4" placeholder="${String(b.purpose || '').toLowerCase() === 'review' ? 'What was it like?' : 'How can we help?'}" maxlength="2000"${String(b.purpose || '').toLowerCase() === 'review' ? ' required' : ''}></textarea>` : '',
        String(b.purpose || '').toLowerCase() === 'review' ? `<label class="consent"><input type="checkbox" name="share" value="1"> You may show my words and first name on your website.</label>` : '',
        // SMS compliance wording appears only when the form asks for text messages.
        b.smsOptIn ? `<input name="phone" type="tel" placeholder="Mobile number" autocomplete="tel" required>
          <label class="consent"><input type="checkbox" name="sms_consent" value="1"> Yes, text me updates from ${esc(ctx.business || 'us')}. Msg &amp; data rates may apply. Msg frequency varies. Reply STOP to opt out, HELP for help. Consent is not a condition of purchase.</label>` : '',
      ].join('');
      const disabled = ctx.preview ? ' onsubmit="event.preventDefault();alert(\'Forms are disabled in preview\')"' : '';
      return `<form class="optin" method="post" action="${esc(ctx.formAction)}"${disabled}>
        <input type="hidden" name="block" value="${esc(b.id)}">
        <input name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
        ${fields}<button class="btn" type="submit"${ctx.preview ? ' data-f="buttonLabel"' : ''}>${esc(b.buttonLabel || 'Get access')}</button></form>`;
    }
    case 'cards': {
      const items = String(b.items || '').split('\n').map((l) => l.split('|').map((x) => x.trim())).filter(([t]) => t);
      return `<div class="cards">${items.map(([t, d]) => `<div class="card"><h3>${esc(t)}</h3>${d ? `<p>${esc(d)}</p>` : ''}</div>`).join('')}</div>`;
    }
    case 'info': {
      const rows = [['🕘', 'Hours', b.hours], ['📍', 'Address', b.address], ['📞', 'Phone', b.phone && `<a href="tel:${esc(String(b.phone).replace(/[^+\d]/g, ''))}">${esc(b.phone)}</a>`], ['✉️', 'Email', b.email && `<a href="mailto:${esc(b.email)}">${esc(b.email)}</a>`]]
        .filter(([, , v]) => v);
      return rows.length ? `<div class="info">${rows.map(([i, l, v]) => `<div><span>${i}</span><b>${l}</b><div>${l === 'Phone' || l === 'Email' ? v : esc(v)}</div></div>`).join('')}</div>` : '';
    }
    // Testimonials come only from the account's approved records.
    case 'testimonial': {
      const t = ctx.testimonials?.[b.testimonialId];
      if (!t) return ctx.preview ? '<p class="warn" style="text-align:center">Pick a testimonial from your records (People → Testimonials).</p>' : '';
      return testimonialHtml(t, ctx);
    }
    case 'reviews': {
      const list = Object.values(ctx.testimonials || {}).sort((x, y) => y.id - x.id).slice(0, Math.max(1, Number(b.limit) || 3));
      if (!list.length) return ctx.preview ? '<p class="warn" style="text-align:center">Your approved testimonials appear here. This section stays hidden until you have one.</p>' : '';
      return list.map((t) => testimonialHtml(t, ctx)).join('');
    }
    case 'spacer':
      return `<div style="height:${Math.min(Math.max(Number(b.height) || 40, 0), 400)}px"></div>`;
    case 'divider':
      return '<hr>';
    default:
      return '';
  }
}

function renderPage({ title, blocks, settings = {}, nextUrl = '#', noUrl = '#', formAction = '#', buyAction = '#', products = {}, preview = false, oneClick = null, site = null, pageHref = (slug) => `#${slug}`, testimonials = {}, business = '' }) {
  const bg = color(settings.background, '#ffffff');
  const fg = color(settings.textColor, '#1f2937');
  const accent = color(settings.accent, '#4f46e5');
  const width = Math.min(Math.max(Number(settings.width) || 720, 360), 1200);
  const ctx = { nextUrl, noUrl, formAction, buyAction, products, preview, accent, background: bg, oneClick, pageHref, testimonials, business };
  // Websites get a menu across the top and a footer.
  const nav = site ? `<header class="site"><div class="in"><a class="brand" href="${esc(site.home)}">${esc(site.name)}</a>
    <input type="checkbox" id="mnu" hidden><label for="mnu" class="burger" aria-label="Menu">☰</label>
    <nav>${site.links.map((l) => `<a href="${esc(l.href)}"${l.active ? ' aria-current="page"' : ''}>${esc(l.label)}</a>`).join('')}</nav></div></header>` : '';
  const foot = site ? `<footer class="site"><div class="in"><b>${esc(site.name)}</b><nav>${site.links.map((l) => `<a href="${esc(l.href)}">${esc(l.label)}</a>`).join('')}</nav>
    <small>© ${new Date().getFullYear()} ${esc(site.name)}</small></div></footer>` : '';
  const body = (blocks || []).map((b, i) => (preview ? `<div data-bi="${i}">${renderBlock(b, ctx, i)}</div>` : renderBlock(b, ctx, i))).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(settings.seoTitle || title)}</title>
${settings.seoDescription ? `<meta name="description" content="${esc(settings.seoDescription)}">` : ''}
<style>
*{box-sizing:border-box}body{margin:0;background:${bg};color:${fg};font:17px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:${width}px;margin:0 auto;padding:48px 20px}
h1{font-size:2.4rem;line-height:1.15;margin:.4em 0}h2{font-size:1.8rem;line-height:1.2;margin:.5em 0}h3{font-size:1.3rem;margin:.5em 0}
.txt{margin:.8em 0}img{max-width:100%;height:auto;border-radius:10px}
.btn{display:inline-block;background:${accent};color:#fff;border:0;padding:15px 30px;border-radius:10px;font:600 1.05rem system-ui,sans-serif;text-decoration:none;cursor:pointer}
.btn:hover{filter:brightness(1.1)}
.optin{display:flex;flex-direction:column;gap:10px;max-width:440px;margin:20px auto}
.optin input{padding:14px 16px;border:1px solid #d1d5db;border-radius:10px;font-size:1rem}
.optin .btn{width:100%}.hp{position:absolute;left:-9999px}
.video{position:relative;padding-top:56.25%;margin:20px 0}.video iframe{position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:10px}
hr{border:0;border-top:1px solid rgba(0,0,0,.12);margin:28px 0}
body{overflow-x:hidden}
.hero{position:relative;margin:0 calc(50% - 50vw) 40px;padding:64px 20px 110px;text-align:center}
.hero.first{margin-top:-48px}.hero h1{max-width:820px;margin:.2em auto;font-size:clamp(2rem,5vw,3.3rem);font-weight:800}
.hero p{max-width:640px;margin:12px auto 0;font-size:1.15rem;opacity:.92}
.eyebrow{display:inline-block;letter-spacing:.18em;text-transform:uppercase;font-size:.95rem;padding-bottom:4px;border-bottom:2px solid currentColor;margin-bottom:10px}
.wave{position:absolute;left:0;bottom:-1px;width:100%;height:70px}
.pricing{max-width:680px;margin:24px auto;padding:32px 28px;border:1px solid rgba(0,0,0,.14);border-radius:6px;text-align:center;background:#fff;color:#1f2937}
.badge{display:inline-block;background:#fee2e2;color:#ef4444;border-radius:99px;padding:4px 12px;font-size:.85rem;letter-spacing:.03em}
.was{text-decoration:line-through;font-size:1.4rem;margin-top:10px;opacity:.85}
.price{font-size:5.5rem;font-weight:800;line-height:1;margin:14px 0 6px;color:#3f3f46}
.price sup{font-size:1.9rem;vertical-align:top;position:relative;top:.35em;margin-right:2px}
.billing{font-size:1.45rem}.note{font-weight:600;font-size:.95rem;margin-top:4px}
.pricing h3{font-size:1.6rem;margin:28px 0 16px}
.features{list-style:none;padding:0;margin:0 0 28px;display:grid;grid-template-columns:1fr 1fr;gap:10px 28px;text-align:left}
.features li{position:relative;padding-left:40px;line-height:1.35}
.features li::before{content:"✓";position:absolute;left:0;top:-1px;width:22px;height:22px;border:2px solid ${accent};color:${accent};border-radius:4px;display:grid;place-items:center;font-weight:800;font-size:.85rem}
.consent{display:flex;gap:8px;align-items:flex-start;text-align:left;font-size:.8rem;opacity:.85;margin:4px 0 10px}.consent input{width:auto;margin-top:3px}.testimonial{margin:28px auto;max-width:560px;text-align:center}.testimonial img{width:64px;height:64px;border-radius:50%;object-fit:cover}.testimonial blockquote{font-size:1.15rem;font-style:italic;margin:10px 0}.testimonial figcaption{font-weight:600}.testimonial figcaption span{font-weight:400;opacity:.7}.pimg{width:100%;max-height:320px;object-fit:cover;border-radius:10px;margin-bottom:14px}.bump{display:flex;gap:10px;align-items:flex-start;text-align:left;border:2px dashed #f59e0b;background:#fffbeb;border-radius:8px;padding:12px;margin:0 0 14px;cursor:pointer;font-size:.95rem}.bump input{margin-top:4px;width:18px;height:18px}.pricing form{margin:0}.cta{display:block;width:100%;font-size:1.6rem;padding:16px 20px;border-radius:6px;font-weight:700}
.cta small{display:block;font-size:.8rem;font-weight:400;margin-top:6px;opacity:.95}
.warn{color:#b45309;font-size:.85rem}.oneclick{font-size:.85rem;opacity:.75;margin:10px 0 0}
@media(max-width:560px){.features{grid-template-columns:1fr}.price{font-size:4.2rem}.cta{font-size:1.25rem}}
header.site{position:sticky;top:0;z-index:5;background:color-mix(in srgb,${bg} 92%,transparent);backdrop-filter:blur(8px);border-bottom:1px solid color-mix(in srgb,${fg} 10%,transparent)}
header.site .in,footer.site .in{max-width:${width}px;margin:0 auto;padding:14px 20px;display:flex;align-items:center;gap:20px;flex-wrap:wrap}
header.site .brand{font-weight:800;font-size:1.15rem;color:${fg};text-decoration:none;margin-right:auto}
header.site nav{display:flex;gap:18px;flex-wrap:wrap}header.site nav a,footer.site nav a{color:${fg};text-decoration:none;opacity:.8;font-weight:500}
header.site nav a[aria-current]{opacity:1;color:${accent};border-bottom:2px solid ${accent}}
.burger{display:none;cursor:pointer;font-size:1.4rem}
footer.site{border-top:1px solid color-mix(in srgb,${fg} 10%,transparent);margin-top:40px;font-size:.9rem}footer.site nav{display:flex;gap:14px;flex-wrap:wrap;margin-right:auto}footer.site small{opacity:.6}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin:28px 0}
.cards .card{border:1px solid color-mix(in srgb,${fg} 12%,transparent);border-radius:12px;padding:18px 20px;background:color-mix(in srgb,${accent} 4%,${bg})}
.cards h3{margin:0 0 6px;font-size:1.1rem}.cards p{margin:0;opacity:.8}
.info{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:24px 0;padding:18px;border-radius:12px;background:color-mix(in srgb,${accent} 6%,${bg})}
.info>div{display:grid;grid-template-columns:auto 1fr;gap:2px 8px;align-items:start}.info>div>div{grid-column:2}.info a{color:${accent}}
@media(max-width:640px){.burger{display:block}header.site nav{display:none;width:100%;flex-direction:column;gap:10px;padding-top:6px}#mnu:checked~nav{display:flex}}
</style></head><body>${nav}<main>
${body || '<p style="text-align:center;opacity:.5">This page is empty. Add blocks in the editor.</p>'}
</main>${foot}${preview ? PREVIEW_EDIT_SCRIPT + PREVIEW_DROP_SCRIPT : ''}</body></html>`;
}

// Click-to-edit in the editor preview: click any text to type over it; the
// change goes to the editor (postMessage), which saves it to the block.
// Drag and drop from the builder's block list: while something is dragged
// over the preview, a line shows where it will land; dropping tells the
// builder the position. Only drags started in the builder are accepted.
const PREVIEW_DROP_SCRIPT = `<style>.ph{border:2px dashed #c7d2fe;border-radius:10px;padding:34px 16px;text-align:center;color:#6366f1;background:#f5f7ff;font:500 14px/1.4 system-ui,sans-serif;margin:8px 0}#ff-drop{position:absolute;left:0;right:0;height:4px;background:#4f46e5;border-radius:2px;box-shadow:0 0 0 3px rgba(79,70,229,.25);pointer-events:none;z-index:99999;display:none}</style>
<script>(function(){var line=document.createElement('div');line.id='ff-drop';document.body.appendChild(line);
function ours(e){return Array.prototype.indexOf.call(e.dataTransfer.types,'text/x-fourfold')>=0;}
function spot(y){var bs=document.querySelectorAll('[data-bi]');for(var k=0;k<bs.length;k++){var r=bs[k].getBoundingClientRect();if(y<r.top+r.height/2)return{at:k,top:r.top+scrollY-2};}
var last=bs[bs.length-1],m=document.querySelector('main')||document.body;return{at:bs.length,top:last?last.getBoundingClientRect().bottom+scrollY-2:m.getBoundingClientRect().top+scrollY+24};}
document.addEventListener('dragover',function(e){if(!ours(e))return;e.preventDefault();e.dataTransfer.dropEffect='copy';var s=spot(e.clientY);line.style.top=s.top+'px';line.style.display='block';});
document.addEventListener('dragleave',function(e){if(!e.relatedTarget)line.style.display='none';});
document.addEventListener('drop',function(e){if(!ours(e))return;e.preventDefault();line.style.display='none';parent.postMessage({ff:'drop',at:spot(e.clientY).at,data:e.dataTransfer.getData('text/x-fourfold')},'*');});})();<\/script>`;

const PREVIEW_EDIT_SCRIPT = `<style>[data-f]{outline:1px dashed transparent;outline-offset:3px;cursor:text}[data-f]:hover{outline-color:#818cf8}[data-f][contenteditable]{outline:2px solid #4f46e5}[data-bi]:hover{box-shadow:inset 0 0 0 1px #c7d2fe}</style>
<script>document.addEventListener('click',function(e){var blk=e.target.closest('[data-bi]');var el=e.target.closest('[data-f]');if(e.target.closest('a,button'))e.preventDefault();if(blk)parent.postMessage({ff:'open',i:+blk.dataset.bi},'*');if(!el||el.isContentEditable)return;e.preventDefault();el.contentEditable='true';el.focus();el.oninput=function(){parent.postMessage({ff:'edit',i:+blk.dataset.bi,f:el.dataset.f,v:el.innerText.replace(/^\\u201c|\\u201d$/g,'').trim()},'*');};el.onkeydown=function(k){if(k.key==='Escape'||(k.key==='Enter'&&el.dataset.f!=='text'&&el.dataset.f!=='quote'&&el.dataset.f!=='subtext')){k.preventDefault();el.blur();}};el.onblur=function(){el.removeAttribute('contenteditable');};},true);<\/script>`;

module.exports = { renderPage, esc, formatMoney };
