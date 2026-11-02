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
    ${b.badge ? `<span class="badge">${esc(b.badge)}</span>` : ''}
    ${b.compareText ? `<div class="was">${esc(b.compareText)}</div>` : ''}
    <div class="price">${price ? `<sup>${esc(price.symbol)}</sup>${esc(price.amount)}` : esc(b.priceText || '$0')}</div>
    ${billing ? `<div class="billing">${esc(billing)}</div>` : ''}
    ${b.note ? `<div class="note">${esc(b.note)}</div>` : ''}
    ${b.featuresTitle ? `<h3>${esc(b.featuresTitle)}</h3>` : ''}
    ${features.length ? `<ul class="features">${features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    ${cta}</div>`;
}

function youtubeEmbed(url) {
  const m = String(url || '').match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/);
  return m ? `https://www.youtube-nocookie.com/embed/${m[1]}` : null;
}

function renderBlock(b, ctx, index) {
  const a = align(b.align);
  switch (b.type) {
    case 'hero': {
      const bg = color(b.background, '#0f766e');
      const fg = color(b.textColor, '#ffffff');
      // The wave is filled with the page background so the band blends into the page below it.
      return `<section class="hero${index === 0 ? ' first' : ''}" style="background:linear-gradient(180deg,color-mix(in srgb,${bg} 75%,#000) 0%,${bg} 100%);color:${fg}">
        ${b.eyebrow ? `<div class="eyebrow">${esc(b.eyebrow)}</div>` : ''}
        <h1>${multiline(b.text)}</h1>${b.subtext ? `<p>${multiline(b.subtext)}</p>` : ''}
        <svg class="wave" viewBox="0 0 1440 90" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 40 C 300 0 500 70 800 45 S 1200 10 1440 40 V90 H0Z" fill="${ctx.background}" opacity=".45"/>
          <path d="M0 60 C 350 25 600 85 900 60 S 1250 40 1440 55 V90 H0Z" fill="${ctx.background}"/></svg></section>`;
    }
    case 'pricing':
      return renderPricing(b, ctx);
    case 'heading': {
      const tag = b.size === 'small' ? 'h3' : b.size === 'medium' ? 'h2' : 'h1';
      return `<${tag} style="text-align:${a}">${multiline(b.text)}</${tag}>`;
    }
    case 'text':
      return `<p class="txt" style="text-align:${a}">${multiline(b.text)}</p>`;
    case 'image':
      return b.url ? `<div style="text-align:${a}"><img src="${esc(safeUrl(b.url))}" alt="${esc(b.alt)}"></div>` : '';
    case 'button': {
      const href = b.url === '#next' || !b.url ? ctx.nextUrl : b.url === '#no' ? ctx.noUrl : safeUrl(b.url);
      return `<div style="text-align:${a}"><a class="btn" href="${esc(href)}">${esc(b.label || 'Continue')}</a></div>`;
    }
    case 'video': {
      const src = youtubeEmbed(b.url);
      return src ? `<div class="video"><iframe src="${src}" allowfullscreen loading="lazy" title="Video"></iframe></div>` : '';
    }
    case 'form': {
      const fields = [
        b.collectName ? '<input name="first_name" placeholder="First name" autocomplete="given-name">' : '',
        '<input name="email" type="email" placeholder="Your email address" required autocomplete="email">',
        b.collectPhone ? '<input name="phone" type="tel" placeholder="Phone number" autocomplete="tel">' : '',
        b.collectMessage ? '<textarea name="message" rows="4" placeholder="How can we help?" maxlength="2000"></textarea>' : '',
      ].join('');
      const disabled = ctx.preview ? ' onsubmit="event.preventDefault();alert(\'Forms are disabled in preview\')"' : '';
      return `<form class="optin" method="post" action="${esc(ctx.formAction)}"${disabled}>
        <input type="hidden" name="block" value="${esc(b.id)}">
        <input name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
        ${fields}<button class="btn" type="submit">${esc(b.buttonLabel || 'Get access')}</button></form>`;
    }
    case 'testimonial':
      return `<figure class="testimonial">${b.photo && /^https?:/i.test(b.photo) ? `<img src="${esc(b.photo)}" alt="" loading="lazy">` : ''}
        <blockquote>“${esc(b.quote || '')}”</blockquote><figcaption>${esc(b.name || '')}${b.detail ? ` · <span>${esc(b.detail)}</span>` : ''}</figcaption></figure>`;
    case 'spacer':
      return `<div style="height:${Math.min(Math.max(Number(b.height) || 40, 0), 400)}px"></div>`;
    case 'divider':
      return '<hr>';
    default:
      return '';
  }
}

function renderPage({ title, blocks, settings = {}, nextUrl = '#', noUrl = '#', formAction = '#', buyAction = '#', products = {}, preview = false }) {
  const bg = color(settings.background, '#ffffff');
  const fg = color(settings.textColor, '#1f2937');
  const accent = color(settings.accent, '#4f46e5');
  const width = Math.min(Math.max(Number(settings.width) || 720, 360), 1200);
  const ctx = { nextUrl, noUrl, formAction, buyAction, products, preview, accent, background: bg };
  const body = (blocks || []).map((b, i) => renderBlock(b, ctx, i)).join('\n');
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
.testimonial{margin:28px auto;max-width:560px;text-align:center}.testimonial img{width:64px;height:64px;border-radius:50%;object-fit:cover}.testimonial blockquote{font-size:1.15rem;font-style:italic;margin:10px 0}.testimonial figcaption{font-weight:600}.testimonial figcaption span{font-weight:400;opacity:.7}.pimg{width:100%;max-height:320px;object-fit:cover;border-radius:10px;margin-bottom:14px}.bump{display:flex;gap:10px;align-items:flex-start;text-align:left;border:2px dashed #f59e0b;background:#fffbeb;border-radius:8px;padding:12px;margin:0 0 14px;cursor:pointer;font-size:.95rem}.bump input{margin-top:4px;width:18px;height:18px}.pricing form{margin:0}.cta{display:block;width:100%;font-size:1.6rem;padding:16px 20px;border-radius:6px;font-weight:700}
.cta small{display:block;font-size:.8rem;font-weight:400;margin-top:6px;opacity:.95}
.warn{color:#b45309;font-size:.85rem}
@media(max-width:560px){.features{grid-template-columns:1fr}.price{font-size:4.2rem}.cta{font-size:1.25rem}}
</style></head><body><main>
${body || '<p style="text-align:center;opacity:.5">This page is empty. Add blocks in the editor.</p>'}
</main></body></html>`;
}

module.exports = { renderPage, esc, formatMoney };
