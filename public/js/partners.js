'use strict';

// ---------------- Partners (Products → Partners) ----------------
// People who send customers: partners earn a commission, customers a thank-you.
// Rilly tracks clicks, sales and what's owed; the owner pays outside Rilly and
// records it with "Mark as paid".
async function viewPartnersTab() {
  const d = await api('GET', '/api/partners');
  const { program: pr, partners } = d;
  const applied = partners.filter((x) => x.status === 'applied');
  const list = partners.filter((x) => x.status !== 'applied' && x.status !== 'declined');
  const ready = list.filter((x) => x.ready);
  const sales = list.reduce((n, x) => n + x.sales, 0);
  const statusPill = (x) => (x.status === 'paused' ? '<span class="pill">Paused</span>' : x.kind === 'customer' ? '<span class="pill">Customer</span>' : '');
  const row = (x) => `<div class="pt-row click" data-partner="${x.id}">
      <div class="pt-who"><strong>${esc(x.name)}</strong> ${statusPill(x)}<div class="muted small pt-link">${esc(x.link.replace(/^https?:\/\//, ''))}
        <button type="button" class="btn icon sm" data-copylink="${esc(x.link)}" title="Copy link" aria-label="Copy ${esc(x.name)}’s link">${icon('copy')}</button></div></div>
      <div class="pt-num"><b>${x.clicks}</b><span>clicks</span></div>
      <div class="pt-num"><b>${x.sales}</b><span>sales</span></div>
      <div class="pt-num"><b>${esc(x.earned)}</b><span>earned</span></div>
      <div class="pt-num"><b class="${x.owed_cents ? 'pt-owed' : ''}">${esc(x.owed)}</b><span>owed</span></div>
      <div class="pt-act">${x.ready ? `<button type="button" class="btn sm" data-pay="${x.id}">Mark as paid</button>` : ''}</div></div>`;
  shell('products', `
    <div class="head"><div><h1>Products</h1><div class="muted">People who send you customers, and what they’ve earned.</div></div>
      ${partners.length ? `<button class="btn primary" data-invite>${icon('plus')} Invite a partner</button>` : ''}</div>
    ${productTabs('partners')}
    ${partners.length ? `<div class="stat-strip">
        <div><b>${esc(d.owed_total)}</b><span>to pay ${ready.length ? `${ready.length} ${ready.length === 1 ? 'person' : 'people'} now` : 'now'}</span></div>
        <div><b>${list.length}</b><span>partners and referrers</span></div>
        <div><b>${sales}</b><span>sales they sent</span></div></div>` : ''}
    ${applied.length ? `<h2 class="section-h">Waiting for you to approve</h2><div class="card list">${applied.map((x) => `<div class="pt-app">
        <div><strong>${esc(x.name)}</strong> <span class="muted small">${esc(x.email)}</span>${x.application ? `<div class="muted small">“${esc(x.application)}”</div>` : ''}</div>
        <div class="row"><button class="btn sm" data-decline="${x.id}">Decline</button><button class="btn primary sm" data-approve="${x.id}">Approve</button></div></div>`).join('')}</div>` : ''}
    ${list.length ? `<div class="card list pt-list">${list.map(row).join('')}</div>
      <p class="muted small pt-foot">${icon('info')}<span>Rilly doesn’t send money. Pay partners by PayPal or bank transfer, then press <b>Mark as paid</b> so their dashboard shows it.</span>
        ${ready.length ? '<a href="/api/partners/owed.csv" data-csv>Download who to pay (CSV)</a>' : ''}</p>`
    : `<div class="card empty"><div class="big">${icon('people')}</div><h2>${applied.length ? 'No active partners yet' : 'No partners yet'}</h2>
      <p>Give a partner or a happy customer their own link. When someone buys through it, they earn ${esc(pr.terms)}. You pay them yourself and mark it paid here.</p>
      <button class="btn primary" data-invite>${icon('plus')} Invite a partner</button></div>`}
    <div class="card pt-prog"><div><h2>How your program works</h2>
      <p class="muted">Partners earn <b>${esc(pr.terms)}</b>. Customers who refer a friend get <b>${esc(pr.customer_terms)}</b>${pr.friend_coupon_id ? `, and the friend gets <b>${esc(d.coupons.find((c) => c.id === pr.friend_coupon_id)?.label || 'a code')}</b>` : ''}.
        A click counts for ${pr.cookie_days} days; earnings are approved after ${pr.hold_days} days${pr.min_payout ? ` and paid from ${esc(fmtPartnerMoney(pr.min_payout, d.currency))}` : ''}.
        ${pr.signup_open ? `Anyone can apply at <a href="${esc(d.signup_url)}" target="_blank" rel="noopener">${esc(d.signup_url.replace(/^https?:\/\//, ''))}</a>.` : ''}</p>
      <p class="muted small">Partners see their own clicks and earnings at <a href="${esc(d.dashboard_url)}" target="_blank" rel="noopener">${esc(d.dashboard_url.replace(/^https?:\/\//, ''))}</a>. Your “Referral ask” follow-up sends every customer their own link.</p></div>
      <button class="btn" data-settings>${icon('gear')} Change</button></div>`);

  const reload = () => viewPartnersTab();
  $$('[data-invite]').forEach((b) => { b.onclick = () => invitePartner(reload); });
  $('[data-settings]').onclick = () => partnerProgramSettings(d, reload);
  $$('[data-copylink]').forEach((b) => { b.onclick = async (e) => { e.stopPropagation(); await navigator.clipboard.writeText(b.dataset.copylink); toast('Link copied'); }; });
  $$('[data-pay]').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); markPartnerPaid(partners.find((x) => x.id === Number(b.dataset.pay)), d.currency, reload); }; });
  $$('[data-partner]').forEach((r) => { r.onclick = () => viewPartnerDetail(Number(r.dataset.partner), reload); });
  const setStatus = async (pid, status, msg) => {
    await api('PUT', `/api/partners/${pid}`, { status });
    undoToast(msg, async () => { await api('PUT', `/api/partners/${pid}`, { status: 'applied' }); reload(); });
    reload();
  };
  $$('[data-approve]').forEach((b) => { b.onclick = () => setStatus(b.dataset.approve, 'active', 'Approved. We emailed them their link'); });
  $$('[data-decline]').forEach((b) => { b.onclick = () => setStatus(b.dataset.decline, 'declined', 'Declined'); });
}

const fmtPartnerMoney = (amount, currency) => new Intl.NumberFormat(undefined, { style: 'currency', currency: (currency || 'usd').toUpperCase(), minimumFractionDigits: amount % 1 ? 2 : 0 }).format(amount);

async function invitePartner(done) {
  const v = await modal('Invite a partner', `
    <label class="f">Name<input name="name" autocomplete="off" placeholder="e.g. Jamie Rivera"></label>
    <label class="f">Email<input name="email" type="email" required autocomplete="off" placeholder="jamie@example.com"></label>
    <label class="f">They’re a<select name="kind"><option value="partner">Partner (earns a commission on sales)</option><option value="customer">Customer (gets your referral thank-you)</option></select></label>
    <p class="hint">We email them their own link and a sign-in link to their dashboard.</p>`,
  { submit: 'Invite', onSubmit: (x) => api('POST', '/api/partners', x) });
  if (v) { toast('Invited. Their link is on its way'); done(); }
}

async function partnerProgramSettings(d, done) {
  const pr = d.program;
  const cur = (d.currency || 'usd').toUpperCase();
  const couponOpts = (sel, none) => `<option value="">${none}</option>${d.coupons.map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.code)} (${esc(c.label)})</option>`).join('')}`;
  const pending = modal('Your partner program', `
    <h3 class="pt-h">Partners</h3>
    <div class="colors"><label class="f">They earn<select name="commission_type"><option value="percent">A percent</option><option value="amount" ${pr.commission_type === 'amount' ? 'selected' : ''}>An amount per sale</option></select></label>
      <label class="f"><span data-ctlabel>${pr.commission_type === 'amount' ? 'Amount' : 'Percent'}</span><input name="commission" type="number" min="0.01" step="0.01" required inputmode="decimal" value="${pr.commission}"></label></div>
    <div class="colors"><label class="f">On subscriptions and payment plans<select name="recurring"><option value="first">First payment only</option><option value="every" ${pr.recurring_months ? 'selected' : ''}>Every payment</option></select></label>
      <label class="f" data-months ${pr.recurring_months ? '' : 'hidden'}>For how many months<input name="recurring_months" type="number" min="1" max="120" step="1" inputmode="numeric" value="${pr.recurring_months || 12}"></label></div>
    <h3 class="pt-h">Customers who tell a friend</h3>
    <div class="colors"><label class="f">They get<select name="reward_type"><option value="amount">An amount</option><option value="coupon" ${pr.reward_type === 'coupon' ? 'selected' : ''}>A code</option><option value="none" ${pr.reward_type === 'none' ? 'selected' : ''}>Just thanks</option></select></label>
      <label class="f" data-rw="amount">How much (${cur}) <span class="hint">you pay or credit it</span><input name="reward" type="number" min="0" step="0.01" inputmode="decimal" value="${pr.reward}"></label>
      <label class="f" data-rw="coupon">Which code<select name="reward_coupon_id">${couponOpts(pr.reward_coupon_id, 'Pick a code')}</select></label></div>
    <label class="f">The friend gets <span class="hint">filled in at checkout when they come through a link</span><select name="friend_coupon_id">${couponOpts(pr.friend_coupon_id, 'Nothing extra')}</select></label>
    ${d.coupons.length ? '' : '<p class="hint" style="margin-top:-6px">Make codes in <a href="#/products/coupons">Coupons</a>.</p>'}
    <h3 class="pt-h">Rules</h3>
    <div class="colors"><label class="f">A click counts for <span class="hint">days</span><input name="cookie_days" type="number" min="1" max="365" step="1" inputmode="numeric" value="${pr.cookie_days}"></label>
      <label class="f">Approve earnings after <span class="hint">days, in case of refunds</span><input name="hold_days" type="number" min="0" max="365" step="1" inputmode="numeric" value="${pr.hold_days}"></label></div>
    <div class="colors"><label class="f">Pay out from <span class="hint">${cur}; 0 for any amount</span><input name="min_payout" type="number" min="0" step="0.01" inputmode="decimal" value="${pr.min_payout}"></label>
      <label class="f">Links go to<select name="landing_funnel_id"><option value="">Your home page</option>${d.funnels.map((f) => `<option value="${f.id}" ${f.id === pr.landing_funnel_id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label></div>
    <label class="check"><input type="checkbox" name="signup_open" ${pr.signup_open ? 'checked' : ''}> Let anyone apply on a public “Become a partner” page (you approve each one)</label>`,
  { onSubmit: (v) => api('PUT', '/api/partners/program', { ...v, recurring_months: v.recurring === 'every' ? v.recurring_months : 0 }) });
  const f = $('.modal-bg form');
  const sync = () => {
    $('[data-ctlabel]', f).textContent = f.commission_type.value === 'amount' ? `Amount (${cur})` : 'Percent';
    $('[data-months]', f).hidden = f.recurring.value !== 'every';
    $$('[data-rw]', f).forEach((el) => { el.hidden = el.dataset.rw !== f.reward_type.value; });
  };
  f.addEventListener('change', sync); sync();
  if (await pending) { toast('Saved'); done(); }
}

async function markPartnerPaid(x, currency, done) {
  const today = new Date().toISOString().slice(0, 10);
  const v = await modal(`Mark ${x.name} as paid`, `
    <p class="muted">Rilly doesn’t move the money. Pay ${esc(x.name)} ${esc(x.owed)} by PayPal or bank transfer first${x.payout_details ? `. They asked for: <b>${esc(x.payout_details)}</b>` : ''}.</p>
    <div class="colors"><label class="f">Amount paid (${esc((currency || 'usd').toUpperCase())})<input name="amount" type="number" min="0" step="0.01" inputmode="decimal" value="${(x.owed_cents / 100).toFixed(2)}"></label>
      <label class="f">Date<input name="paid_on" type="date" value="${today}"></label></div>
    <label class="f">Note <span class="hint">optional, they see it</span><input name="note" maxlength="300" placeholder="e.g. PayPal"></label>`,
  { submit: 'Mark as paid', onSubmit: (b) => api('POST', `/api/partners/${x.id}/payouts`, b) });
  if (!v) return;
  undoToast(`${v.amount} marked as paid`, async () => { await api('DELETE', `/api/partners/payouts/${v.id}`); done(); });
  done();
}

async function viewPartnerDetail(pid, done) {
  const p = await api('GET', `/api/partners/${pid}`);
  const st = { pending: ['warn', 'On hold'], approved: ['ok', 'Approved'], paid: ['', 'Paid'], void: ['', 'Cancelled'] };
  const pending = modal(p.name, `
    <p class="muted small">${esc(p.email)} · ${p.clicks} clicks · ${p.sales} sales · earned ${esc(p.earned)} · paid ${esc(p.paid)}</p>
    <label class="f">Their link <span class="hint">change the last part if you like</span><span class="pt-codeedit"><span class="muted">${esc(p.link.replace(/[^/]+$/, ''))}</span><input name="code" value="${esc(p.code)}" maxlength="30" autocomplete="off"></span></label>
    <div class="colors"><label class="f">They’re a<select name="kind"><option value="partner">Partner</option><option value="customer" ${p.kind === 'customer' ? 'selected' : ''}>Customer</option></select></label>
      <label class="f">Link is<select name="status"><option value="active">Working</option><option value="paused" ${p.status === 'paused' ? 'selected' : ''}>Paused</option></select></label></div>
    ${p.payout_details ? `<p class="small"><b>Pay to:</b> ${esc(p.payout_details)}</p>` : ''}
    <h3 class="pt-h">Sales</h3>
    ${p.commissions.length ? `<div class="pt-sales">${p.commissions.map((c) => `<div class="pt-sale ${c.status === 'void' ? 'void' : ''}">
        <div><b>${esc(c.product || 'A sale')}</b>${c.payment_no > 1 ? ` <span class="muted small">payment ${c.payment_no}</span>` : ''}<div class="muted small">${c.buyer_id ? `<a href="#/people/${c.buyer_id}">${esc(c.buyer)}</a> · ` : ''}${fmtDate(c.sale_at)} · sale ${esc(c.sale)}${c.note ? ` · ${esc(c.note)}` : ''}</div></div>
        <div class="pt-amt">${esc(c.amount)}</div><span class="pill ${st[c.status][0]}">${c.status === 'pending' ? `On hold to ${fmtDate(c.available_at)}` : st[c.status][1]}</span>
        ${c.status === 'pending' || c.status === 'approved' ? `<button type="button" class="btn sm" data-void="${c.id}" data-was="${c.status}" title="Don’t pay this one (e.g. it was refunded)">Don’t pay</button>` : '<span></span>'}</div>`).join('')}</div>`
    : '<p class="muted small">No sales yet.</p>'}
    ${p.payouts.length ? `<h3 class="pt-h">Payments</h3>${p.payouts.map((x) => `<div class="pt-sale"><div>${fmtDate(`${x.paid_on}T12:00:00`)}${x.note ? ` <span class="muted small">· ${esc(x.note)}</span>` : ''}</div><div class="pt-amt">${esc(x.amount)}</div><span></span><span></span></div>`).join('')}` : ''}`,
  { onSubmit: (v) => api('PUT', `/api/partners/${pid}`, v) });
  $$('.modal-bg [data-void]').forEach((b) => { b.onclick = async () => {
    await api('PUT', `/api/partners/commissions/${b.dataset.void}`, { status: 'void' });
    const was = b.dataset.was;
    b.closest('.pt-sale').classList.add('void'); b.remove();
    undoToast('Won’t be paid', async () => { await api('PUT', `/api/partners/commissions/${b.dataset.void}`, { status: was }); $('.modal-bg [data-x]')?.click(); done(); });
  }; });
  const saved = await pending;
  if (saved) toast('Saved');
  done();
}
