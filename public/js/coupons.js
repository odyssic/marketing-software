'use strict';

// ---------------- Coupons (Products → Coupons) ----------------
// A simple list of codes buyers can type on a pricing card.
async function viewCouponsTab() {
  const [coupons, products] = await Promise.all([api('GET', '/api/coupons'), api('GET', '/api/products')]);
  const names = Object.fromEntries(products.map((p) => [p.id, p.name]));
  const limits = (c) => [
    c.product_ids.length ? `Only ${c.product_ids.map((x) => names[x]).filter(Boolean).map(esc).join(', ') || 'removed products'}` : 'Any product',
    c.expires ? `until ${fmtDate(`${c.expires}T12:00:00`)}` : '',
    c.max_uses ? `${c.uses} of ${c.max_uses} used` : `used ${c.uses} time${c.uses === 1 ? '' : 's'}`,
  ].filter(Boolean).join(' · ');
  shell('products', `
    <div class="head"><div><h1>Products</h1><div class="muted">Codes buyers can type at checkout for money off.</div></div>
      ${coupons.length ? '<button class="btn primary" data-newcoupon>+ New code</button>' : ''}</div>
    ${productTabs('coupons')}
    ${coupons.length ? `<div class="card list">${coupons.map((c) => `<div class="inv-row click" data-coupon="${c.id}">
        <div class="inv-main"><strong class="coupon-code">${esc(c.code)}</strong><div class="muted small">${limits(c)}</div></div>
        <div class="inv-amt">${esc(c.label)}</div>
        <span class="pill ${c.status === 'active' ? 'ok' : ''}">${c.status === 'active' ? 'Active' : c.status === 'expired' ? 'Expired' : 'Used up'}</span></div>`).join('')}</div>`
    : `<div class="card empty"><div class="big">${icon('tag')}</div><h2>No codes yet</h2>
      <p>Make a code like SPRING20 for money off. A “Have a code?” box then shows on your pricing cards.</p>
      <button class="btn primary" data-newcoupon>+ New code</button></div>`}`);

  const form = (c = {}) => `
    <label class="f">Code <span class="hint">what buyers type</span><input name="code" required maxlength="30" value="${esc(c.code || '')}" placeholder="SPRING20" autocomplete="off"></label>
    <div class="colors"><label class="f">Money off<select name="kind"><option value="percent">Percent off</option><option value="amount" ${c.amount_off_cents ? 'selected' : ''}>Amount off</option></select></label>
      <label class="f">How much<input name="value" type="number" min="0.01" step="0.01" required inputmode="decimal" value="${c.percent_off || (c.amount_off_cents ? c.amount_off_cents / 100 : '')}" placeholder="20"></label></div>
    <div class="colors"><label class="f">Ends <span class="hint">optional</span><input name="expires" type="date" value="${esc(c.expires || '')}"></label>
      <label class="f">Times it can be used <span class="hint">optional</span><input name="max_uses" type="number" min="1" step="1" inputmode="numeric" value="${c.max_uses || ''}" placeholder="No limit"></label></div>
    ${products.length ? `<div class="f"><span>Works for <span class="hint">leave all unticked for every product</span></span>
      <div class="coupon-products">${products.map((p) => `<label class="check"><input type="checkbox" name="p_${p.id}" ${c.product_ids?.includes(p.id) ? 'checked' : ''}> ${esc(p.name)}</label>`).join('')}</div></div>` : ''}
    <p class="hint">On monthly plans and payments in parts, the money comes off every payment.</p>`;
  const values = (v) => ({ ...v, product_ids: Object.keys(v).filter((k) => k.startsWith('p_') && v[k]).map((k) => Number(k.slice(2))) });
  const reload = () => viewCouponsTab();

  $$('[data-newcoupon]').forEach((b) => { b.onclick = async () => {
    if (await modal('New code', form(), { submit: 'Create code', onSubmit: (v) => api('POST', '/api/coupons', values(v)) })) { toast('Code created'); reload(); }
  }; });
  $$('[data-coupon]').forEach((row) => { row.onclick = async () => {
    const c = coupons.find((x) => x.id === Number(row.dataset.coupon));
    const pending = modal('Edit code', `${form(c)}<button type="button" class="btn danger sm" data-delcoupon>Delete code</button>`,
      { onSubmit: (v) => api('PUT', `/api/coupons/${c.id}`, values(v)) });
    $('[data-delcoupon]').onclick = () => {
      $('.modal-bg [data-x]').click();
      deleteWithUndo(`${c.code} deleted`, { url: `/api/coupons/${c.id}`, hide: hideEl(row) });
    };
    if (await pending) { toast('Saved'); reload(); }
  }; });
}

// Settings → the second checkout reminder can offer one of the codes.
async function couponsRecoveryPicker(el) {
  if (!el) return;
  const coupons = await api('GET', '/api/coupons').catch(() => []);
  const cur = state.me.account.recover_coupon_id;
  el.innerHTML = `<label class="f" style="margin:0 0 12px 26px">The second reminder, a day later, offers
    <select data-recovercode style="max-width:360px"><option value="">No code</option>${coupons.map((c) => `<option value="${c.id}" ${c.id === cur ? 'selected' : ''}>${esc(c.code)} (${esc(c.label)})</option>`).join('')}</select>
    ${coupons.length ? '' : '<span class="hint">Make codes in <a href="#/products/coupons">Products → Coupons</a></span>'}</label>`;
  $('[data-recovercode]', el).onchange = async (e) => {
    await api('PUT', '/api/account/recovery-coupon', { coupon_id: e.target.value || null });
    state.me = await api('GET', '/api/me');
    toast(e.target.value ? 'The second reminder includes the code' : 'No code in reminders');
  };
}
