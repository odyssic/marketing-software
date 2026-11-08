'use strict';

// ---------------- Page builder ----------------
const ALIGN = ['align', 'align', 'Alignment'];
const BLOCKS = {
  hero: { label: 'Hero banner', icon: icon('hero'), defaults: { eyebrow: 'New', text: 'A bold headline for your offer', subtext: '', background: '#0d9488', textColor: '#ffffff', style: 'wave' },
    fields: [['style', 'select', 'Look', ['wave', 'flat', 'minimal', 'split'], 'wave and flat: a coloured band · minimal: big words, no band · split: words beside a photo'],
      ['eyebrow', 'text', 'Small label above'], ['text', 'textarea', 'Headline'], ['subtext', 'textarea', 'Subheadline'],
      ['button', 'text', 'Button (optional)', null, 'e.g. Get the guide'], ['url', 'text', 'Button link', null, '#next = the next page · page:contact · or a full https:// link'],
      ['image', 'photo', 'Photo (for the split look)'], ['imageAlt', 'text', 'Photo description'],
      ['background', 'color', 'Band color'], ['textColor', 'color', 'Text color']] },
  pricing: { label: 'Pricing card', icon: icon('dollar'), defaults: { productId: null, badge: 'LIMITED TIME OFFER', compareText: '', billingText: '', note: '',
    featuresTitle: 'Everything you get:', features: 'Feature one\nFeature two\nFeature three', buttonLabel: 'Get Instant Access Now',
    buttonSubtext: '14-day money-back guarantee', buttonColor: '#ff7849' },
  fields: [['productId', 'product', 'Product sold by this card'], ['badge', 'text', 'Badge'],
    ['compareText', 'text', 'Crossed-out “was” price', null, 'e.g. $190 per year'],
    ['billingText', 'text', 'Text under the price', null, 'Leave empty to use the product’s billing (e.g. one-time payment)'],
    ['note', 'text', 'Highlight line'], ['featuresTitle', 'text', 'Features heading'], ['features', 'textarea', 'Features (one per line)'],
    ['buttonLabel', 'text', 'Button text'], ['buttonSubtext', 'text', 'Small text in button'], ['buttonColor', 'color', 'Button color'],
    ['bumpProductId', 'product', 'Order bump (a one-time add-on ticked at checkout)'], ['bumpLabel', 'text', 'Order bump checkbox text', null, 'e.g. Yes, add the matching coasters'],
    ['askEmail', 'check', 'Ask for their email first (fills in checkout, and sends one reminder if they don’t finish)']] },
  // Only real, approved testimonials (People → Testimonials) can be shown.
  testimonial: { label: 'Testimonial', icon: icon('quote'), defaults: { testimonialId: null }, fields: [['testimonialId', 'testimonial', 'Testimonial from your records']] },
  reviews: { label: 'Reviews', icon: icon('star'), defaults: { limit: 3 }, fields: [['limit', 'number', 'How many to show (newest approved first)']] },
  heading: { label: 'Heading', icon: icon('heading'), defaults: { text: 'Your big headline', size: 'large', align: 'center' },
    fields: [['text', 'textarea', 'Text'], ['size', 'select', 'Size', ['large', 'medium', 'small']], ALIGN] },
  text: { label: 'Text', icon: icon('text'), defaults: { text: 'Write something persuasive here.', align: 'center' },
    fields: [['text', 'textarea', 'Text'], ALIGN] },
  image: { label: 'Image', icon: icon('image'), defaults: { url: '', alt: '', align: 'center' },
    fields: [['url', 'photo', 'Photo'], ['alt', 'text', 'Description (for accessibility)'], ALIGN] },
  video: { label: 'Video', icon: icon('video'), defaults: { url: '' },
    fields: [['url', 'text', 'YouTube link', null, 'e.g. https://youtu.be/…'], ['controls', 'check', 'Show YouTube controls (seek bar, title, logo, more videos)']] },
  button: { label: 'Button', icon: icon('button'), defaults: { label: 'Continue', url: '#next', align: 'center' },
    fields: [['label', 'text', 'Button text'], ['url', 'text', 'Link', null, 'page:contact = another page of this site · #next = this page’s ✓ Yes exit · #no = its ✕ No thanks exit · or a full https:// link'], ALIGN] },
  form: { label: 'Form', icon: icon('form'), defaults: { buttonLabel: 'Get instant access', collectName: true, collectPhone: false, purpose: 'Sign up', tag: 'lead' },
    fields: [['purpose', 'select', 'What happens', ['Sign up', 'Newsletter', 'Inquiry', 'Review'], 'Sign up: a lead. Newsletter: also subscribes them. Inquiry: logs a request you should answer.'],
      ['newsletter', 'text', 'Newsletter name (for Newsletter forms)'],
      ['buttonLabel', 'text', 'Button text'], ['collectName', 'check', 'Ask for first name'], ['collectPhone', 'check', 'Ask for phone number'], ['collectBirthday', 'check', 'Ask for birthday (for birthday follow-ups)'], ['smsOptIn', 'check', 'SMS updates (adds a mobile number and the required text-message consent)'], ['collectMessage', 'check', 'Ask for a message'],
      ['tag', 'text', 'Tag new contacts with', null, 'Use tags to email this group later. Comma-separate for several.'],
      ['deliverUrl', 'file', 'Send them something (optional)'], ['deliverName', 'text', 'What it’s called in the email', null, 'e.g. the free typewriter care guide']] },
  bullets: { label: 'Bullet list', icon: icon('check'), defaults: { title: '', items: 'One clear benefit\nAnother benefit\nA third benefit', style: 'check', align: 'center' },
    fields: [['title', 'text', 'Heading (optional)'], ['items', 'textarea', 'Points (one per line)'], ['style', 'select', 'Style', ['check', 'dot', 'number']], ALIGN] },
  offer: { label: 'Offer stack', icon: icon('bag'), defaults: { title: 'Here’s everything you get', items: 'The full course | $297\nWorkbook and templates | $49\nPrivate community | $99\nBonus: live Q&A replays | $79', priceLabel: 'Today', price: '$49', buttonLabel: 'Get everything', url: '#next', note: '30-day money-back guarantee', showTotal: true },
    fields: [['title', 'text', 'Heading'], ['items', 'textarea', 'What they get (one per line: item | value)', null, 'e.g. Workbook | $49. Leave the value off to skip the total.'],
      ['showTotal', 'check', 'Show the total value'], ['priceLabel', 'text', 'Price label', null, 'e.g. Today, Your price'], ['price', 'text', 'Your price', null, 'e.g. $49'],
      ['buttonLabel', 'text', 'Button text'], ['url', 'text', 'Button link', null, '#next = this page’s ✓ Yes exit · page:slug · or a full https:// link'], ['note', 'text', 'Small print under the button']] },
  cards: { label: 'Cards', icon: icon('cards'), defaults: { items: 'Service one | A short description\nService two | A short description\nService three | A short description' },
    fields: [['items', 'textarea', 'Cards (one per line: Title | description)'], ['numbered', 'check', 'Number them (for steps like 1, 2, 3)']] },
  info: { label: 'Business info', icon: icon('info'), defaults: { hours: 'Mon–Fri 9am–5pm', address: '', phone: '', email: '' },
    fields: [['hours', 'text', 'Hours'], ['address', 'text', 'Address'], ['phone', 'text', 'Phone'], ['email', 'text', 'Email']] },
  booking: { label: 'Booking', icon: icon('calendar'), defaults: { heading: 'Pick a time that suits you', buttonLabel: 'Confirm booking', collectPhone: false, askNote: true, tag: 'booked', payment: 'Free', price: '', deposit: '', currency: 'usd' },
    fields: [['heading', 'text', 'Heading'], ['buttonLabel', 'text', 'Button text'], ['collectPhone', 'check', 'Ask for a phone number (optional for them)'],
      ['askNote', 'check', 'Let them add a note'], ['tag', 'text', 'Tag people who book', null, 'e.g. booked'],
      ['payment', 'select', 'Payment', ['Free', 'Pay in full', 'Deposit'], 'Pay in full or Deposit: they pay when they book. The time is held 15 minutes while they pay.'],
      ['price', 'text', 'Price of the appointment', null, 'e.g. 80'], ['deposit', 'text', 'Deposit they pay to book (Deposit only)', null, 'e.g. 20. The rest is due at the appointment.'],
      ['currency', 'select', 'Currency', ['usd', 'eur', 'gbp', 'cad', 'aud']]] },
  spacer: { label: 'Spacer', icon: icon('spacer'), defaults: { height: 40 }, fields: [['height', 'number', 'Height (px)']] },
  divider: { label: 'Divider', icon: icon('divider'), defaults: {}, fields: [] },
  html: { label: 'Custom HTML', icon: icon('note'), defaults: { code: '', title: '' },
    fields: [['code', 'code', 'Your HTML', null, 'Embeds, widgets, forms from other tools. Scripts run in a sealed box on the page.'], ['title', 'text', 'What it is (for screen readers)', null, 'e.g. Calendly scheduler']] },
};
const uid = () => Math.random().toString(36).slice(2, 10);

// Colour palettes: one tap restyles the page (background, text, buttons, banners).
// Every button colour keeps white text readable (4.5:1 or better).
const PALETTES = [
  { name: 'Teal', bg: '#ffffff', text: '#14282b', accent: '#1b736d', band: '#0f5f5a' },
  { name: 'Ocean', bg: '#ffffff', text: '#0f172a', accent: '#1d4ed8', band: '#1e3a8a' },
  { name: 'Forest', bg: '#fbfaf5', text: '#1f2a1f', accent: '#2f6b3b', band: '#24502c' },
  { name: 'Sunset', bg: '#fffaf5', text: '#2b1d16', accent: '#c2410c', band: '#9a3412' },
  { name: 'Plum', bg: '#fdfbff', text: '#24142e', accent: '#7e22ce', band: '#581c87' },
  { name: 'Rose', bg: '#fffafa', text: '#2a1517', accent: '#be185d', band: '#9d174d' },
  { name: 'Charcoal', bg: '#ffffff', text: '#111827', accent: '#111827', band: '#1f2937' },
  { name: 'Night', bg: '#0f1720', text: '#e5edf0', accent: '#0f766e', band: '#134e4a' },
];
// A whole palette from one brand colour: buttons in that colour (darkened until
// white text reads well), a deeper band, a near-white background with a hint of
// it, and near-black text with a hint of it.
function paletteFrom(hex, name = 'My brand', hex2 = '') {
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const hexOf = (c) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const onWhite = (c) => 1.05 / (lum(c) + 0.05);
  const readable = (c) => { for (let i = 0; i < 20 && onWhite(c) < 4.6; i++) c = mix(c, [0, 0, 0], 0.08); return c; };
  // Same rules as src/palette.js: with two colours, the darker is the band, the other the buttons.
  let a = rgb(/^#[0-9a-f]{6}$/i.test(hex || '') ? hex : '#1b736d'), band;
  if (/^#[0-9a-f]{6}$/i.test(hex2 || '') && hex2.toLowerCase() !== String(hex).toLowerCase()) {
    let b = rgb(hex2);
    if (lum(b) > lum(a)) [a, b] = [b, a];
    band = readable(b);
  }
  const accent = readable(a);
  band ||= mix(accent, [0, 0, 0], 0.22);
  return { name, bg: hexOf(mix(accent, [255, 255, 255], 0.97)), text: hexOf(mix(band, [8, 10, 12], 0.88)), accent: hexOf(accent), band: hexOf(band) };
}
const allPalettes = () => [...(state.me.account.brand_color ? [paletteFrom(state.me.account.brand_color, 'My brand', state.me.account.brand_color2)] : []), ...PALETTES];
const palButton = (p, on) => `<button type="button" class="pal ${on ? 'on' : ''}" data-pal="${p.name}" title="${p.name}" aria-label="${p.name} palette" aria-pressed="${on}">
        <span style="background:${p.bg}"></span><span style="background:${p.band}"></span><span style="background:${p.accent}"></span><small>${p.name}</small></button>`;
// The palette applied to one page's settings and coloured blocks.
function applyPalette(pal, settings, blocks) {
  Object.assign(settings, { background: pal.bg, textColor: pal.text, accent: pal.accent, palette: pal.name });
  for (const b of blocks || []) {
    if (b.type === 'hero') Object.assign(b, { background: pal.band, textColor: '#ffffff' });
    if (b.type === 'pricing' && b.buttonColor) b.buttonColor = pal.accent;
  }
}

async function viewEditor(stepId) {
  const [step, products, testimonials, savedList] = await Promise.all([api('GET', `/api/steps/${stepId}`), api('GET', '/api/products'), api('GET', '/api/testimonials'), api('GET', '/api/saved-blocks').catch(() => [])]);
  const realTestimonials = testimonials.filter((t) => t.approved);
  // Split test: ?v=b edits version B of this page.
  const editingB = Boolean(step.variant_blocks) && new URLSearchParams(location.hash.split('?')[1] || '').get('v') === 'b';
  const ed = { step, blocks: editingB ? step.variant_blocks : step.blocks,
    settings: { background: '#ffffff', textColor: '#1f2937', accent: '#4f46e5', width: 720, ...(editingB ? step.variant_settings || step.settings : step.settings) }, open: null,
    saved: savedList, savedSync: {} };
  // Saved sections on this page, as last synced (so edits to them can be sent on).
  const savedContent = (b) => { const { id: _i, savedId: _s, ...rest } = b; return JSON.stringify(rest); };
  ed.blocks.forEach((b) => { if (b.savedId) ed.savedSync[b.savedId] = savedContent(b); });
  const link = publicUrl(`/f/${step.funnel.slug}/${step.slug}`);
  app.innerHTML = `<div class="editor">
    <div class="bar"><a class="btn sm" href="#/${step.funnel.kind === 'website' ? 'websites' : 'funnels'}/${step.funnel.id}">← ${esc(step.funnel.name)}</a>
      <div class="title"><input data-name value="${esc(step.name)}" aria-label="Page name"></div>
      ${step.variant_blocks ? `<span class="seg"><a href="#/editor/${step.id}" class="btn sm ${editingB ? '' : 'primary'}">Version A</a><a href="#/editor/${step.id}?v=b" class="btn sm ${editingB ? 'primary' : ''}">Version B</a></span>` : ''}
      <button class="btn sm" data-abtest>${step.variant_blocks ? icon('flask') + ' Test results' : icon('flask') + ' Split test'}</button>
      <span class="saved" data-saved>All changes saved</span>
      <button class="btn sm" data-undo title="Undo (Ctrl+Z)" disabled>${icon('undo')} Undo</button><button class="btn sm" data-redo title="Redo (Ctrl+Shift+Z)" disabled>${icon('redo')} Redo</button>
      <button class="btn sm" data-history title="Earlier versions of this page">${icon('history')} History</button>
      <button class="btn sm" data-device title="Toggle mobile preview">${icon('phone')} Mobile</button>
      <a class="btn sm primary" href="${esc(link)}" target="_blank" rel="noopener" data-live>View live ${icon('external')}</a></div>
    <div class="side">
      <h3>Add a block</h3><div class="palette">${Object.entries(BLOCKS).map(([k, b]) => `<button data-addblock="${k}" draggable="true" title="Click to add at the end, or drag onto the page"><span class="ico">${b.icon}</span>${b.label}</button>`).join('')}</div>
      <div data-savedpal></div>
      <h3>Page content</h3><div data-blocks></div>
      <div class="list-bin" data-bin aria-hidden="true">${icon('trash')} Drop here to delete</div>
      <h3>Page style</h3>
      <div class="pal-row" role="group" aria-label="Colour palettes" data-palrow></div>
      <div class="type-row" role="group" aria-label="Type style">${[['', 'Classic'], ['elegant', 'Elegant'], ['modern', 'Modern']].map(([k, l]) => `<button type="button" class="type-opt t-${k || 'classic'} ${(ed.settings.font || '') === k ? 'on' : ''}" data-font="${k}" aria-pressed="${(ed.settings.font || '') === k}"><b>Aa</b><small>${l}</small></button>`).join('')}</div>
      <button type="button" class="btn sm ghost" data-palall style="margin:-2px 0 10px">${icon('sparkle')} Use this look on every page</button>
      <details class="more-page seo-fold" ${ed.settings.seoTitle ? '' : 'open'}><summary>Search &amp; AI <span class="muted small" data-seostate>${ed.settings.seoTitle && ed.settings.seoDescription ? 'ready' : 'not set yet'}</span></summary>
        <button type="button" class="btn sm primary seo-write" data-seowrite>${icon('sparkle')} Write these for me</button>
        <div class="serp" aria-label="How it may look in Google"><span class="serp-url" data-serpurl></span><span class="serp-title" data-serptitle></span><span class="serp-desc" data-serpdesc></span></div>
        <label class="f">Search title <span class="hint" data-tlen></span><input data-s="seoTitle" maxlength="70" value="${esc(ed.settings.seoTitle || '')}" placeholder="${esc(step.name)}"></label>
        <label class="f">Description <span class="hint" data-dlen></span><textarea data-s="seoDescription" rows="3" maxlength="200">${esc(ed.settings.seoDescription || '')}</textarea></label>
        <label class="f">Page address<input data-slug value="${esc(step.slug)}"></label>
        <p class="hint" data-slughint></p>
        <p class="hint">Shown in Google and AI search, and when the link is shared. Rilly adds the structured data, sitemap and sharing preview for you, and fills in anything missing when you publish.</p>
      </details>
      <details class="more-page"><summary>More page settings</summary>
      <h3 style="margin-top:10px">Your own colours</h3>
      <div class="colors">
        <label class="f">Background<input type="color" data-s="background" value="${esc(ed.settings.background)}"></label>
        <label class="f">Text<input type="color" data-s="textColor" value="${esc(ed.settings.textColor)}"></label>
        <label class="f">Buttons<input type="color" data-s="accent" value="${esc(ed.settings.accent)}"></label></div>
      <label class="f">Content width (px)<input type="number" min="360" max="1200" step="20" data-s="width" value="${esc(ed.settings.width)}"></label>
      <h3>Custom CSS</h3>
      <label class="f">For this page only <span class="hint">for every page: Settings → Website</span><textarea data-s="customCss" rows="6" class="code" spellcheck="false" placeholder=".hero h1 { letter-spacing: -0.02em; }">${esc(ed.settings.customCss || '')}</textarea></label>
      </details>
    </div>
    <div class="stage"><iframe title="Page preview" sandbox="allow-same-origin allow-scripts allow-modals"></iframe></div></div>`;

  const saved = $('[data-saved]');
  let saveTimer, previewTimer;
  const preview = async () => {
    const { html } = await api('POST', '/api/preview', { blocks: ed.blocks, settings: ed.settings, name: $('[data-name]').value });
    $('iframe').srcdoc = html;
  };
  // Undo / redo: snapshots of the page as it changes.
  const undo = { past: [JSON.stringify({ b: ed.blocks, s: ed.settings })], future: [] };
  const syncUndo = () => { $('[data-undo]').disabled = undo.past.length < 2; $('[data-redo]').disabled = !undo.future.length; };
  const remember = () => {
    const snap = JSON.stringify({ b: ed.blocks, s: ed.settings });
    if (snap !== undo.past.at(-1)) { undo.past.push(snap); undo.future = []; if (undo.past.length > 100) undo.past.shift(); }
    syncUndo();
  };
  const travel = (from, to) => {
    if (from === undo.past ? undo.past.length < 2 : !undo.future.length) return;
    if (from === undo.past) undo.future.push(undo.past.pop()); else undo.past.push(undo.future.pop());
    const { b, s } = JSON.parse(undo.past.at(-1));
    ed.blocks = b; ed.settings = s;
    renderBlocks(); changed({}, true); syncUndo();
  };
  // "Deleted · Undo": one click brings it back.
  const undoToast = (msg) => {
    toast(msg);
    const t = $('#toast');
    const b = document.createElement('button');
    b.className = 'toast-undo'; b.textContent = 'Undo';
    b.onclick = () => { travel(undo.past, undo.future); t.className = ''; };
    t.append(' ', b);
  };
  const changed = (extra = {}, fromUndo = false) => {
    if (!fromUndo) setTimeout(remember);
    saved.textContent = 'Saving…';
    // Typing straight into the preview already shows the change; don't reload it under the cursor.
    if (!ed.typing) { clearTimeout(previewTimer); previewTimer = setTimeout(preview, 250); }
    ed.typing = false;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        const r = await api('PUT', `/api/steps/${stepId}`, { name: $('[data-name]').value, blocks: ed.blocks, settings: ed.settings, ...(editingB ? { variant: 'b' } : {}), ...extra });
        for (const b of ed.blocks.filter((x) => x.savedId)) {
          const now = savedContent(b);
          if (ed.savedSync[b.savedId] === now) continue;
          ed.savedSync[b.savedId] = now;
          const u = await api('PUT', `/api/saved-blocks/${b.savedId}`, { block: b });
          const x = ed.saved.find((y) => y.id === b.savedId); if (x) { x.pages = u.pages; x.block = JSON.parse(now); }
        }
        saved.textContent = 'All changes saved';
        if (extra.slug !== undefined) { $('[data-slug]').value = r.slug; $('[data-live]').href = publicUrl(`/f/${step.funnel.slug}/${r.slug}`); }
      } catch (err) { saved.textContent = 'Not saved'; toast(err.message, true); }
    }, 700);
  };

  const fieldHtml = (b, i, [key, kind, label, options, hint]) => {
    const v = b[key] ?? '';
    const attrs = `data-i="${i}" data-k="${key}"`;
    if (kind === 'textarea') return `<label class="f">${label}<textarea ${attrs} rows="3">${esc(v)}</textarea></label>`;
    if (kind === 'code') return `<label class="f">${label}<textarea ${attrs} rows="10" class="code" spellcheck="false" autocapitalize="off">${esc(v)}</textarea></label>`;
    if (kind === 'select') return `<label class="f">${label}<select ${attrs}>${options.map((o) => `<option ${o === v ? 'selected' : ''}>${o}</option>`).join('')}</select></label>`;
    if (kind === 'color') return `<label class="f">${label}<input type="color" ${attrs} value="${esc(v || '#000000')}"></label>`;
    if (kind === 'testimonial') {
      return `<label class="f">${label}${realTestimonials.length ? `<select ${attrs} data-num><option value="">— Pick one —</option>
        ${realTestimonials.map((t) => `<option value="${t.id}" ${t.id === v ? 'selected' : ''}>${esc(t.name)}: “${esc(t.quote.slice(0, 50))}${t.quote.length > 50 ? '…' : ''}”</option>`).join('')}</select>`
        : '<div class="hint" style="margin-top:4px">No approved testimonials yet. Add real ones from a customer’s page in <a href="#/people/testimonials" target="_blank">People → Testimonials</a>, or collect them with a Review form.</div>'}</label>`;
    }
    if (kind === 'product') {
      return `<label class="f">${label}${products.length ? `<select ${attrs} data-num>
        <option value="">${key === 'bumpProductId' ? '— No order bump —' : '— None (button just goes to next page) —'}</option>
        ${products.map((pr) => `<option value="${pr.id}" ${pr.id === v ? 'selected' : ''}>${esc(pr.name)} · ${esc(pr.priceLabel)}</option>`).join('')}</select>`
        : '<div class="hint" style="margin-top:4px">No products yet. <a href="#/products" target="_blank">Create one</a>, then reload this page.</div>'}</label>`;
    }
    if (kind === 'photo') {
      return `<div class="f">${label}<div class="dropzone ${v ? 'has' : ''}" data-photo="${i}" tabindex="0" role="button" aria-label="Upload a photo">
        ${v ? `<img src="${esc(v)}" alt="">` : `<span class="dz-ico">${icon('image')}</span>`}
        <span class="dz-text"><b>${v ? 'Replace photo' : 'Drop a photo here'}</b><span>or click to choose one</span></span>
        <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden data-photofile="${i}"></div>
        <input type="text" ${attrs} value="${esc(v)}" placeholder="…or paste an image link (https://…)" style="margin-top:6px"></div>`;
    }
    // "Ask for email" is on unless switched off, including on older pricing cards.
    if (kind === 'file') {
      // A lead magnet: upload a PDF, or paste a link to a video, a Google Drive file, anything.
      return `<div class="f">${label}<div class="dropzone ${v ? 'has' : ''}" data-filezone="${i}" tabindex="0" role="button" aria-label="Upload a PDF">
        <span class="dz-ico">${icon(v ? 'check' : 'download')}</span>
        <span class="dz-text"><b>${v ? (v.endsWith('.pdf') ? 'PDF ready. Replace it' : 'Link set. Replace with a PDF') : 'Drop a PDF here'}</b><span>emailed the moment they sign up</span></span>
        <input type="file" accept="application/pdf" hidden data-filepick="${i}"></div>
        <input type="url" ${attrs} value="${esc(v)}" placeholder="…or paste a link (video, Google Drive, Dropbox)" style="margin-top:6px"></div>`;
    }
    if (kind === 'check') return `<label class="check"><input type="checkbox" ${attrs} ${(key === 'askEmail' ? b[key] !== false : v) ? 'checked' : ''}>${label}</label>`;
    if (kind === 'align') return `<div class="f">${label}<div class="aligns">${['left', 'center', 'right'].map((a) => `<button type="button" data-align="${i}:${a}" class="${(v || 'center') === a ? 'on' : ''}">${a}</button>`).join('')}</div></div>`;
    return `<label class="f">${label}${hint ? ` <span class="hint">${esc(hint)}</span>` : ''}<input type="${kind}" ${attrs} value="${esc(v)}"></label>`;
  };
  const summary = (b) => esc(String(b.type === 'pricing' ? (products.find((pr) => pr.id === b.productId)?.name || 'no product')
    : b.type === 'image' ? (b.url ? b.alt || 'Photo' : 'no photo yet') : b.text || b.label || b.buttonLabel || b.url || '').slice(0, 40));

  // Saved sections: reusable blocks for this business, listed under Add a block.
  const SAVABLE = (t) => !['form', 'pricing', 'booking'].includes(t);
  const savedName = (sid) => ed.saved.find((x) => x.id === sid)?.name || 'Saved section';
  const renderSavedPal = () => {
    $('[data-savedpal]').innerHTML = ed.saved.length ? `<h3>Saved sections</h3><p class="muted small" style="margin:-4px 0 8px">Change one, and it changes on every page.</p>
      <div class="saved-pal">${ed.saved.map((x) => `<span class="sp-item"><button type="button" data-addsaved="${x.id}" title="Add “${esc(x.name)}” to this page"><span class="ico">${BLOCKS[x.type]?.icon || icon('copy')}</span>${esc(x.name)}<small>${x.pages} page${x.pages === 1 ? '' : 's'}</small></button>
        <button type="button" class="sp-x" data-rmsaved="${x.id}" title="Delete this saved section (pages keep their copy)" aria-label="Delete saved section ${esc(x.name)}">${icon('x')}</button></span>`).join('')}</div>` : '';
  };
  renderSavedPal();
  const renderBlocks = () => {
    $('[data-blocks]').innerHTML = ed.blocks.length ? ed.blocks.map((b, i) => {
      const def = BLOCKS[b.type] || { label: b.type, icon: '?', fields: [] };
      const open = ed.open === b.id;
      const linkNote = b.savedId ? `<div class="saved-note">${icon('link')}<span>Saved section <b>${esc(savedName(b.savedId))}</b>. Changes here update every page that uses it.</span><button type="button" class="btn sm" data-unlink="${i}">Edit just here</button></div>`
        : SAVABLE(b.type) ? `<button type="button" class="btn sm saved-btn" data-saveblock="${i}">${icon('copy')} Save for reuse</button>` : '';
      return `<div class="block ${open ? 'open' : ''} ${b.savedId ? 'linked' : ''}">
        <div class="bh" data-toggle="${b.id}" draggable="true" data-drag="${i}" title="Drag to move"><span>${def.icon}</span><span class="name">${b.savedId ? `<i class="lk" title="Saved section">${icon('link')}</i>` : ''}${def.label} <span>${summary(b)}</span></span>
          <button class="btn" data-up="${i}" ${i === 0 ? 'disabled' : ''} title="Move up">↑</button>
          <button class="btn" data-down="${i}" ${i === ed.blocks.length - 1 ? 'disabled' : ''} title="Move down">↓</button>
          <button class="btn" data-dup="${i}" title="Duplicate">${icon('copy')}</button>
          <button class="btn danger" data-rm="${i}" title="Delete">${icon('x')}</button></div>
        ${open ? `<div class="bb">${b.savedId ? linkNote : ''}${def.fields.length ? def.fields.map((fd) => fieldHtml(b, i, fd)).join('') : '<p class="muted small">No settings for this block.</p>'}${b.savedId ? '' : linkNote}</div>` : ''}
      </div>`;
    }).join('') : '<p class="muted small" data-empty>Your page is empty. Drag a block from above onto the page, or click one to add it.</p>';
  };
  const structural = () => { renderBlocks(); changed(); };
  // Palettes: restyle this page in one tap (Undo works), or every page of the funnel/site.
  // The palette row: your brand first (once picked), the ready-made ones, and "Your colour".
  const renderPalettes = () => {
    $('[data-palrow]').innerHTML = allPalettes().map((p) => palButton(p, ed.settings.palette === p.name)).join('')
      + `<label class="pal pal-own" title="Make a palette from your brand colour"><input type="color" data-brandcolor value="${esc(state.me.account.brand_color || '#1b736d')}" aria-label="Pick your brand colour"><span class="pal-plus">${icon('plus')}</span><small>Your colour</small></label>`;
    $$('[data-pal]').forEach((btn) => { btn.onclick = () => usePalette(allPalettes().find((x) => x.name === btn.dataset.pal)); });
    // One pick: a palette from that colour, saved as this business's brand, on this page now.
    $('[data-brandcolor]').onchange = async (e) => {
      try { await api('PUT', '/api/account/brand', { color: e.target.value }); } catch (err) { toast(err.message, true); return; }
      state.me.account.brand_color = e.target.value.toLowerCase(); state.me.account.brand_color2 = '';
      usePalette(paletteFrom(state.me.account.brand_color));
      toast('Your brand palette is on. “Use this look on every page” spreads it');
    };
  };
  const usePalette = (pal) => {
    applyPalette(pal, ed.settings, ed.blocks);
    for (const k of ['background', 'textColor', 'accent']) { const x = $(`[data-s="${k}"]`); if (x) x.value = ed.settings[k]; }
    renderPalettes();
    structural();
  };
  renderPalettes();
  // Type style: Classic, Elegant (serif headings) or Modern (tight, bold).
  $$('[data-font]').forEach((b) => { b.onclick = () => {
    if (b.dataset.font) ed.settings.font = b.dataset.font; else delete ed.settings.font;
    $$('[data-font]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
    structural();
  }; });
  $('[data-palall]').onclick = async () => {
    const pal = allPalettes().find((x) => x.name === ed.settings.palette) || { name: '', bg: ed.settings.background, text: ed.settings.textColor, accent: ed.settings.accent, band: ed.blocks.find((b) => b.type === 'hero')?.background || ed.settings.accent };
    const f = await api('GET', `/api/funnels/${step.funnel.id}`);
    const others = f.steps.filter((x) => x.id !== step.id);
    if (!others.length) { toast('This is the only page'); return; }
    const before = others.map((x) => ({ id: x.id, settings: JSON.parse(JSON.stringify(x.settings)), blocks: JSON.parse(JSON.stringify(x.blocks)) }));
    for (const x of others) {
      applyPalette(pal, x.settings, x.blocks);
      if (ed.settings.font) x.settings.font = ed.settings.font; else delete x.settings.font;
      if (!pal.name) delete x.settings.palette;
      await api('PUT', `/api/steps/${x.id}`, { name: x.name, blocks: x.blocks, settings: x.settings });
    }
    undoToast(`Colours applied to ${others.length} more page${others.length === 1 ? '' : 's'}`, async () => {
      for (const x of before) await api('PUT', `/api/steps/${x.id}`, { name: f.steps.find((y) => y.id === x.id).name, blocks: x.blocks, settings: x.settings });
      toast('Other pages put back');
    });
  };

  const side = $('.side');
  side.addEventListener('click', (e) => {
    const t = e.target.closest('button, [data-toggle]');
    if (!t) return;
    const d = t.dataset;
    if (d.saveblock) {
      const i = Number(d.saveblock), b = ed.blocks[i];
      modal('Save for reuse', `<p class="muted small">Put it on any page of this business. Change it once, and it changes on every page that uses it.</p>
        <label class="f">Name<input name="name" required maxlength="80" placeholder="e.g. Main header, Sam’s testimonial"></label>`, { submit: 'Save', onSubmit: (v) => api('POST', '/api/saved-blocks', { name: v.name, block: b }) }).then((r) => {
        if (!r) return;
        ed.saved.push(r); b.savedId = r.id; ed.savedSync[r.id] = savedContent(b);
        renderSavedPal(); structural(); toast(`Saved as “${r.name}”. Add it to any page from Saved sections`);
      });
      return;
    }
    if (d.addsaved) {
      const x = ed.saved.find((y) => y.id === Number(d.addsaved));
      if (!ed.blocks.some((y) => y.savedId === x.id)) { x.pages++; setTimeout(renderSavedPal); }
      const b = { ...x.block, id: uid(), savedId: x.id };
      ed.savedSync[x.id] = savedContent(b);
      ed.blocks.push(b); ed.open = b.id; structural();
      $('[data-blocks]').lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    if (d.unlink) {
      const b = ed.blocks[Number(d.unlink)]; delete b.savedId; structural(); toast('This copy is now separate. Edits stay on this page');
      return;
    }
    if (d.rmsaved) {
      const x = ed.saved.find((y) => y.id === Number(d.rmsaved));
      api('DELETE', `/api/saved-blocks/${x.id}`).then(() => {
        ed.saved = ed.saved.filter((y) => y !== x); ed.blocks.forEach((b) => { if (b.savedId === x.id) delete b.savedId; });
        renderSavedPal(); renderBlocks(); toast(`“${x.name}” removed from Saved sections. Pages keep their copy`);
      }).catch((err) => toast(err.message, true));
      return;
    }
    if (d.addblock) {
      const b = { id: uid(), type: d.addblock, ...BLOCKS[d.addblock].defaults };
      ed.blocks.push(b); ed.open = b.id; structural();
      $('[data-blocks]').lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else if (d.up || d.down) {
      const i = Number(d.up ?? d.down), j = d.up ? i - 1 : i + 1;
      [ed.blocks[i], ed.blocks[j]] = [ed.blocks[j], ed.blocks[i]]; structural();
    } else if (d.dup) {
      const i = Number(d.dup);
      const copy = { ...ed.blocks[i], id: uid() };
      ed.blocks.splice(i + 1, 0, copy); ed.open = copy.id; structural();
    } else if (d.rm) {
      const gone = BLOCKS[ed.blocks[Number(d.rm)].type]?.label || 'Block';
      ed.blocks.splice(Number(d.rm), 1); structural();
      undoToast(`${gone} deleted`);
    } else if (d.align) {
      const [i, a] = d.align.split(':');
      ed.blocks[i].align = a; renderBlocks(); changed();
    } else if (d.toggle) {
      ed.open = ed.open === d.toggle ? null : d.toggle; renderBlocks();
    }
  });
  side.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.k) {
      const b = ed.blocks[t.dataset.i];
      b[t.dataset.k] = t.type === 'checkbox' ? t.checked : t.type === 'number' ? Number(t.value)
        : 'num' in t.dataset ? (t.value ? Number(t.value) : null) : t.value;
      const name = t.closest('.block')?.querySelector('.name span');
      if (name) name.innerHTML = summary(b);
      changed();
    } else if (t.dataset.s) {
      if (['background', 'textColor', 'accent'].includes(t.dataset.s)) { delete ed.settings.palette; $$('[data-pal]').forEach((b) => { b.classList.remove('on'); b.setAttribute('aria-pressed', 'false'); }); }
      ed.settings[t.dataset.s] = t.type === 'number' ? Number(t.value) : t.value;
      changed();
    }
  });
  // Drag and drop: blocks from the palette, or rows in Page content, can be
  // dropped onto the preview (it reports the position) or into the list.
  const dropAt = (data, at) => {
    let d; try { d = JSON.parse(data); } catch { return; }
    if (d.add && BLOCKS[d.add]) {
      const b = { id: uid(), type: d.add, ...BLOCKS[d.add].defaults };
      ed.blocks.splice(at, 0, b); ed.open = b.id;
    } else if (Number.isInteger(d.move) && ed.blocks[d.move]) {
      const [b] = ed.blocks.splice(d.move, 1);
      ed.blocks.splice(d.move < at ? at - 1 : at, 0, b);
    } else return;
    structural();
  };
  side.addEventListener('dragstart', (e) => {
    const t = e.target.closest?.('[data-addblock], [data-drag]');
    if (!t) return;
    const data = t.dataset.addblock ? { add: t.dataset.addblock } : { move: Number(t.dataset.drag) };
    e.dataTransfer.setData('text/x-fourfold', JSON.stringify(data));
    e.dataTransfer.setData('text/plain', t.dataset.addblock || 'block');
    e.dataTransfer.effectAllowed = 'copyMove';
    document.body.classList.add('dragging-block');
    if (data.move !== undefined) $('[data-bin]').classList.add('on');
  });
  side.addEventListener('dragend', () => { document.body.classList.remove('dragging-block'); listMark(null); $('[data-bin]').classList.remove('on', 'over'); });
  const bin = $('[data-bin]');
  bin.addEventListener('dragover', (e) => { if (!e.dataTransfer.types.includes('text/x-fourfold')) return; e.preventDefault(); bin.classList.add('over'); });
  bin.addEventListener('dragleave', () => bin.classList.remove('over'));
  bin.addEventListener('drop', (e) => {
    e.preventDefault(); bin.classList.remove('on', 'over'); document.body.classList.remove('dragging-block');
    let d; try { d = JSON.parse(e.dataTransfer.getData('text/x-fourfold')); } catch { return; }
    if (Number.isInteger(d.move) && ed.blocks[d.move]) {
      const gone = BLOCKS[ed.blocks[d.move].type]?.label || 'Block';
      ed.blocks.splice(d.move, 1); structural(); undoToast(`${gone} deleted`);
    }
  });
  const list = $('[data-blocks]');
  const listSpot = (y) => {
    const rows = [...list.querySelectorAll('.block')];
    const k = rows.findIndex((r) => { const b = r.getBoundingClientRect(); return y < b.top + b.height / 2; });
    return k === -1 ? rows.length : k;
  };
  const listMark = (at) => list.querySelectorAll('.block').forEach((r, k, all) => {
    r.classList.toggle('drop-before', at === k);
    r.classList.toggle('drop-after', at === all.length && k === all.length - 1);
  });
  list.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('text/x-fourfold')) return;
    e.preventDefault(); listMark(listSpot(e.clientY));
  });
  list.addEventListener('dragleave', (e) => { if (!list.contains(e.relatedTarget)) listMark(null); });
  list.addEventListener('drop', (e) => {
    if (!e.dataTransfer.types.includes('text/x-fourfold')) return;
    e.preventDefault(); listMark(null); document.body.classList.remove('dragging-block');
    dropAt(e.dataTransfer.getData('text/x-fourfold'), listSpot(e.clientY));
  });
  // Photos: dropped or chosen in the panel, or dropped onto the page preview.
  const putPhoto = async (i, file) => {
    const b = ed.blocks[i];
    if (!b) return;
    saved.textContent = 'Uploading photo…';
    try {
      const url = await uploadImage(file);
      b.url = url;
      if (!b.alt) b.alt = file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim();
      ed.open = b.id; structural();
    } catch (err) { saved.textContent = 'Not saved'; toast(err.message, true); }
  };
  const photoAt = (at, file) => {
    const b = { id: uid(), type: 'image', ...BLOCKS.image.defaults };
    ed.blocks.splice(at, 0, b);
    return putPhoto(at, file);
  };
  side.addEventListener('click', (e) => {
    const z = e.target.closest('[data-photo]');
    if (z && !e.target.closest('input')) side.querySelector(`[data-photofile="${z.dataset.photo}"]`).click();
  });
  side.addEventListener('keydown', (e) => {
    const z = e.target.closest?.('[data-photo]');
    if (z && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); z.click(); }
  });
  side.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.photofile && t.files[0]) putPhoto(Number(t.dataset.photofile), t.files[0]);
  });
  side.addEventListener('dragover', (e) => {
    const z = e.target.closest?.('[data-photo]');
    if (!z || !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault(); e.stopPropagation(); z.classList.add('over');
  });
  side.addEventListener('dragleave', (e) => { e.target.closest?.('[data-photo]')?.classList.remove('over'); });
  side.addEventListener('drop', (e) => {
    const z = e.target.closest?.('[data-photo]');
    if (!z || !e.dataTransfer.files.length) return;
    e.preventDefault(); e.stopPropagation(); z.classList.remove('over');
    putPhoto(Number(z.dataset.photo), e.dataTransfer.files[0]);
  });
  // Lead magnet files (PDF) on forms.
  const putFile = async (i, file) => {
    if (file.type !== 'application/pdf') { toast('Use a PDF, or paste a link instead', true); return; }
    if (file.size > 4 * 1024 * 1024) { toast('That PDF is over 4 MB. Put it on Google Drive or Dropbox and paste the link instead', true); return; }
    saved.textContent = 'Uploading…';
    try {
      const res = await fetch('/api/uploads', { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Upload failed');
      ed.blocks[i].deliverUrl = data.url;
      if (!ed.blocks[i].deliverName) ed.blocks[i].deliverName = `the ${file.name.replace(/\.pdf$/i, '').replace(/[-_]+/g, ' ')}`;
      structural(); toast('PDF ready. It’ll be emailed to everyone who signs up');
    } catch (err) { saved.textContent = 'Not saved'; toast(err.message, true); }
  };
  side.addEventListener('click', (e) => { const z = e.target.closest('[data-filezone]'); if (z && !e.target.closest('input')) side.querySelector(`[data-filepick="${z.dataset.filezone}"]`).click(); });
  side.addEventListener('change', (e) => { const t = e.target; if (t.dataset.filepick && t.files[0]) putFile(Number(t.dataset.filepick), t.files[0]); });
  side.addEventListener('dragover', (e) => { const z = e.target.closest?.('[data-filezone]'); if (z && e.dataTransfer.types.includes('Files')) { e.preventDefault(); z.classList.add('over'); } });
  side.addEventListener('drop', (e) => { const z = e.target.closest?.('[data-filezone]'); if (!z || !e.dataTransfer.files.length) return; e.preventDefault(); e.stopPropagation(); z.classList.remove('over'); putFile(Number(z.dataset.filezone), e.dataTransfer.files[0]); });
  // A picture dropped anywhere else in the editor shouldn't open in the browser tab.
  window.ondragover = (e) => { if ($('.editor') && e.dataTransfer?.types.includes('Files')) e.preventDefault(); };
  window.ondrop = (e) => { if ($('.editor') && e.dataTransfer?.types.includes('Files')) e.preventDefault(); };
  $('[data-slug]').addEventListener('change', (e) => changed({ slug: e.target.value }));
  // Search & AI: a live Google-style preview, length hints, and "Write these for me".
  const serp = () => {
    const t = ed.settings.seoTitle || $('[data-name]').value, d = ed.settings.seoDescription || '';
    $('[data-serptitle]').textContent = t.length > 60 ? `${t.slice(0, 58)}…` : t;
    $('[data-serpdesc]').textContent = d ? (d.length > 158 ? `${d.slice(0, 156)}…` : d) : 'Add a description so search and AI tools know what this page offers.';
    $('[data-serpurl]').textContent = link.replace(/^https?:\/\//, '').replace(/\/[^/]*$/, `/${$('[data-slug]').value}`);
    const len = (n, lo, hi) => `${n} characters${n === 0 ? '' : n < lo ? ' · a little short' : n > hi ? ' · may be cut off' : ' · good'}`;
    $('[data-tlen]').textContent = len((ed.settings.seoTitle || '').length, 30, 60);
    $('[data-dlen]').textContent = len(d.length, 110, 160);
    $('[data-seostate]').textContent = ed.settings.seoTitle && ed.settings.seoDescription ? 'ready' : 'not set yet';
  };
  serp();
  $('.seo-fold').addEventListener('input', serp);
  $('[data-seowrite]').onclick = async (e) => {
    const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Writing…';
    try {
      const g = await api('POST', `/api/steps/${stepId}/seo`);
      ed.settings.seoTitle = g.title; ed.settings.seoDescription = g.description; ed.settings.seoSummary = g.summary;
      $('[data-s="seoTitle"]').value = g.title; $('[data-s="seoDescription"]').value = g.description;
      const hint = $('[data-slughint]');
      if (g.slug && g.slug !== step.slug) {
        if (!g.live) { $('[data-slug]').value = g.slug; changed({ slug: g.slug }); hint.textContent = ''; }
        else hint.innerHTML = `Suggested address: <b>/${esc(g.slug)}</b> <button type="button" class="linkbtn" data-useslug="${esc(g.slug)}">Use it</button> <span class="muted">(this page is live, so old links to it would stop working)</span>`;
      } else changed();
      serp(); toast(g.by === 'ai' ? 'Written for search and AI. Change anything you like' : 'Written from your page’s words. Change anything you like');
    } catch (err) { toast(err.message, true); }
    btn.disabled = false; btn.innerHTML = `${icon('sparkle')} Write these for me`;
  };
  $('.seo-fold').addEventListener('click', (e) => { const b = e.target.closest('[data-useslug]'); if (b) { $('[data-slug]').value = b.dataset.useslug; changed({ slug: b.dataset.useslug }); $('[data-slughint]').textContent = ''; serp(); } });
  $('[data-name]').addEventListener('input', () => changed());
  $('[data-device]').onclick = () => $('.stage').classList.toggle('mobile');

  // Click-to-edit: the preview sends what was typed, or which block was clicked.
  window.onmessage = (e) => {
    const d = e.data;
    if (d?.ff === 'photo' && $('.editor') && d.file) {
      // Onto an image block: fill it. Anywhere else: a new image block there.
      const at = Math.max(0, Math.min(Number(d.at) || 0, ed.blocks.length));
      return ed.blocks[d.i]?.type === 'image' ? putPhoto(d.i, d.file) : photoAt(at, d.file);
    }
    if (d?.ff === 'act' && $('.editor') && ed.blocks[d.i]) {
      const i = d.i;
      if (d.act === 'rm') {
        const gone = BLOCKS[ed.blocks[i].type]?.label || 'Block';
        ed.blocks.splice(i, 1); structural();
        undoToast(`${gone} deleted`);
      } else if (d.act === 'dup') {
        const copy = { ...ed.blocks[i], id: uid() };
        ed.blocks.splice(i + 1, 0, copy); ed.open = copy.id; structural();
      } else if ((d.act === 'up' && i > 0) || (d.act === 'down' && i < ed.blocks.length - 1)) {
        const j = d.act === 'up' ? i - 1 : i + 1;
        [ed.blocks[i], ed.blocks[j]] = [ed.blocks[j], ed.blocks[i]]; structural();
      }
      return;
    }
    if (d?.ff === 'undo' && $('.editor')) return d.redo ? travel(undo.future, undo.past) : travel(undo.past, undo.future);
    if (d?.ff === 'drop' && $('.editor')) { document.body.classList.remove('dragging-block'); return dropAt(d.data, Math.max(0, Math.min(Number(d.at) || 0, ed.blocks.length))); }
    if (!d?.ff || !$('.editor') || !ed.blocks[d.i]) return;
    if (d.ff === 'open' && ed.open !== ed.blocks[d.i].id) { ed.open = ed.blocks[d.i].id; renderBlocks(); }
    if (d.ff === 'edit') {
      ed.blocks[d.i][d.f] = d.v;
      const input = $(`[data-i="${d.i}"][data-k="${d.f}"]`);
      if (input) input.value = d.v;
      ed.typing = true;
      changed();
    }
  };
  $('[data-abtest]').onclick = async () => {
    if (!step.variant_blocks) {
      const r = await modal('Start a split test', `<p class="muted small">Half your visitors see version A (this page), half see version B. After ${'enough'} visitors on each, the one that gets more signups or sales is marked the winner and everyone sees it.</p>
        <label class="check"><input type="radio" name="mode" value="suggestion" checked> Start B with the suggested fix for this kind of page</label>
        <label class="check"><input type="radio" name="mode" value="copy"> Start B as a copy, then change it myself</label>`, { submit: 'Start test', onSubmit: (v) => api('POST', `/api/steps/${stepId}/variant`, { mode: v.mode }) });
      if (r) { toast('Test started. You’re now editing version B'); location.hash = `#/editor/${stepId}?v=b`; }
      return;
    }
    const t = await api('GET', `/api/steps/${stepId}/test`);
    const pending = modal(t.winner ? `Version ${t.winner.toUpperCase()} won` : 'Split test running', `
      <div class="li"><span><b>Version A</b><br><span class="muted small">${esc(t.a.plain)}</span></span>${t.winner === 'a' ? '<span class="pill ok">winner</span>' : ''}</div>
      <div class="li"><span><b>Version B</b><br><span class="muted small">${esc(t.b.plain)}</span></span>${t.winner === 'b' ? '<span class="pill ok">winner</span>' : ''}</div>
      <p class="hint">${t.winner ? 'Everyone now sees the winner. Keep B to make it the page, or end the test to keep A.' : `A winner is picked once each version has ${t.min_visits} visitors.`}</p>
      <div class="row"><button type="button" class="btn sm primary" data-keepb>Keep B as the page</button><button type="button" class="btn sm" data-endtest>End test, keep A</button></div>`, { submit: 'Close' });
    $('[data-keepb]').onclick = async () => { await api('POST', `/api/steps/${stepId}/variant/promote`); $('.modal-bg [data-x]').click(); toast('Version B is now the page'); location.hash = `#/editor/${stepId}`; viewEditor(stepId); };
    $('[data-endtest]').onclick = async () => { await api('DELETE', `/api/steps/${stepId}/variant`); $('.modal-bg [data-x]').click(); toast('Test ended'); location.hash = `#/editor/${stepId}`; viewEditor(stepId); };
    await pending;
  };
  // Opened from the dashboard's New, then Split test: show the setup straight away.
  if (!step.variant_blocks && new URLSearchParams(location.hash.split('?')[1] || '').get('abtest')) {
    history.replaceState(history.state, '', `#/editor/${stepId}`);
    $('[data-abtest]').click();
  }
  $('[data-undo]').onclick = () => travel(undo.past, undo.future);
  $('[data-redo]').onclick = () => travel(undo.future, undo.past);
  document.onkeydown = (e) => {
    if (!$('.editor') || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z' || e.target.closest('input, textarea')) return;
    e.preventDefault(); e.shiftKey ? travel(undo.future, undo.past) : travel(undo.past, undo.future);
  };
  $('[data-history]').onclick = async () => {
    const versions = await api('GET', `/api/steps/${stepId}/versions`);
    const label = { autosave: 'Saved while editing', published: 'Published', 'before restore': 'Before a restore' };
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal"><h2>Earlier versions</h2>
      ${versions.length ? versions.map((v) => `<div class="li"><span>${esc(label[v.reason] || v.reason)}<br><span class="muted small">${new Date(v.created_at).toLocaleString()}</span></span>
        <button class="btn sm" data-restore="${v.id}">Restore</button></div>`).join('') : '<p class="muted">No earlier versions yet. One is kept every few minutes while you edit, and every time you publish.</p>'}
      <p class="hint">Restoring keeps the current page as a version too, so you can always go back.</p>
      <div class="actions"><button class="btn" data-x>Close</button></div></div>`;
    document.body.append(bg);
    $('[data-x]', bg).onclick = () => bg.remove();
    $$('[data-restore]', bg).forEach((b) => { b.onclick = async () => { await api('POST', `/api/steps/${stepId}/versions/${b.dataset.restore}/restore`); bg.remove(); toast('Version restored'); viewEditor(stepId); }; });
  };
  renderBlocks();
  preview();
}
