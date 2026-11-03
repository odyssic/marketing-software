'use strict';

// ---------------- Page builder ----------------
const ALIGN = ['align', 'align', 'Alignment'];
const BLOCKS = {
  hero: { label: 'Hero banner', icon: '▀', defaults: { eyebrow: 'New', text: 'A bold headline for your offer', subtext: '', background: '#0d9488', textColor: '#ffffff' },
    fields: [['eyebrow', 'text', 'Small label above'], ['text', 'textarea', 'Headline'], ['subtext', 'textarea', 'Subheadline'],
      ['background', 'color', 'Band color'], ['textColor', 'color', 'Text color']] },
  pricing: { label: 'Pricing card', icon: '$', defaults: { productId: null, badge: 'LIMITED TIME OFFER', compareText: '', billingText: '', note: '',
    featuresTitle: 'Everything you get:', features: 'Feature one\nFeature two\nFeature three', buttonLabel: 'Get Instant Access Now',
    buttonSubtext: '14-day money-back guarantee', buttonColor: '#ff7849' },
  fields: [['productId', 'product', 'Product sold by this card'], ['badge', 'text', 'Badge'],
    ['compareText', 'text', 'Crossed-out “was” price', null, 'e.g. $190 per year'],
    ['billingText', 'text', 'Text under the price', null, 'Leave empty to use the product’s billing (e.g. one-time payment)'],
    ['note', 'text', 'Highlight line'], ['featuresTitle', 'text', 'Features heading'], ['features', 'textarea', 'Features (one per line)'],
    ['buttonLabel', 'text', 'Button text'], ['buttonSubtext', 'text', 'Small text in button'], ['buttonColor', 'color', 'Button color'],
    ['bumpProductId', 'product', 'Order bump (a one-time add-on ticked at checkout)'], ['bumpLabel', 'text', 'Order bump checkbox text', null, 'e.g. Yes, add the matching coasters']] },
  // Only real, approved testimonials (People → Testimonials) can be shown.
  testimonial: { label: 'Testimonial', icon: '❝', defaults: { testimonialId: null }, fields: [['testimonialId', 'testimonial', 'Testimonial from your records']] },
  reviews: { label: 'Reviews', icon: '★', defaults: { limit: 3 }, fields: [['limit', 'number', 'How many to show (newest approved first)']] },
  heading: { label: 'Heading', icon: 'H', defaults: { text: 'Your big headline', size: 'large', align: 'center' },
    fields: [['text', 'textarea', 'Text'], ['size', 'select', 'Size', ['large', 'medium', 'small']], ALIGN] },
  text: { label: 'Text', icon: '¶', defaults: { text: 'Write something persuasive here.', align: 'center' },
    fields: [['text', 'textarea', 'Text'], ALIGN] },
  image: { label: 'Image', icon: '🖼', defaults: { url: '', alt: '', align: 'center' },
    fields: [['url', 'text', 'Image URL', null, 'Paste a link to an image (https://…)'], ['alt', 'text', 'Description (for accessibility)'], ALIGN] },
  video: { label: 'Video', icon: '▶', defaults: { url: '' },
    fields: [['url', 'text', 'YouTube link', null, 'e.g. https://youtu.be/…']] },
  button: { label: 'Button', icon: '⬭', defaults: { label: 'Continue', url: '#next', align: 'center' },
    fields: [['label', 'text', 'Button text'], ['url', 'text', 'Link', null, 'page:contact = another page of this site · #next = this page’s ✓ Yes exit · #no = its ✕ No thanks exit · or a full https:// link'], ALIGN] },
  form: { label: 'Form', icon: '✉', defaults: { buttonLabel: 'Get instant access', collectName: true, collectPhone: false, purpose: 'Sign up', tag: 'lead' },
    fields: [['purpose', 'select', 'What happens', ['Sign up', 'Newsletter', 'Inquiry', 'Review'], 'Sign up: a lead. Newsletter: also subscribes them. Inquiry: logs a request you should answer.'],
      ['newsletter', 'text', 'Newsletter name (for Newsletter forms)'],
      ['buttonLabel', 'text', 'Button text'], ['collectName', 'check', 'Ask for first name'], ['collectPhone', 'check', 'Ask for phone number'], ['smsOptIn', 'check', 'SMS updates (adds a mobile number and the required text-message consent)'], ['collectMessage', 'check', 'Ask for a message'],
      ['tag', 'text', 'Tag new contacts with', null, 'Use tags to email this group later. Comma-separate for several.']] },
  cards: { label: 'Cards', icon: '▦', defaults: { items: 'Service one | A short description\nService two | A short description\nService three | A short description' },
    fields: [['items', 'textarea', 'Cards (one per line: Title | description)']] },
  info: { label: 'Business info', icon: 'ℹ', defaults: { hours: 'Mon–Fri 9am–5pm', address: '', phone: '', email: '' },
    fields: [['hours', 'text', 'Hours'], ['address', 'text', 'Address'], ['phone', 'text', 'Phone'], ['email', 'text', 'Email']] },
  spacer: { label: 'Spacer', icon: '↕', defaults: { height: 40 }, fields: [['height', 'number', 'Height (px)']] },
  divider: { label: 'Divider', icon: '—', defaults: {}, fields: [] },
};
const uid = () => Math.random().toString(36).slice(2, 10);

async function viewEditor(stepId) {
  const [step, products, testimonials] = await Promise.all([api('GET', `/api/steps/${stepId}`), api('GET', '/api/products'), api('GET', '/api/testimonials')]);
  const realTestimonials = testimonials.filter((t) => t.approved);
  // Split test: ?v=b edits version B of this page.
  const editingB = Boolean(step.variant_blocks) && new URLSearchParams(location.hash.split('?')[1] || '').get('v') === 'b';
  const ed = { step, blocks: editingB ? step.variant_blocks : step.blocks,
    settings: { background: '#ffffff', textColor: '#1f2937', accent: '#4f46e5', width: 720, ...(editingB ? step.variant_settings || step.settings : step.settings) }, open: null };
  const link = publicUrl(`/f/${step.funnel.slug}/${step.slug}`);
  app.innerHTML = `<div class="editor">
    <div class="bar"><a class="btn sm" href="#/${step.funnel.kind === 'website' ? 'websites' : 'funnels'}/${step.funnel.id}">← ${esc(step.funnel.name)}</a>
      <div class="title"><input data-name value="${esc(step.name)}" aria-label="Page name"></div>
      ${step.variant_blocks ? `<span class="seg"><a href="#/editor/${step.id}" class="btn sm ${editingB ? '' : 'primary'}">Version A</a><a href="#/editor/${step.id}?v=b" class="btn sm ${editingB ? 'primary' : ''}">Version B</a></span>` : ''}
      <button class="btn sm" data-abtest>${step.variant_blocks ? '🧪 Test results' : '🧪 Split test'}</button>
      <span class="saved" data-saved>All changes saved</span>
      <button class="btn sm" data-undo title="Undo (Ctrl+Z)" disabled>↶ Undo</button><button class="btn sm" data-redo title="Redo (Ctrl+Shift+Z)" disabled>↷ Redo</button>
      <button class="btn sm" data-history title="Earlier versions of this page">🕘 History</button>
      <button class="btn sm" data-device title="Toggle mobile preview">📱 Mobile</button>
      <a class="btn sm primary" href="${esc(link)}" target="_blank" rel="noopener" data-live>View live ↗</a></div>
    <div class="side">
      <h3>Add a block</h3><div class="palette">${Object.entries(BLOCKS).map(([k, b]) => `<button data-addblock="${k}" draggable="true" title="Click to add at the end, or drag onto the page"><span class="ico">${b.icon}</span>${b.label}</button>`).join('')}</div>
      <h3>Page content</h3><div data-blocks></div>
      <h3>Page style</h3>
      <div class="colors">
        <label class="f">Background<input type="color" data-s="background" value="${esc(ed.settings.background)}"></label>
        <label class="f">Text<input type="color" data-s="textColor" value="${esc(ed.settings.textColor)}"></label>
        <label class="f">Buttons<input type="color" data-s="accent" value="${esc(ed.settings.accent)}"></label></div>
      <label class="f">Content width (px)<input type="number" min="360" max="1200" step="20" data-s="width" value="${esc(ed.settings.width)}"></label>
      <h3>SEO &amp; sharing</h3>
      <label class="f">Browser tab title<input data-s="seoTitle" value="${esc(ed.settings.seoTitle || '')}" placeholder="${esc(step.name)}"></label>
      <label class="f">Description<textarea data-s="seoDescription" rows="2">${esc(ed.settings.seoDescription || '')}</textarea></label>
      <label class="f">Page URL<input data-slug value="${esc(step.slug)}"></label>
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
        saved.textContent = 'All changes saved';
        if (extra.slug !== undefined) { $('[data-slug]').value = r.slug; $('[data-live]').href = publicUrl(`/f/${step.funnel.slug}/${r.slug}`); }
      } catch (err) { saved.textContent = 'Not saved'; toast(err.message, true); }
    }, 700);
  };

  const fieldHtml = (b, i, [key, kind, label, options, hint]) => {
    const v = b[key] ?? '';
    const attrs = `data-i="${i}" data-k="${key}"`;
    if (kind === 'textarea') return `<label class="f">${label}<textarea ${attrs} rows="3">${esc(v)}</textarea></label>`;
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
    if (kind === 'check') return `<label class="check"><input type="checkbox" ${attrs} ${v ? 'checked' : ''}>${label}</label>`;
    if (kind === 'align') return `<div class="f">${label}<div class="aligns">${['left', 'center', 'right'].map((a) => `<button type="button" data-align="${i}:${a}" class="${(v || 'center') === a ? 'on' : ''}">${a}</button>`).join('')}</div></div>`;
    return `<label class="f">${label}${hint ? ` <span class="hint">${esc(hint)}</span>` : ''}<input type="${kind}" ${attrs} value="${esc(v)}"></label>`;
  };
  const summary = (b) => esc(String(b.type === 'pricing' ? (products.find((pr) => pr.id === b.productId)?.name || 'no product')
    : b.text || b.label || b.buttonLabel || b.url || '').slice(0, 40));

  const renderBlocks = () => {
    $('[data-blocks]').innerHTML = ed.blocks.length ? ed.blocks.map((b, i) => {
      const def = BLOCKS[b.type] || { label: b.type, icon: '?', fields: [] };
      const open = ed.open === b.id;
      return `<div class="block ${open ? 'open' : ''}">
        <div class="bh" data-toggle="${b.id}" draggable="true" data-drag="${i}" title="Drag to move"><span>${def.icon}</span><span class="name">${def.label} <span>${summary(b)}</span></span>
          <button class="btn" data-up="${i}" ${i === 0 ? 'disabled' : ''} title="Move up">↑</button>
          <button class="btn" data-down="${i}" ${i === ed.blocks.length - 1 ? 'disabled' : ''} title="Move down">↓</button>
          <button class="btn" data-dup="${i}" title="Duplicate">⧉</button>
          <button class="btn danger" data-rm="${i}" title="Delete">✕</button></div>
        ${open ? `<div class="bb">${def.fields.length ? def.fields.map((fd) => fieldHtml(b, i, fd)).join('') : '<p class="muted small">No settings for this block.</p>'}</div>` : ''}
      </div>`;
    }).join('') : '<p class="muted small" data-empty>Your page is empty. Drag a block from above onto the page, or click one to add it.</p>';
  };
  const structural = () => { renderBlocks(); changed(); };

  const side = $('.side');
  side.addEventListener('click', (e) => {
    const t = e.target.closest('button, [data-toggle]');
    if (!t) return;
    const d = t.dataset;
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
      ed.blocks.splice(Number(d.rm), 1); structural();
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
  });
  side.addEventListener('dragend', () => { document.body.classList.remove('dragging-block'); listMark(null); });
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
  $('[data-slug]').addEventListener('change', (e) => changed({ slug: e.target.value }));
  $('[data-name]').addEventListener('input', () => changed());
  $('[data-device]').onclick = () => $('.stage').classList.toggle('mobile');

  // Click-to-edit: the preview sends what was typed, or which block was clicked.
  window.onmessage = (e) => {
    const d = e.data;
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
