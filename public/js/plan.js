'use strict';

// ---------------- Rilly plan (trial, subscription) ----------------
const planMoney = (cents, cur = 'usd') => new Intl.NumberFormat(undefined, { style: 'currency', currency: cur.toUpperCase(), minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);

// A slim line at the top of every screen near the end of the trial, or when a payment failed.
function planBanner() {
  const b = state.me?.billing;
  if (!b?.enabled || state.me.role !== 'owner') return '';
  if (b.status === 'past_due') return `<div class="plan-banner warn">${icon('alert')} Your last payment didn’t go through. <a href="#/settings?plan=1">Update your card</a> to keep Rilly running.</div>`;
  if (b.status === 'trialing' && b.daysLeft !== null && b.daysLeft <= 5 && !b.locked) {
    return `<div class="plan-banner">${icon('clock')} ${b.daysLeft <= 1 ? 'Your free trial ends today' : `${b.daysLeft} days left in your free trial`}. <a href="#/settings?plan=1">Choose a plan</a></div>`;
  }
  return '';
}

function planCardHtml() {
  const b = state.me.billing;
  const price = `${planMoney(b.priceCents, b.currency)}/month`;
  const n = Math.max(1, (state.me.accounts || []).length), extras = b.extraCents ? n - 1 : 0;
  const total = `${planMoney(b.priceCents + extras * b.extraCents, b.currency)}/month`;
  const howMuch = b.extraCents ? `<p class="small plan-price">${price} for your first business, plus ${planMoney(b.extraCents, b.currency)}/month for each extra one.${n > 1 ? ` You run <b>${n} businesses</b>: <b>${total}</b>.` : ''}</p>` : '';
  const line = b.status === 'comped' ? '<span class="pill ok">Free</span> Your account is free. Nothing to pay.'
    : b.status === 'active' ? `<span class="pill ok">Active</span> ${total}, renews monthly.`
      : b.status === 'past_due' ? `<span class="pill warn">Payment failed</span> Update your card to keep going.`
        : b.locked ? `<span class="pill warn">Trial ended</span> Choose a plan to keep using Rilly.`
          : b.status === 'trialing' ? `<span class="pill">Free trial</span> ${b.daysLeft} day${b.daysLeft === 1 ? '' : 's'} left, then ${total}.`
            : `<span class="pill">Cancelled</span> Subscribe again any time.`;
  const subscribe = ['trialing', 'canceled'].includes(b.status);
  return `<div class="card" style="max-width:560px" data-plan>
    <p class="small" style="margin-top:0">${line}</p>
    ${b.status === 'comped' ? '' : howMuch}
    ${subscribe ? `<ul class="plan-list"><li>Websites, pages and members areas</li><li>Email, texting and follow-ups that run on their own</li><li>Bookings, products, invoices and payments</li><li>Unlimited contacts and pages</li></ul>` : ''}
    <div class="err"></div>
    <div class="row">${subscribe ? `<button class="btn primary" data-subscribe>${b.status === 'trialing' && !b.locked ? `Subscribe: ${total}` : `Subscribe for ${total}`}</button>` : ''}
      ${['active', 'past_due'].includes(b.status) ? '<button class="btn" data-portal>Change card or see invoices</button>' : ''}</div>
    ${b.cancelAt || b.pausedUntil ? `<p class="small plan-note">${icon('info')} ${b.cancelAt ? `Ends on <b>${new Date(b.cancelAt).toLocaleDateString()}</b>. Nothing more will be charged.` : `Paused until <b>${new Date(b.pausedUntil).toLocaleDateString()}</b>. Your pages stay live; editing waits until then.`} <button class="btn sm" data-resume>${b.cancelAt ? 'Keep my plan' : 'Resume now'}</button></p>`
      : b.status === 'active' ? '<div class="row plan-exit"><button class="btn sm ghost" data-pause>Pause for a while</button><button class="btn sm ghost" data-cancel>Cancel plan</button></div>' : ''}
    ${subscribe && b.status === 'trialing' && !b.locked ? '<p class="hint" style="margin-top:8px">Subscribing now keeps your free days: the first charge is when the trial ends.</p>' : ''}
  </div>`;
}

function bindPlanCard() {
  const card = $('[data-plan]'); if (!card) return;
  const go = async (btn, path) => {
    btn.disabled = true;
    try { const r = await api('POST', path); location.href = r.url; } catch (e) { $('.err', card).textContent = e.message; btn.disabled = false; }
  };
  const s = $('[data-subscribe]', card); if (s) s.onclick = () => go(s, '/api/billing/checkout');
  const p = $('[data-portal]', card); if (p) p.onclick = () => go(p, '/api/billing/portal');
  const done = async (msg) => { state.me = await api('GET', '/api/me'); toast(msg); viewSettings(); };
  const c = $('[data-cancel]', card);
  if (c) c.onclick = async () => {
    const r = await modal('Cancel your plan', `<p>No hoops: it stops at the end of this month’s billing period and nothing more is charged. Your pages stay up until then.</p>
      <p class="small">Before you go, take everything with you:</p><p><a class="btn sm" href="/api/export.zip">${icon('download')} Download everything (.zip)</a></p>
      <p class="small muted">Rather take a break? You can pause for 1 to 3 months instead and keep everything as it is.</p>`, { submit: 'Cancel my plan', danger: true });
    if (!r) return;
    try { const x = await api('POST', '/api/billing/cancel'); done(`Cancelled. It ends on ${new Date(x.cancel_at).toLocaleDateString()}`); } catch (e) { toast(e.message, true); }
  };
  const pz = $('[data-pause]', card);
  if (pz) pz.onclick = async () => {
    const r = await modal('Pause your plan', `<p>No charges while it’s paused. Your pages, forms and checkouts stay live; editing and sending wait until you’re back.</p>
      <label class="f">For<select name="months"><option value="1">1 month</option><option value="2">2 months</option><option value="3">3 months</option></select></label>`, { submit: 'Pause' });
    if (!r) return;
    try { const x = await api('POST', '/api/billing/pause', { months: r.months }); done(`Paused until ${new Date(x.paused_until).toLocaleDateString()}`); } catch (e) { toast(e.message, true); }
  };
  const rs = $('[data-resume]', card);
  if (rs) rs.onclick = async () => { try { await api('POST', '/api/billing/resume'); done('Your plan carries on as before'); } catch (e) { toast(e.message, true); } };
}

// Back from Stripe Checkout: confirm, then show the plan.
async function confirmPlanReturn() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const sid = q.get('billing');
  if (!sid) return;
  history.replaceState(history.state, '', '#/settings?plan=1');
  if (sid === 'cancel') return;
  try {
    const r = await api('POST', '/api/billing/confirm', { session_id: sid });
    if (r.ok) { state.me = await api('GET', '/api/me'); toast('You’re subscribed. Thank you!'); viewSettings(); }
  } catch (e) { toast(e.message, true); }
}

// Trial over: everything else waits until a plan is chosen. Nothing is deleted.
function viewPlanLocked() {
  shell('settings', `<div class="card plan-lock">
    <div class="big">${icon('clock')}</div>
    <h1>Your free trial has ended</h1>
    <p class="muted">Your pages, people and follow-ups are all still here, and your published pages keep working. ${state.me.role === 'owner' ? 'Choose a plan to keep editing and sending.' : 'Ask the business owner to choose a plan to keep editing and sending.'}</p>
    ${state.me.role === 'owner' ? planCardHtml() : ''}
  </div>`);
  bindPlanCard();
}
