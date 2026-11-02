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
  testimonial: { label: 'Testimonial', icon: '❝', defaults: { quote: 'Write what a happy customer said.', name: 'Customer name', detail: '', photo: '' },
    fields: [['quote', 'textarea', 'Quote'], ['name', 'text', 'Name'], ['detail', 'text', 'Detail', null, 'e.g. city or what they bought'], ['photo', 'text', 'Photo link (optional)']] },
  heading: { label: 'Heading', icon: 'H', defaults: { text: 'Your big headline', size: 'large', align: 'center' },
    fields: [['text', 'textarea', 'Text'], ['size', 'select', 'Size', ['large', 'medium', 'small']], ALIGN] },
  text: { label: 'Text', icon: '¶', defaults: { text: 'Write something persuasive here.', align: 'center' },
    fields: [['text', 'textarea', 'Text'], ALIGN] },
  image: { label: 'Image', icon: '🖼', defaults: { url: '', alt: '', align: 'center' },
    fields: [['url', 'text', 'Image URL', null, 'Paste a link to an image (https://…)'], ['alt', 'text', 'Description (for accessibility)'], ALIGN] },
  video: { label: 'Video', icon: '▶', defaults: { url: '' },
    fields: [['url', 'text', 'YouTube link', null, 'e.g. https://youtu.be/…']] },
  button: { label: 'Button', icon: '⬭', defaults: { label: 'Continue', url: '#next', align: 'center' },
    fields: [['label', 'text', 'Button text'], ['url', 'text', 'Link', null, '#next = the page this one’s ✓ Yes exit leads to · #no = its ✕ No thanks exit'], ALIGN] },
  form: { label: 'Form', icon: '✉', defaults: { buttonLabel: 'Get instant access', collectName: true, collectPhone: false, purpose: 'Sign up', tag: 'lead' },
    fields: [['purpose', 'select', 'What happens', ['Sign up', 'Newsletter', 'Inquiry'], 'Sign up: a lead. Newsletter: also subscribes them. Inquiry: logs a request you should answer.'],
      ['newsletter', 'text', 'Newsletter name (for Newsletter forms)'],
      ['buttonLabel', 'text', 'Button text'], ['collectName', 'check', 'Ask for first name'], ['collectPhone', 'check', 'Ask for phone number'], ['collectMessage', 'check', 'Ask for a message'],
      ['tag', 'text', 'Tag new contacts with', null, 'Use tags to email this group later. Comma-separate for several.']] },
  spacer: { label: 'Spacer', icon: '↕', defaults: { height: 40 }, fields: [['height', 'number', 'Height (px)']] },
  divider: { label: 'Divider', icon: '—', defaults: {}, fields: [] },
};
const uid = () => Math.random().toString(36).slice(2, 10);

async function viewEditor(stepId) {
  const [step, products] = await Promise.all([api('GET', `/api/steps/${stepId}`), api('GET', '/api/products')]);
  const ed = { step, blocks: step.blocks, settings: { background: '#ffffff', textColor: '#1f2937', accent: '#4f46e5', width: 720, ...step.settings }, open: null };
  const link = publicUrl(`/f/${step.funnel.slug}/${step.slug}`);
  app.innerHTML = `<div class="editor">
    <div class="bar"><a class="btn sm" href="#/funnels/${step.funnel.id}">← ${esc(step.funnel.name)}</a>
      <div class="title"><input data-name value="${esc(step.name)}" aria-label="Page name"></div>
      <span class="saved" data-saved>All changes saved</span>
      <button class="btn sm" data-undo title="Undo (Ctrl+Z)" disabled>↶ Undo</button><button class="btn sm" data-redo title="Redo (Ctrl+Shift+Z)" disabled>↷ Redo</button>
      <button class="btn sm" data-history title="Earlier versions of this page">🕘 History</button>
      <button class="btn sm" data-device title="Toggle mobile preview">📱 Mobile</button>
      <a class="btn sm primary" href="${esc(link)}" target="_blank" rel="noopener" data-live>View live ↗</a></div>
    <div class="side">
      <h3>Add a block</h3><div class="palette">${Object.entries(BLOCKS).map(([k, b]) => `<button data-addblock="${k}"><span class="ico">${b.icon}</span>${b.label}</button>`).join('')}</div>
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
    clearTimeout(previewTimer); previewTimer = setTimeout(preview, 250);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        const r = await api('PUT', `/api/steps/${stepId}`, { name: $('[data-name]').value, blocks: ed.blocks, settings: ed.settings, ...extra });
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
        <div class="bh" data-toggle="${b.id}"><span>${def.icon}</span><span class="name">${def.label} <span>${summary(b)}</span></span>
          <button class="btn" data-up="${i}" ${i === 0 ? 'disabled' : ''} title="Move up">↑</button>
          <button class="btn" data-down="${i}" ${i === ed.blocks.length - 1 ? 'disabled' : ''} title="Move down">↓</button>
          <button class="btn" data-dup="${i}" title="Duplicate">⧉</button>
          <button class="btn danger" data-rm="${i}" title="Delete">✕</button></div>
        ${open ? `<div class="bb">${def.fields.length ? def.fields.map((fd) => fieldHtml(b, i, fd)).join('') : '<p class="muted small">No settings for this block.</p>'}</div>` : ''}
      </div>`;
    }).join('') : '<p class="muted small">Your page is empty. Click a block above to add it.</p>';
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
  $('[data-slug]').addEventListener('change', (e) => changed({ slug: e.target.value }));
  $('[data-name]').addEventListener('input', () => changed());
  $('[data-device]').onclick = () => $('.stage').classList.toggle('mobile');

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
