'use strict';

// ---------------- Settings ----------------
function viewSettings() {
  const a = state.me.account;
  shell('settings', `
    <div class="head"><h1>Settings</h1></div>
    ${state.me.billing?.enabled && state.me.role === 'owner' ? planCardHtml() : ''}
    <form class="card" style="max-width:560px" data-form>
      <h2>This business</h2>
      <label class="f">Business name<input name="name" required value="${esc(a.name)}"></label>
      <h2 style="margin-top:20px">Email sender</h2>
      <label class="f">Sender name <span class="hint">what people see in their inbox</span><input name="from_name" value="${esc(a.from_name || '')}" placeholder="${esc(a.name)}"></label>
      <label class="f">Replies go to <span class="hint">your own email</span><input name="from_email" type="email" value="${esc(a.from_email || '')}"></label>
      <p class="muted small">${state.me.emailLive ? `Email is <b>connected</b>. Emails are sent from Rilly’s verified address under your sender name, and replies come straight to you.` : 'Email is in <b>test mode</b>: messages are saved to Email → Outbox but not delivered.'}</p>
      <label class="check" style="margin:10px 0"><input type="checkbox" data-gravatar ${a.gravatar === 0 ? '' : 'checked'}> Show people’s public profile photos <span class="muted small">(from Gravatar, where they have one; looked up by a scrambled form of their email)</span></label>
      <div class="err"></div><button class="btn primary">Save settings</button>
    </form>
    <form class="card" style="max-width:560px;margin-top:16px" data-business>
      <h2>Kind of business</h2>
      <p class="muted small">Sets the starting follow-ups and which sections you see. Nothing is deleted when you change it.</p>
      <label class="f">This business is a<select name="business_type"><option value="">— Choose —</option>${BUSINESS_TYPES_UI.map(([k, l]) => `<option value="${k}" ${a.business_type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <div class="f">Show in the menu
        ${[['calendar', 'Calendar', 'people book calls or appointments from your pages'], ['pipelines', 'Deals', 'a board for quotes, jobs or clients you win one at a time'], ['products', 'Products', 'things you sell with checkout'], ['email', 'Email', 'newsletters and broadcasts']].map(([k, l, h]) => `<label class="check"><input type="checkbox" name="show" value="${k}" ${(a.hidden_sections || []).includes(k) ? '' : 'checked'}> <b>${l}</b> <span class="muted small">${h}</span></label>`).join('')}</div>
      <button class="btn primary">Save</button>
    </form>
    <form class="card" style="max-width:560px;margin-top:16px" data-reviews>
      <h2>Reviews</h2>
      <p class="muted small">Paste your Google review link (Google Business Profile → <b>Ask for reviews</b> → copy link), or any review page. Rilly asks happy customers once, at the right moment.</p>
      <label class="f">Review link<input name="review_url" type="url" value="${esc(a.review_url || '')}" placeholder="https://g.page/r/…/review"></label>
      <label class="check"><input type="checkbox" name="after_booking" ${a.review_after_booking === 0 ? '' : 'checked'}> A few hours after an appointment</label>
      <label class="check"><input type="checkbox" name="after_purchase" ${a.review_after_purchase === 0 ? '' : 'checked'}> Five days after a purchase</label>
      <p class="hint">At most once every 90 days per person, and never to anyone who unsubscribed.</p>
      <div class="err"></div><button class="btn primary">Save</button>
    </form>
    <form class="card" style="max-width:560px;margin-top:16px" data-voice>
      <h2>Your voice</h2>
      <p class="muted small">Paste 3 to 5 things you’ve written (an email, a product description, a post). Drafts copy your tone, not your words. ${state.me.aiLive ? '' : '<b>AI drafting isn’t connected</b> (set ANTHROPIC_API_KEY on the server), so drafts are templates for now.'}</p>
      ${[0, 1, 2, 3, 4].map((i) => `<label class="f">Sample ${i + 1}${i >= 3 ? ' <span class="hint">optional</span>' : ''}<textarea name="s${i}" rows="3">${esc(JSON.parse(a.voice_samples || '[]')[i] || '')}</textarea></label>`).join('')}
      <label class="f">Tone notes <span class="hint">e.g. “warm, a bit dry, never salesy, short sentences”</span><input name="notes" value="${esc(a.voice_notes || '')}"></label>
      <button class="btn primary">Save voice</button>
    </form>
    <div class="card" style="max-width:560px;margin-top:16px" data-digestcard>
      <h2>Weekly digest</h2>
      <p class="muted small">The only alert ${BRAND} sends: one email a week with what happened this week, how each area is doing, this week’s move and any inquiries older than 14 days. No push notifications.</p>
      <div class="row"><label class="f" style="margin:0">Send it on<select data-digestday>${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => `<option value="${i}" ${a.digest_day === i ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
        <button class="btn" data-digestpreview type="button">Preview</button><button class="btn" data-digestsend type="button">Send me one now</button></div>
    </div>
    <div class="card" style="max-width:560px;margin-top:16px" data-senddomain hidden></div>
    <div class="card" style="max-width:560px;margin-top:16px" data-sigcard><h2>Email signatures</h2>
      <p class="muted small">Design a signature once and it goes on your emails: newsletters, follow-ups and Inbox replies.</p>
      <div data-sigsummary class="muted small">Loading…</div>
      <button type="button" class="btn" data-sigmanage style="margin-top:8px">${icon('pencil')} Make or edit signatures</button></div>
    <form class="card" style="max-width:560px;margin-top:16px" data-texting><h2>Texting and calls</h2><p class="muted small">Loading…</p></form>
    <form class="card" style="max-width:560px;margin-top:16px" data-pagecode><h2>Tracking and custom CSS</h2><p class="muted small">Loading…</p></form>
    <form class="card" style="max-width:560px;margin-top:16px" data-domain>
      <h2>Your domain</h2>
      <p class="muted small">Connect it once for the whole business. The home website opens at the domain; every other website or pageflow lives at /its-name.</p>
      <label class="f">Domain<input name="domain" value="${esc(a.domain || '')}" placeholder="www.yourbusiness.com"></label>
      <label class="f">Home website<select name="home_funnel_id" data-homes><option value="">— Pick one —</option></select></label>
      <details class="hint"><summary>How to connect it</summary><ol style="padding-left:18px;margin:6px 0">
        <li>At your domain registrar, point a <b>CNAME</b> for <b>www</b> at <b>${esc(new URL(state.me.baseUrl).hostname)}</b>.</li>
        <li>In Netlify → Domain management, add the domain as an alias (HTTPS is automatic).</li><li>Save here and publish your pages.</li></ol></details>
      <div class="err"></div><button class="btn primary">Save domain</button>
    </form>
    <div class="card" style="max-width:560px;margin-top:16px" data-team><h2>People with access</h2><p class="muted small">Loading…</p></div>
    <div class="card" style="max-width:560px;margin-top:16px" data-subs>
      <div class="row" style="justify-content:space-between"><h2 style="margin:0">Sub-accounts</h2><button class="btn sm primary" data-newsub>${icon('plus')} New sub-account</button></div>
      <p class="muted small">One workspace per business. Each has its own people, pageflows, emails and dashboard.</p>
      <div data-sublist class="muted small">Loading…</div>
    </div>
    <div class="card" style="max-width:560px;margin-top:16px" data-datacard>
      <h2>Your data</h2>
      <p class="muted small">Download everything (people, events, orders, subscriptions, campaigns, pageflows, deals) at any time.</p>
      <div class="row"><a class="btn" href="/api/export.zip">${icon('download')} Every table as CSV (.zip)</a><a class="btn" href="/api/export.json">${icon('download')} Everything as JSON</a></div>
    </div>
    <form class="card" style="max-width:560px;margin-top:16px" data-stripe>
      <h2>Payments (Stripe)</h2>
      <p class="small">Status: ${state.me.payments.connected ? `<span class="pill ok">connected${state.me.payments.testKey ? ' · test key' : ''}</span> key ${esc(state.me.payments.keyHint)}`
        : '<span class="pill warn">not connected</span> checkouts run in test mode'}</p>
      ${!state.me.payments.connected && state.me.payments.canLogin ? `<button type="button" class="btn primary big stripe-login" data-stripelogin>Log in with Stripe</button>
        <p class="muted small" style="text-align:center">or sign up there, it’s free. Nothing to copy.</p>
        <details class="stripe-manual"><summary class="small">Paste a key instead</summary>` : ''}
      ${state.me.payments.connected ? '' : `<ol class="stripe-steps">
        <li><a class="btn" href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noopener">${icon('external')} Open my Stripe keys</a>
          <span class="muted small">Log in to Stripe (or sign up, it’s free). Next to <b>Secret key</b>, click <b>Reveal</b> and copy it.</span></li>
        <li>Paste it here and press <b>Connect</b>. Rilly sets up the rest in your Stripe account.</li></ol>`}
      <label class="f">${state.me.payments.connected ? 'Replace the key' : 'Secret key'}
        <input name="secretKey" type="password" autocomplete="off" placeholder="${state.me.payments.connected ? 'Paste a new key to replace it' : 'sk_live_… (or sk_test_… to try it out)'}"></label>
      ${!state.me.payments.connected && state.me.payments.canLogin ? '</details>' : ''}
      ${state.me.payments.connected && !state.me.payments.webhookSecretSet ? `<p class="hint">${icon('alert')} Paid orders are confirmed when buyers return to your page. To confirm them even if they close the tab, paste your key again (Rilly adds the webhook), or set it up yourself below.</p>` : ''}
      <details class="stripe-manual" ${state.me.payments.connected && !state.me.payments.webhookSecretSet ? 'open' : ''}><summary class="small">Set up the webhook yourself</summary>
        <p class="hint">Only needed if Rilly couldn’t add it for you. In Stripe → Developers → Webhooks, add an endpoint for <b>checkout.session.completed</b> pointing to:</p>
        <div class="copy" style="margin-bottom:10px"><input readonly aria-label="Webhook address" value="${esc(state.me.payments.webhookUrl)}"><button type="button" class="btn" data-copy="${esc(state.me.payments.webhookUrl)}">Copy</button></div>
        <label class="f">Its signing secret<input name="webhookSecret" type="password" autocomplete="off" placeholder="${state.me.payments.webhookSecretSet ? 'Saved. Paste a new one to replace it' : 'whsec_…'}"></label></details>
      <label class="check" style="margin:4px 0 12px"><input type="checkbox" data-recover ${state.me.account.recover_checkouts === 0 ? '' : 'checked'}> Remind people who start checking out but don’t finish <span class="muted small">(one email, an hour later)</span></label>
      <div class="err"></div>
      <div class="row"><button class="btn ${state.me.payments.canLogin && !state.me.payments.connected ? '' : 'primary'}">${state.me.payments.connected ? 'Save payment settings' : state.me.payments.canLogin ? 'Save' : 'Connect'}</button>
        ${state.me.payments.connected ? '<button type="button" class="btn danger" data-disconnect>Disconnect</button>' : ''}</div>
    </form>`);
  bindCopy();
  $('[data-newsub]').onclick = newSubAccount;
  $('[data-reviews]').onsubmit = async (e) => {
    e.preventDefault(); const f = e.target;
    try { await api('PUT', '/api/account/reviews', { review_url: f.review_url.value, after_booking: f.after_booking.checked, after_purchase: f.after_purchase.checked }); state.me = await api('GET', '/api/me'); toast(f.review_url.value ? 'Review requests on' : 'Saved'); }
    catch (err) { $('.err', f).textContent = err.message; }
  };
  $('[data-gravatar]').onchange = async (e) => { await api('PUT', '/api/account/gravatar', { on: e.target.checked }); state.me = await api('GET', '/api/me'); toast(e.target.checked ? 'Profile photos on' : 'Profile photos off'); };
  $('[data-recover]').onchange = async (e) => { await api('PUT', '/api/account/recovery', { on: e.target.checked }); state.me = await api('GET', '/api/me'); toast(e.target.checked ? 'Checkout reminders on' : 'Checkout reminders off'); };
  const bizForm = $('[data-business]');
  // Picking a type suggests its usual sections; the boxes can still be changed.
  bizForm.business_type.onchange = () => {
    const t = state.me.businessTypes.find((x) => x.key === bizForm.business_type.value);
    if (t) $$('[name="show"]', bizForm).forEach((c) => { c.checked = !t.hide.includes(c.value); });
  };
  bizForm.onsubmit = async (e) => {
    e.preventDefault();
    const shown = $$('[name="show"]:checked', bizForm).map((c) => c.value);
    await api('PUT', '/api/account/business', { business_type: bizForm.business_type.value, hidden_sections: ['calendar', 'pipelines', 'products', 'email'].filter((k) => !shown.includes(k)) });
    state.me = await api('GET', '/api/me'); toast('Saved'); viewSettings();
  };
  Promise.all([api('GET', '/api/websites'), api('GET', '/api/funnels')]).finally(() => setTimeout(() => trackDirty($('[data-domain]')))).then(([sites, funnels]) => {
    $('[data-homes]').innerHTML += [...sites, ...funnels].map((x) => `<option value="${x.id}" ${a.home_funnel_id === x.id ? 'selected' : ''}>${esc(x.name)} (${x.kind === 'website' ? 'website' : 'funnel'})</option>`).join('');
  });
  $('[data-domain]').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('PUT', '/api/account/domain', Object.fromEntries(new FormData(e.target))); state.me = await api('GET', '/api/me'); toast('Domain saved'); } catch (err) { $('.err', e.target).textContent = err.message; }
  };
  $('[data-digestday]').onchange = async (e) => { const r = await api('PUT', '/api/account/digest', { day: Number(e.target.value) }); state.me = await api('GET', '/api/me'); toast(`Digest moves to ${r.day}s`); };
  $('[data-digestpreview]').onclick = async () => { const d = await api('GET', '/api/digest/preview'); modal(d.subject, `<pre class="mail" style="max-height:60vh">${esc(d.text)}</pre>`, { submit: 'Close' }); };
  $('[data-digestsend]').onclick = async () => { const r = await api('POST', '/api/digest/send'); toast(`Sent to ${r.to}${r.status === 'logged' ? ' (dev mode: see Email → Outbox)' : ''}`); };
  $('[data-voice]').onsubmit = async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(e.target));
    const r = await api('PUT', '/api/account/voice', { samples: [0, 1, 2, 3, 4].map((i) => v[`s${i}`]), notes: v.notes });
    state.me = await api('GET', '/api/me');
    toast(r.samples >= 3 ? 'Voice saved' : `Voice saved. Add ${3 - r.samples} more sample${3 - r.samples === 1 ? '' : 's'} for the best match`);
  };
  api('GET', '/api/accounts').then(({ accounts, current }) => {
    $('[data-sublist]').innerHTML = accounts.map((a) => `<div class="li"><span><b style="color:var(--text)">${esc(a.name)}</b>
      ${a.id === current ? ' <span class="pill ok">current</span>' : ''}<br>${a.people} people · ${a.funnels} funnels</span>
      <span class="row">${a.id === current ? '' : `<button class="btn sm" data-sw="${a.id}">Switch</button>`}
      ${accounts.length > 1 ? `<button class="btn sm danger" data-delacct="${a.id}">Delete</button>` : ''}</span></div>`).join('');
    $$('[data-sw]').forEach((b) => { b.onclick = () => switchAccount(Number(b.dataset.sw)); });
    $$('[data-delacct]').forEach((b) => { b.onclick = async () => {
      const a = accounts.find((x) => x.id === Number(b.dataset.delacct));
      const r = await modal(`Delete ${a.name}?`, `<p>This permanently deletes <b>${esc(a.name)}</b> and everything in it: ${a.people} people, ${a.funnels} funnels, emails, orders and deals. It can’t be undone.</p>
        <p class="small">Export its data first from “Your data” while it’s the current sub-account.</p>
        <label class="f">Type <b>${esc(a.name)}</b> to confirm<input name="confirm" autocomplete="off" required></label>`,
      { submit: 'Delete forever', danger: true, onSubmit: (v) => api('DELETE', `/api/accounts/${a.id}`, v) });
      if (r) { state.me = await api('GET', '/api/me'); toast(`Deleted ${a.name}`); viewSettings(); }
    }; });
  });
  const saveStripe = async (body, form) => {
    try {
      const r = await api('PUT', '/api/account/stripe', body);
      state.me = await api('GET', '/api/me');
      toast(body.disconnect ? 'Stripe disconnected' : body.secretKey ? `Stripe connected${r.name ? `: ${r.name}` : ''}${r.webhook ? '' : '. One more step below'}` : 'Payment settings saved');
      viewSettings();
    } catch (err) { $('.err', form).textContent = err.message; }
  };
  const sl = $('[data-stripelogin]');
  if (sl) sl.onclick = async () => { sl.disabled = true; try { location.href = (await api('POST', '/api/account/stripe/connect')).url; } catch (e) { toast(e.message, true); sl.disabled = false; } };
  if (/[?&]stripe=connected/.test(location.hash)) { history.replaceState(history.state, '', '#/settings'); toast('Stripe connected. Real payments are on'); setTimeout(() => $('#set-payments')?.scrollIntoView({ block: 'start' })); }
  $('[data-stripe]').onsubmit = (e) => { e.preventDefault(); saveStripe(Object.fromEntries(new FormData(e.target)), e.target); };
  const dc = $('[data-disconnect]');
  if (dc) dc.onclick = async () => { if (await confirmBox('Disconnect Stripe?', 'Checkouts will switch to test mode until you connect again.', 'Disconnect')) saveStripe({ disconnect: true }, $('[data-stripe]')); };
  $('[data-form]').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('PUT', '/api/account', Object.fromEntries(new FormData(e.target)));
      state.me = await api('GET', '/api/me');
      toast('Settings saved'); viewSettings();
    } catch (err) { $('.err').textContent = err.message; }
  };
  const sigSummary = async () => {
    const s = await loadSignatures(true);
    const box = $('[data-sigsummary]'); if (!box) return;
    const def = s.list.find((x) => x.id === s.default);
    box.innerHTML = def ? `<div class="sig-mini">${signatureHtml(def)}</div><div style="margin-top:6px">${s.list.length} saved · this one goes on new emails</div>` : 'None yet.';
  };
  sigSummary();
  $('[data-sigmanage]').onclick = async () => { const s = await loadSignatures(true); if (s.list.length) manageSignatures(sigSummary); else { await editSignature(); sigSummary(); } };
  ['[data-form]', '[data-business]', '[data-reviews]', '[data-voice]', '[data-stripe]'].forEach((sel) => trackDirty($(sel)));
  groupSettings();
  loadSendDomain();
  loadPageCode();
  loadTeam();
  bindPlanCard();
  confirmPlanReturn();
  if (/[?&]plan=1/.test(location.hash)) setTimeout(() => $('#set-plan')?.scrollIntoView({ block: 'start' }));
  loadTextingSettings();
}

// Texting and calls: the workspace's number, where calls ring, the missed-call text,
// and the business details US carriers ask for before a business can text (10DLC).
async function loadTextingSettings() {
  const form = $('[data-texting]');
  if (!form) return;
  let t;
  try { t = await api('GET', '/api/account/texting'); } catch { form.innerHTML = '<h2>Texting and calls</h2><p class="muted small">Couldn’t load.</p>'; return; }
  const b = t.brand || {};
  // Sensible starting values from what Rilly already knows; the browser can autofill the rest.
  const site = state.me.account.domain ? `https://${state.me.account.domain}` : '';
  const start = { contact_name: state.me.user.name || '', contact_email: state.me.user.email || '', contact_phone: t.forward_to || '', website: site, legal_name: state.me.account.name };
  const AC = { legal_name: 'organization', address: 'street-address', website: 'url', contact_name: 'name', contact_email: 'email', contact_phone: 'tel' };
  const TYPE = { website: 'url', contact_email: 'email', contact_phone: 'tel' };
  const bf = (k, label, ph = '', hint = '') => `<label class="f">${label}${hint ? ` <span class="hint">${hint}</span>` : ''}<input name="b_${k}" value="${esc(b[k] ?? start[k] ?? '')}" placeholder="${esc(ph)}"${AC[k] ? ` autocomplete="${AC[k]}"` : ''}${TYPE[k] ? ` type="${TYPE[k]}"` : ''}></label>`;
  form.innerHTML = `<h2>Texting and calls</h2>
    <p class="small">Status: ${t.live && t.sms_number ? '<span class="pill ok">on</span> texts and calls go through your number' : t.sms_number ? '<span class="pill warn">test mode</span> texts are saved in the Inbox but not sent yet' : '<span class="pill">not set up</span>'}</p>
    <p class="muted small">Give customers one number to text or call. Texts and calls land in your Inbox; when you miss a call, ${BRAND} texts them straight back so you don’t lose the job.</p>
    ${t.live ? `<div class="getnum">${t.sms_number ? `<span>Your number: <b>${esc(t.sms_number)}</b></span><button type="button" class="btn sm" data-getnum>Get a different number</button>`
      : `<button type="button" class="btn primary" data-getnum>${icon('phone')} Get a number</button><span class="muted small">A local number for this business, ready in a minute.</span>`}</div>` : ''}
    <details class="hint" ${t.live ? '' : 'open'}><summary>${t.live ? 'I already have a number' : 'Your number'}</summary>
    <label class="f">Your ${BRAND} number <span class="hint">the number customers text and call</span><input name="sms_number" type="tel" value="${esc(t.sms_number)}" placeholder="+1 555 010 0000"></label></details>
    <label class="f">Ring my phone <span class="hint">calls forward here for 20 seconds first</span><input name="forward_to" type="tel" value="${esc(t.forward_to)}" placeholder="Your mobile (leave empty to text every caller back)"></label>
    <label class="f">Missed-call text <span class="hint">sent once per caller every 12 hours</span><textarea name="missed_call_text" rows="2" placeholder="${esc(t.default_text)}">${esc(t.missed_call_text)}</textarea></label>
    <details ${t.sms_number && !b.legal_name ? 'open' : ''}><summary><b>Business details for texting approval</b> <span class="muted small">US carriers require these before a business can text (called 10DLC). Approval usually takes 1 to 3 weeks.</span></summary>
      <div class="colors" style="grid-template-columns:1fr 1fr">${bf('legal_name', 'Legal business name', 'As on your tax records')}${bf('ein', 'EIN (tax ID)', '12-3456789', 'sole traders can skip')}</div>
      ${bf('address', 'Business address', 'Street, city, state, ZIP')}${bf('website', 'Website', 'https://')}
      <div class="colors">${bf('contact_name', 'Contact name')}${bf('contact_email', 'Contact email')}${bf('contact_phone', 'Contact phone')}</div>
      ${bf('use_case', 'What you text about', 'e.g. Appointment reminders, replies to customer questions, occasional offers')}
      ${bf('sample', 'A sample text', `e.g. Hi Sam, it’s ${state.me.account.name}. Your appointment is tomorrow at 10am. Reply STOP to opt out.`)}
    </details>
    ${t.live ? `<details class="hint"><summary>Connecting the number</summary><p>In Twilio, set the number’s “A message comes in” webhook to <code>${esc(t.hooks.sms)}</code> and “A call comes in” to <code>${esc(t.hooks.voice)}</code> (both HTTP POST).</p></details>` : ''}
    <div class="err"></div><button class="btn primary">Save texting</button>`;
  addressSuggest($('[name=b_address]', form));
  const gn = $('[data-getnum]', form); if (gn) gn.onclick = () => getNumber(loadTextingSettings);
  // Pre-filled suggestions that were never saved count as something to save.
  trackDirty(form, { dirty: !Object.keys(b).length && Object.values(start).some(Boolean) && Boolean(t.sms_number) });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(form));
    const brand = Object.fromEntries(Object.entries(v).filter(([k]) => k.startsWith('b_')).map(([k, x]) => [k.slice(2), x]));
    try {
      await api('PUT', '/api/account/texting', { sms_number: v.sms_number, forward_to: v.forward_to, missed_call_text: v.missed_call_text, brand });
      toast('Texting saved'); loadTextingSettings();
    } catch (err) { $('.err', form).textContent = err.message; }
  };
}

// Settings in a few short sections with an index, instead of one long scroll.
const SETTINGS_SECTIONS = [
  ['plan', 'Your plan', ['[data-plan]']],
  ['business', 'Business', ['[data-form]', '[data-business]', '[data-voice]']],
  ['email', 'Email', ['[data-senddomain]', '[data-sigcard]', '[data-digestcard]', '[data-reviews]']],
  ['texting', 'Texting and calls', ['[data-texting]']],
  ['payments', 'Payments', ['[data-stripe]']],
  ['address', 'Website', ['[data-domain]', '[data-pagecode]']],
  ['team', 'People with access', ['[data-team]']],
  ['workspaces', 'Workspaces and data', ['[data-subs]', '[data-datacard]']],
];
function groupSettings() {
  const main = $('.main');
  const cards = SETTINGS_SECTIONS.map(([, , sels]) => sels.map((x) => $(x)).filter(Boolean));
  const first = cards.flat()[0];
  if (!first) return;
  const wrap = document.createElement('div');
  wrap.className = 'set-layout';
  wrap.innerHTML = `<nav class="set-index" aria-label="Settings sections">${SETTINGS_SECTIONS.filter((x, i) => cards[i].length).map(([id, label]) => `<a href="#set-${id}" data-setlink="${id}">${label}</a>`).join('')}</nav><div class="set-body"></div>`;
  first.before(wrap);
  const body = $('.set-body', wrap);
  SETTINGS_SECTIONS.forEach(([id, label], i) => {
    if (!cards[i].length) return;
    const sec = document.createElement('section');
    sec.id = `set-${id}`; sec.className = 'set-sec';
    sec.innerHTML = `<h2 class="set-h">${label}</h2>`;
    cards[i].forEach((c) => { c.style.marginTop = ''; sec.append(c); });
    body.append(sec);
  });
  // Anything not in a section stays at the end.
  $$('.main > .card, .main > form.card').forEach((c) => body.append(c));
  // Index links scroll without changing the page address.
  $$('[data-setlink]', wrap).forEach((a) => { a.onclick = (e) => { e.preventDefault(); $(`#set-${a.dataset.setlink}`).scrollIntoView({ behavior: 'smooth', block: 'start' }); }; });
  const io = new IntersectionObserver((es) => es.forEach((en) => { if (en.isIntersecting) $$('[data-setlink]', wrap).forEach((a) => a.classList.toggle('on', `set-${a.dataset.setlink}` === en.target.id)); }), { rootMargin: '-20% 0px -70% 0px' });
  $$('.set-sec', body).forEach((x) => io.observe(x));
  void main;
}

// Send from your own domain: enter it, add the DNS records, check.
async function loadSendDomain(data) {
  const card = $('[data-senddomain]');
  if (!card) return;
  let d = data;
  if (!d) { try { d = await api('GET', '/api/account/sending-domain'); } catch { return; } }
  if (!d.available) { card.hidden = true; return; }
  card.hidden = false;
  const verified = d.status === 'verified';
  const STATUS = { verified: ['ok', 'Verified'], pending: ['warn', 'Checking…'], not_started: ['warn', 'Waiting for the records'], failed: ['warn', 'Not found yet'], temporary_failure: ['warn', 'Not found yet'] };
  const [cls, word] = STATUS[d.status] || ['warn', 'Waiting for the records'];
  card.innerHTML = `<h2>Send from your own domain</h2>
    ${!d.domain ? `<p class="muted small">Emails go out from Rilly’s address under your business name. Using your own domain (like hello@yourbusiness.com) looks more professional and lands in more inboxes.</p>
      <form class="sd-form" data-sdform><input name="local" value="hello" aria-label="Name before @" class="sd-local"><span class="sd-at">@</span><input name="domain" placeholder="yourbusiness.com" aria-label="Your domain" required>
        <button class="btn primary">Set up</button></form><div class="err"></div>`
    : verified ? `<p>${icon('check')} Emails now go out from <b>${esc(d.address)}</b>. Replies still come to your own email.</p>
      <div class="row"><button type="button" class="btn sm" data-sdchange>Change</button><button type="button" class="btn sm danger" data-sdremove>Stop using it</button></div>`
      : `<p class="small"><span class="pill ${cls}">${word}</span> Sending as <b>${esc(d.address)}</b> once these are added.</p>
      <ol class="sd-steps"><li>Sign in where you bought <b>${esc(d.domain)}</b> (GoDaddy, Namecheap, Squarespace, Cloudflare…) and open its <b>DNS</b> settings.</li>
        <li>Add each record below. Copy the name and value exactly. Leave TTL as it is.</li>
        <li>Come back and press <b>Check now</b>. It can take from a few minutes to a few hours to show up.</li></ol>
      <div class="sd-records">${d.records.map((r) => `<div class="sd-rec ${r.status === 'verified' ? 'ok' : ''}">
        <div class="sd-type">${esc(r.type)}${r.priority !== null ? ` <span class="muted small">priority ${esc(r.priority)}</span>` : ''}${r.status === 'verified' ? ` ${icon('check')}` : ''}</div>
        <label>Name<span class="copy"><input readonly value="${esc(r.name)}"><button type="button" class="btn sm" data-copy="${esc(r.name)}">Copy</button></span></label>
        <label>Value<span class="copy"><input readonly value="${esc(r.value)}"><button type="button" class="btn sm" data-copy="${esc(r.value)}">Copy</button></span></label></div>`).join('')}</div>
      <div class="err"></div>
      <div class="row"><button type="button" class="btn primary" data-sdcheck>Check now</button><button type="button" class="btn sm" data-sdremove>Cancel</button></div>
      <p class="hint">Until it’s verified, emails keep going out from Rilly’s address, so nothing stops.</p>`}`;
  bindCopy();
  const form = $('[data-sdform]', card);
  if (form) form.onsubmit = async (e) => {
    e.preventDefault();
    try { loadSendDomain(await api('POST', '/api/account/sending-domain', Object.fromEntries(new FormData(form)))); } catch (err) { $('.err', card).textContent = err.message; }
  };
  const check = $('[data-sdcheck]', card);
  if (check) check.onclick = async () => {
    check.disabled = true; check.textContent = 'Checking…';
    try {
      const r = await api('POST', '/api/account/sending-domain/verify');
      loadSendDomain(r);
      toast(r.status === 'verified' ? `Verified. Emails now go out from ${r.address}` : 'Not found yet. DNS changes can take a while: try again later.', r.status !== 'verified');
    } catch (err) { $('.err', card).textContent = err.message; check.disabled = false; check.textContent = 'Check now'; }
  };
  const remove = $('[data-sdremove]', card);
  if (remove) remove.onclick = async () => { await api('DELETE', '/api/account/sending-domain'); toast('Back to sending from Rilly’s address'); loadSendDomain(); };
  const change = $('[data-sdchange]', card);
  if (change) change.onclick = () => loadSendDomain({ ...d, domain: '' });
}

// Get a number: pick an area code, choose one, done.
async function getNumber(done) {
  const pending = modal('Get a number', `<p class="muted small">Pick an area code your customers know. The number is set up to land texts and calls in your Inbox.</p>
    <div class="row" style="gap:8px;align-items:flex-end"><label class="f" style="flex:1;margin:0">Area code<input name="area" inputmode="numeric" maxlength="3" placeholder="e.g. 503" data-area></label>
      <button type="button" class="btn" data-search>Search</button></div>
    <div data-results class="num-results"><p class="muted small">Search to see available numbers.</p></div>
    <p class="hint">About $1.15/month per number is included in your plan. Texting to US phones also needs the business details below approved by carriers.</p>`, { submit: 'Get this number', onSubmit: async (v) => {
      if (!v.phone) throw new Error('Pick one of the numbers');
      return api('POST', '/api/account/texting/numbers', { phone: v.phone });
    } });
  const m = $('.modal');
  const search = async () => {
    const box = $('[data-results]', m);
    box.innerHTML = '<p class="muted small">Searching…</p>';
    try {
      const list = await api('GET', `/api/account/texting/numbers?area=${encodeURIComponent($('[data-area]', m).value)}`);
      box.innerHTML = list.length ? list.map((n, i) => `<label class="choice num"><input type="radio" name="phone" value="${esc(n.phone)}" ${i ? '' : 'checked'}><span><b>${esc(n.pretty || n.phone)}</b><small>${esc(n.place)}</small></span></label>`).join('')
        : '<p class="muted small">No numbers left in that area code. Try a nearby one.</p>';
    } catch (e) { box.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  };
  $('[data-search]', m).onclick = search;
  $('[data-area]', m).onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } };
  const r = await pending;
  if (r) { toast(`${r.sms_number} is yours`); done?.(); }
}

// Ad pixels, analytics and CSS for every page of this business.
async function loadPageCode() {
  const form = $('[data-pagecode]');
  if (!form) return;
  let c = {};
  try { c = await api('GET', '/api/account/page-code'); } catch { /* empty form */ }
  const f = (k, label, ph, hint = '') => `<label class="f">${label}${hint ? ` <span class="hint">${hint}</span>` : ''}<input name="${k}" value="${esc(c[k] || '')}" placeholder="${ph}" spellcheck="false" autocomplete="off"></label>`;
  form.innerHTML = `<h2>Tracking and custom CSS</h2>
    <p class="muted small">Paste the IDs from your ad and analytics accounts. Rilly adds the right code to every page of this business.</p>
    <div class="colors" style="grid-template-columns:1fr 1fr">${f('meta', 'Meta (Facebook) Pixel ID', '1234567890123456')}${f('ga4', 'Google Analytics ID', 'G-XXXXXXX')}
      ${f('tiktok', 'TikTok Pixel ID', 'C1A2B3C4D5E6F7')}${f('gtm', 'Google Tag Manager ID', 'GTM-XXXXXX', 'on your own domain only')}</div>
    <label class="f">Custom CSS <span class="hint">applies to every page; a page can add its own in the editor</span><textarea name="css" rows="7" class="code" spellcheck="false" placeholder="h1 { font-family: Georgia, serif; }">${esc(c.css || '')}</textarea></label>
    <p class="hint">For embeds and widgets, add a <b>Custom HTML</b> block to any page.</p>
    <div class="err"></div><button class="btn primary">Save tracking and CSS</button>`;
  trackDirty(form);
  form.onsubmit = async (e) => {
    e.preventDefault();
    try { await api('PUT', '/api/account/page-code', Object.fromEntries(new FormData(form))); toast('Saved. It’s on every page now'); loadPageCode(); }
    catch (err) { $('.err', form).textContent = err.message; }
  };
}
