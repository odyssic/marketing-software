'use strict';

// ---------------- Settings → Integrations (webhooks, API keys, how to connect) ----------------
const INTEG_DEFAULT_EVENTS = ['person.created', 'form.submitted', 'order.paid', 'booking.created', 'tag.added', 'contact.unsubscribed'];

function integStatusPill(w) {
  if (!w.active) return '<span class="pill">Off</span>';
  if (!w.last_at) return '<span class="pill">Not used yet</span>';
  if (w.last_status >= 200 && w.last_status < 300) return '<span class="pill ok">Working</span>';
  return `<span class="pill warn" title="${esc(w.last_error || '')}">Not reaching it${w.last_status ? ` (${esc(w.last_status)})` : ''}</span>`;
}

function integCopyBox(value, label) {
  return `<div class="copy integ-secret"><input readonly aria-label="${esc(label)}" value="${esc(value)}"><button type="button" class="btn" data-integcopy="${esc(value)}">${icon('copy')} Copy</button></div>`;
}
function bindIntegCopy(root = document) {
  $$('[data-integcopy]', root).forEach((b) => { b.onclick = async () => {
    try { await navigator.clipboard.writeText(b.dataset.integcopy); toast('Copied'); } catch { b.previousElementSibling.select(); toast('Press Ctrl+C (or ⌘C) to copy', true); }
  }; });
}
// Shows a secret once, with a Copy button.
function showIntegSecret(title, text, value) {
  const p = modal(title, `<p class="muted small">${text}</p>${integCopyBox(value, title)}<p class="hint">${icon('alert')} You won’t see it again. If you lose it, make a new one.</p>`, { submit: 'Done' });
  setTimeout(() => { bindIntegCopy($('.modal')); $('.modal [data-x]')?.remove(); });
  return p;
}

async function loadIntegrations() {
  const card = $('[data-integrations]');
  if (!card) return;
  let d;
  try { d = await api('GET', '/api/integrations'); } catch { card.innerHTML = '<h2>Integrations</h2><p class="muted small">Couldn’t load.</p>'; return; }
  const can = d.can_manage;
  card.innerHTML = `<div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">Connect other apps</h2>
      <a class="btn sm" href="#/settings/developers">${icon('info')} How to connect</a></div>
    <p class="muted small">Send what happens in Rilly to Zapier, Make or your own tools, and let them add people and tags here.</p>
    <h3 class="integ-h">Webhooks <span class="muted small">Rilly tells another app when something happens</span></h3>
    <div class="integ-list">${d.webhooks.map((w) => `<div class="integ-row" data-hook="${w.id}">
        <span class="integ-main"><b class="integ-url" title="${esc(w.url)}">${esc(w.url.replace(/^https?:\/\//, ''))}</b>
          <span class="muted small">${w.events.map((e) => esc(e)).join(' · ')}</span></span>
        ${integStatusPill(w)}
        ${can ? `<button type="button" class="btn sm" data-hooktest="${w.id}">Send test</button>
        ${moreMenu(`<button role="menuitem" data-hooklog="${w.id}">${icon('history')} Recent deliveries</button>
          <button role="menuitem" data-hookedit="${w.id}">${icon('pencil')} Change</button>
          <button role="menuitem" data-hooktoggle="${w.id}">${icon(w.active ? 'pause' : 'play')} ${w.active ? 'Turn off' : 'Turn on'}</button>
          <button role="menuitem" data-hooksecret="${w.id}">${icon('undo')} New signing secret</button>
          <button role="menuitem" class="danger" data-hookdel="${w.id}">${icon('trash')} Remove</button>`)}` : `<button type="button" class="btn sm" data-hooklog="${w.id}">Deliveries</button>`}
      </div>`).join('') || '<p class="muted small">None yet.</p>'}</div>
    ${can ? `<button type="button" class="btn" data-hookadd>${icon('plus')} Add a webhook</button>` : ''}
    <h3 class="integ-h">API keys <span class="muted small">another app does things in Rilly</span></h3>
    <div class="integ-list">${d.keys.map((k) => `<div class="integ-row" data-key="${k.id}">
        <span class="integ-main"><b>${esc(k.name)}</b><span class="muted small">rilly_…${esc(k.hint)} · made ${esc(fmtDate(k.created_at))} · ${k.last_used_at ? `last used ${esc(fmtDate(k.last_used_at))}` : 'not used yet'}</span></span>
        ${can ? `<button type="button" class="btn sm" data-keydel="${k.id}">Remove</button>` : ''}</div>`).join('') || '<p class="muted small">None yet.</p>'}</div>
    ${can ? `<form class="integ-keyform" data-keyform><input name="name" placeholder="What it’s for, e.g. Zapier" aria-label="Key name" maxlength="80"><button class="btn">${icon('plus')} Make a key</button></form>`
    : '<p class="hint">Only the business owner can add or remove webhooks and keys.</p>'}`;
  bindMoreMenus(card);
  const hookOf = (x) => d.webhooks.find((w) => String(w.id) === String(x));

  const add = $('[data-hookadd]', card);
  if (add) add.onclick = () => editIntegHook(d, null);
  $$('[data-hookedit]', card).forEach((b) => { b.onclick = () => editIntegHook(d, hookOf(b.dataset.hookedit)); });
  $$('[data-hooktest]', card).forEach((b) => { b.onclick = async () => {
    b.disabled = true; b.textContent = 'Sending…';
    try {
      const r = await api('POST', `/api/integrations/webhooks/${b.dataset.hooktest}/test`);
      r.ok ? toast(`Test sent. It answered ${r.status}.`) : toast(`It didn’t arrive: ${r.error || r.status}`, true);
    } catch (e) { toast(e.message, true); }
    loadIntegrations();
  }; });
  $$('[data-hooktoggle]', card).forEach((b) => { b.onclick = async () => {
    const w = hookOf(b.dataset.hooktoggle);
    await api('PUT', `/api/integrations/webhooks/${w.id}`, { active: !w.active });
    toast(w.active ? 'Webhook off' : 'Webhook on'); loadIntegrations();
  }; });
  $$('[data-hooksecret]', card).forEach((b) => { b.onclick = async () => {
    const r = await api('POST', `/api/integrations/webhooks/${b.dataset.hooksecret}/secret`);
    await showIntegSecret('New signing secret', 'The old one stops working now. Paste this where you check the Rilly-Signature header.', r.secret);
  }; });
  $$('[data-hookdel]', card).forEach((b) => { b.onclick = () => deleteWithUndo('Webhook removed', {
    url: `/api/integrations/webhooks/${b.dataset.hookdel}`, hide: hideEl(b.closest('.integ-row')), done: loadIntegrations }); });
  $$('[data-hooklog]', card).forEach((b) => { b.onclick = () => showIntegDeliveries(hookOf(b.dataset.hooklog)); });
  $$('[data-keydel]', card).forEach((b) => { b.onclick = () => deleteWithUndo('Key removed. Apps using it stop working.', {
    url: `/api/integrations/keys/${b.dataset.keydel}`, hide: hideEl(b.closest('.integ-row')), done: loadIntegrations }); });
  const kf = $('[data-keyform]', card);
  if (kf) kf.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const k = await api('POST', '/api/integrations/keys', { name: kf.name.value });
      await showIntegSecret('Your new API key', `Paste it into Zapier, Make or your app as <b>Authorization: Bearer &lt;key&gt;</b>. It can read and change people in <b>${esc(state.me.account.name)}</b>.`, k.key);
      loadIntegrations();
    } catch (err) { toast(err.message, true); }
  };
}

async function editIntegHook(d, w) {
  const chosen = w ? w.events : INTEG_DEFAULT_EVENTS;
  const html = `<label class="f">Send to this address <span class="hint">from Zapier’s “Catch Hook”, Make’s “Custom webhook”, or your own app</span>
      <input name="url" type="url" required value="${esc(w?.url || '')}" placeholder="https://hooks.zapier.com/hooks/catch/…"></label>
    <div class="f">When<div class="integ-events">${Object.entries(d.events).map(([k, l]) => `<label class="check"><input type="checkbox" name="ev:${esc(k)}" ${chosen.includes(k) ? 'checked' : ''}> ${esc(l)} <code class="muted small">${esc(k)}</code></label>`).join('')}</div></div>`;
  const r = await modal(w ? 'Change webhook' : 'Add a webhook', html, { submit: w ? 'Save' : 'Add webhook', onSubmit: async (v) => {
    const events = Object.keys(v).filter((k) => k.startsWith('ev:') && v[k]).map((k) => k.slice(3));
    return w ? api('PUT', `/api/integrations/webhooks/${w.id}`, { url: v.url, events }) : api('POST', '/api/integrations/webhooks', { url: v.url, events });
  } });
  if (!r) return;
  if (r.secret) await showIntegSecret('Webhook added', 'Each message carries a <b>Rilly-Signature</b> header made with this secret, so your app can check it really came from Rilly. Zapier and Make don’t need it.', r.secret);
  else toast('Saved');
  loadIntegrations();
}

async function showIntegDeliveries(w) {
  const rows = await api('GET', `/api/integrations/webhooks/${w.id}/deliveries`);
  const word = { sent: ['ok', 'Delivered'], pending: ['warn', 'Will try again'], failed: ['', 'Gave up'] };
  await modal('Recent deliveries', rows.length ? `<p class="muted small integ-url">${esc(w.url)}</p><div class="integ-log">${rows.map((x) => {
    const [cls, l] = word[x.status] || ['', x.status];
    return `<div class="integ-logrow"><code>${esc(x.event)}</code><span class="pill ${cls}">${l}</span>
      <span class="muted small">${esc(new Date(x.created_at).toLocaleString())} · ${x.attempts} ${x.attempts === 1 ? 'try' : 'tries'}${x.response_status ? ` · answered ${esc(x.response_status)}` : ''}${x.error && !x.response_status ? ` · ${esc(x.error)}` : ''}</span></div>`;
  }).join('')}</div>` : '<p class="muted">Nothing sent yet. Press <b>Send test</b> to try it.</p>', { submit: 'Close' });
}

// ---------------- How to connect (developer notes, in plain words) ----------------
async function viewDevelopers() {
  let base = `${location.origin}/api/v1`;
  try { base = (await api('GET', '/api/integrations')).api_base; } catch { /* use this site's address */ }
  const ex = (s) => `<pre class="integ-code">${esc(s)}</pre>`;
  const ep = [
    ['GET', '/people', 'List people, newest first. Add ?search=, ?email=, ?tag=, ?limit= (up to 100) and ?before=<id> for the next page.'],
    ['GET', '/people/{id}', 'One person.'],
    ['POST', '/people', 'Add a person, or update the one with that email. Fields: email (needed), first_name, last_name, name, phone, tags, source. Tags are added, never removed.'],
    ['POST', '/people/{id}/tags', 'Add tags: { "tags": ["vip"] }'],
    ['DELETE', '/people/{id}/tags/{tag}', 'Remove one tag.'],
    ['POST', '/people/{id}/notes', 'Add a note to their timeline: { "note": "Called back" }. Or log another kind of event with "type" (e.g. inquiry).'],
    ['GET', '/products', 'Your products.'],
    ['GET', '/orders', 'Paid orders, newest first. ?since=2026-01-31 for orders since a date, ?status=all for unpaid too.'],
    ['GET', '/forms', 'Your pageflows and websites, with the forms on their pages.'],
    ['GET', '/follow-ups', 'Your follow-ups (automations).'],
    ['POST', '/follow-ups/{id}/enroll', 'Start a follow-up for someone: { "email": "…" } or { "person_id": 12 }. It runs when the follow-up is live.'],
    ['GET', '/me', 'Which business this key belongs to (good for testing a key).'],
  ];
  shell('settings', `<div class="head"><div><a class="muted small" href="#/settings">← Settings</a><h1>How to connect</h1></div></div>
    <div class="card integ-doc">
      <h2>With Zapier or Make (no code)</h2>
      <p><b>When something happens in Rilly → do something elsewhere</b> (a trigger):</p>
      <ol><li>In Zapier, start a Zap with <b>Webhooks by Zapier → Catch Hook</b> (in Make: <b>Webhooks → Custom webhook</b>). Copy the address it gives you.</li>
        <li>Here, go to Settings → Integrations → <b>Add a webhook</b>, paste the address and pick when to send.</li>
        <li>Press <b>Send test</b>, then in Zapier press <b>Test trigger</b>. You’ll see the sample person and can use their email, name and tags in the next steps.</li></ol>
      <p><b>Do something in Rilly</b> (an action), like adding a person with a tag:</p>
      <ol><li>Make an API key in Settings → Integrations.</li>
        <li>In Zapier, add <b>Webhooks by Zapier → POST</b> (or <b>Custom Request</b> for PUT/DELETE). In Make: <b>HTTP → Make a request</b>.</li>
        <li>URL: <code>${esc(base)}/people</code>, payload type <b>JSON</b>, data: <code>email</code>, <code>first_name</code>, <code>tags</code>.</li>
        <li>Add a header <code>Authorization</code> with the value <code>Bearer</code>, a space, then your key.</li></ol>
    </div>
    <div class="card integ-doc">
      <h2>What a webhook sends</h2>
      <p class="muted small">A JSON POST. The <code>id</code> is the same for every webhook that gets the same event, so you can skip repeats. If the other side doesn’t answer with a 2xx status, Rilly tries again after 1, 5 and 30 minutes, 2 hours and 12 hours.</p>
      ${ex(`{
  "id": "evt_3f2a…",
  "type": "form.submitted",
  "created_at": "2026-11-07T10:15:00.000Z",
  "account_id": 12,
  "person": { "id": 345, "email": "pat@example.com", "first_name": "Pat", "last_name": "Lee",
              "name": "Pat Lee", "phone": "", "tags": ["vip"], "stage": "lead",
              "source": "funnel", "unsubscribed": false, "created_at": "…" },
  "data": { "kind": "signup", "form": "Free guide", "pageflow_id": 7, "page_id": 31 }
}`)}
      <table class="integ-table"><tr><th>type</th><th>data</th></tr>
        <tr><td><code>person.created</code></td><td>source, came_in_through</td></tr>
        <tr><td><code>form.submitted</code></td><td>kind (signup, inquiry, newsletter), form, pageflow_id, page_id, message, newsletter</td></tr>
        <tr><td><code>order.paid</code></td><td>order_id, product, amount_cents, currency</td></tr>
        <tr><td><code>booking.created</code></td><td>starts_at, page, note</td></tr>
        <tr><td><code>tag.added</code></td><td>tag (one message per tag)</td></tr>
        <tr><td><code>contact.unsubscribed</code></td><td>reason</td></tr>
        <tr><td><code>email.opened</code>, <code>email.clicked</code></td><td>subject, campaign_id, follow_up_id</td></tr>
        <tr><td><code>test.ping</code></td><td>sent by the Send test button</td></tr></table>
      <h3>Checking the signature (optional)</h3>
      <p class="muted small">Every message has a header <code>Rilly-Signature: t=&lt;time&gt;,v1=&lt;hex&gt;</code>. It’s an HMAC-SHA256 of <code>&lt;time&gt;.&lt;raw body&gt;</code> with the webhook’s signing secret. In Node.js:</p>
      ${ex(`const crypto = require('crypto');
function fromRilly(rawBody, header, secret) {
  const { t, v1 } = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const want = crypto.createHmac('sha256', secret).update(\`\${t}.\${rawBody}\`).digest('hex');
  const fresh = Math.abs(Date.now() / 1000 - Number(t)) < 300; // within 5 minutes
  return fresh && v1?.length === want.length && crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(want));
}`)}
    </div>
    <div class="card integ-doc">
      <h2>The API</h2>
      <p class="muted small">Address: <code>${esc(base)}</code>. Send <code>Authorization: Bearer &lt;key&gt;</code> with every request and JSON bodies. A key works for one business only. Up to 120 requests a minute per key. Errors come back as <code>{ "error": "…" }</code> with a 4xx status.</p>
      <table class="integ-table">${ep.map(([m, p, t]) => `<tr><td><code>${m}</code></td><td><code>${esc(p)}</code></td><td>${esc(t)}</td></tr>`).join('')}</table>
      <h3>Examples</h3>
      ${ex(`# Add or update a person, with tags
curl -X POST ${base}/people \\
  -H "Authorization: Bearer $RILLY_KEY" -H "Content-Type: application/json" \\
  -d '{"email":"pat@example.com","first_name":"Pat","tags":["webinar"],"source":"zapier"}'

# Find someone by email
curl "${base}/people?email=pat@example.com" -H "Authorization: Bearer $RILLY_KEY"

# Add a tag, add a note
curl -X POST ${base}/people/345/tags -H "Authorization: Bearer $RILLY_KEY" \\
  -H "Content-Type: application/json" -d '{"tags":["vip"]}'
curl -X POST ${base}/people/345/notes -H "Authorization: Bearer $RILLY_KEY" \\
  -H "Content-Type: application/json" -d '{"note":"Asked about wholesale"}'

# Orders paid since a date
curl "${base}/orders?since=2026-11-01" -H "Authorization: Bearer $RILLY_KEY"

# Start a follow-up for someone
curl -X POST ${base}/follow-ups/8/enroll -H "Authorization: Bearer $RILLY_KEY" \\
  -H "Content-Type: application/json" -d '{"email":"pat@example.com"}'`)}
    </div>`);
}
