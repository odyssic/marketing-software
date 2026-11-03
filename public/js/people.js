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
  const q = params.get('q') || '', tag = params.get('tag') || '', stage = params.get('stage') || '', segment = params.get('segment') || '';
  const [all, tags, segs] = await Promise.all([api('GET', `/api/contacts?${new URLSearchParams({ q, tag, segment })}`), api('GET', '/api/tags'), api('GET', '/api/segments').catch(() => [])]);
  const seg = segs.find((s) => s.key === segment);
  const people = stage ? all.filter((c) => c.stage === stage) : all;
  const count = (s) => all.filter((c) => c.stage === s).length;
  const link = (over) => `#/people?${new URLSearchParams({ q, tag, stage, segment, ...over })}`;
  shell('people', `
    <div class="head"><div><h1>People</h1><div class="muted">One record per person: all your ${esc(state.me.account.people_word || 'people')}, leads and subscribers in one place.</div></div>
      <div class="row"><a class="btn" href="#/people/testimonials">${icon('quote')} Testimonials</a><a class="btn" href="/api/export.zip">${icon('download')} Export</a>
      <button class="btn primary" data-leads>${icon('plus')} Add leads</button></div></div>
    <div class="stagebar">
      <a href="${link({ stage: '' })}" class="${stage ? '' : 'active'}"><b>${all.length}</b>Everyone</a>
      ${STAGES.map(([k, l]) => `<a href="${link({ stage: k })}" class="${stage === k ? 'active' : ''} ${k}"><b>${count(k)}</b>${l}</a>`).join('<span class="arrow">→</span>')}
    </div>
    <div class="row" style="margin:14px 0"><input data-q placeholder="Search name, email, phone or city…" value="${esc(q)}" style="max-width:340px">
      <select data-tag style="max-width:220px"><option value="">All tags</option>${tags.map((t) => `<option value="${esc(t.tag)}" ${t.tag === tag ? 'selected' : ''}>${esc(t.tag)} (${t.count})</option>`).join('')}</select>
      <select data-seg style="max-width:260px" aria-label="Email behaviour"><option value="">Any email behaviour</option>
        ${[...new Set(segs.map((x) => x.group))].map((g) => `<optgroup label="${esc(g)}">${segs.filter((x) => x.group === g).map((x) => `<option value="${esc(x.key)}" ${x.key === segment ? 'selected' : ''}>${esc(x.label)} (${x.count})</option>`).join('')}</optgroup>`).join('')}</select></div>
    ${seg ? `<div class="seg-bar card"><span>${icon('target')} <b>${esc(seg.label)}</b> <span class="muted small">${esc(seg.description)} · ${seg.count} ${seg.count === 1 ? 'person' : 'people'}</span></span>
      <span class="row" style="gap:6px"><a class="btn sm primary" href="#/email/new?segment=${encodeURIComponent(seg.key)}">${icon('mail')} Email them</a><button class="btn sm" data-segtag>${icon('tag')} Save as tag</button>
      <a class="btn sm" href="${link({ segment: '' })}">Clear</a></span></div>` : ''}
    ${people.length ? `<div class="card table-wrap"><table>
      <tr><th>Name</th><th>Email</th><th>Stage</th><th>City</th><th>Tags</th><th>First source</th><th>Added</th></tr>
      ${people.map((c) => `<tr class="click" data-go="#/people/${c.id}"><td><strong>${esc(personName(c))}</strong></td>
        <td>${esc(c.email) || '<span class="muted">no email</span>'} ${c.unsubscribed ? '<span class="pill warn">unsubscribed</span>' : ''}</td>
        <td>${stagePill(c.stage)}</td><td>${esc(c.city)}</td>
        <td>${tagsHtml(c.tags)}</td><td class="muted small">${esc(c.source)}</td><td class="muted small">${fmtDate(c.created_at)}</td></tr>`).join('')}
    </table></div>` : `<div class="card empty"><div class="big">${icon('people')}</div><h2>${q || tag || stage || segment ? 'No matches' : 'No people yet'}</h2>
      <p>${q || tag || stage || segment ? 'Try a different search.' : 'Upload a spreadsheet, paste a list or a photo of a sign-up sheet, or add someone by hand.'}</p>
      ${q || tag || stage || segment ? '' : '<button class="btn primary" data-leads>' + icon('plus') + ' Add leads</button>'}</div>`}`);
  bindRowLinks();
  const go = () => { location.hash = link({ q: $('[data-q]').value, tag: $('[data-tag]').value }); };
  let t; $('[data-q]').oninput = () => { clearTimeout(t); t = setTimeout(go, 350); };
  $('[data-tag]').onchange = go;
  $('[data-seg]').onchange = (e) => { location.hash = link({ segment: e.target.value }); };
  const st = $('[data-segtag]');
  if (st) st.onclick = async () => {
    const v = await modal('Save this segment as a tag', `<p class="muted small">Tags everyone in “${esc(seg.label)}” now. Segments update as people open and click; a tag keeps today’s list, and can start a workflow.</p>
      <label class="f">Tag<input name="tag" required value="${esc(seg.label.toLowerCase().replace(/[“”"’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40))}"></label>`, { submit: 'Save tag' });
    if (!v) return;
    try { const r = await api('POST', '/api/segments/tag', { segment: seg.key, tag: v.tag }); toast(`Tagged ${r.tagged} ${r.tagged === 1 ? 'person' : 'people'} “${v.tag.toLowerCase()}”`); viewPeople(); }
    catch (err) { toast(err.message, true); }
  };
  const qEl = $('[data-q]'); if (q) { qEl.focus(); qEl.setSelectionRange(q.length, q.length); }
  $$('[data-leads]').forEach((b) => { b.onclick = () => addLeads(viewPeople); });
  // The dashboard's "Add leads" link lands here with ?add=1.
  if (new URLSearchParams(location.hash.split('?')[1] || '').get('add')) { history.replaceState(null, '', '#/people'); addLeads(viewPeople); }
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

const EVENT_ICON = { booking: icon('calendar'), signup: icon('pencil'), inquiry: icon('chat'), purchase: icon('bag'), subscribe: icon('inbox'), unsubscribe: icon('door'), open: icon('eye'), click: icon('cursor'), listen: icon('headphones'), scan: icon('camera'), visit: icon('globe'), note: icon('note') };
const EVENT_LABEL = { booking: 'Booked a call', signup: 'Signed up', inquiry: 'Inquiry', purchase: 'Bought', subscribe: 'Subscribed', unsubscribe: 'Unsubscribed', open: 'Opened an email', click: 'Clicked a link', listen: 'Listened', scan: 'Scanned a QR code', visit: 'Visited', note: 'Note' };
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
      <div class="row"><button class="btn" data-log>+ Log activity</button><button class="btn" data-addt>${icon('quote')} Add testimonial</button><button class="btn" data-edit>Edit</button></div></div>
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
  $('[data-addt]').onclick = async () => {
    const r = await modal(`Testimonial from ${personName(p)}`, `
      <label class="f">What they said <span class="hint">their words, not a summary</span><textarea name="quote" rows="4" required></textarea></label>
      <div class="colors" style="grid-template-columns:1fr 1fr"><label class="f">Show as<input name="name" value="${esc([p.first_name, p.last_name ? `${p.last_name[0]}.` : ''].filter(Boolean).join(' '))}" required></label>
        <label class="f">Detail <span class="hint">optional</span><input name="detail" placeholder="e.g. ${esc(p.city || 'Austin')}"></label></div>
      <label class="f">Where it came from<input name="source" placeholder="e.g. email, Google review, in person"></label>
      <label class="check"><input type="checkbox" name="consent" required> These are ${esc(personName(p))}’s real words, and they agreed to share them.</label>`,
    { submit: 'Save testimonial', onSubmit: (v) => api('POST', '/api/testimonials', { ...v, person_id: p.id }) });
    if (r) toast('Saved. It can now be shown on your pages');
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
    fields: ['email', 'name', 'first_name', 'last_name', 'phone', 'tags', 'unsubscribed', 'address1', 'address2', 'city', 'region', 'postal', 'country', 'source'] },
  orders: { label: 'Orders (store, Etsy, PayPal export)', endpoint: '/api/import/orders',
    fields: ['order_id', 'email', 'name', 'first_name', 'last_name', 'date', 'total', 'currency', 'item_name', 'item_qty', 'item_price', 'address1', 'address2', 'city', 'region', 'postal', 'country', 'tags'] },
  subscribers: { label: 'Newsletter subscribers (print or email)', endpoint: '/api/import/subscribers',
    fields: ['email', 'name', 'first_name', 'last_name', 'address1', 'address2', 'city', 'region', 'postal', 'country', 'product', 'format', 'status', 'started_at', 'tags'] },
  listens: { label: 'Podcast listens (from your podcast host)', endpoint: '/api/import/listens', fields: ['date', 'episode', 'listens'] },
};
const FIELD_LABEL = { unsubscribed: 'Unsubscribed / do not disturb', email: 'Email', name: 'Full name', first_name: 'First name', last_name: 'Last name', phone: 'Phone', tags: 'Tags', address1: 'Street address', address2: 'Address line 2', city: 'City', region: 'State / region', postal: 'ZIP / postal code', country: 'Country', source: 'Source', order_id: 'Order ID', date: 'Order date', total: 'Order total', currency: 'Currency', item_name: 'Item name', item_qty: 'Item quantity', item_price: 'Item price', product: 'Newsletter name', format: 'Format (print/email)', status: 'Status', started_at: 'Start date', episode: 'Episode', listens: 'Listens' };
const ALIASES = {
  email: ['email', 'emailaddress', 'customeremail', 'buyeremail', 'fromemailaddress', 'e-mail', 'mail', 'contactemail', 'primaryemail'],
  unsubscribed: ['unsubscribed', 'dnd', 'donotdisturb', 'emaildnd', 'unsubscribedat', 'unsub', 'optedout', 'emailstatus', 'status_unsubscribed'],
  name: ['name', 'fullname', 'customername', 'billingname', 'shippingname', 'buyer', 'buyername', 'shipname', 'contactname'],
  first_name: ['firstname', 'first', 'givenname', 'billingfirstname'], last_name: ['lastname', 'last', 'surname', 'familyname', 'billinglastname'],
  phone: ['phone', 'phonenumber', 'billingphone', 'shippingphone', 'mobile', 'mobilephone', 'cellphone', 'contactphone'], tags: ['tags', 'tag', 'labels', 'groups', 'contacttags', 'mailchimptags'],
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
// Moving from another tool: where to find the export, and what its columns are called.
const IMPORT_FROM = {
  '': { label: 'A spreadsheet or another tool', help: '' },
  mailchimp: { label: 'Mailchimp', help: 'Audience → All contacts → Export Audience. Unzip it and upload <b>subscribed</b> (and <b>unsubscribed</b> too, so those people stay opted out).' },
  gohighlevel: { label: 'GoHighLevel', help: 'Contacts → select all → Export. Tags and the DND (do not disturb) column come across.' },
  clickfunnels: { label: 'ClickFunnels', help: 'ClickFunnels 2.0: Contacts → Export. Classic: Contacts → Export contacts. Tags come across.' },
  shopify: { label: 'Shopify', help: 'Customers → Export → CSV for Excel. For order history, choose “Orders” above and export Orders.' },
  kit: { label: 'Kit (ConvertKit)', help: 'Subscribers → select all → Export. Unsubscribed people are marked as such.' },
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

async function importWizard(done, file) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  document.body.append(bg);
  const close = () => bg.remove();
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
  let type = 'people', headers = [], rows = [], mapping = [], from = '';

  const step1 = () => {
    bg.innerHTML = `<form class="modal"><h2>Import from a CSV</h2>
      <label class="f">Where’s it from?<select name="from">${Object.entries(IMPORT_FROM).map(([k, f]) => `<option value="${k}" ${k === from ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}</select></label>
      <p class="hint" data-fromhelp>${IMPORT_FROM[from]?.help || ''}</p>
      <label class="f">What’s in the file?<select name="type">${Object.entries(IMPORT_TYPES).map(([k, t]) => `<option value="${k}" ${k === type ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label>
      <label class="f">CSV file <span class="hint">with a header row</span><input type="file" name="file" accept=".csv,text/csv" required></label>
      <p class="hint">Re-importing is safe: people merge by email and orders skip ones already imported.</p>
      <div class="err"></div><div class="actions"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary">Next: match columns</button></div></form>`;
    $('[data-x]', bg).onclick = close;
    $('[name=from]', bg).onchange = (e) => { from = e.target.value; $('[data-fromhelp]', bg).innerHTML = IMPORT_FROM[from]?.help || ''; };
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
          ${(type === 'orders' ? ['store', 'etsy', 'paypal', 'stripe', 'other'] : ['import', 'newsletter', 'podcast', 'store', 'inquiry', 'social', 'referral', 'other']).map((s) => `<option>${s}</option>`).join('')}</select></label>`}
      ${type === 'people' ? `<label class="f">Also tag everyone with <span class="hint">optional</span><input name="tag" placeholder="e.g. spring-fair" value="${from ? `from-${from}` : ''}"></label>` : ''}
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
          : [`${n('created')} new people`, n('updated') && `${n('updated')} updated`, n('unsubscribed') && `${n('unsubscribed')} kept unsubscribed`, n('skipped') && `${n('skipped')} skipped (no email or name)`];
      toast(`${parts.filter(Boolean).join(' · ')} (${Math.round((Date.now() - t0) / 100) / 10}s)`);
      done?.();
    };
  };
  if (file) {
    // A spreadsheet dropped in "Add leads": go straight to matching columns.
    file.text().then((txt) => {
      const parsed = parseCsv(txt.replace(/^\ufeff/, ''));
      headers = parsed.shift() || []; rows = parsed;
      if (!headers.length || !rows.length) return step1();
      mapping = guessMapping(type, headers, rows.slice(0, 20));
      step2();
    });
  } else step1();
}

// ---------------- Add leads ----------------
// One door for every way people arrive: a spreadsheet, anything pasted or
// photographed (read by the AI), or one person typed in.
function addLeads(done) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal"><h2>Add leads</h2>
    <div class="choices">
      <button type="button" class="choice" data-c="csv"><span class="ci">${icon('download')}</span><span><b>Upload a spreadsheet</b><small>A CSV from Excel, Google Sheets, your store, Etsy, PayPal or a newsletter tool</small></span></button>
      <button type="button" class="choice" data-c="ai"><span class="ci">${icon('sparkle')}</span><span><b>Paste or drop anything</b><small>An email thread, a list, notes, or a photo of business cards or a sign-up sheet. AI finds the people for you to check.</small></span></button>
      <button type="button" class="choice" data-c="one"><span class="ci">${icon('user')}</span><span><b>Add one person</b><small>Type in their details</small></span></button>
    </div>
    <div class="dropzone" data-any style="margin-top:12px"><span class="dz-ico">${icon('upload')}</span><span class="dz-text"><b>Or drop a file here</b><span>CSV, text file or photo: we’ll pick the right way in</span></span></div>
    <div class="err"></div><div class="actions"><button type="button" class="btn" data-x>Cancel</button></div></div>`;
  document.body.append(bg);
  const close = () => bg.remove();
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
  $('[data-x]', bg).onclick = close;
  $$('[data-c]', bg).forEach((b) => { b.onclick = async () => {
    close();
    if (b.dataset.c === 'csv') return importWizard(done);
    if (b.dataset.c === 'ai') return aiLeads(done);
    const r = await modal('Add person', personForm(), { submit: 'Add person', onSubmit: (v) => api('POST', '/api/contacts', v) });
    if (r) { toast('Person added'); location.hash = `#/people/${r.id}`; }
  }; });
  const z = $('[data-any]', bg);
  z.ondragover = (e) => { e.preventDefault(); z.classList.add('over'); };
  z.ondragleave = () => z.classList.remove('over');
  z.ondrop = (e) => {
    e.preventDefault(); z.classList.remove('over');
    const f = e.dataTransfer.files[0];
    if (!f) return;
    close();
    if (/\.(csv|tsv)$/i.test(f.name) || f.type === 'text/csv') importWizard(done, f); else aiLeads(done, f);
  };
}

// Shrink a photo and return it as base64 for the AI to read.
async function photoForAI(file) {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return { media_type: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.85).split(',')[1] };
}

function aiLeads(done, file) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  document.body.append(bg);
  const close = () => bg.remove();
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
  let photo = null, photoName = '';

  const step1 = (text = '') => {
    bg.innerHTML = `<form class="modal wide"><h2>Paste or drop anything</h2>
      <p class="muted small">${state.me?.aiLive ? 'The AI reads it and lists the people it finds. Nothing is added until you check the list.' : 'No AI key is set, so this finds email addresses (and names next to them). Add an ANTHROPIC_API_KEY to read messy notes and photos too.'}</p>
      <label class="f">Text<textarea name="text" rows="9" placeholder="Paste an email thread, a list of names and emails, cells copied from a spreadsheet, notes from an event…">${esc(text)}</textarea></label>
      <div class="dropzone" data-photo tabindex="0" role="button"><span class="dz-ico">${icon('camera')}</span><span class="dz-text"><b data-pn>${photoName ? esc(photoName) : 'Drop a photo or text file'}</b><span>business cards, a sign-up sheet, a .txt or .vcf file, or click to choose</span></span>
        <input type="file" hidden accept="image/*,.txt,.vcf,.csv,.tsv,.md,text/plain"></div>
      <div class="err"></div><div class="actions"><button type="button" class="btn" data-x>Cancel</button><button class="btn primary">${icon('sparkle')} Find the people</button></div></form>`;
    $('[data-x]', bg).onclick = close;
    const z = $('[data-photo]', bg), input = $('input[type=file]', bg);
    const take = async (f) => {
      if (!f) return;
      if (f.type.startsWith('image/')) { photo = await photoForAI(f); photoName = f.name; $('[data-pn]', bg).textContent = `${f.name} (ready)`; }
      else { const t = $('textarea', bg); t.value = `${t.value ? `${t.value}\n` : ''}${await f.text()}`; }
    };
    z.onclick = () => input.click();
    z.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } };
    input.onchange = () => take(input.files[0]);
    z.ondragover = (e) => { e.preventDefault(); z.classList.add('over'); };
    z.ondragleave = () => z.classList.remove('over');
    z.ondrop = (e) => { e.preventDefault(); z.classList.remove('over'); take(e.dataTransfer.files[0]); };
    $('form', bg).onsubmit = async (e) => {
      e.preventDefault();
      const btn = $('button.primary', bg);
      const text = $('textarea', bg).value.trim();
      btn.disabled = true; btn.textContent = 'Reading…';
      try {
        const r = await api('POST', '/api/import/extract', { text, image: photo || undefined });
        if (!r.people.length) throw new Error(r.template ? 'No email addresses found. Without an AI key only emails can be picked out.' : 'No people found in that.');
        step2(r.people, text);
      } catch (err) { $('.err', bg).textContent = err.message; btn.disabled = false; btn.innerHTML = `${icon('sparkle')} Find the people`; }
    };
  };

  const F = [['first_name', 'First name'], ['last_name', 'Last name'], ['email', 'Email'], ['phone', 'Phone'], ['city', 'City'], ['note', 'Note']];
  const step2 = (people, text) => {
    bg.innerHTML = `<form class="modal wide"><h2>Check the ${people.length} ${people.length === 1 ? 'person' : 'people'} found</h2>
      <p class="muted small">Fix anything that’s wrong and untick anyone you don’t want. People already in your list are updated, not duplicated.</p>
      <div class="table-wrap" style="border:1px solid var(--line);border-radius:8px;max-height:46vh"><table class="mini leads">
        <tr><th><input type="checkbox" data-all checked aria-label="Select all"></th>${F.map(([, l]) => `<th>${l}</th>`).join('')}</tr>
        ${people.map((p, i) => `<tr><td><input type="checkbox" data-keep="${i}" checked aria-label="Include"></td>${F.map(([k]) => `<td><input data-r="${i}" data-k="${k}" value="${esc(p[k])}"></td>`).join('')}</tr>`).join('')}</table></div>
      <div class="colors" style="grid-template-columns:1fr 1fr;margin-top:12px">
        <label class="f">Where did they come from?<select name="source">${['inquiry', 'referral', 'social', 'event', 'newsletter', 'podcast', 'store', 'import', 'other'].map((s) => `<option>${s}</option>`).join('')}</select></label>
        <label class="f">Tag them <span class="hint">optional</span><input name="tag" placeholder="e.g. spring-fair"></label></div>
      <div class="err"></div><div class="actions"><button type="button" class="btn" data-back>Back</button><button class="btn primary">Add ${people.length} ${people.length === 1 ? 'person' : 'people'}</button></div></form>`;
    const count = () => $$('[data-keep]', bg).filter((c) => c.checked).length;
    const label = () => { const n = count(); $('button.primary', bg).textContent = `Add ${n} ${n === 1 ? 'person' : 'people'}`; $('button.primary', bg).disabled = !n; };
    $$('[data-keep]', bg).forEach((c) => { c.onchange = label; });
    $('[data-all]', bg).onchange = (e) => { $$('[data-keep]', bg).forEach((c) => { c.checked = e.target.checked; }); label(); };
    $$('[data-r]', bg).forEach((inp) => { inp.oninput = () => { people[inp.dataset.r][inp.dataset.k] = inp.value; }; });
    $('[data-back]', bg).onclick = () => step1(text);
    $('form', bg).onsubmit = async (e) => {
      e.preventDefault();
      const opts = Object.fromEntries(new FormData(e.target));
      const rows = people.filter((p, i) => $(`[data-keep="${i}"]`, bg).checked);
      const btn = $('button.primary', bg);
      btn.disabled = true; btn.textContent = 'Adding…';
      try {
        const r = await api('POST', '/api/import/people', { ...opts, rows });
        close();
        toast([`${r.created} new ${r.created === 1 ? 'person' : 'people'}`, r.updated && `${r.updated} updated`, r.skipped && `${r.skipped} skipped (no email or name)`].filter(Boolean).join(' · '));
        done?.();
      } catch (err) { $('.err', bg).textContent = err.message; label(); }
    };
  };

  step1();
  if (file) {
    if (file.type.startsWith('image/')) photoForAI(file).then((p) => { photo = p; photoName = file.name; $('[data-pn]', bg).textContent = `${file.name} (ready)`; });
    else file.text().then((t) => { $('textarea', bg).value = t; });
  }
}
