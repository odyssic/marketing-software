// Turns a step's block list into a standalone HTML page. Used both for the
// public funnel pages and the live preview inside the page builder.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const { payOf, payLabel, money: payMoney } = require('./paidbookings'); // paid Booking blocks
const sections = require('./sections'); // cover banner, features, FAQ, guarantee and other rich sections
// *Words between stars* in a headline are highlighted.
const starHl = (html) => html.replace(/\*([^*<\n]+)\*/g, '<em class="hl">$1</em>');

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

// Checks a typed code on the server and says what it does; a ?coupon= link
// (from a checkout reminder) fills it in. Runs once per page.
const COUPON_JS = `<script>if(!window.__pcode){window.__pcode=1;addEventListener('DOMContentLoaded',function(){
var pre=new URLSearchParams(location.search).get('coupon');
document.querySelectorAll('.pcode').forEach(function(d){var f=d.closest('form'),i=d.querySelector('input'),m=d.querySelector('.pcode-msg');
function go(){if(!i.value.trim()){m.textContent='';return}var pl=f.querySelector('input[name=plan]:checked');
fetch(d.dataset.check+'?block='+encodeURIComponent(f.block.value)+'&code='+encodeURIComponent(i.value)+(pl&&pl.value?'&plan=1':'')).then(function(r){return r.json()}).then(function(j){m.textContent=j.message;m.className='pcode-msg '+(j.ok?'ok':'bad')}).catch(function(){})}
d.querySelector('.pcode-go').onclick=go;i.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();go()}});
f.querySelectorAll('input[name=plan]').forEach(function(r){r.addEventListener('change',go)});
if(pre){i.value=pre;d.open=true;go()}})})}</script>`;

function renderPricing(b, ctx) {
  const product = ctx.products?.[b.productId];
  const price = product ? moneyParts(product.price_cents, product.currency) : null;
  // A free trial says so plainly: "14 days free, then $29/month".
  const trial = product && product.billing !== 'one_time' && product.trial_days > 0
    ? `${product.trial_days} days free, then ${formatMoney(product.price_cents, product.currency)}/${product.billing === 'yearly' ? 'year' : 'month'}` : '';
  const billing = trial || b.billingText || (product ? BILLING_TEXT[product.billing] : '');
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
    // Email first: it pre-fills checkout and lets us send one reminder if they don't finish.
    const emailHtml = b.askEmail === false ? '' : '<input class="pemail" type="email" name="email" required autocomplete="email" placeholder="Your email (for your receipt)" aria-label="Your email">';
    // Pay in parts: pick "in full" or "3 × $33".
    const parts = product.billing === 'one_time' && product.plan_parts >= 2 ? product.plan_parts : 0;
    const planHtml = parts ? `<div class="plans" role="radiogroup" aria-label="How to pay">
      <label><input type="radio" name="plan" value="" checked><span>Pay in full <b>${esc(formatMoney(product.price_cents, product.currency))}</b></span></label>
      <label><input type="radio" name="plan" value="1"><span>${parts} monthly payments of <b>${esc(formatMoney(product.plan_part_cents || Math.ceil(product.price_cents / parts), product.currency))}</b></span></label></div>` : '';
    // "Have a code?" only shows when the business has made at least one code.
    const check = String(ctx.buyAction).replace(/\/buy$/, '/coupon');
    const codeHtml = ctx.coupons ? `<details class="pcode" data-check="${esc(check)}"><summary>Have a code?</summary>
      <div class="pcode-row"><input name="coupon" maxlength="30" autocomplete="off" placeholder="Enter code" aria-label="Discount code"><button type="button" class="pcode-go">Apply</button></div>
      <div class="pcode-msg" role="status"></div></details>${COUPON_JS}` : '';
    cta = `<form method="post" action="${esc(ctx.buyAction)}"${blocked}><input type="hidden" name="block" value="${esc(b.id)}">
      ${emailHtml}${planHtml}${bumpHtml}${codeHtml}<button class="btn cta" style="${btnStyle}">${label}</button></form>`;
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

const TICK = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
const youtubeId = (url) => String(url || '').match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/))([\w-]{11})/)?.[1] || null;
function youtubeEmbed(url) {
  const id = youtubeId(url);
  return id ? `https://www.youtube-nocookie.com/embed/${id}?rel=0&iv_load_policy=3&playsinline=1` : null;
}

const testimonialHtml = (t) => `<figure class="testimonial"><blockquote>“${esc(t.quote)}”</blockquote>
  <figcaption>${esc(t.name)}${t.detail ? ` · <span>${esc(t.detail)}</span>` : ''}</figcaption></figure>`;

function renderBlock(b, ctx, index) {
  const a = align(b.align);
  // In the editor preview, text marked with data-f can be clicked and typed into.
  const f = (field) => (ctx.preview ? ` data-f="${field}"` : '');
  const linkOf = (u) => (u === '#form' ? '#form' : String(u || '').startsWith('page:') ? ctx.pageHref(String(u).slice(5))
    : u === '#next' || !u ? ctx.nextUrl : u === '#no' ? ctx.noUrl : safeUrl(u));
  switch (b.type) {
    case 'hero': {
      if (b.style === 'cover') return sections.renderCover(b, ctx, index, { href: linkOf, formHtml: ctx.coverForm || '' });
      const bg = color(b.background, '#0f766e');
      const fg = color(b.textColor, '#ffffff');
      const style = ['flat', 'minimal', 'split'].includes(b.style) ? b.style : 'wave';
      // An optional button right in the hero.
      const href = !b.button ? '' : String(b.url || '').startsWith('page:') ? ctx.pageHref(String(b.url).slice(5))
        : b.url === '#next' || !b.url ? ctx.nextUrl : b.url === '#no' ? ctx.noUrl : safeUrl(b.url);
      const cta = b.button ? `<div class="hero-cta"><a class="btn hero-btn" href="${esc(href)}"${f('button')}>${esc(b.button)}</a></div>` : '';
      const words = `${b.eyebrow ? `<div class="eyebrow"${f('eyebrow')}>${esc(b.eyebrow)}</div>` : ''}
        <h1${f('text')}>${starHl(multiline(b.text))}</h1>${b.subtext ? `<p${f('subtext')}>${multiline(b.subtext)}</p>` : ''}${cta}`;
      if (style === 'minimal') return `<section class="hero-min${index === 0 ? ' first' : ''}">${words}</section>`;
      if (style === 'split') {
        const img = b.image ? `<img src="${esc(safeUrl(b.image))}" alt="${esc(b.imageAlt || '')}">` : '<div class="hero-ph" aria-hidden="true"></div>';
        return `<section class="hero-split${index === 0 ? ' first' : ''}"><div class="hs-words">${words}</div><div class="hs-img">${img}</div></section>`;
      }
      if (style === 'flat') return `<section class="hero flat${index === 0 ? ' first' : ''}" style="background:${bg};color:${fg};--hero-fg:${fg};--hero-bg:${bg}">${words}</section>`;
      // The wave is filled with the page background so the band blends into the page below it.
      return `<section class="hero${index === 0 ? ' first' : ''}" style="background:linear-gradient(180deg,color-mix(in srgb,${bg} 75%,#000) 0%,${bg} 100%);color:${fg};--hero-fg:${fg};--hero-bg:${bg}">
        ${b.eyebrow ? `<div class="eyebrow"${f('eyebrow')}>${esc(b.eyebrow)}</div>` : ''}
        <h1${f('text')}>${starHl(multiline(b.text))}</h1>${b.subtext ? `<p${f('subtext')}>${multiline(b.subtext)}</p>` : ''}${cta}
        <svg class="wave" viewBox="0 0 1440 90" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 40 C 300 0 500 70 800 45 S 1200 10 1440 40 V90 H0Z" fill="${ctx.background}" opacity=".45"/>
          <path d="M0 60 C 350 25 600 85 900 60 S 1250 40 1440 55 V90 H0Z" fill="${ctx.background}"/></svg></section>`;
    }
    case 'pricing':
      return renderPricing(b, ctx);
    case 'heading': {
      const tag = b.size === 'small' ? 'h3' : b.size === 'medium' ? 'h2' : 'h1';
      return `<${tag} style="text-align:${a}"${f('text')}>${starHl(multiline(b.text))}</${tag}>`;
    }
    case 'text':
      return `<p class="txt" style="text-align:${a}"${f('text')}>${multiline(b.text)}</p>`;
    case 'image':
      return b.url ? `<div style="text-align:${a}"><img src="${esc(safeUrl(b.url))}" alt="${esc(b.alt)}"></div>` : (ctx.preview ? `<div class="ph ph-image"><svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="9.5" r="1.6"/><path d="m4 17.5 4.8-4.6a1.2 1.2 0 0 1 1.6 0l3.1 2.9 2.3-2.1a1.2 1.2 0 0 1 1.6 0l3.1 2.8"/></svg><div>Drop a photo here</div><small>or choose one in the panel on the left</small></div>` : '');
    // Benefits or what's included, with ticks, dots or numbers.
    case 'bullets': {
      const items = String(b.items || '').split('\n').map((x) => x.trim()).filter(Boolean);
      if (!items.length) return '';
      const style = ['dot', 'number'].includes(b.style) ? b.style : 'check';
      const tag = style === 'number' ? 'ol' : 'ul';
      return `<div class="bul-wrap" style="text-align:${a}">${b.title ? `<h3 class="bul-t">${esc(b.title)}</h3>` : ''}<${tag} class="bul ${style}">${items.map((x) => `<li>${style === 'check' ? `<span class="tick" aria-hidden="true">${TICK}</span>` : ''}<span>${esc(x)}</span></li>`).join('')}</${tag}></div>`;
    }
    // The offer stack: everything they get, what each is worth, the total, today's price.
    case 'offer': {
      const rows = String(b.items || '').split('\n').map((l) => l.split('|').map((x) => x.trim())).filter(([t]) => t);
      if (!rows.length) return '';
      const nums = rows.map(([, v]) => Number(String(v || '').replace(/[^0-9.]/g, '')));
      const sym = (rows.find(([, v]) => v)?.[1] || '$').replace(/[0-9.,\s]/g, '').slice(0, 3) || '$';
      const total = rows.every(([, v]) => v) && nums.every((n) => n > 0) ? nums.reduce((x, y) => x + y, 0) : null;
      const href = String(b.url || '').startsWith('page:') ? ctx.pageHref(String(b.url).slice(5))
        : b.url === '#next' || !b.url ? ctx.nextUrl : b.url === '#no' ? ctx.noUrl : safeUrl(b.url);
      return `<div class="offer">${b.title ? `<h3 class="offer-t">${esc(b.title)}</h3>` : ''}
        <ul class="offer-rows">${rows.map(([t, v]) => `<li><span class="tick" aria-hidden="true">${TICK}</span><span class="o-name">${esc(t)}</span>${v ? `<span class="o-val">${esc(v)}</span>` : ''}</li>`).join('')}</ul>
        ${total !== null && b.showTotal !== false ? `<div class="offer-total"><span>Total value</span><s>${esc(sym)}${total.toLocaleString('en-US', { maximumFractionDigits: 2 })}</s></div>` : ''}
        ${b.price ? `<div class="offer-price"><span>${esc(b.priceLabel || 'Today')}</span><b>${esc(b.price)}</b></div>` : ''}
        ${b.buttonLabel ? `<a class="btn offer-btn" href="${esc(href)}">${esc(b.buttonLabel)}</a>` : ''}
        ${b.note ? `<p class="offer-note">${esc(b.note)}</p>` : ''}</div>`;
    }
    case 'button': {
      // "page:<slug>" links to another page of the same website or funnel.
      const href = String(b.url || '').startsWith('page:') ? ctx.pageHref(String(b.url).slice(5))
        : b.url === '#next' || !b.url ? ctx.nextUrl : b.url === '#no' ? ctx.noUrl : safeUrl(b.url);
      if (b.sub || b.big) return `<div style="text-align:${a}"><a class="btn big" href="${esc(linkOf(b.url))}"><span${f('label')}>${esc(b.label || 'Continue')}</span><svg class="arr" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>${b.sub ? `<small${f('sub')}>${esc(b.sub)}</small>` : ''}</a></div>`;
      return `<div style="text-align:${a}"><a class="btn" href="${esc(href)}"${f('label')}>${esc(b.label || 'Continue')}</a></div>`;
    }
    case 'video': {
      const vid = youtubeId(b.url);
      if (!vid) return ctx.preview ? `<div class="ph">Video: paste a YouTube link in the panel on the left</div>` : '';
      // Standard YouTube player, only when asked for (long videos people need to skip around in).
      if (b.controls) return `<div class="video"><iframe src="${youtubeEmbed(b.url)}" allowfullscreen loading="lazy" title="Video"></iframe></div>`;
      // Clean player: the thumbnail and our own play button; once playing, YouTube's title, logo,
      // "More videos" and control bar stay hidden. Click to pause or resume, double-click for full screen.
      return `<div class="video clean" data-yt="${vid}"><img class="vposter" src="https://i.ytimg.com/vi/${vid}/hqdefault.jpg" alt="" loading="lazy" onerror="this.style.display='none'">
        <button type="button" class="vshield" aria-label="Play video"><span class="vplay"><svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg></span></button></div>`;
    }
    case 'booking': {
      // Open times load from the server and show in the visitor's own time zone.
      const live = ctx.formAction && ctx.formAction !== '#';
      const book = live ? ctx.formAction.replace(/\/optin$/, '/book') : '';
      const slots = live ? ctx.formAction.replace(/\/[^/]+\/optin$/, '/slots') : '';
      // Paid: the price shows up front; the button goes to payment (paidbookings.js).
      const pay = payOf(b), due = pay.kind ? payMoney(pay.due, pay.currency) : '';
      const btnLabel = pay.kind ? (/pay|\$|€|£/i.test(b.buttonLabel || '') ? b.buttonLabel : `Continue to pay ${due}`) : b.buttonLabel || 'Confirm booking';
      return `<div class="booking" id="book" data-book="${esc(book)}" data-slots="${esc(slots)}" data-next="${esc(ctx.nextUrl || '#')}" data-phone="${b.collectPhone ? 1 : ''}" data-note="${b.askNote === false ? '' : 1}" data-btn="${esc(btnLabel)}" data-pay="${esc(payLabel(pay))}">
        ${b.heading ? `<h2${f('heading')}>${esc(b.heading)}</h2>` : ''}
        <p class="bk-meta"></p>
        <div class="bk-days" role="tablist" aria-label="Choose a day"></div>
        <div class="bk-times" aria-live="polite"><p class="bk-msg">Loading open times…</p></div>
        <p class="bk-tz"></p>
        <form class="bk-form" hidden><p class="bk-picked"></p>
          <input name="name" placeholder="Your name" required autocomplete="name"><input name="email" type="email" placeholder="Your email" required autocomplete="email">
          ${b.collectPhone ? '<input name="phone" type="tel" placeholder="Phone (optional)" autocomplete="tel">' : ''}
          ${b.askNote === false ? '' : '<textarea name="note" rows="3" placeholder="Anything I should know before we talk? (optional)"></textarea>'}
          <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
          ${pay.kind ? `<input name="code" class="bk-code" placeholder="Discount code (optional)" autocomplete="off" hidden>
          <p class="bk-paynote">You’ll pay <b>${esc(due)}</b> now${pay.kind === 'deposit' ? ` as a deposit, and ${esc(payMoney(pay.balance, pay.currency))} at the appointment` : ''}. We hold this time for 15 minutes while you pay.</p>` : ''}
          <button class="btn" type="submit">${esc(btnLabel)}</button><p class="bk-err" role="alert"></p></form>
        <div class="bk-done" hidden></div></div>`;
    }
    case 'form': {
      const fields = [
        b.collectName ? '<input name="first_name" placeholder="First name" autocomplete="given-name">' : '',
        '<input name="email" type="email" placeholder="Your email address" required autocomplete="email">',
        b.collectPhone && !b.smsOptIn ? '<input name="phone" type="tel" placeholder="Phone number" autocomplete="tel">' : '',
        b.collectBirthday ? '<label class="consent" style="display:block">Birthday (optional)<input name="birthday" type="date" autocomplete="bday" style="display:block;margin-top:4px"></label>' : '',
        b.collectMessage || String(b.purpose || '').toLowerCase() === 'review' ? `<textarea name="message" rows="4" placeholder="${String(b.purpose || '').toLowerCase() === 'review' ? 'What was it like?' : 'How can we help?'}" maxlength="2000"${String(b.purpose || '').toLowerCase() === 'review' ? ' required' : ''}></textarea>` : '',
        String(b.purpose || '').toLowerCase() === 'review' ? `<label class="consent"><input type="checkbox" name="share" value="1"> You may show my words and first name on your website.</label>` : '',
        // SMS compliance wording appears only when the form asks for text messages.
        b.smsOptIn ? `<input name="phone" type="tel" placeholder="Mobile number" autocomplete="tel" required>
          <label class="consent"><input type="checkbox" name="sms_consent" value="1"> Yes, text me updates from ${esc(ctx.business || 'us')}. Msg &amp; data rates may apply. Msg frequency varies. Reply STOP to opt out, HELP for help. Consent is not a condition of purchase.</label>` : '',
      ].join('');
      const disabled = ctx.preview ? ' onsubmit="event.preventDefault();alert(\'Forms are disabled in preview\')"' : '';
      const anchor = ctx.formAnchored ? '' : ' id="form"'; ctx.formAnchored = true;
      return `<form class="optin"${anchor} method="post" action="${esc(ctx.formAction)}"${disabled}>
        <input type="hidden" name="block" value="${esc(b.id)}">
        <input name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
        ${fields}<button class="btn" type="submit"${ctx.preview ? ' data-f="buttonLabel"' : ''}>${esc(b.buttonLabel || 'Get access')}</button></form>`;
    }
    case 'cards': {
      const items = String(b.items || '').split('\n').map((l) => l.split('|').map((x) => x.trim())).filter(([t]) => t);
      return `<div class="cards${b.numbered ? ' numbered' : ''}">${items.map(([t, d]) => `<div class="card"><h3>${esc(t)}</h3>${d ? `<p>${esc(d)}</p>` : ''}</div>`).join('')}</div>`;
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
      if (!list.length) return ctx.preview ? '<div class="ph"><b>Reviews show here</b><small>Only real ones you approve (People → Testimonials). Visitors don’t see this box until then.</small></div>' : '';
      return list.map((t) => testimonialHtml(t, ctx)).join('');
    }
    case 'spacer':
      return `<div style="height:${Math.min(Math.max(Number(b.height) || 40, 0), 400)}px"></div>`;
    case 'divider':
      return '<hr>';
    // Your own HTML (embeds, widgets, forms from other tools). It runs in a sealed
    // frame, so it can't reach Rilly or the visitor's sign-in; it grows to fit.
    case 'html': {
      const code = String(b.code || '').slice(0, 60000);
      if (!code.trim()) return ctx.preview ? '<p style="text-align:center;opacity:.5">Custom HTML: paste your code in the panel</p>' : '';
      const doc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_top"><style>body{margin:0;font:17px/1.6 system-ui,sans-serif}</style></head><body>${code}<script>(function(){var s=function(){parent.postMessage({rillyHtml:${index},h:document.documentElement.scrollHeight},'*')};addEventListener('load',s);new ResizeObserver(s).observe(document.body);setTimeout(s,800)})()<\/script></body></html>`;
      return `<div class="custom-html"><iframe title="${esc(b.title || 'Embedded content')}" data-html="${index}" style="width:100%;border:0;height:${Math.max(20, Number(b.height) || 150)}px" sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation" srcdoc="${esc(doc)}"></iframe></div>`;
    }
    default:
      return sections.renderSection(b, ctx, index, { href: linkOf }) ?? '';
  }
}

// Ad and analytics tags from the business's IDs (only known snippets, never raw code).
// Tag Manager can run any code, so it only loads on the business's own domain.
function trackingTags(code = {}, ownDomain = false) {
  const id = (v, re) => (re.test(String(v || '').trim()) ? String(v).trim() : '');
  const meta = id(code.meta, /^\d{6,20}$/), ga = id(code.ga4, /^G-[A-Z0-9]{4,15}$/i), tt = id(code.tiktok, /^[A-Z0-9]{10,30}$/i), gtm = ownDomain ? id(code.gtm, /^GTM-[A-Z0-9]{4,12}$/i) : '';
  return [
    ga && `<script async src="https://www.googletagmanager.com/gtag/js?id=${ga}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${ga}');</script>`,
    meta && `<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${meta}');fbq('track','PageView');</script>`,
    tt && `<script>!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.load=function(e){var n="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{};ttq._i[e]=[];ttq._u=n;var o=d.createElement("script");o.async=!0;o.src=n+"?sdkid="+e+"&lib="+t;var a=d.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};ttq.load('${tt}');ttq.page()}(window,document,'ttq');</script>`,
    gtm && `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s);j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i;f.parentNode.insertBefore(j,f)})(window,document,'script','dataLayer','${gtm}');</script>`,
  ].filter(Boolean).join('\n');
}
// Type styles: system fonts only, so pages stay fast and private.
const TYPE_CSS = {
  elegant: `h1,h2,h3,.hero h1,.offer-t,.bul-t{font-family:"Iowan Old Style","Palatino Linotype","Book Antiqua",Palatino,Georgia,serif;font-weight:600;letter-spacing:-.01em}
.eyebrow{font-family:system-ui,sans-serif;font-size:.78rem;letter-spacing:.24em;border:0;padding:0}body{line-height:1.7}`,
  modern: `h1,h2,h3{font-weight:800;letter-spacing:-.035em}.hero h1{font-weight:800;letter-spacing:-.04em}
.eyebrow{font-size:.75rem;font-weight:700;letter-spacing:.2em;border:0;padding:6px 12px;border-radius:99px;background:color-mix(in srgb,currentColor 12%,transparent)}.btn{border-radius:99px}`,
};
// What search engines, AI assistants and link previews read: the page's one true
// address, a social card, and structured data about the page and the business.
function seoHead({ title, description, url, business, blocks, logo, embed }) {
  const seo = require('./seo');
  const image = seo.firstImage(blocks);
  return [
    embed ? '<meta name="robots" content="noindex">' : '',
    url && !embed ? `<link rel="canonical" href="${esc(url)}">` : '',
    `<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}">`,
    description ? `<meta property="og:description" content="${esc(description)}">` : '',
    url ? `<meta property="og:url" content="${esc(url)}">` : '',
    business ? `<meta property="og:site_name" content="${esc(business)}">` : '',
    image ? `<meta property="og:image" content="${esc(image)}"><meta name="twitter:card" content="summary_large_image">` : '<meta name="twitter:card" content="summary">',
    business ? `<script type="application/ld+json">${seo.jsonLd({ business, url, title, description, blocks, image, logo })}</script>` : '',
  ].filter(Boolean).join('\n');
}
// Custom CSS can't close its <style> tag or pull in other files.
const cleanCss = (css) => String(css || '').slice(0, 40000).replace(/<\/?\s*style/gi, '').replace(/@import[^;]*;?/gi, '');
// Inside another website: tell the host page how tall we are, and open links in the top window.
const EMBED_STYLE = 'main{padding:28px 20px}.hero.first,.hero-min.first,.hero-split.first{margin-top:-28px}body{background:transparent}';
const EMBED_SCRIPT = `<script>(function(){var s=function(){parent.postMessage({rillyEmbed:Math.ceil(document.body.getBoundingClientRect().height)},'*')};addEventListener('load',s);new ResizeObserver(s).observe(document.body);document.querySelectorAll('a[href^="http"]').forEach(function(a){if(a.host!==location.host)a.target='_top'})})()</script>`;
const HTML_RESIZE = `<script>addEventListener('message',function(e){var d=e.data;if(!d||d.rillyHtml===undefined)return;var f=document.querySelector('iframe[data-html="'+d.rillyHtml+'"]');if(f&&e.source===f.contentWindow)f.style.height=Math.min(Math.max(20,d.h),20000)+'px'})</script>`;

function renderPage({ title, blocks, settings = {}, nextUrl = '#', noUrl = '#', formAction = '#', buyAction = '#', products = {}, preview = false, oneClick = null, site = null, pageHref = (slug) => `#${slug}`, testimonials = {}, business = '', code = {}, ownDomain = false, embed = false, url = '', logo = '', coupons = false, course = null }) {
  const bg = color(settings.background, '#ffffff');
  const fg = color(settings.textColor, '#1f2937');
  const accent = color(settings.accent, '#4f46e5');
  const width = Math.min(Math.max(Number(settings.width) || 720, 360), 1200);
  const ctx = { nextUrl, noUrl, formAction, buyAction, products, preview, accent, background: bg, oneClick, pageHref, testimonials, business, coupons };
  // Websites get a menu across the top and a footer.
  // A course shows its own menu (lessons and progress) instead of the site menu.
  const logoImg = logo && /^(https?:\/\/|\/u\/)/.test(logo) ? `<img class="site-logo" src="${esc(logo)}" alt="${esc(business || site?.name || '')}">` : '';
  // Pages without a site menu show the logo small at the top.
  const logoBar = logoImg && !site && !embed && !course ? `<div class="logo-bar">${logoImg}</div>` : '';
  const nav = site && !course ? `<header class="site"><div class="in"><a class="brand" href="${esc(site.home)}">${logoImg}<span>${esc(site.name)}</span></a>
    <input type="checkbox" id="mnu" hidden><label for="mnu" class="burger" aria-label="Menu">☰</label>
    <nav>${site.links.map((l) => `<a href="${esc(l.href)}"${l.active ? ' aria-current="page"' : ''}>${esc(l.label)}</a>`).join('')}</nav></div></header>` : '';
  const foot = site ? `<footer class="site"><div class="in"><b>${esc(site.name)}</b><nav>${(course ? [] : site.links).map((l) => `<a href="${esc(l.href)}">${esc(l.label)}</a>`).join('')}</nav>
    <small>© ${new Date().getFullYear()} ${esc(site.name)}</small></div></footer>` : '';
  const list = blocks || [];
  // The page's deep colour (dark bands, notice bar): the banner's colour when there is one.
  const heroBg = list.find((b) => b.type === 'hero' && /^#[0-9a-f]{6}$/i.test(b.background || ''))?.background;
  const deep = heroBg || `color-mix(in srgb,${accent} 62%,#0a0d12)`;
  const wrap = (i, html) => (preview ? `<div data-bi="${i}">${html}</div>` : html);
  const parts = [];
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    // A cover banner can hold the sign-up form that follows it.
    if (b.type === 'hero' && b.style === 'cover' && b.formHere && list[i + 1]?.type === 'form') {
      ctx.coverForm = renderBlock(list[i + 1], ctx, i + 1);
      parts.push({ band: '', html: wrap(i, renderBlock(b, ctx, i)) + (preview ? `<div data-bi="${i + 1}" hidden></div>` : '') });
      ctx.coverForm = ''; i++; continue;
    }
    const band = ['soft', 'dark', 'brand'].includes(b.band) && !['hero', 'notice'].includes(b.type) ? b.band : '';
    const html = renderBlock(b, ctx, i);
    if (!html && !preview) continue; // nothing to show (e.g. reviews before any are approved): no empty band
    parts.push({ band, html: wrap(i, html) });
  }
  // Neighbouring blocks on the same background share one full-width band.
  const groups = [];
  for (const p of parts) { const g = groups.at(-1); if (p.band && g?.band === p.band) g.html.push(p.html); else groups.push({ band: p.band, html: [p.html] }); }
  const body = groups.map((g, k) => (g.band ? `<section class="band band-${g.band}${k === 0 ? ' first' : ''}${k === groups.length - 1 ? ' last' : ''}"><div class="band-in">${g.html.join('\n')}</div></section>` : g.html.join('\n'))).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(settings.seoTitle || title)}</title>
${settings.seoDescription ? `<meta name="description" content="${esc(settings.seoDescription)}">` : ''}
${preview ? '' : seoHead({ title: settings.seoTitle || title, description: settings.seoDescription || settings.seoSummary || '', url, business, blocks: blocks || [], logo, embed })}
<style>
*{box-sizing:border-box}:root{--bg:${bg};--fg:${fg};--accent:${accent};--deep:${deep};--w:${width}px}body{margin:0;background:${bg};color:${fg};font:17px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:${width}px;margin:0 auto;padding:48px 20px}
h1{font-size:clamp(1.8rem,4.5vw,2.4rem);line-height:1.15;margin:.4em 0}h1,h2,h3,p{overflow-wrap:break-word;text-wrap:balance}
/* Breathing room: every block sits at least 28px from the next. */
main>*+*{margin-top:28px}main>*:last-child{margin-bottom:8px}.hero:not(.first){margin-top:48px}h2{font-size:1.8rem;line-height:1.2;margin:.5em 0}h3{font-size:1.3rem;margin:.5em 0}
.txt{margin:.8em 0}img{max-width:100%;height:auto;border-radius:10px}
.btn{display:inline-block;background:${accent};color:#fff;border:0;padding:15px 30px;border-radius:10px;font:600 1.05rem system-ui,sans-serif;text-decoration:none;cursor:pointer}
.btn:hover{filter:brightness(1.1)}
.optin{display:flex;flex-direction:column;gap:10px;max-width:440px;margin:20px auto}
.optin input{padding:14px 16px;border:1px solid #d1d5db;border-radius:10px;font-size:1rem}
.optin .btn{width:100%}.hp{position:absolute;left:-9999px}
.video{position:relative;padding-top:56.25%;margin:20px 0}.video iframe{position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:10px}
hr{border:0;border-top:1px solid rgba(0,0,0,.12);margin:28px 0}
body{overflow-x:hidden}
.hero{position:relative;margin:0 calc(50% - 50vw) 40px;padding:64px 24px 110px;text-align:center}
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
.consent{display:flex;gap:8px;align-items:flex-start;text-align:left;font-size:.8rem;opacity:.85;margin:4px 0 10px}.consent input{width:auto;margin-top:3px}.testimonial{margin:28px auto;max-width:560px;text-align:center}.testimonial img{width:64px;height:64px;border-radius:50%;object-fit:cover}.testimonial blockquote{font-size:1.15rem;font-style:italic;margin:10px 0}.testimonial figcaption{font-weight:600}.testimonial figcaption span{font-weight:400;opacity:.7}.pimg{width:100%;max-height:320px;object-fit:cover;border-radius:10px;margin-bottom:14px}.bump{display:flex;gap:10px;align-items:flex-start;text-align:left;border:2px dashed #f59e0b;background:#fffbeb;border-radius:8px;padding:12px;margin:0 0 14px;cursor:pointer;font-size:.95rem}.bump input{margin-top:4px;width:18px;height:18px}.pemail{display:block;width:100%;margin:0 0 12px;padding:14px 16px;border:1px solid #d1d5db;border-radius:8px;font:inherit}.pricing form{margin:0}.plans{display:grid;gap:8px;margin:0 0 14px;text-align:left}.plans label{display:flex;gap:10px;align-items:center;border:1px solid #d1d5db;border-radius:8px;padding:12px 14px;cursor:pointer}.plans label:has(input:checked){border-color:currentColor;box-shadow:0 0 0 1px currentColor}.plans input{width:18px;height:18px;margin:0}.pcode{text-align:left;margin:0 0 14px;font-size:.95rem}.pcode summary{cursor:pointer;opacity:.8}.pcode-row{display:flex;gap:8px;margin-top:8px}.pcode-row input{flex:1;min-width:0;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font:inherit;text-transform:uppercase}.pcode-row input::placeholder{text-transform:none}.pcode-go{padding:10px 16px;border:1px solid #d1d5db;background:#f9fafb;border-radius:8px;font:inherit;cursor:pointer}.pcode-msg{font-size:.88rem;margin-top:6px}.pcode-msg.ok{color:#15803d}.pcode-msg.bad{color:#b91c1c}.cta{display:block;width:100%;font-size:1.6rem;padding:16px 20px;border-radius:6px;font-weight:700}
.cta small{display:block;font-size:.8rem;font-weight:400;margin-top:6px;opacity:.95}
.warn{color:#b45309;font-size:.85rem}.oneclick{font-size:.85rem;opacity:.75;margin:10px 0 0}
@media(max-width:560px){.features{grid-template-columns:1fr}.price{font-size:4.2rem}.cta{font-size:1.25rem}}
header.site{position:sticky;top:0;z-index:5;background:color-mix(in srgb,${bg} 92%,transparent);backdrop-filter:blur(8px);border-bottom:1px solid color-mix(in srgb,${fg} 10%,transparent)}
header.site .in,footer.site .in{max-width:${width}px;margin:0 auto;padding:14px 20px;display:flex;align-items:center;gap:20px;flex-wrap:wrap}
header.site .brand{font-weight:800;font-size:1.15rem;color:${fg};text-decoration:none;margin-right:auto;display:inline-flex;align-items:center;gap:10px}
header.site .site-logo{height:36px;width:auto;max-width:160px;object-fit:contain}
.logo-bar{text-align:center;padding:18px 16px;background:${bg}}.logo-bar .site-logo{height:72px;width:auto;max-width:300px;object-fit:contain}@media(max-width:600px){.logo-bar .site-logo{height:56px}}
header.site nav{display:flex;gap:18px;flex-wrap:wrap}header.site nav a,footer.site nav a{color:${fg};text-decoration:none;opacity:.8;font-weight:500}
header.site nav a[aria-current]{opacity:1;color:${accent};border-bottom:2px solid ${accent}}
.burger{display:none;cursor:pointer;font-size:1.4rem}
footer.site{border-top:1px solid color-mix(in srgb,${fg} 10%,transparent);margin-top:40px;font-size:.9rem}footer.site nav{display:flex;gap:14px;flex-wrap:wrap;margin-right:auto}footer.site small{opacity:.6}
.bul-wrap{margin:22px 0}.bul-t{margin:0 0 10px;font-size:1.15rem}
.bul{list-style:none;padding:0;margin:0 auto;display:inline-grid;gap:10px;text-align:left;max-width:100%}
.bul li{display:flex;gap:10px;align-items:flex-start;line-height:1.5}
.bul .tick,.offer .tick{flex:none;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;background:color-mix(in srgb,${accent} 14%,${bg});color:${accent};margin-top:1px}
.bul.dot{list-style:disc;padding-left:1.3em;display:block}.bul.dot li{display:list-item}
.bul.number{list-style:decimal;padding-left:1.4em;display:block}.bul.number li{display:list-item;padding-left:4px}
.offer{max-width:560px;margin:28px auto;border:2px solid color-mix(in srgb,${accent} 35%,transparent);border-radius:16px;padding:22px 24px;background:color-mix(in srgb,${accent} 3%,${bg});text-align:left}
.offer-t{margin:0 0 14px;font-size:1.25rem;text-align:center}
.offer-rows{list-style:none;padding:0;margin:0}
.offer-rows li{display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-bottom:1px dashed color-mix(in srgb,${fg} 15%,transparent)}
.offer-rows .o-name{flex:1;font-weight:500}.offer-rows .o-val{white-space:nowrap;opacity:.75}
.offer-total{display:flex;justify-content:space-between;padding:12px 0 4px;opacity:.8}
.offer-price{display:flex;justify-content:space-between;align-items:baseline;padding:4px 0 14px;font-size:1.1rem}
.offer-price b{font-size:1.8rem;color:${accent}}
.offer-btn{display:block;text-align:center}
.offer-note{text-align:center;font-size:.85rem;opacity:.7;margin:10px 0 0}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin:28px 0}
.cards .card{border:1px solid color-mix(in srgb,${fg} 12%,transparent);border-radius:12px;padding:18px 20px;background:color-mix(in srgb,${accent} 4%,${bg})}
.cards h3{margin:0 0 6px;font-size:1.1rem}.cards p{margin:0;opacity:.8}
.cards.numbered{counter-reset:step}.cards.numbered .card::before{counter-increment:step;content:counter(step);display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:${accent};color:#fff;font:700 .9rem system-ui,sans-serif;margin-bottom:10px}
/* Forms, booking and offers sit on a clean card. */
.optin,.booking{background:color-mix(in srgb,#fff 92%,${bg});border:1px solid color-mix(in srgb,${fg} 9%,transparent);border-radius:18px;padding:26px 24px;box-shadow:0 18px 40px -22px color-mix(in srgb,${fg} 35%,transparent)}
.optin{max-width:480px}
.optin input,.optin textarea,.bk-form input,.bk-form textarea{width:100%;padding:14px 16px;border:1px solid color-mix(in srgb,${fg} 18%,transparent);border-radius:10px;font:inherit;font-size:1rem;background:#fff;color:#1f2328}
.optin input:focus,.optin textarea:focus,.bk-form input:focus,.bk-form textarea:focus{outline:2px solid color-mix(in srgb,${accent} 45%,transparent);border-color:${accent}}
.optin textarea{resize:vertical;min-height:110px}
.booking{max-width:760px;margin-left:auto;margin-right:auto}
.pricing{border-radius:18px;border:1px solid color-mix(in srgb,${fg} 10%,transparent);box-shadow:0 22px 50px -26px color-mix(in srgb,${fg} 40%,transparent);border-top:5px solid ${accent}}
.info{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:24px 0;padding:18px;border-radius:12px;background:color-mix(in srgb,${accent} 6%,${bg})}
.info>div{display:grid;grid-template-columns:auto 1fr;gap:2px 8px;align-items:start}.info>div>div{grid-column:2}.info a{color:${accent}}
@media(max-width:640px){.burger{display:block}header.site nav{display:none;width:100%;flex-direction:column;gap:10px;padding-top:6px}#mnu:checked~nav{display:flex}}
${sections.SECTION_CSS}${TYPE_CSS[settings.font] || ''}${embed ? EMBED_STYLE : ''}
.hero-cta{margin-top:26px}.hero .btn.hero-btn{background:var(--hero-fg);color:var(--hero-bg)}
.hero.flat{padding:88px 24px 92px}
.hero-min{text-align:center;padding:40px 0 8px;max-width:820px;margin:0 auto}.hero-min h1{font-size:clamp(2.2rem,5.6vw,3.8rem);line-height:1.06;letter-spacing:-.02em;margin:.15em 0}
.hero-min p{font-size:1.2rem;opacity:.78;max-width:620px;margin:14px auto 0}.hero-min .eyebrow{color:${accent};border-color:currentColor}
.hero-split{display:grid;grid-template-columns:1.05fr 1fr;gap:48px;align-items:center;padding:24px 0}.hero-split h1{font-size:clamp(2rem,4.4vw,3.2rem);line-height:1.08;letter-spacing:-.02em;margin:.15em 0}
.hero-split p{font-size:1.15rem;opacity:.8}.hero-split .eyebrow{color:${accent}}.hs-img img,.hero-ph{width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:18px;display:block}
.hero-ph{background:linear-gradient(135deg,color-mix(in srgb,${accent} 22%,${bg}),color-mix(in srgb,${accent} 8%,${bg}))}
@media(max-width:760px){.hero-split{grid-template-columns:1fr;gap:24px}.hs-img{order:-1}.hs-img img,.hero-ph{aspect-ratio:16/10}}
</style>${code.css ? `<style data-site-css>${cleanCss(code.css)}</style>` : ''}${settings.customCss ? `<style data-page-css>${cleanCss(settings.customCss)}</style>` : ''}
${course ? `<style>:root{--crs-accent:${accent};--crs-bg:${bg};--crs-w:${width}px}${course.css}</style>` : ''}
${preview ? '' : trackingTags(code, ownDomain)}</head><body${course ? ' class="has-crs"' : ''}>${course ? course.nav : ''}${nav}${logoBar}<main>
${course ? course.top : ''}${body || '<p style="text-align:center;opacity:.5">This page is empty. Add blocks in the editor.</p>'}
${course ? course.bottom : ''}</main>${foot}${(blocks || []).some((b) => b.type === 'booking') ? BOOKING_SCRIPT : ''}${(blocks || []).some((b) => b.type === 'video' && !b.controls && youtubeId(b.url)) ? VIDEO_SCRIPT : ''}${(blocks || []).some((b) => b.type === 'html') ? HTML_RESIZE : ''}${embed ? EMBED_SCRIPT : ''}${preview ? PREVIEW_EDIT_SCRIPT + PREVIEW_DROP_SCRIPT + PREVIEW_TOOLS_SCRIPT : ''}</body></html>`;
}

// Click-to-edit in the editor preview: click any text to type over it; the
// change goes to the editor (postMessage), which saves it to the block.
// Drag and drop from the builder's block list: while something is dragged
// over the preview, a line shows where it will land; dropping tells the
// builder the position. Only drags started in the builder are accepted.
const PREVIEW_DROP_SCRIPT = `<style>.ph{border:2px dashed #a9dcd6;border-radius:14px;padding:34px 16px;text-align:center;color:#1F7F78;background:#f3faf9;font:500 14px/1.4 -apple-system,system-ui,sans-serif;margin:8px 0;transition:background .15s,border-color .15s}.ph small{display:block;color:#5b9e97;font-weight:400;margin-top:2px}.ph.ph-over{background:#dff1ee;border-color:#1F7F78}#ff-drop{position:absolute;left:0;right:0;height:4px;background:#4f46e5;border-radius:2px;box-shadow:0 0 0 3px rgba(79,70,229,.25);pointer-events:none;z-index:99999;display:none}</style>
<script>(function(){var line=document.createElement('div');line.id='ff-drop';document.body.appendChild(line);
function has(e,t){return Array.prototype.indexOf.call(e.dataTransfer.types,t)>=0;}function ours(e){return has(e,'text/x-fourfold')||has(e,'Files');}
function spot(y){var bs=document.querySelectorAll('[data-bi]');for(var k=0;k<bs.length;k++){var r=bs[k].getBoundingClientRect();if(y<r.top+r.height/2)return{at:k,top:r.top+scrollY-2};}
var last=bs[bs.length-1],m=document.querySelector('main')||document.body;return{at:bs.length,top:last?last.getBoundingClientRect().bottom+scrollY-2:m.getBoundingClientRect().top+scrollY+24};}
document.addEventListener('dragover',function(e){if(!ours(e))return;e.preventDefault();e.dataTransfer.dropEffect='copy';var s=spot(e.clientY);line.style.top=s.top+'px';line.style.display='block';});
document.addEventListener('dragleave',function(e){if(!e.relatedTarget)line.style.display='none';});
document.addEventListener('dragover',function(e){if(!has(e,'Files'))return;var b=e.target.closest&&e.target.closest('[data-bi]'),ph=b&&b.querySelector('.ph-image');document.querySelectorAll('.ph-over').forEach(function(x){if(x!==ph)x.classList.remove('ph-over');});if(ph){ph.classList.add('ph-over');line.style.display='none';}});
document.addEventListener('drop',function(e){if(!ours(e))return;e.preventDefault();line.style.display='none';var at=spot(e.clientY).at;
if(has(e,'Files')){var f=e.dataTransfer.files[0],b=e.target.closest&&e.target.closest('[data-bi]');if(f)parent.postMessage({ff:'photo',at:at,i:b?+b.dataset.bi:-1,file:f},'*');return;}
parent.postMessage({ff:'drop',at:at,data:e.dataTransfer.getData('text/x-fourfold')},'*');});})();<\/script>`;

// The booking widget: days with open times, then times, then name and email.
// Without a server (the editor preview) it shows sample times and doesn't book.
// The clean video player: loads YouTube only when played, keeps a shield over it so
// YouTube's hover title and pause screen never show, and listens to the player's state.
const VIDEO_SCRIPT = `<style>
.video.clean{background:#0b1416;border-radius:10px;overflow:hidden}
.video.clean iframe{pointer-events:none}
.video.clean .vposter{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transition:opacity .25s}
.video.clean .vshield{position:absolute;inset:0;border:0;padding:0;margin:0;background:rgba(0,0,0,.18);cursor:pointer;display:grid;place-items:center;transition:background .2s}
.video.clean .vplay{width:68px;height:68px;border-radius:50%;background:rgba(255,255,255,.94);color:#14282b;display:grid;place-items:center;box-shadow:0 6px 24px rgba(0,0,0,.25);transition:transform .15s,opacity .2s}
.video.clean .vplay svg{margin-left:4px}
.video.clean .vshield:hover .vplay{transform:scale(1.06)}
.video.clean .vshield:focus-visible{outline:3px solid #7cc8bf;outline-offset:-3px}
.video.clean.playing .vposter{opacity:0}
.video.clean.playing .vshield{background:transparent}
.video.clean.playing .vplay{opacity:0}
.video.clean.paused .vshield{background:rgba(11,20,22,.72)}
.video.clean.ended .vposter{opacity:1}
</style><script>(function(){
var players=[];
function cmd(f,fn){f.contentWindow&&f.contentWindow.postMessage(JSON.stringify({event:'command',func:fn,args:[]}),'*')}
document.querySelectorAll('.video.clean').forEach(function(v){
  var sh=v.querySelector('.vshield'),f=null;
  function state(s){v.classList.remove('playing','paused','ended');if(s)v.classList.add(s);sh.setAttribute('aria-label',s==='playing'?'Pause video':'Play video')}
  sh.addEventListener('click',function(e){
    if(e.detail>1)return;
    if(!f){
      f=document.createElement('iframe');
      f.src='https://www.youtube-nocookie.com/embed/'+v.dataset.yt+'?autoplay=1&controls=0&rel=0&iv_load_policy=3&playsinline=1&disablekb=1&fs=0&enablejsapi=1&origin='+encodeURIComponent(location.origin);
      f.allow='autoplay; encrypted-media; fullscreen';f.title='Video';f.setAttribute('tabindex','-1');
      f.addEventListener('load',function(){f.contentWindow.postMessage(JSON.stringify({event:'listening',id:players.length}),'*')});
      v.insertBefore(f,v.firstChild);players.push({f:f,set:state});state('playing');return;
    }
    if(v.classList.contains('playing')){cmd(f,'pauseVideo');state('paused')}else{if(v.classList.contains('ended'))cmd(f,'seekTo');cmd(f,'playVideo');state('playing')}
  });
  sh.addEventListener('dblclick',function(){var el=v;(el.requestFullscreen||el.webkitRequestFullscreen||function(){}).call(el)});
});
addEventListener('message',function(e){
  if(!/youtube/.test(e.origin))return;var d;try{d=JSON.parse(e.data)}catch(x){return}
  var s=d&&d.info&&d.info.playerState;if(s===undefined)return;
  players.forEach(function(p){if(p.f.contentWindow===e.source){p.set(s===1||s===3?'playing':s===2?'paused':s===0?'ended':null)}});
});
})();</script>`;

const BOOKING_SCRIPT = `<style>
.booking{text-align:center}.bk-meta{opacity:.75;margin:0 0 14px}
.bk-days{display:flex;gap:8px;overflow-x:auto;padding:4px 2px 10px;justify-content:flex-start;scroll-snap-type:x proximity}
.bk-days button,.bk-times button{border:1px solid color-mix(in srgb,currentColor 18%,transparent);background:transparent;color:inherit;border-radius:10px;cursor:pointer;font:inherit}
.bk-days button{flex:none;min-width:64px;padding:8px 10px;display:flex;flex-direction:column;align-items:center;scroll-snap-align:start}
.bk-days button small{opacity:.7;font-size:.75rem;text-transform:uppercase;letter-spacing:.04em}.bk-days button b{font-size:1.2rem}
.bk-times{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px;margin:6px 0}
.bk-times button{padding:10px 6px;font-weight:600}
.bk-days button.on,.bk-times button.on,.bk-days button:hover,.bk-times button:hover{border-color:var(--bk-accent);color:var(--bk-accent)}
.bk-days button.on{background:color-mix(in srgb,var(--bk-accent) 10%,transparent)}
.bk-msg,.bk-tz{opacity:.7;font-size:.85rem;grid-column:1/-1}
.bk-form{display:grid;gap:10px;max-width:420px;margin:14px auto 0;text-align:left}.bk-form input,.bk-form textarea{padding:13px 14px;border:1px solid #d1d5db;border-radius:10px;font:inherit}
.bk-form .btn{width:100%}.bk-picked{font-weight:600;text-align:center;margin:0}.bk-err{color:#b91c1c;font-size:.9rem;margin:0}
.bk-done{padding:22px;border-radius:14px;background:color-mix(in srgb,var(--bk-accent) 8%,transparent)}.bk-done h3{margin:0 0 6px}
.bk-price{display:inline-block;margin:0 0 14px;padding:5px 12px;border-radius:99px;font-weight:600;font-size:.9rem;background:color-mix(in srgb,var(--bk-accent) 10%,transparent);color:var(--bk-accent)}
.bk-paynote{font-size:.85rem;opacity:.75;margin:0;text-align:center}
</style><script>(function(){document.querySelectorAll('.booking').forEach(function(el){
var acc=getComputedStyle(document.querySelector('.btn')||el).backgroundColor||'#1F7F78';el.style.setProperty('--bk-accent',acc);
var tz=Intl.DateTimeFormat().resolvedOptions().timeZone,days=el.querySelector('.bk-days'),times=el.querySelector('.bk-times'),form=el.querySelector('.bk-form'),picked=null,byDay={};
var fmtDay=function(d){return d.toLocaleDateString(undefined,{year:'numeric',month:'2-digit',day:'2-digit'})};
var fmtTime=function(d){return d.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})};
var fmtLong=function(d){return d.toLocaleString(undefined,{weekday:'long',month:'long',day:'numeric',hour:'numeric',minute:'2-digit'})};
el.querySelector('.bk-tz').textContent='Times are shown in your time zone ('+tz.replace(/_/g,' ')+').';
var demo=function(){var out=[],n=new Date();for(var i=1;out.length<40&&i<20;i++){var d=new Date(n.getFullYear(),n.getMonth(),n.getDate()+i);if(d.getDay()%6===0)continue;for(var h=9;h<17;h++){var s=new Date(d.getFullYear(),d.getMonth(),d.getDate(),h,0);out.push({start:s.toISOString()});}}return{title:'Sample times (preview)',length:30,slots:out};};
var show=function(data){var meta=el.querySelector('.bk-meta');meta.textContent=[data.title,data.length?data.length+' minutes':'',data.location].filter(Boolean).join(' · ');
 if(el.dataset.pay&&!el.querySelector('.bk-price')){var pr=document.createElement('p');pr.className='bk-price';pr.textContent=el.dataset.pay;meta.after(pr);}
 var code=form.querySelector('.bk-code');if(code&&data.codes)code.hidden=false;
 if(!data.slots.length){times.innerHTML='<p class="bk-msg">No open times right now. Please check back soon.</p>';return;}
 data.slots.forEach(function(s){var d=new Date(s.start),k=fmtDay(d);(byDay[k]=byDay[k]||[]).push(d);});
 Object.keys(byDay).forEach(function(k,i){var d=byDay[k][0],b=document.createElement('button');b.type='button';b.setAttribute('role','tab');
  b.innerHTML='<small></small><b></b><small></small>';b.children[0].textContent=d.toLocaleDateString(undefined,{weekday:'short'});b.children[1].textContent=d.getDate();b.children[2].textContent=d.toLocaleDateString(undefined,{month:'short'});
  b.onclick=function(){days.querySelectorAll('button').forEach(function(x){x.classList.toggle('on',x===b)});pick(k)};days.appendChild(b);if(i===0)b.click();});};
var pick=function(k){times.innerHTML='';form.hidden=true;byDay[k].forEach(function(d){var b=document.createElement('button');b.type='button';b.textContent=fmtTime(d);
 b.onclick=function(){times.querySelectorAll('button').forEach(function(x){x.classList.toggle('on',x===b)});picked=d;form.hidden=false;form.querySelector('.bk-picked').textContent=fmtLong(d);form.querySelector('input[name=name]').focus();};times.appendChild(b);});};
if(el.dataset.slots){fetch(el.dataset.slots,{credentials:'same-origin'}).then(function(r){return r.json()}).then(show).catch(function(){times.innerHTML='<p class="bk-msg">Couldn’t load open times. Please refresh.</p>';});}else show(demo());
form.onsubmit=function(e){e.preventDefault();if(!picked)return;var err=form.querySelector('.bk-err');err.textContent='';
 if(!el.dataset.book){alert('Booking is turned off in the preview. Publish the page to take real bookings.');return;}
 var btn=form.querySelector('button[type=submit]');btn.disabled=true;btn.textContent='Booking…';
 var v={start:picked.toISOString()};new FormData(form).forEach(function(val,key){v[key]=val});
 fetch(el.dataset.book,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(v),credentials:'same-origin'}).then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j}})}).then(function(x){
  if(!x.ok){err.textContent=x.j.error||'Something went wrong. Please try again.';btn.disabled=false;btn.textContent=el.dataset.btn;if(/taken/.test(x.j.error||''))location.reload();return;}
  if(x.j.pay){btn.textContent='Taking you to payment…';location.href=x.j.pay;return;}
  var done=el.querySelector('.bk-done');done.innerHTML='<h3>You’re booked!</h3><p></p><p style="opacity:.75;margin:0">A confirmation is on its way to your inbox.</p>';done.querySelector('p').textContent=fmtLong(new Date(x.j.start));
  done.hidden=false;form.hidden=true;times.hidden=true;days.hidden=true;el.querySelector('.bk-tz').hidden=true;
  if(x.j.next)setTimeout(function(){location.href=x.j.next},2500);}).catch(function(){err.textContent='Couldn’t reach the server. Please try again.';btn.disabled=false;btn.textContent=el.dataset.btn;});};
});})();<\/script>`;

// Block toolbar in the editor preview: on hover (or once selected) each block
// shows Move up, Move down, Duplicate and Delete. Delete/Backspace removes the
// selected block when you're not typing. The builder does the change (and undo).
const PREVIEW_TOOLS_SCRIPT = `<style>
[data-bi]{position:relative}
.ff-tools{position:absolute;top:6px;right:6px;z-index:9999;display:none;gap:2px;padding:3px;background:#14282B;border-radius:9px;box-shadow:0 4px 14px rgba(0,0,0,.18)}
[data-bi]:hover>.ff-tools,[data-bi].ff-sel>.ff-tools{display:flex}
[data-bi].ff-sel{box-shadow:inset 0 0 0 2px #2BA39A}
.ff-tools button{all:unset;cursor:pointer;width:28px;height:28px;display:grid;place-items:center;border-radius:6px;color:#fff}
.ff-tools button:hover{background:rgba(255,255,255,.14)}.ff-tools button.grip{cursor:grab}
#ff-bin{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:99999;display:none;align-items:center;gap:8px;padding:12px 22px;border-radius:99px;background:#fff;color:#b91c1c;border:2px dashed #fca5a5;font:600 14px -apple-system,system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.15)}
#ff-bin svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
#ff-bin.on{display:flex}#ff-bin.over{background:#dc2626;color:#fff;border-color:#dc2626}
[data-bi].ff-dragging{opacity:.35}.ff-tools button.del:hover{background:#dc2626}
.ff-tools svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
</style>
<script>(function(){
var I={grip:'<circle cx="9" cy="6.5" r="1"/><circle cx="15" cy="6.5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="17.5" r="1"/><circle cx="15" cy="17.5" r="1"/>',up:'<path d="m6 15 6-6 6 6"/>',down:'<path d="m6 9 6 6 6-6"/>',dup:'<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>',rm:'<path d="M4.5 7h15M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2M6.5 7l1 12.5h9l1-12.5"/>'};
var L={grip:'Drag to move, or onto the bin to delete',up:'Move up',down:'Move down',dup:'Duplicate',rm:'Delete'};
var sel=-1;
document.querySelectorAll('[data-bi]').forEach(function(b){var t=document.createElement('div');t.className='ff-tools';t.setAttribute('contenteditable','false');
['grip','up','down','dup','rm'].forEach(function(a){var x=document.createElement('button');x.type='button';if(a==='grip'){x.draggable=true;x.className='grip';}x.title=L[a];x.setAttribute('aria-label',L[a]);if(a==='rm')x.className='del';if(a==='grip')x.className='grip';x.dataset.act=a;x.innerHTML='<svg viewBox="0 0 24 24">'+I[a]+'</svg>';t.appendChild(x);});b.appendChild(t);});
document.addEventListener('click',function(e){var x=e.target.closest('.ff-tools button');if(x){e.preventDefault();e.stopPropagation();parent.postMessage({ff:'act',act:x.dataset.act,i:+x.closest('[data-bi]').dataset.bi},'*');return;}
var b=e.target.closest('[data-bi]');document.querySelectorAll('.ff-sel').forEach(function(n){n.classList.remove('ff-sel');});if(b){b.classList.add('ff-sel');sel=+b.dataset.bi;}else sel=-1;},true);
document.addEventListener('keydown',function(e){if(sel<0||e.target.isContentEditable||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;
if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();parent.postMessage({ff:'act',act:'rm',i:sel},'*');}
else if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();parent.postMessage({ff:'undo',redo:e.shiftKey},'*');}});
var bin=document.createElement('div');bin.id='ff-bin';bin.innerHTML='<svg viewBox="0 0 24 24">'+I.rm+'</svg>Drop here to delete';document.body.appendChild(bin);
var dragging=-1;
document.addEventListener('dragstart',function(e){var g=e.target.closest&&e.target.closest('.ff-tools .grip');if(!g)return;var b=g.closest('[data-bi]');dragging=+b.dataset.bi;
e.dataTransfer.setData('text/x-fourfold',JSON.stringify({move:dragging}));e.dataTransfer.setData('text/plain','block');e.dataTransfer.effectAllowed='move';
try{e.dataTransfer.setDragImage(b,24,24);}catch(_){}b.classList.add('ff-dragging');bin.classList.add('on');});
document.addEventListener('dragend',function(){dragging=-1;bin.classList.remove('on','over');document.querySelectorAll('.ff-dragging').forEach(function(n){n.classList.remove('ff-dragging');});});
bin.addEventListener('dragover',function(e){if(dragging<0)return;e.preventDefault();e.stopPropagation();bin.classList.add('over');var l=document.getElementById('ff-drop');if(l)l.style.display='none';});
bin.addEventListener('dragleave',function(){bin.classList.remove('over');});
bin.addEventListener('drop',function(e){if(dragging<0)return;e.preventDefault();e.stopPropagation();parent.postMessage({ff:'act',act:'rm',i:dragging},'*');bin.classList.remove('on','over');});
})();<\/script>`;

const PREVIEW_EDIT_SCRIPT = `<style>[data-f]{outline:1px dashed transparent;outline-offset:3px;cursor:text}[data-f]:hover{outline-color:#818cf8}[data-f][contenteditable]{outline:2px solid #4f46e5}[data-bi]:hover{box-shadow:inset 0 0 0 1px #c7d2fe}</style>
<script>document.addEventListener('click',function(e){var blk=e.target.closest('[data-bi]');var el=e.target.closest('[data-f]');if(e.target.closest('a,button'))e.preventDefault();if(blk)parent.postMessage({ff:'open',i:+blk.dataset.bi},'*');if(!el||el.isContentEditable)return;e.preventDefault();el.contentEditable='true';el.focus();el.oninput=function(){parent.postMessage({ff:'edit',i:+blk.dataset.bi,f:el.dataset.f,v:el.innerText.replace(/^\\u201c|\\u201d$/g,'').trim()},'*');};el.onkeydown=function(k){if(k.key==='Escape'||(k.key==='Enter'&&el.dataset.f!=='text'&&el.dataset.f!=='quote'&&el.dataset.f!=='subtext')){k.preventDefault();el.blur();}};el.onblur=function(){el.removeAttribute('contenteditable');};},true);<\/script>`;

module.exports = { renderPage, esc, formatMoney, trackingTags };
