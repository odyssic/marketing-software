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
      <label class="f">From name<input name="from_name" value="${esc(a.from_name || '')}"></label>
      <label class="f">From email <span class="hint">must be allowed by your SMTP provider</span><input name="from_email" type="email" value="${esc(a.from_email || '')}"></label>
      <p class="muted small">Email delivery: <b>${state.me.emailLive ? 'connected (SMTP)' : 'dev mode (Outbox only)'}</b></p>
      <div class="err"></div><button class="btn primary">Save settings</button>
    </form>
    <div class="card" style="max-width:560px;margin-top:16px" data-subs>
      <div class="row" style="justify-content:space-between"><h2 style="margin:0">Sub-accounts</h2><button class="btn sm primary" data-newsub>＋ New sub-account</button></div>
      <p class="muted small">One workspace per business. Each has its own people, funnels, emails and dashboard.</p>
      <div data-sublist class="muted small">Loading…</div>
    </div>
    <div class="card" style="max-width:560px;margin-top:16px">
      <h2>Your data</h2>
      <p class="muted small">Download everything (people, events, orders, subscriptions, campaigns, funnels, deals) at any time.</p>
      <div class="row"><a class="btn" href="/api/export.zip">⬇ Every table as CSV (.zip)</a><a class="btn" href="/api/export.json">⬇ Everything as JSON</a></div>
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
      <div class="copy" style="margin-bottom:12px"><input readonly value="${esc(state.me.payments.webhookUrl)}"><button type="button" class="btn" data-copy="${esc(state.me.payments.webhookUrl)}">Copy</button></div>
      <div class="err"></div>
      <div class="row"><button class="btn primary">Save payment settings</button>
        ${state.me.payments.connected ? '<button type="button" class="btn danger" data-disconnect>Disconnect</button>' : ''}</div>
    </form>`);
  bindCopy();
  $('[data-newsub]').onclick = newSubAccount;
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
