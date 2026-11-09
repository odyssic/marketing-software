'use strict';

// ---------------- Files (Products → Files) ----------------
async function viewFiles() {
  const list = await api('GET', '/api/files');
  const kb = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  shell('products', `
    <div class="head"><div><h1>Products</h1><div class="muted">What you sell, and the orders that come in.</div></div>
      ${list.length ? `<label class="btn primary">${icon('upload')} Upload a file<input type="file" accept="${FILE_ACCEPT}" hidden data-fileup></label>` : ''}</div>
    ${productTabs('files')}
    <p class="muted small files-why">Guides, checklists and price lists people get when they sign up. Each person gets their own download link, so you can see who downloaded what on their record.</p>
    ${list.length ? `<div class="card files-list">${list.map((f) => `<div class="file-row" data-file="${esc(f.id)}">
      <span class="file-ico">${icon(f.content_type === 'application/pdf' ? 'note' : 'image')}</span>
      <span class="file-main"><input class="file-name" value="${esc(f.name)}" placeholder="Name this file" aria-label="File name" data-fname="${esc(f.id)}">
        <span class="muted small">${kb(f.size)} · added ${fmtDate(f.created_at)}</span></span>
      <span class="file-dl"><b>${f.downloads}</b><span class="muted small">download${f.downloads === 1 ? '' : 's'}</span></span>
      <span class="more-wrap">${moreMenu(`<button role="menuitem" data-fcopy="${esc(f.url)}">${icon('link')} Copy a public link</button><a role="menuitem" href="${esc(f.url)}" target="_blank" rel="noopener">${icon('external')} Open</a><button role="menuitem" class="danger" data-fdel="${esc(f.id)}">${icon('trash')} Delete</button>`)}</span>
    </div>`).join('')}</div>
    <p class="hint">To send a file when someone signs up: in the page editor, open the form and choose <b>Send them something</b>. Files up to 4 MB; for bigger ones, paste a Google Drive or Dropbox link there instead.</p>`
    : `<div class="card empty"><div class="big">${icon('download')}</div><h2>No files yet</h2><p>Upload a PDF guide, checklist or price list. Hand it out on a sign-up page and see who downloads it.</p>
      <label class="btn primary">${icon('upload')} Upload a file<input type="file" accept="${FILE_ACCEPT}" hidden data-fileup></label></div>`}`);
  bindMoreMenus();
  $$('[data-fileup]').forEach((inp) => { inp.onchange = async () => {
    const file = inp.files[0]; if (!file) return;
    try {
      let id;
      if (!file.type.startsWith('image/')) {
        toast('Uploading…');
        id = (await uploadFile(file, (pct) => { if (pct % 25 === 0) toast(`Uploading… ${pct}%`); })).id;
      } else id = (await uploadImage(file)).split('/u/')[1];
      await api('PUT', `/api/files/${encodeURIComponent(id)}`, { name: file.name.replace(/\.[a-z0-9]+$/i, '') });
      toast('File added'); viewFiles();
    } catch (err) { toast(err.message, true); }
  }; });
  $$('[data-fname]').forEach((inp) => { inp.onchange = async () => { await api('PUT', `/api/files/${encodeURIComponent(inp.dataset.fname)}`, { name: inp.value }); toast('Renamed'); }; });
  $$('[data-fcopy]').forEach((b) => { b.onclick = async () => { b.closest('.more-menu').hidden = true; try { await navigator.clipboard.writeText(b.dataset.fcopy); toast('Public link copied. Anyone with it can open the file'); } catch { toast('Copy failed', true); } }; });
  $$('[data-fdel]').forEach((b) => { b.onclick = () => {
    b.closest('.more-menu').hidden = true;
    deleteWithUndo('File deleted. Links to it stop working', { url: `/api/files/${encodeURIComponent(b.dataset.fdel)}`, hide: hideEl(b.closest('.file-row')) });
  }; });
}
