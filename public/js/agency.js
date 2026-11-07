'use strict';

// ---------------- Agency brand and client reports ----------------
// The app in the agency's colours, for everyone working in its businesses.
function applyAgencyBrand() {
  const b = state.me?.brand, root = document.documentElement.style;
  if (b?.color && /^#[0-9a-f]{6}$/i.test(b.color) && typeof paletteFrom === 'function') {
    const c = paletteFrom(b.color).accent;
    root.setProperty('--brand', c);
    root.setProperty('--brand-soft', `color-mix(in srgb, ${c} 12%, #fff)`);
  } else { root.removeProperty('--brand'); root.removeProperty('--brand-soft'); }
}
const agencyLogo = () => {
  const b = state.me?.brand;
  if (b?.logo) return `<img class="agency-logo" src="${esc(b.logo)}" alt="${esc(b.name || '')}">`;
  if (b?.name) return `<span class="agency-name">${esc(b.name)}</span>`;
  return '';
};

async function loadAgencyBrand() {
  const card = $('[data-agency]');
  if (!card) return;
  let b = { name: '', logo: '', color: '' };
  try { b = await api('GET', '/api/agency-brand'); } catch { /* empty form */ }
  card.innerHTML = `<h2>Your agency brand</h2>
    <p class="muted small">Your name, logo and colour in place of Rilly’s, for everyone working in the businesses you own, and on their monthly reports.</p>
    <label class="f">Agency name<input name="name" value="${esc(b.name)}" placeholder="e.g. Brightside Marketing"></label>
    <div class="f">Logo <span class="hint">a wide logo works best</span>
      <div class="agency-logo-row"><div class="agency-logo-box" data-logobox>${b.logo ? `<img src="${esc(b.logo)}" alt="">` : '<span class="muted small">No logo yet</span>'}</div>
        <label class="btn sm">${icon('upload')} Upload<input type="file" accept="image/png,image/jpeg,image/webp" hidden data-logofile></label>
        ${b.logo ? '<button type="button" class="btn sm" data-logoclear>Remove</button>' : ''}</div>
      <input type="hidden" name="logo" value="${esc(b.logo)}"></div>
    <label class="f">Colour<input type="color" name="color" value="${esc(b.color || '#1b736d')}"></label>
    <label class="check"><input type="checkbox" data-nocolor ${b.color ? '' : 'checked'}> Keep Rilly’s colours</label>
    <div class="err"></div><button class="btn primary">Save brand</button>`;
  $('[data-logofile]', card).onchange = async (e) => {
    try {
      const url = await uploadImage(e.target.files[0]);
      card.logo.value = url; $('[data-logobox]', card).innerHTML = `<img src="${esc(url)}" alt="">`;
    } catch (err) { $('.err', card).textContent = err.message; }
  };
  const clear = $('[data-logoclear]', card); if (clear) clear.onclick = () => { card.logo.value = ''; $('[data-logobox]', card).innerHTML = '<span class="muted small">No logo yet</span>'; };
  card.color.oninput = () => { $('[data-nocolor]', card).checked = false; };
  card.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('PUT', '/api/agency-brand', { name: card.name.value, logo: card.logo.value, color: $('[data-nocolor]', card).checked ? '' : card.color.value });
      state.me = await api('GET', '/api/me');
      toast('Brand saved'); viewSettings();
    } catch (err) { $('.err', card).textContent = err.message; }
  };
}

async function loadClientReport() {
  const card = $('[data-report]');
  if (!card) return;
  let r;
  try { r = await api('GET', '/api/report'); } catch { card.innerHTML = '<h2>Monthly report</h2><p class="muted small">Couldn’t load.</p>'; return; }
  card.innerHTML = `<h2>Monthly report</h2>
    <p class="muted small">On the 1st of each month, a short email with last month’s visitors, leads, customers and sales, next to the month before. Great for clients.</p>
    <label class="f">Send it to <span class="hint">emails, separated by commas</span><input name="to" value="${esc(r.to)}" placeholder="owner@client.com, you@agency.com"></label>
    <label class="check"><input type="checkbox" name="monthly" ${r.monthly ? 'checked' : ''}> Send it every month</label>
    <div class="err"></div>
    <div class="row"><button class="btn primary">Save</button><button type="button" class="btn" data-reportpreview>Preview</button><button type="button" class="btn" data-reportsend>Send now</button></div>`;
  const save = () => api('PUT', '/api/report', { to: card.to.value, monthly: card.monthly.checked });
  card.onsubmit = async (e) => {
    e.preventDefault();
    try { await save(); toast(card.monthly.checked ? 'Saved. It goes out on the 1st' : 'Saved'); } catch (err) { $('.err', card).textContent = err.message; }
  };
  $('[data-reportpreview]', card).onclick = async () => {
    const latest = await api('GET', '/api/report');
    modal('Report preview', '<iframe class="report-frame" title="Report preview" sandbox=""></iframe>', { submit: 'Close' });
    $('.report-frame').srcdoc = latest.preview;
  };
  $('[data-reportsend]', card).onclick = async () => {
    try { await save(); const s = await api('POST', '/api/report/send'); toast(`Sent to ${s.sent} ${s.sent === 1 ? 'person' : 'people'}`); }
    catch (err) { $('.err', card).textContent = err.message; }
  };
}
