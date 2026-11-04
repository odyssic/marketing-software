'use strict';

// ---------------- Signature maker ----------------
// Pick a layout and a colour, fill in a few details, see it live, save it.
// Saved signatures are shared by every email; the default goes on new emails.
let sigCache = null;
async function loadSignatures(force = false) {
  if (!sigCache || force) sigCache = await api('GET', '/api/account/signatures').catch(() => ({ list: [], default: null }));
  return sigCache;
}
const SIG_COLORS = ['#1b736d', '#1d4ed8', '#2f6b3b', '#c2410c', '#7e22ce', '#be185d', '#111827'];

// Opens the maker for a new signature (or `existing`). Resolves with the saved signature, or null.
async function editSignature(existing = null) {
  const store = await loadSignatures();
  const a = state.me.account;
  const s = existing ? { ...existing } : {
    id: '', style: 'photo', color: SIG_COLORS[0], name: state.me.user.name || '', title: '', company: a.name, phone: '', email: state.me.user.email || '',
    website: a.domain ? `https://${a.domain}` : '', photo: '', tagline: '',
  };
  const field = (k, label, ph = '', type = 'text') => `<label class="f">${label}<input name="${k}" type="${type}" value="${esc(s[k] || '')}" placeholder="${esc(ph)}"${({ name: ' autocomplete="name" required', email: ' autocomplete="email"', phone: ' autocomplete="tel"', website: ' autocomplete="url"', company: ' autocomplete="organization"' })[k] || ''}></label>`;
  const pending = modal(existing ? 'Edit signature' : 'New signature', `<div class="sig-maker">
    <div class="sig-fields">
      <div class="f"><span>Layout</span><div class="sig-styles" role="radiogroup" aria-label="Layout">${SIG_STYLES.map(([k, l]) => `<label class="sig-style"><input type="radio" name="style" value="${k}" ${s.style === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></div>
      <div class="f"><span>Colour</span><div class="sig-colors">${SIG_COLORS.map((c) => `<label class="sig-color" style="--c:${c}" title="${c}"><input type="radio" name="color" value="${c}" ${s.color === c ? 'checked' : ''} aria-label="Colour ${c}"><span></span></label>`).join('')}
        <label class="sig-color custom" title="Your own colour"><input type="color" name="customcolor" value="${esc(SIG_COLORS.includes(s.color) ? '#1b736d' : s.color)}" aria-label="Your own colour"></label></div></div>
      ${field('name', 'Name')}
      <div class="colors" style="grid-template-columns:1fr 1fr">${field('title', 'Title', 'e.g. Owner')}${field('company', 'Business')}</div>
      <div class="colors" style="grid-template-columns:1fr 1fr">${field('phone', 'Phone', '', 'tel')}${field('email', 'Email', '', 'email')}</div>
      ${field('website', 'Website', 'yourbusiness.com')}
      <div class="f"><span>Photo or logo <span class="hint">a square photo for “With photo”, a logo for “Card”</span></span>
        <div class="sig-photo"><span data-sigphoto>${s.photo ? `<img src="${esc(s.photo)}" alt="">` : icon('camera')}</span>
          <button type="button" class="btn sm" data-sigup>${s.photo ? 'Change' : 'Upload'}</button>${s.photo ? '<button type="button" class="btn sm ghost" data-signophoto>Remove</button>' : ''}
          <input type="file" accept="image/*" hidden data-sigfile><input type="hidden" name="photo" value="${esc(s.photo || '')}"></div></div>
      <details ${SIG_SOCIAL.slice(1).some(([k]) => s[k]) ? 'open' : ''}><summary>Social links</summary>
        <div class="colors" style="grid-template-columns:1fr 1fr">${SIG_SOCIAL.slice(1).map(([k, l]) => field(k, l, `${k}.com/yourname`)).join('')}</div></details>
      ${field('tagline', 'A short line under it', 'e.g. Restoring typewriters since 1998')}
      ${field('label', 'Call this signature', 'e.g. Main, Short, Sales')}
      <label class="check"><input type="checkbox" name="isdefault" ${!store.list.length || store.default === s.id ? 'checked' : ''}> Put it on new emails automatically</label>
    </div>
    <div class="sig-live"><div class="muted small">Preview</div><div class="sig-paper"><p>Hi Alex,</p><p>Thanks so much for your order. It’s on its way.</p><div data-sigprev></div></div></div>
  </div>`, { submit: 'Save signature', onSubmit: async (v) => {
    const color = v.customcolor && !SIG_COLORS.includes(v.color) ? v.customcolor : v.color || s.color;
    const sig = { ...s, ...Object.fromEntries(Object.entries(v).filter(([k]) => !['isdefault', 'customcolor'].includes(k))), color, id: s.id || `s${Math.random().toString(36).slice(2, 8)}` };
    if (!sig.label) sig.label = sig.name;
    const list = s.id ? store.list.map((x) => (x.id === s.id ? sig : x)) : [...store.list, sig];
    sigCache = await api('PUT', '/api/account/signatures', { list, default: v.isdefault ? sig.id : store.default === sig.id ? null : store.default });
    return sig;
  } });
  const bg = $$('.modal-bg').pop();
  $('.modal', bg).classList.add('wide');
  const form = $('form', bg);
  const current = () => {
    const v = Object.fromEntries(new FormData(form));
    const custom = $('[name=customcolor]', form);
    return { ...s, ...v, color: v.color || custom.value };
  };
  const draw = () => { $('[data-sigprev]', bg).innerHTML = signatureHtml(current()); };
  form.addEventListener('input', (e) => { if (e.target.name === 'customcolor') $$('[name=color]', form).forEach((r) => { r.checked = false; }); draw(); });
  form.addEventListener('change', draw);
  const file = $('[data-sigfile]', bg);
  $('[data-sigup]', bg).onclick = () => file.click();
  const rm = $('[data-signophoto]', bg);
  if (rm) rm.onclick = () => { $('[name=photo]', form).value = ''; $('[data-sigphoto]', bg).innerHTML = icon('camera'); draw(); };
  file.onchange = async () => {
    try {
      const url = await uploadImage(file.files[0]);
      $('[name=photo]', form).value = url;
      $('[data-sigphoto]', bg).innerHTML = `<img src="${esc(url)}" alt="">`;
      draw();
    } catch (e) { toast(e.message, true); }
  };
  draw();
  const r = await pending;
  if (r?.id) toast('Signature saved');
  return r?.id ? r : null;
}

// The toolbar menu in the email editor: insert a saved signature, or make one.
async function signatureMenu(anchor, insert) {
  const store = await loadSignatures();
  if (!store.list.length) { const s = await editSignature(); if (s) insert(`\n\n{{signature:${s.id}}}`); return; }
  $('.sig-menu')?.remove();
  const m = document.createElement('div');
  m.className = 'sig-menu nodemenu'; m.setAttribute('role', 'menu');
  m.innerHTML = `${store.list.map((s) => `<button type="button" role="menuitem" data-pick="${esc(s.id)}">${icon('pencil')}<span>${esc(s.label || s.name)}${s.id === store.default ? ' <span class="muted small">(default)</span>' : ''}</span></button>`).join('')}
    <button type="button" role="menuitem" data-signew>${icon('plus')} New signature</button>
    <button type="button" role="menuitem" data-sigmanage>${icon('gear')} Edit signatures</button>`;
  anchor.parentElement.style.position = 'relative';
  anchor.after(m);
  const close = () => { m.remove(); removeEventListener('pointerdown', outside, true); };
  const outside = (e) => { if (!m.contains(e.target) && e.target !== anchor) close(); };
  addEventListener('pointerdown', outside, true);
  $$('[data-pick]', m).forEach((b) => { b.onclick = () => { close(); insert(`\n\n{{signature:${b.dataset.pick}}}`); }; });
  $('[data-signew]', m).onclick = async () => { close(); const s = await editSignature(); if (s) insert(`\n\n{{signature:${s.id}}}`); };
  $('[data-sigmanage]', m).onclick = () => { close(); manageSignatures(); };
  $('button', m).focus();
}

// All signatures: edit, make default, delete.
async function manageSignatures(onDone) {
  const store = await loadSignatures(true);
  const pending = modal('Your signatures', `<div class="sig-list">${store.list.map((s) => `<div class="sig-item" data-sid="${esc(s.id)}">
      <div class="sig-mini">${signatureHtml(s)}</div>
      <div class="row" style="gap:6px"><b>${esc(s.label || s.name)}</b>${s.id === store.default ? '<span class="pill ok">On new emails</span>' : `<button type="button" class="btn sm" data-sdef="${esc(s.id)}">Use on new emails</button>`}
        <button type="button" class="btn sm" data-sedit="${esc(s.id)}">Edit</button><button type="button" class="btn sm" data-sdel="${esc(s.id)}">Delete</button></div></div>`).join('') || '<p class="muted">No signatures yet.</p>'}</div>
    <button type="button" class="btn" data-snew>${icon('plus')} New signature</button>`, { submit: 'Done' });
  const bg = $$('.modal-bg').pop();
  $('.modal', bg).classList.add('wide');
  const reopen = () => { $('[data-x]', bg)?.click(); setTimeout(() => manageSignatures(onDone), 50); };
  $('[data-snew]', bg).onclick = async () => { $('[data-x]', bg).click(); await editSignature(); manageSignatures(onDone); };
  $$('[data-sedit]', bg).forEach((b) => { b.onclick = async () => { $('[data-x]', bg).click(); await editSignature(store.list.find((s) => s.id === b.dataset.sedit)); manageSignatures(onDone); }; });
  $$('[data-sdef]', bg).forEach((b) => { b.onclick = async () => { sigCache = await api('PUT', '/api/account/signatures', { list: store.list, default: b.dataset.sdef }); reopen(); }; });
  $$('[data-sdel]', bg).forEach((b) => { b.onclick = async () => {
    const before = { list: store.list, default: store.default };
    sigCache = await api('PUT', '/api/account/signatures', { list: store.list.filter((s) => s.id !== b.dataset.sdel), default: store.default === b.dataset.sdel ? null : store.default });
    reopen();
    undoToast('Signature deleted', async () => { sigCache = await api('PUT', '/api/account/signatures', before); });
  }; });
  await pending;
  onDone?.();
}
