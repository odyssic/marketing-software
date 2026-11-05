'use strict';

// ---------------- Products & orders ----------------
const BILLING_LABEL = { one_time: 'One-time', monthly: 'Monthly', yearly: 'Yearly' };

async function viewProducts(tab) {
  if (tab === 'invoices') return viewInvoices();
  const orders = tab === 'orders';
  const items = await api('GET', orders ? '/api/orders' : '/api/products');
  const p = state.me.payments;
  shell('products', `
    <div class="head"><div><h1>Products</h1><div class="muted">What you sell, and the orders that come in.</div></div>
      ${orders || !items.length ? '' : '<button class="btn primary" data-new>+ New product</button>'}</div>
    ${p.connected ? (p.testKey ? `<p class="test-note">${icon('info')}<span>Stripe test key: checkouts use test cards, no real money moves.</span></p>` : '')
      : `<p class="test-note">${icon('info')}<span>Test mode: no card is charged until you <a href="#/settings">connect Stripe</a>.</span></p>`}
    ${productTabs(orders ? 'orders' : 'products')}
    ${orders ? ordersHtml(items) : productsHtml(items)}`);

  const form = (pr = {}) => `
    <label class="f">Product name<input name="name" required value="${esc(pr.name)}" placeholder="e.g. Lifetime access"></label>
    <label class="f">Description <span class="hint">shown at checkout</span><textarea name="description" rows="2">${esc(pr.description)}</textarea></label>
    <div class="colors"><label class="f">Price<input name="price" type="number" min="0.5" step="0.01" required value="${pr.price ?? ''}"></label>
      <label class="f">Currency<select name="currency">${['usd', 'eur', 'gbp', 'cad', 'aud'].map((c) => `<option value="${c}" ${pr.currency === c ? 'selected' : ''}>${c.toUpperCase()}</option>`).join('')}</select></label>
      <label class="f">Billing<select name="billing">${Object.entries(BILLING_LABEL).map(([k, l]) => `<option value="${k}" ${pr.billing === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    <label class="f">Photo <span class="hint">link to an image (https://…), shown on buy buttons</span><input name="image_url" value="${esc(pr.image_url || '')}" placeholder="https://"></label>
    <label class="f">Tag buyers with <span class="hint">buyers are always tagged “customer” too</span><input name="tag" value="${esc(pr.tag)}" placeholder="e.g. bought-course"></label>`;
  if (orders) return;
  // One "New product" button: in the header once there are products, in the middle until then.
  $('[data-new]').onclick = async () => {
    const r = await modal('New product', form(), { submit: 'Create product', onSubmit: (v) => api('POST', '/api/products', v) });
    if (r) {
      toast('Product created');
      if (await modal('Sell it on a page?', '<p class="muted">Create a pricing page pageflow for this product now? You can edit everything after.</p>', { submit: 'Create pricing page' })) {
        const f = await api('POST', '/api/funnels', { name: `${(await api('GET', '/api/products')).find((x) => x.id === r.id).name} pricing`, template: 'pricing' });
        location.hash = `#/funnels/${f.id}`;
      } else viewProducts();
    }
  };
  if (dashNew.next === 'product') { dashNew.next = ''; $('[data-new]').click(); }
  $$('[data-edit]').forEach((row) => { row.onclick = async () => {
    const pr = items.find((x) => x.id === Number(row.dataset.edit));
    const pending = modal('Edit product', `${form(pr)}<button type="button" class="btn danger sm" data-delp>Delete product</button>`,
      { onSubmit: (v) => api('PUT', `/api/products/${pr.id}`, v) });
    $('[data-delp]').onclick = async () => {
      $('.modal-bg [data-x]').click();
      deleteWithUndo(`“${pr.name}” deleted`, { url: `/api/products/${pr.id}`, hide: hideEl(row) });
    };
    if (await pending) { toast('Saved'); viewProducts(); }
  }; });
}

const productsHtml = (items) => (items.length ? `<div class="card table-wrap"><table>
  <tr><th>Product</th><th>Price</th><th>Billing</th><th>Buyer tag</th><th>Sales</th></tr>
  ${items.map((pr) => `<tr class="click" data-edit="${pr.id}"><td><strong>${esc(pr.name)}</strong><div class="muted small">${esc(pr.description.slice(0, 70))}</div></td>
    <td>${esc(pr.priceLabel)}</td><td>${BILLING_LABEL[pr.billing]}</td><td>${pr.tag ? tagsHtml(pr.tag.split(',')) : ''}</td><td>${pr.sales}</td></tr>`).join('')}
  </table></div>` : `<div class="card empty"><div class="big">${icon('bag')}</div><h2>No products yet</h2>
  <p>Add what you sell and its price. Then put it on any page with a Pricing block, and Rilly handles checkout and receipts.</p>
  <button class="btn primary" data-new>+ New product</button></div>`);

const ordersHtml = (items) => (items.length ? `<div class="card table-wrap"><table>
  <tr><th>Order</th><th>Product</th><th>Buyer</th><th>Amount</th><th>Status</th><th>Date</th></tr>
  ${items.map((o) => `<tr><td>#${o.id}${o.mode === 'test' ? ' <span class="pill">test</span>' : ''}</td><td>${esc(o.product_name)}<div class="muted small">${esc(o.funnel_name || '')}</div></td>
    <td>${esc(o.email) || '<span class="muted">—</span>'}</td><td>${esc(o.amountLabel)}</td>
    <td><span class="pill ${o.status === 'paid' ? 'ok' : ''}">${o.status === 'pending' ? 'abandoned / pending' : esc(o.status)}</span></td>
    <td class="muted small">${fmtDate(o.paid_at || o.created_at)}</td></tr>`).join('')}
  </table></div>` : '<div class="card empty"><div class="big">' + icon('receipt') + '</div><h2>No orders yet</h2><p>Orders appear here when someone buys from a page or pays an invoice or payment link.</p></div>');

const productTabs = (on) => `<div class="tabs">${[['products', 'Products', '#/products'], ['invoices', 'Invoices & links', '#/products/invoices'], ['orders', 'Orders', '#/products/orders']]
  .map(([k, l, h]) => `<a href="${h}" class="${on === k ? 'active' : ''}">${l}</a>`).join('')}</div>`;

// ---------------- Invoices & payment links ----------------
const INVOICE_STATUS = { draft: 'Draft', sent: 'Waiting', paid: 'Paid', void: 'Void', active: 'Active', archived: 'Archived' };

async function viewInvoices() {
  const list = await api('GET', '/api/invoices');
  const p = state.me.payments;
  const invoices = list.filter((x) => x.kind === 'invoice');
  const links = list.filter((x) => x.kind === 'link');
  const waiting = invoices.filter((x) => x.status === 'sent');
  const owed = waiting.reduce((n, x) => n + x.total_cents, 0);
  const paid30 = invoices.filter((x) => x.status === 'paid' && x.paid_at && Date.now() - new Date(x.paid_at) < 30 * 864e5).reduce((n, x) => n + x.total_cents, 0);
  shell('products', `
    <div class="head"><div><h1>Products</h1><div class="muted">Bill a client, or share a link anyone can pay.</div></div>
      <div class="row">${links.length ? `<button class="btn" data-newlink>${icon('link')} New payment link</button>` : ''}${invoices.length ? '<button class="btn primary" data-newinv>+ New invoice</button>' : ''}</div></div>
    ${p.connected ? '' : `<p class="test-note">${icon('info')}<span>Test mode: no card is charged until you <a href="#/settings">connect Stripe</a>.</span></p>`}
    ${productTabs('invoices')}
    ${invoices.length ? `<div class="stat-strip">
      <div><b>${money(owed)}</b><span>waiting on ${waiting.length} invoice${waiting.length === 1 ? '' : 's'}</span></div>
      <div><b>${money(paid30)}</b><span>paid in the last 30 days</span></div>
      <div><b>${waiting.filter((x) => x.overdue).length}</b><span>overdue (we send one polite reminder)</span></div></div>` : ''}
    <h2 class="section-h">Invoices</h2>
    ${invoices.length ? `<div class="card list">${invoices.map((x) => `<div class="inv-row" data-inv="${x.id}">
        <div class="inv-main"><strong>${esc(x.client_name || x.client_email)}</strong><div class="muted small">#${x.number}${x.title ? ` · ${esc(x.title)}` : ''}${x.due_date ? ` · due ${fmtDate(`${x.due_date}T12:00:00`)}` : ''}</div></div>
        <div class="inv-amt">${esc(x.totalLabel)}</div>
        <span class="pill ${x.status === 'paid' ? 'ok' : x.overdue ? 'warn' : ''}">${x.overdue ? 'Overdue' : INVOICE_STATUS[x.status]}</span>
        <div class="inv-acts">${invoiceActions(x)}</div></div>`).join('')}</div>`
    : `<div class="card empty"><div class="big">${icon('receipt')}</div><h2>Send your first invoice</h2>
      <p>Add what you did and the price. Your client gets a clean email with a Pay button, and it’s marked paid on its own.</p>
      <button class="btn primary" data-newinv>+ New invoice</button></div>`}
    <h2 class="section-h">Payment links</h2>
    ${links.length ? `<div class="card list">${links.map((x) => `<div class="inv-row" data-inv="${x.id}">
        <div class="inv-main"><strong>${esc(x.title || 'Payment')}</strong><div class="muted small">${x.payments} payment${x.payments === 1 ? '' : 's'}</div></div>
        <div class="inv-amt">${esc(x.totalLabel)}</div>
        <span class="pill ${x.status === 'active' ? 'ok' : ''}">${INVOICE_STATUS[x.status]}</span>
        <div class="inv-acts">${x.status === 'active' ? `<button class="btn sm" data-copy="${esc(x.url)}">${icon('copy')} Copy link</button><button class="btn sm" data-st="archived">Turn off</button>`
          : '<button class="btn sm" data-st="active">Turn on</button>'}</div></div>`).join('')}</div>`
    : `<div class="card empty slim"><p>A payment link is a fixed amount anyone can pay, like “Deposit: $100”. Text it, email it, or put it in your bio.</p>
      <button class="btn" data-newlink>${icon('link')} New payment link</button></div>`}`);

  const reload = () => viewInvoices();
  $$('[data-newinv]').forEach((b) => { b.onclick = () => newInvoice().then((r) => r && reload()); });
  $$('[data-newlink]').forEach((b) => { b.onclick = async () => {
    const r = await modal('New payment link', `
      <label class="f">What it’s for<input name="title" required placeholder="e.g. Deposit, 1-hour session"></label>
      <label class="f">Amount<input name="price" type="number" min="0.5" step="0.01" required inputmode="decimal" placeholder="100"></label>`,
    { submit: 'Create link', onSubmit: (v) => api('POST', '/api/invoices', { kind: 'link', title: v.title, items: [{ description: v.title, price: v.price }] }) });
    if (r?.url) { await navigator.clipboard?.writeText(r.url).catch(() => {}); toast('Link created and copied'); reload(); }
  }; });
  $$('[data-copy]').forEach((b) => { b.onclick = async (e) => { e.stopPropagation(); await navigator.clipboard.writeText(b.dataset.copy); toast('Link copied'); }; });
  const row = (b) => list.find((x) => x.id === Number(b.closest('[data-inv]').dataset.inv));
  const setStatus = (x, status) => api('POST', `/api/invoices/${x.id}/status`, { status });
  $$('[data-st]').forEach((b) => { b.onclick = async () => {
    const x = row(b); const before = x.status;
    await setStatus(x, b.dataset.st); reload();
    undoToast(b.dataset.st === 'void' ? 'Invoice voided' : b.dataset.st === 'paid' ? 'Marked paid' : b.dataset.st === 'archived' ? 'Link turned off' : 'Done',
      async () => { await setStatus(x, before); reload(); });
  }; });
  $$('[data-send]').forEach((b) => { b.onclick = async () => {
    const x = row(b);
    b.disabled = true;
    await api('POST', `/api/invoices/${x.id}/send`).then(() => { toast(x.status === 'sent' ? 'Reminder sent' : `Sent to ${x.client_email}`); reload(); })
      .catch((e) => { toast(e.message, true); b.disabled = false; });
  }; });
}

const invoiceActions = (x) => {
  if (x.status === 'draft') return `<a class="btn sm" href="${esc(x.url)}" target="_blank">Preview</a><button class="btn sm primary" data-send>Send</button><button class="btn sm" data-st="void">Void</button>`;
  if (x.status === 'sent') return `<button class="btn sm" data-copy="${esc(x.url)}">${icon('copy')} Link</button><button class="btn sm" data-send>Remind</button><button class="btn sm" data-st="paid">Mark paid</button><button class="btn sm" data-st="void">Void</button>`;
  return `<a class="btn sm" href="${esc(x.url)}" target="_blank">View</a>`;
};

// One screen: who, what, when. The total updates as you type; preview before it goes out.
async function newInvoice() {
  const people = await api('GET', '/api/contacts').catch(() => []);
  const due = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
  const line = () => `<div class="inv-line"><input name="d" placeholder="What you did, e.g. Kitchen repair" aria-label="Description">
    <input name="q" type="number" min="1" value="1" aria-label="Quantity" inputmode="numeric"><input name="p" type="number" min="0" step="0.01" placeholder="Price" aria-label="Price" inputmode="decimal">
    <button type="button" class="btn sm ghost" data-rm aria-label="Remove line">${icon('x')}</button></div>`;
  const pending = modal('New invoice', `
    <div class="colors"><label class="f">Client email<input name="client_email" type="email" required list="inv-people" autocomplete="off" placeholder="client@example.com"></label>
      <label class="f">Name<input name="client_name" placeholder="Their name"></label></div>
    <datalist id="inv-people">${people.filter((c) => c.email).slice(0, 500).map((c) => `<option value="${esc(c.email)}">${esc(c.name || '')}</option>`).join('')}</datalist>
    <label class="f">For <span class="hint">optional</span><input name="title" placeholder="e.g. Bathroom remodel, March coaching"></label>
    <div class="f"><span>Items</span><div data-lines>${line()}</div><button type="button" class="btn sm ghost" data-addline>${icon('plus')} Add a line</button></div>
    <div class="inv-total">Total <b data-total>${money(0)}</b></div>
    <label class="f">Due<input name="due_date" type="date" value="${due}"></label>
    <details><summary>Add a note</summary><label class="f"><textarea name="note" rows="2" placeholder="e.g. Thanks for your business! Bank transfer details on request."></textarea></label></details>
    <label class="check"><input type="checkbox" name="draft"> Save as a draft (don’t email it yet)</label>`,
  { submit: 'Send invoice', onSubmit: (v) => api('POST', '/api/invoices', { ...v, items: items(), send: !v.draft }) });
  const bg = $$('.modal-bg').pop();
  const items = () => $$('.inv-line', bg).map((l) => ({ description: $('[name=d]', l).value, qty: $('[name=q]', l).value, price: $('[name=p]', l).value }));
  const total = () => { $('[data-total]', bg).textContent = money(items().reduce((n, i) => n + (Number(i.qty) || 1) * Math.round((Number(i.price) || 0) * 100), 0)); };
  const wire = () => $$('[data-rm]', bg).forEach((b) => { b.onclick = () => { if ($$('.inv-line', bg).length > 1) b.parentElement.remove(); total(); }; });
  bg.addEventListener('input', (e) => {
    total();
    if (e.target.name === 'client_email') {
      const c = people.find((x) => x.email === e.target.value);
      const n = $('[name=client_name]', bg);
      if (c && !n.value) n.value = c.name || '';
    }
  });
  $('[data-addline]', bg).onclick = () => { $('[data-lines]', bg).insertAdjacentHTML('beforeend', line()); wire(); $$('.inv-line [name=d]', bg).pop().focus(); };
  $('[name=draft]', bg).onchange = (e) => { $('.actions .primary', bg).textContent = e.target.checked ? 'Save draft' : 'Send invoice'; };
  wire();
  const r = await pending;
  if (r?.id) toast(r.status === 'sent' ? `Invoice #${r.number} sent to ${r.client_email}` : `Draft #${r.number} saved`);
  return r;
}
