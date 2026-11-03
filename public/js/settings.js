'use strict';

// ---------------- Settings ----------------
function viewSettings() {
  const a = state.me.account;
  shell('settings', `
    <div class="head"><h1>Settings</h1></div>
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
    <div class="card" style="max-width:560px;margin-top:16px">
      <h2>Weekly digest</h2>
      <p class="muted small">The only alert ${BRAND} sends: one email a week with lever health, this week’s move and any inquiries older than 14 days. No push notifications.</p>
      <div class="row"><label class="f" style="margin:0">Send it on<select data-digestday>${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => `<option value="${i}" ${a.digest_day === i ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
        <button class="btn" data-digestpreview type="button">Preview</button><button class="btn" data-digestsend type="button">Send me one now</button></div>
    </div>
    <form class="card" style="max-width:560px;margin-top:16px" data-domain>
      <h2>Your domain</h2>
      <p class="muted small">Connect it once for the whole business. The home website opens at the domain; every other website or funnel lives at /its-name.</p>
      <label class="f">Domain<input name="domain" value="${esc(a.domain || '')}" placeholder="www.yourbusiness.com"></label>
      <label class="f">Home website<select name="home_funnel_id" data-homes><option value="">— Pick one —</option></select></label>
      <details class="hint"><summary>How to connect it</summary><ol style="padding-left:18px;margin:6px 0">
        <li>At your domain registrar, point a <b>CNAME</b> for <b>www</b> at <b>${esc(new URL(state.me.baseUrl).hostname)}</b>.</li>
        <li>In Netlify → Domain management, add the domain as an alias (HTTPS is automatic).</li><li>Save here and publish your pages.</li></ol></details>
      <div class="err"></div><button class="btn primary">Save domain</button>
    </form>
    <div class="card" style="max-width:560px;margin-top:16px" data-subs>
      <div class="row" style="justify-content:space-between"><h2 style="margin:0">Sub-accounts</h2><button class="btn sm primary" data-newsub>${icon('plus')} New sub-account</button></div>
      <p class="muted small">One workspace per business. Each has its own people, funnels, emails and dashboard.</p>
      <div data-sublist class="muted small">Loading…</div>
    </div>
    <div class="card" style="max-width:560px;margin-top:16px">
      <h2>Your data</h2>
      <p class="muted small">Download everything (people, events, orders, subscriptions, campaigns, funnels, deals) at any time.</p>
      <div class="row"><a class="btn" href="/api/export.zip">${icon('download')} Every table as CSV (.zip)</a><a class="btn" href="/api/export.json">${icon('download')} Everything as JSON</a></div>
    </div>
    <form class="card" style="max-width:560px;margin-top:16px" data-stripe>
      <h2>Payments (Stripe)</h2>
      <p class="small">Status: ${state.me.payments.connected ? `<span class="pill ok">connected${state.me.payments.testKey ? ' · test key' : ''}</span> key ${esc(state.me.payments.keyHint)}`
        : '<span class="pill warn">not connected</span> checkouts run in test mode'}</p>
      <label class="f">Secret key <span class="hint">Stripe Dashboard → Developers → API keys</span>
        <input name="secretKey" type="password" autocomplete="off" placeholder="${state.me.payments.connected ? 'Saved. Paste a new key to replace it' : 'sk_live_… or sk_test_…'}"></label>
      <label class="f">Webhook signing secret <span class="hint">recommended</span>
        <input name="webhookSecret" type="password" autocomplete="off" placeholder="${state.me.payments.webhookSecretSet ? 'Saved. Paste a new one to replace it' : 'whsec_…'}"></label>
      <p class="hint">In Stripe, add a webhook endpoint for <b>checkout.session.completed</b> pointing to:</p>
      <div class="copy" style="margin-bottom:12px"><input readonly aria-label="Webhook address" value="${esc(state.me.payments.webhookUrl)}"><button type="button" class="btn" data-copy="${esc(state.me.payments.webhookUrl)}">Copy</button></div>
      <label class="check" style="margin:4px 0 12px"><input type="checkbox" data-recover ${state.me.account.recover_checkouts === 0 ? '' : 'checked'}> Remind people who start checking out but don’t finish <span class="muted small">(one email, an hour later)</span></label>
      <div class="err"></div>
      <div class="row"><button class="btn primary">Save payment settings</button>
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
  Promise.all([api('GET', '/api/websites'), api('GET', '/api/funnels')]).then(([sites, funnels]) => {
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
      await api('PUT', '/api/account/stripe', body);
      state.me = await api('GET', '/api/me');
      toast('Payment settings saved'); viewSettings();
    } catch (err) { $('.err', form).textContent = err.message; }
  };
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
}
