'use strict';

// ---------------- Email writing tools ----------------
// The Insert bar (link, button, picture, heading, divider, bold) and a live preview
// showing the email as it will arrive, in the business's chosen look (a plain letter
// or branded). Used wherever an email is written in a small box (the flow map, follow-ups).

const EMAIL_SAMPLE = { first_name: 'Sam', last_name: 'Lee', email: 'sam@example.com' };

function emailToolsHtml() {
  return `<div class="cmp-tools et-tools" role="toolbar" aria-label="Insert">
    <button type="button" data-et="bold" title="Bold: wraps the selected words">${icon('text')} <b>Bold</b></button>
    <button type="button" data-et="link">${icon('link')} Link</button>
    <button type="button" data-et="button">${icon('button')} Button</button>
    <label class="tool-file">${icon('image')} Picture<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden data-et-img></label>
    <button type="button" data-et="heading">${icon('heading')} Heading</button>
    <button type="button" data-et="divider">${icon('divider')} Divider</button></div>`;
}

// The preview pane, with the choice of look (it applies to every email the business sends).
function emailPreviewPaneHtml() {
  const look = state.me?.account?.email_look === 'branded' ? 'branded' : 'letter';
  return `<aside class="et-preview">
    <div class="et-head"><span class="muted small">How it arrives</span>
      <div class="seg et-look" role="group" aria-label="Email look"><button type="button" data-etlook="letter" class="${look === 'letter' ? 'on' : ''}">Letter</button><button type="button" data-etlook="branded" class="${look === 'branded' ? 'on' : ''}">Branded</button></div></div>
    <div class="et-inbox"><b data-et-from></b><span><b data-et-subj></b></span></div>
    <div class="et-mail" data-et-mail></div>
    <p class="hint et-note" data-et-note></p></aside>`;
}

function emailSampleMerge(t) {
  const acct = state.me?.account || {};
  return String(t || '').replace(/\{\{\s*(\w+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g, (m, k, fb) => {
    const v = { ...EMAIL_SAMPLE, business: acct.name, name: `${EMAIL_SAMPLE.first_name} ${EMAIL_SAMPLE.last_name}` };
    if (k in v) return v[k] || fb || '';
    if (k === 'guide_line') return '\n\nHere’s your download: https://example.com/your-guide';
    if (/^signature/.test(k)) return `\n${acct.from_name || acct.name || ''}`;
    return fb || `[${k.replace(/_/g, ' ')}]`;
  });
}

function renderEmailPreview(root, subject, body) {
  const acct = state.me?.account || {};
  const look = acct.email_look === 'branded' ? 'branded' : 'letter';
  const html = emailBodyHtml(emailSampleMerge(body), { color: acct.brand_color || undefined }).replace(/<a href=/g, '<a target="_blank" rel="noopener" href=');
  $('[data-et-from]', root).textContent = acct.from_name || acct.name || '';
  $('[data-et-subj]', root).textContent = emailSampleMerge(subject) || '(no subject)';
  const mail = $('[data-et-mail]', root);
  mail.classList.toggle('branded', look === 'branded');
  mail.innerHTML = emailFrame(html || '<p style="color:#9ca3af">Your message appears here.</p>', { look, logo: acct.logo_url || '', name: acct.name || acct.from_name || '', color: acct.brand_color || '' });
  $('[data-et-note]', root).textContent = look === 'branded'
    ? (acct.logo_url ? 'Your logo on your colour, the words on a white card. Every email uses this look.' : 'Shows your business name on your colour. Add a logo in Settings to show it here.')
    : 'A plain, personal letter. It tends to reach the main inbox. Every email uses this look.';
}

// Wire the bar and the preview to a subject input and a message box inside root.
function bindEmailTools(root, { subject, body }) {
  const draw = () => renderEmailPreview(root, subject?.value || '', body.value);
  // Until they've clicked into the message, things are added at the end (not above "Hi …").
  let placed = false;
  ['focus', 'click', 'keyup'].forEach((ev) => body.addEventListener(ev, () => { placed = true; }));
  const insert = (text) => {
    const s = placed ? body.selectionStart : body.value.replace(/\s+$/, '').length, e = placed ? body.selectionEnd : body.value.length;
    body.value = body.value.slice(0, s) + text + body.value.slice(e);
    body.focus(); body.selectionStart = body.selectionEnd = s + text.length;
    draw();
  };
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-et], [data-etlook]');
    if (!b) return;
    e.preventDefault();
    if (b.dataset.etlook) {
      try { await api('PUT', '/api/account/email-look', { look: b.dataset.etlook }); } catch (err) { toast(err.message, true); return; }
      state.me.account.email_look = b.dataset.etlook;
      $$('[data-etlook]', root).forEach((x) => x.classList.toggle('on', x === b));
      draw(); toast(b.dataset.etlook === 'branded' ? 'Every email now arrives branded' : 'Every email now arrives as a plain letter');
      return;
    }
    const k = b.dataset.et;
    if (k === 'bold') {
      const s = body.selectionStart, en = body.selectionEnd;
      const words = body.value.slice(s, en) || 'bold words';
      insert(`**${words.replace(/\*/g, '')}**`);
    } else if (k === 'heading') insert('\n\n## A heading\n\n');
    else if (k === 'divider') insert('\n\n---\n\n');
    else if (k === 'link') {
      const v = await modal('Add a link', `<label class="f">Words to click<input name="label" required maxlength="80" value="${esc(body.value.slice(body.selectionStart, body.selectionEnd))}"></label>
        <label class="f">Web address<input name="url" type="url" required placeholder="https://"></label>`, { submit: 'Add link' });
      if (v?.url) insert(`[${v.label.replace(/[[\]]/g, '')}](${v.url})`);
    } else if (k === 'button') {
      const v = await modal('Add a button', `<label class="f">Button words<input name="label" required maxlength="40" placeholder="e.g. Read the guide"></label>
        <label class="f">Web address<input name="url" type="url" required placeholder="https://"></label>`, { submit: 'Add button' });
      if (v?.url) insert(`\n\n[${v.label.replace(/[[\]]/g, '')}](${v.url})\n\n`);
    }
  });
  const img = $('[data-et-img]', root);
  if (img) img.onchange = async () => {
    const file = img.files[0]; img.value = '';
    if (!file) return;
    try {
      toast('Uploading picture…');
      let url = await uploadImage(file);
      if (url.startsWith('/')) url = `${location.origin}${url}`;
      const alt = (await modal('Describe the picture', '<label class="f">What it shows <span class="hint">read aloud to people who can’t see it</span><input name="alt" maxlength="120"></label>', { submit: 'Add picture' }))?.alt || '';
      insert(`\n\n![${alt.replace(/[[\]]/g, '')}](${url})\n\n`);
    } catch (err) { toast(err.message, true); }
  };
  subject?.addEventListener('input', draw);
  body.addEventListener('input', draw);
  draw();
}

// A whole email box (subject, the bar, the message, the preview) for a modal,
// and wiring it once the modal is open.
function emailBoxHtml(subject = '', body = 'Hi {{first_name|there}},\n\n', { subjectPlaceholder = '' } = {}) {
  return `<div class="et-grid"><div class="et-write">
    <label class="f">Subject<input name="subject" required value="${esc(subject)}" placeholder="${esc(subjectPlaceholder)}"></label>
    <div class="f"><span class="lbl-row">Message <span class="hint">type {{ for fill-in fields</span></span>${emailToolsHtml()}<textarea name="body" rows="12" required>${esc(body)}</textarea></div></div>
    ${emailPreviewPaneHtml()}</div>`;
}
function wireEmailBox() {
  setTimeout(() => {
    const m = $('.modal:has(.et-grid)'); if (!m) return;
    m.classList.add('wide-email');
    if (typeof bindFieldInserts === 'function') bindFieldInserts(m);
    bindEmailTools(m, { subject: $('[name=subject]', m), body: $('[name=body]', m) });
  });
}
