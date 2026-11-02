'use strict';

// ---------------- Products & orders ----------------
const BILLING_LABEL = { one_time: 'One-time', monthly: 'Monthly', yearly: 'Yearly' };

async function viewProducts(tab) {
  const orders = tab === 'orders';
  const items = await api('GET', orders ? '/api/orders' : '/api/products');
  const p = state.me.payments;
  shell('products', `
    <div class="head"><div><h1>Products</h1><div class="muted">What you sell, and the orders that come in.</div></div>
      <button class="btn primary" data-new>+ New product</button></div>
    ${p.connected ? (p.testKey ? '<div class="banner">Stripe is connected with a <b>test</b> key: checkouts use Stripe’s test cards and no real money moves.</div>' : '')
      : '<div class="banner"><b>Test mode:</b> Stripe isn’t connected, so checkouts are simulated and no card is charged. <a href="#/settings">Connect Stripe</a> to take real payments.</div>'}
    <div class="tabs"><a href="#/products" class="${orders ? '' : 'active'}">Products</a><a href="#/products/orders" class="${orders ? 'active' : ''}">Orders</a></div>
    ${orders ? ordersHtml(items) : productsHtml(items)}`);

  const form = (pr = {}) => `
    <label class="f">Product name<input name="name" required value="${esc(pr.name)}" placeholder="e.g. Lifetime access"></label>
    <label class="f">Description <span class="hint">shown at checkout</span><textarea name="description" rows="2">${esc(pr.description)}</textarea></label>
    <div class="colors"><label class="f">Price<input name="price" type="number" min="0.5" step="0.01" required value="${pr.price ?? ''}"></label>
      <label class="f">Currency<select name="currency">${['usd', 'eur', 'gbp', 'cad', 'aud'].map((c) => `<option value="${c}" ${pr.currency === c ? 'selected' : ''}>${c.toUpperCase()}</option>`).join('')}</select></label>
      <label class="f">Billing<select name="billing">${Object.entries(BILLING_LABEL).map(([k, l]) => `<option value="${k}" ${pr.billing === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    <label class="f">Photo <span class="hint">link to an image (https://…), shown on buy buttons</span><input name="image_url" value="${esc(pr.image_url || '')}" placeholder="https://"></label>
    <label class="f">Tag buyers with <span class="hint">buyers are always tagged “customer” too</span><input name="tag" value="${esc(pr.tag)}" placeholder="e.g. bought-course"></label>`;
  $('[data-new]').onclick = async () => {
    const r = await modal('New product', form(), { submit: 'Create product', onSubmit: (v) => api('POST', '/api/products', v) });
    if (r) {
      toast('Product created');
      if (await modal('Sell it on a page?', '<p class="muted">Create a pricing page funnel for this product now? You can edit everything after.</p>', { submit: 'Create pricing page' })) {
        const f = await api('POST', '/api/funnels', { name: `${(await api('GET', '/api/products')).find((x) => x.id === r.id).name} pricing`, template: 'pricing' });
        location.hash = `#/funnels/${f.id}`;
      } else viewProducts();
    }
  };
  $$('[data-edit]').forEach((row) => { row.onclick = async () => {
    const pr = items.find((x) => x.id === Number(row.dataset.edit));
    const pending = modal('Edit product', `${form(pr)}<button type="button" class="btn danger sm" data-delp>Delete product</button>`,
      { onSubmit: (v) => api('PUT', `/api/products/${pr.id}`, v) });
    $('[data-delp]').onclick = async () => {
      $('.modal-bg [data-x]').click();
      if (await confirmBox('Delete product?', `Pricing cards selling “${pr.name}” will stop taking payments. Past orders are kept.`)) {
        await api('DELETE', `/api/products/${pr.id}`); toast('Product deleted'); viewProducts();
      }
    };
    if (await pending) { toast('Saved'); viewProducts(); }
  }; });
}

const productsHtml = (items) => (items.length ? `<div class="card table-wrap"><table>
  <tr><th>Product</th><th>Price</th><th>Billing</th><th>Buyer tag</th><th>Sales</th></tr>
  ${items.map((pr) => `<tr class="click" data-edit="${pr.id}"><td><strong>${esc(pr.name)}</strong><div class="muted small">${esc(pr.description.slice(0, 70))}</div></td>
    <td>${esc(pr.priceLabel)}</td><td>${BILLING_LABEL[pr.billing]}</td><td>${pr.tag ? tagsHtml(pr.tag.split(',')) : ''}</td><td>${pr.sales}</td></tr>`).join('')}
  </table></div>` : `<div class="card empty"><div class="big">🛒</div><h2>No products yet</h2>
  <p>Create a product, then sell it with a Pricing card on any funnel page.</p></div>`);

const ordersHtml = (items) => (items.length ? `<div class="card table-wrap"><table>
  <tr><th>Order</th><th>Product</th><th>Buyer</th><th>Amount</th><th>Status</th><th>Date</th></tr>
  ${items.map((o) => `<tr><td>#${o.id}${o.mode === 'test' ? ' <span class="pill">test</span>' : ''}</td><td>${esc(o.product_name)}<div class="muted small">${esc(o.funnel_name || '')}</div></td>
    <td>${esc(o.email) || '<span class="muted">—</span>'}</td><td>${esc(o.amountLabel)}</td>
    <td><span class="pill ${o.status === 'paid' ? 'ok' : ''}">${o.status === 'pending' ? 'abandoned / pending' : esc(o.status)}</span></td>
    <td class="muted small">${fmtDate(o.paid_at || o.created_at)}</td></tr>`).join('')}
  </table></div>` : '<div class="card empty"><div class="big">🧾</div><h2>No orders yet</h2><p>Orders appear here when someone clicks buy on a pricing card.</p></div>');
