'use strict';

// ---------------- Rilly plan (trial, subscription) ----------------
const planMoney = (cents, cur = 'usd') => new Intl.NumberFormat(undefined, { style: 'currency', currency: cur.toUpperCase(), minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);

// A slim line at the top of every screen near the end of the trial, or when a payment failed.
function planBanner() {
  const b = state.me?.billing;
  if (!b?.enabled) return '';
  if (b.status === 'past_due') return `<div class="plan-banner warn">${icon('alert')} Your last payment didn’t go through. <a href="#/settings?plan=1">Update your card</a> to keep Rilly running.</div>`;
  if (b.status === 'trialing' && b.daysLeft !== null && b.daysLeft <= 5 && !b.locked) {
    return `<div class="plan-banner">${icon('clock')} ${b.daysLeft <= 1 ? 'Your free trial ends today' : `${b.daysLeft} days left in your free trial`}. <a href="#/settings?plan=1">Choose a plan</a></div>`;
  }
  return '';
}

function planCardHtml() {
  const b = state.me.billing;
  const price = `${planMoney(b.priceCents, b.currency)}/month`;
  const line = b.status === 'comped' ? '<span class="pill ok">Free</span> Your account is free. Nothing to pay.'
    : b.status === 'active' ? `<span class="pill ok">Active</span> ${price}, renews monthly.`
      : b.status === 'past_due' ? `<span class="pill warn">Payment failed</span> Update your card to keep going.`
        : b.locked ? `<span class="pill warn">Trial ended</span> Choose a plan to keep using Rilly.`
          : b.status === 'trialing' ? `<span class="pill">Free trial</span> ${b.daysLeft} day${b.daysLeft === 1 ? '' : 's'} left, then ${price}.`
            : `<span class="pill">Cancelled</span> Subscribe again any time.`;
  const subscribe = ['trialing', 'canceled'].includes(b.status);
  return `<div class="card" style="max-width:560px" data-plan>
    <p class="small" style="margin-top:0">${line}</p>
    ${subscribe ? `<ul class="plan-list"><li>Websites, pageflows and members areas</li><li>Email, texting and follow-ups that run on their own</li><li>Bookings, products, invoices and payments</li><li>Unlimited businesses (sub-accounts)</li></ul>` : ''}
    <div class="err"></div>
    <div class="row">${subscribe ? `<button class="btn primary" data-subscribe>${b.status === 'trialing' && !b.locked ? `Subscribe: ${price}` : `Subscribe for ${price}`}</button>` : ''}
      ${['active', 'past_due'].includes(b.status) ? '<button class="btn" data-portal>Change card, invoices or cancel</button>' : ''}</div>
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
    <p class="muted">Your pages, people and follow-ups are all still here, and your published pages keep working. Choose a plan to keep editing and sending.</p>
    ${planCardHtml()}
  </div>`);
  bindPlanCard();
}
