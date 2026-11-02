'use strict';

// ---------------- People ----------------
const STAGES = [['audience', 'Audience'], ['lead', 'Leads'], ['customer', 'Customers'], ['regular', 'Regulars']];
const STAGE_LABEL = { audience: 'Audience', lead: 'Lead', customer: 'Customer', regular: 'Regular' };
const stagePill = (s) => `<span class="stage ${esc(s)}">${esc(STAGE_LABEL[s] || s)}</span>`;
const personName = (c) => fullName(c) || c.email || 'Unnamed';
const addressLines = (c) => [c.address1, c.address2, [c.city, c.region].filter(Boolean).join(', ') + (c.postal ? ` ${c.postal}` : ''), c.country]
  .map((x) => String(x || '').trim()).filter(Boolean);

async function viewPeople() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const q = params.get('q') || '', tag = params.get('tag') || '', stage = params.get('stage') || '';
  const [all, tags] = await Promise.all([api('GET', `/api/contacts?${new URLSearchParams({ q, tag })}`), api('GET', '/api/tags')]);
  const people = stage ? all.filter((c) => c.stage === stage) : all;
  const count = (s) => all.filter((c) => c.stage === s).length;
  const link = (over) => `#/people?${new URLSearchParams({ q, tag, stage, ...over })}`;
  shell('people', `
    <div class="head"><div><h1>People</h1><div class="muted">One record per person, across your store, newsletter, podcast and inquiries.</div></div>
      <div class="row"><button class="btn" data-import>Import CSV</button><a class="btn" href="/api/export.zip">Export everything</a>
      <button class="btn primary" data-add>+ Add person</button></div></div>
    <div class="stagebar">
      <a href="${link({ stage: '' })}" class="${stage ? '' : 'active'}"><b>${all.length}</b>Everyone</a>
      ${STAGES.map(([k, l]) => `<a href="${link({ stage: k })}" class="${stage === k ? 'active' : ''} ${k}"><b>${count(k)}</b>${l}</a>`).join('<span class="arrow">→</span>')}
    </div>
    <div class="row" style="margin:14px 0"><input data-q placeholder="Search name, email, phone or city…" value="${esc(q)}" style="max-width:340px">
      <select data-tag style="max-width:220px"><option value="">All tags</option>${tags.map((t) => `<option value="${esc(t.tag)}" ${t.tag === tag ? 'selected' : ''}>${esc(t.tag)} (${t.count})</option>`).join('')}</select></div>
    ${people.length ? `<div class="card table-wrap"><table>
      <tr><th>Name</th><th>Email</th><th>Stage</th><th>City</th><th>Tags</th><th>First source</th><th>Added</th></tr>
      ${people.map((c) => `<tr class="click" data-go="#/people/${c.id}"><td><strong>${esc(personName(c))}</strong></td>
        <td>${esc(c.email) || '<span class="muted">no email</span>'} ${c.unsubscribed ? '<span class="pill warn">unsubscribed</span>' : ''}</td>
        <td>${stagePill(c.stage)}</td><td>${esc(c.city)}</td>
        <td>${tagsHtml(c.tags)}</td><td class="muted small">${esc(c.source)}</td><td class="muted small">${fmtDate(c.created_at)}</td></tr>`).join('')}
    </table></div>` : `<div class="card empty"><div class="big">👥</div><h2>${q || tag || stage ? 'No matches' : 'No people yet'}</h2>
      <p>${q || tag || stage ? 'Try a different search.' : 'Import your store orders, newsletter list or podcast signups to get started.'}</p>
      ${q || tag || stage ? '' : '<button class="btn primary" data-import>Import a CSV</button>'}</div>`}`);
  bindRowLinks();
  const go = () => { location.hash = link({ q: $('[data-q]').value, tag: $('[data-tag]').value }); };
  let t; $('[data-q]').oninput = () => { clearTimeout(t); t = setTimeout(go, 350); };
  $('[data-tag]').onchange = go;
  const qEl = $('[data-q]'); if (q) { qEl.focus(); qEl.setSelectionRange(q.length, q.length); }
  $('[data-add]').onclick = async () => {
    const r = await modal('Add person', personForm(), { submit: 'Add person', onSubmit: (v) => api('POST', '/api/contacts', v) });
    if (r) { toast('Person added'); location.hash = `#/people/${r.id}`; }
  };
  $$('[data-import]').forEach((b) => { b.onclick = () => importWizard(viewPeople); });
}

const personForm = (c = {}) => `
  <div class="colors" style="grid-template-columns:1fr 1fr"><label class="f">First name<input name="first_name" value="${esc(c.first_name)}"></label>
  <label class="f">Last name<input name="last_name" value="${esc(c.last_name)}"></label></div>
  <div class="colors" style="grid-template-columns:3fr 2fr"><label class="f">Email <span class="hint">optional for print-only people</span><input name="email" type="email" value="${esc(c.email)}"></label>
  <label class="f">Phone<input name="phone" value="${esc(c.phone)}"></label></div>
  <label class="f">Mailing address<input name="address1" value="${esc(c.address1)}" placeholder="Street"></label>
  <input name="address2" value="${esc(c.address2)}" placeholder="Apt, suite (optional)" style="margin:-6px 0 8px">
  <div class="colors" style="grid-template-columns:2fr 1fr 1fr 1fr;margin-bottom:8px"><input name="city" value="${esc(c.city)}" placeholder="City">
    <input name="region" value="${esc(c.region)}" placeholder="State"><input name="postal" value="${esc(c.postal)}" placeholder="ZIP"><input name="country" value="${esc(c.country)}" placeholder="Country"></div>
  <label class="f">Tags <span class="hint">comma separated</span><input name="tags" value="${esc((c.tags || []).join(', '))}"></label>`;

const EVENT_ICON = { signup: '✍️', inquiry: '💬', purchase: '🛍️', subscribe: '📬', unsubscribe: '🚪', open: '👀', click: '🖱️', listen: '🎧', scan: '📷', visit: '🌐', note: '📝' };
const EVENT_LABEL = { signup: 'Signed up', inquiry: 'Inquiry', purchase: 'Bought', subscribe: 'Subscribed', unsubscribe: 'Unsubscribed', open: 'Opened an email', click: 'Clicked a link', listen: 'Listened', scan: 'Scanned a QR code', visit: 'Visited', note: 'Note' };
const eventText = (e) => {
  const m = e.meta || {};
  const bits = [m.items || m.product, m.funnel && `funnel “${m.funnel}”`, m.format && `${m.format}`, m.campaign, m.url, m.note].filter(Boolean);
  return bits.map(esc).join(' · ');
};

async function viewPerson(personId) {
  const p = await api('GET', `/api/people/${personId}`);
  const addr = addressLines(p);
  shell('people', `
    <div class="head"><div><a href="#/people" class="small">← People</a>
      <h1 style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">${esc(personName(p))} ${stagePill(p.stage)}</h1>
      <div class="muted">${[p.email && esc(p.email), p.phone && esc(p.phone), `first came from <b>${esc(p.source)}</b>`, `added ${fmtDate(p.created_at)}`].filter(Boolean).join(' · ')}</div></div>
      <div class="row"><button class="btn" data-log>+ Log activity</button><button class="btn" data-edit>Edit</button></div></div>
    <div class="flowline">${STAGES.map(([k, l]) => `<div class="${k} ${STAGES.findIndex((s) => s[0] === k) <= STAGES.findIndex((s) => s[0] === p.stage) ? 'on' : ''}">${esc(l.replace(/s$/, ''))}</div>`).join('')}</div>
    <div class="grid two">
      <div class="card"><h2>Timeline</h2>
        ${p.events.length ? `<ol class="timeline">${p.events.map((e) => `<li><span class="ico">${EVENT_ICON[e.type] || '•'}</span>
          <div><b>${esc(EVENT_LABEL[e.type] || e.type)}</b>${e.value_cents ? ` · ${esc(e.valueLabel)}` : ''}${e.source ? ` <span class="muted small">via ${esc(e.source)}</span>` : ''}
          <div class="muted small">${eventText(e)}</div></div>
          <time class="muted small">${fmtDate(e.occurred_at)}</time></li>`).join('')}</ol>`
          : '<p class="muted">Nothing yet. Signups, purchases, opens and inquiries show up here.</p>'}
      </div>
      <div class="grid" style="align-content:start">
        <div class="card"><div class="grid" style="grid-template-columns:1fr 1fr;gap:8px">
          ${stat('Spent', esc(fmtMoney(p.totals.spent_cents)), `${p.totals.orders} order${p.totals.orders === 1 ? '' : 's'}`)}
          ${stat('Events', p.events.length, p.events[0] ? `last ${fmtDate(p.events[0].occurred_at)}` : 'none yet')}</div>
          ${addr.length ? `<h2 style="margin-top:14px">Mailing address</h2><div>${addr.map(esc).join('<br>')}</div>` : ''}
          ${p.tags.length ? `<h2 style="margin-top:14px">Tags</h2>${tagsHtml(p.tags)}` : ''}</div>
        <div class="card"><h2>Orders</h2>${p.orders.length ? p.orders.map((o) => `<div class="li"><span>${esc(o.product_name)}<span class="muted small"> · ${esc(o.source)}${o.status !== 'paid' ? ` · ${esc(o.status)}` : ''}</span></span>
          <span><b>${esc(o.amountLabel)}</b> <span class="muted small">${fmtDate(o.paid_at || o.created_at)}</span></span></div>`).join('') : '<p class="muted small">No orders yet.</p>'}</div>
        <div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Subscriptions</h2><button class="btn sm" data-sub>+ Subscribe</button></div>
          ${p.subscriptions.length ? p.subscriptions.map((s) => `<div class="li"><span>${esc(s.product)} <span class="pill">${esc(s.format)}</span> <span class="pill ${s.status === 'active' ? 'ok' : 'warn'}">${esc(s.status)}</span></span>
          <span>${s.status === 'active' ? `<button class="btn sm" data-substatus="${s.id}" data-to="cancelled">Cancel</button>` : `<button class="btn sm" data-substatus="${s.id}" data-to="active">Restart</button>`}</span></div>`).join('')
          : '<p class="muted small" style="margin-top:10px">Not subscribed to a newsletter.</p>'}</div>
        ${p.deals.length ? `<div class="card"><h2>Deals</h2>${p.deals.map((d) => `<a class="cdeal" href="#/pipelines/${d.pipeline_id}"><span>${esc(d.title)}</span>
          <span class="muted small">${d.status === 'open' ? esc(d.stage_name) : esc(d.status)} · ${esc(d.valueLabel)}</span></a>`).join('')}</div>` : ''}
      </div>
    </div>`);

  $('[data-edit]').onclick = async () => {
    const pending = modal('Edit person', `${personForm(p)}
      <label class="check"><input type="checkbox" name="unsubscribed" ${p.unsubscribed ? 'checked' : ''}>Unsubscribed from email</label>
      <button type="button" class="btn danger sm" data-delc>Delete person</button>`,
    { onSubmit: (v) => api('PUT', `/api/contacts/${p.id}`, v) });
    $('[data-delc]').onclick = async () => {
      $('.modal-bg [data-x]').click();
      if (await confirmBox('Delete person?', `${personName(p)} and their whole timeline will be permanently removed. Orders are kept.`)) {
        await api('DELETE', `/api/contacts/${p.id}`); toast('Person deleted'); location.hash = '#/people';
      }
    };
    if (await pending) { toast('Saved'); viewPerson(p.id); }
  };
  $('[data-log]').onclick = async () => {
    const r = await modal('Log activity', `
      <label class="f">What happened<select name="type">${['inquiry', 'note', 'listen', 'signup', 'open', 'click', 'scan', 'visit'].map((t) => `<option value="${t}">${EVENT_LABEL[t]}</option>`).join('')}</select></label>
      <label class="f">When<input name="occurred_at" type="date" value="${new Date().toISOString().slice(0, 10)}"></label>
      <label class="f">Details <span class="hint">optional</span><textarea name="note" rows="3" placeholder="e.g. Called asking about a custom order"></textarea></label>`,
    { submit: 'Log it', onSubmit: (v) => api('POST', `/api/people/${p.id}/events`, v) });
    if (r) { toast('Logged'); viewPerson(p.id); }
  };
  $('[data-sub]').onclick = async () => {
    const r = await modal('Add a subscription', `
      <label class="f">Newsletter<input name="product" value="Newsletter" required></label>
      <label class="f">Format<select name="format"><option value="email">Email</option><option value="print">Print (mailed)</option></select></label>`,
    { submit: 'Subscribe', onSubmit: (v) => api('POST', `/api/people/${p.id}/subscriptions`, v) });
    if (r) { toast('Subscribed'); viewPerson(p.id); }
  };
  $$('[data-substatus]').forEach((b) => { b.onclick = async () => {
    await api('PUT', `/api/subscriptions/${b.dataset.substatus}`, { status: b.dataset.to }); toast('Updated'); viewPerson(p.id);
  }; });
}
const fmtMoney = (cents, currency = 'usd') => new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase(), minimumFractionDigits: cents % 100 ? 2 : 0 }).format((cents || 0) / 100);

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

// ---------------- Import wizard ----------------
// Pick what you're importing, upload a CSV, match its columns (guessed for
// Squarespace, Shopify, Etsy and PayPal exports), check a preview, import.
const IMPORT_TYPES = {
  people: { label: 'People (a contact or mailing list)', endpoint: '/api/import/people',
    fields: ['email', 'name', 'first_name', 'last_name', 'phone', 'tags', 'address1', 'address2', 'city', 'region', 'postal', 'country', 'source'] },
  orders: { label: 'Orders (store, Etsy, PayPal export)', endpoint: '/api/import/orders',
    fields: ['order_id', 'email', 'name', 'first_name', 'last_name', 'date', 'total', 'currency', 'item_name', 'item_qty', 'item_price', 'address1', 'address2', 'city', 'region', 'postal', 'country', 'tags'] },
  subscribers: { label: 'Newsletter subscribers (print or email)', endpoint: '/api/import/subscribers',
    fields: ['email', 'name', 'first_name', 'last_name', 'address1', 'address2', 'city', 'region', 'postal', 'country', 'product', 'format', 'status', 'started_at', 'tags'] },
  listens: { label: 'Podcast listens (from your podcast host)', endpoint: '/api/import/listens', fields: ['date', 'episode', 'listens'] },
};
const FIELD_LABEL = { email: 'Email', name: 'Full name', first_name: 'First name', last_name: 'Last name', phone: 'Phone', tags: 'Tags', address1: 'Street address', address2: 'Address line 2', city: 'City', region: 'State / region', postal: 'ZIP / postal code', country: 'Country', source: 'Source', order_id: 'Order ID', date: 'Order date', total: 'Order total', currency: 'Currency', item_name: 'Item name', item_qty: 'Item quantity', item_price: 'Item price', product: 'Newsletter name', format: 'Format (print/email)', status: 'Status', started_at: 'Start date', episode: 'Episode', listens: 'Listens' };
const ALIASES = {
  email: ['email', 'emailaddress', 'customeremail', 'buyeremail', 'fromemailaddress', 'e-mail', 'mail'],
  name: ['name', 'fullname', 'customername', 'billingname', 'shippingname', 'buyer', 'buyername', 'shipname', 'contactname'],
  first_name: ['firstname', 'first', 'givenname', 'billingfirstname'], last_name: ['lastname', 'last', 'surname', 'familyname', 'billinglastname'],
  phone: ['phone', 'phonenumber', 'billingphone', 'shippingphone', 'mobile'], tags: ['tags', 'tag', 'labels', 'groups'],
  address1: ['address1', 'address', 'street', 'streetaddress', 'addressline1', 'shippingaddress1', 'shippingaddress', 'shipaddress1', 'street1', 'billingaddress1', 'mailingaddress'],
  address2: ['address2', 'addressline2', 'shippingaddress2', 'shipaddress2', 'street2', 'billingaddress2', 'apt', 'suite'],
  city: ['city', 'shippingcity', 'shipcity', 'billingcity', 'town'], region: ['state', 'province', 'region', 'shippingprovince', 'shippingstate', 'shipstate', 'billingprovince', 'billingstate', 'statecode'],
  postal: ['zip', 'zipcode', 'postal', 'postalcode', 'postcode', 'shippingzip', 'shipzipcode', 'shippingpostalcode', 'billingzip'],
  country: ['country', 'shippingcountry', 'shipcountry', 'billingcountry', 'countrycode'], source: ['source', 'firstsource', 'channel', 'leadsource'],
  order_id: ['orderid', 'ordernumber', 'order', 'orderno', 'transactionid', 'saleid', 'receiptid'], date: ['date', 'createdat', 'orderdate', 'paidat', 'saledate', 'datepaid', 'created', 'datecreated'],
  total: ['total', 'ordertotal', 'gross', 'amount', 'totalprice', 'ordervalue', 'grandtotal', 'net'], currency: ['currency', 'currencycode'],
  item_name: ['lineitemname', 'itemname', 'product', 'productname', 'title', 'item', 'itemtitle'], item_qty: ['lineitemquantity', 'quantity', 'qty', 'itemquantity'],
  item_price: ['lineitemprice', 'price', 'itemprice', 'unitprice', 'itemtotal'],
  product: ['newsletter', 'publication', 'list', 'productname'], format: ['format', 'delivery', 'type'], status: ['status', 'subscriptionstatus'],
  started_at: ['startedat', 'startdate', 'subscribedat', 'datesubscribed', 'since', 'joined', 'signupdate'],
  episode: ['episode', 'episodetitle', 'title', 'episodename'], listens: ['listens', 'downloads', 'plays', 'count', 'totallistens', 'totaldownloads'],
};
const normHeader = (h) => String(h).toLowerCase().replace(/[^a-z0-9]/g, '');
function guessMapping(type, headers, sample) {
  const fields = IMPORT_TYPES[type].fields;
  const used = new Set();
  return headers.map((h, i) => {
    const n = normHeader(h);
    // Shopify's "Name" column is the order number (#1001), not a person.
    if (type === 'orders' && n === 'name' && sample.every((r) => !r[i] || /^#?\d+$/.test(r[i].trim()))) { used.add('order_id'); return 'order_id'; }
    const hit = fields.find((f) => !used.has(f) && (ALIASES[f] || [f]).includes(n));
    if (hit) used.add(hit);
    return hit || '';
  });
}

async function importWizard(done) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  document.body.append(bg);
  const close = () => bg.remove();
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
  let type = 'people', headers = [], rows = [], mapping = [];

  const step1 = () => {
    bg.innerHTML = `<form class="modal"><h2>Import from a CSV</h2>
      <label class="f">What’s in the file?<select name="type">${Object.entries(IMPORT_TYPES).map(([k, t]) => `<option value="${k}" ${k === type ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label>
      <label class="f">CSV file <span class="hint">with a header row</span><input type="file" name="file" accept=".csv,text/csv" required></label>
      <p class="hint">Re-importing is safe: people merge by email and orders skip ones already imported.</p>
      <div class="err"></div><div class="actions"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary">Next: match columns</button></div></form>`;
    $('[data-x]', bg).onclick = close;
    $('form', bg).onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      type = f.get('type');
      const parsed = parseCsv((await f.get('file').text()).replace(/^﻿/, ''));
      headers = parsed.shift() || [];
      rows = parsed;
      if (!headers.length || !rows.length) { $('.err', bg).textContent = 'That file has no rows under the header.'; return; }
      mapping = guessMapping(type, headers, rows.slice(0, 20));
      step2();
    };
  };

  const mapped = () => rows.map((cells) => {
    const o = {};
    mapping.forEach((f, i) => { if (f && cells[i] !== undefined && String(cells[i]).trim()) o[f] = String(cells[i]).trim(); });
    return o;
  });
  // Orders: one row per line item → group rows that share an order id.
  const groupOrders = (list) => {
    const byId = new Map(), out = [];
    for (const r of list) {
      const key = r.order_id || Symbol('row');
      let o = byId.get(key);
      if (!o) {
        o = { ...r, items: [] };
        delete o.item_name; delete o.item_qty; delete o.item_price;
        byId.set(key, o); out.push(o);
      } else for (const [k, v] of Object.entries(r)) if (!k.startsWith('item_') && !o[k]) o[k] = v;
      if (r.item_name) o.items.push({ name: r.item_name, qty: r.item_qty || 1, price: r.item_price || '' });
    }
    return out;
  };

  const step2 = () => {
    const t = IMPORT_TYPES[type];
    const preview = mapped().slice(0, 5);
    const cols = t.fields.filter((f) => mapping.includes(f));
    const records = type === 'orders' ? groupOrders(mapped()).length : rows.length;
    const needs = type === 'listens' ? ['listens'] : type === 'orders' ? ['email', 'name', 'first_name'] : type === 'subscribers' ? ['email', 'name', 'first_name', 'address1'] : ['email', 'name', 'first_name'];
    bg.innerHTML = `<form class="modal wide"><h2>Match your columns</h2>
      <p class="muted small">${rows.length} rows${type === 'orders' ? ` → ${records} orders` : ''}. We guessed the matches; change any that are wrong, or skip a column.</p>
      <div class="mapgrid">${headers.map((h, i) => `<div class="m"><span title="${esc(h)}">${esc(h)}</span><span class="muted small">${esc((rows[0][i] || '').slice(0, 30))}</span>
        <select data-col="${i}"><option value="">— skip —</option>${t.fields.map((f) => `<option value="${f}" ${mapping[i] === f ? 'selected' : ''}>${esc(FIELD_LABEL[f])}</option>`).join('')}</select></div>`).join('')}</div>
      ${type === 'listens' ? '' : type === 'subscribers' ? `<div class="colors" style="grid-template-columns:2fr 1fr;margin-top:12px"><label class="f">Newsletter name<input name="product" value="Newsletter"></label>
        <label class="f">Format<select name="format"><option value="email">Email</option><option value="print">Print</option></select></label></div>`
        : `<label class="f" style="margin-top:12px">Where did these ${type === 'orders' ? 'orders' : 'people'} come from?<select name="source">
          ${(type === 'orders' ? ['store', 'etsy', 'paypal', 'stripe', 'other'] : ['newsletter', 'podcast', 'store', 'inquiry', 'social', 'referral', 'import', 'other']).map((s) => `<option>${s}</option>`).join('')}</select></label>`}
      ${type === 'people' ? '<label class="f">Also tag everyone with <span class="hint">optional</span><input name="tag" placeholder="e.g. spring-fair"></label>' : ''}
      <h2 style="margin-top:6px">Preview</h2>
      ${cols.length ? `<div class="table-wrap" style="border:1px solid var(--line);border-radius:8px"><table class="mini"><tr>${cols.map((c) => `<th>${esc(FIELD_LABEL[c])}</th>`).join('')}</tr>
        ${preview.map((r) => `<tr>${cols.map((c) => `<td>${esc(r[c] || '')}</td>`).join('')}</tr>`).join('')}</table></div>` : '<p class="muted">Match at least one column.</p>'}
      <div class="err">${needs.some((f) => mapping.includes(f)) ? '' : `Match an ${needs.map((f) => FIELD_LABEL[f].toLowerCase()).join(' or ')} column so we know who each row is.`}</div>
      <div class="actions"><button type="button" class="btn" data-back>Back</button><button class="btn primary" ${needs.some((f) => mapping.includes(f)) ? '' : 'disabled'}>Import ${records} ${type === 'orders' ? 'orders' : 'rows'}</button></div></form>`;
    $$('[data-col]', bg).forEach((s) => { s.onchange = () => {
      const i = Number(s.dataset.col);
      if (s.value) mapping = mapping.map((m) => (m === s.value ? '' : m));
      mapping[i] = s.value;
      const keep = Object.fromEntries(new FormData($('form', bg)));
      step2();
      for (const [k, v] of Object.entries(keep)) { const el = $(`[name="${k}"]`, bg); if (el) el.value = v; }
    }; });
    $('[data-back]', bg).onclick = step1;
    $('form', bg).onsubmit = async (e) => {
      e.preventDefault();
      const opts = Object.fromEntries(new FormData(e.target));
      const list = type === 'orders' ? groupOrders(mapped()) : mapped();
      const key = type === 'orders' ? 'orders' : 'rows';
      const btn = $('button.primary', bg);
      btn.disabled = true;
      const sum = {};
      const t0 = Date.now();
      try {
        // Small batches keep each request quick (serverless time limits).
        for (let i = 0; i < list.length; i += 200) {
          btn.textContent = `Importing… ${Math.min(i + 200, list.length)} of ${list.length}`;
          const r = await api('POST', t.endpoint, { ...opts, [key]: list.slice(i, i + 200) });
          for (const [k, v] of Object.entries(r)) sum[k] = (sum[k] || 0) + v;
        }
      } catch (err) { $('.err', bg).textContent = err.message; btn.disabled = false; btn.textContent = 'Try again'; return; }
      close();
      const n = (k) => sum[k] || 0;
      const parts = type === 'orders' ? [`${n('created')} orders imported`, n('people') && `${n('people')} new people`, n('duplicates') && `${n('duplicates')} already imported`, n('skipped') && `${n('skipped')} skipped (no email or name)`]
        : type === 'listens' ? [`${n('created')} listen rows imported`, n('skipped') && `${n('skipped')} skipped (no date or count)`]
        : type === 'subscribers' ? [`${n('created')} subscribers added`, n('existing') && `${n('existing')} already subscribed`, n('skipped') && `${n('skipped')} skipped`]
          : [`${n('created')} new people`, n('updated') && `${n('updated')} updated`, n('skipped') && `${n('skipped')} skipped (no email or name)`];
      toast(`${parts.filter(Boolean).join(' · ')} (${Math.round((Date.now() - t0) / 100) / 10}s)`);
      done?.();
    };
  };
  step1();
}
