// Partners and referrals: people who send customers, and what they earn.
//
// - Two kinds in one list: partners (affiliates) earn a commission on sales
//   they send (percent or fixed, optionally on every payment for N months);
//   customers get a personal share link and a thank-you (money or a code).
//   The friend can get a code off (one of the business's coupons).
// - Tracking: /r/<code> sends the visitor to the business's page with
//   ?ref=<code>; any public page with ?ref=<code> (also on custom domains)
//   sets a signed first-party cookie for the program's cookie days. The buy
//   route attaches the referrer to the order; a paid order earns a commission.
// - Commissions wait out a hold period (refunds), then are approved (the
//   partner gets "You earned $X"); the owner pays outside Rilly and records it
//   with "Mark as paid". Self-referrals earn nothing.
// - Stripe webhooks: later subscription/plan payments (invoice.paid) earn per
//   payment within the program's months; refunds (charge.refunded) void.
// - Partner dashboard at /my/<business>/partner (magic link sign-in, the same
//   customer cookie as /my/<business>), and an optional public signup page.
'use strict';
const crypto = require('node:crypto');
const express = require('express');
const { esc, formatMoney } = require('./render');

const DAY = 864e5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_RE = /^[a-z0-9][a-z0-9-]{2,29}$/;
const KINDS = ['partner', 'customer'];
const STATUSES = ['applied', 'active', 'paused', 'declined'];
const DEFAULTS = { commission_type: 'percent', commission_value: 20, recurring_months: 0, cookie_days: 30, hold_days: 30, min_payout_cents: 0,
  signup_open: 0, friend_coupon_id: null, reward_type: 'amount', reward_cents: 1000, reward_coupon_id: null, landing_funnel_id: null, summary_month: '' };
const cookieName = (accountId) => `rref${accountId}`;
const monthKey = (d) => d.toISOString().slice(0, 7);
const addMonths = (d, n) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x; };
const personName = (c) => [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || 'Someone';
const couponText = (c, currency) => (c.percent_off ? `${c.percent_off}% off` : `${formatMoney(c.amount_off_cents, currency)} off`);

// { usd: 1200, eur: 500 } → "$12 + €5" (or "$0").
function moneyLabel(byCur, fallback = 'usd') {
  const parts = Object.entries(byCur || {}).filter(([, c]) => c).map(([cur, c]) => formatMoney(c, cur));
  return parts.join(' + ') || formatMoney(0, fallback);
}
const sumOf = (byCur) => Object.values(byCur || {}).reduce((n, c) => n + c, 0);

// What a partner earns, in plain words: "20% of each sale", "$10 for each sale, every payment for 12 months".
function termsText(p, currency, kind = 'partner') {
  if (kind === 'customer') {
    return p.reward_type === 'amount' && p.reward_cents ? `${formatMoney(p.reward_cents, currency)} for each friend who buys`
      : p.reward_type === 'coupon' ? 'a thank-you code for each friend who buys' : 'our thanks for each friend who buys';
  }
  const what = p.commission_type === 'amount' ? `${formatMoney(p.commission_value, currency)} for each sale` : `${p.commission_value}% of each sale`;
  return p.recurring_months ? `${what}, and of every payment for ${p.recurring_months} month${p.recurring_months === 1 ? '' : 's'}` : what;
}

function registerAffiliates(app, api, { getDb, HttpError, id, upsertContact, logEvent, messaging, members, publicBase, checkout, toCsv }) {
  const db = () => getDb();
  const base = () => (process.env.PUBLIC_URL || publicBase()).replace(/\/$/, '');

  // ---------- Program settings ----------
  async function program(accountId, q = db()) {
    const r = await q.get('SELECT * FROM affiliate_programs WHERE account_id = ?', accountId);
    return { ...DEFAULTS, ...(r || {}), account_id: accountId };
  }
  const mainCurrency = async (accountId) => (await db().get(`SELECT currency FROM products WHERE account_id = ?
    GROUP BY currency ORDER BY COUNT(*) DESC LIMIT 1`, accountId))?.currency || 'usd';

  // ---------- Links ----------
  const accountRow = (accountId) => db().get('SELECT id, name, from_name, from_email, domain, brand_color, home_funnel_id, handle FROM accounts WHERE id = ?', accountId);
  const siteBase = (acct) => (acct.domain ? `https://${acct.domain}` : base());
  const linkFor = (acct, code) => `${siteBase(acct)}/r/${code}`;
  // The business's public pages a partner can link to (entry pages of live flows, and every website page).
  async function pagesOf(acct) {
    const funnels = await db().all(`SELECT id, name, slug, kind, entry_step_id FROM funnels WHERE account_id = ? AND status = 'live' AND kind <> 'members'
      ORDER BY (id = ?) DESC, id`, acct.id, acct.home_funnel_id || 0);
    const out = [];
    for (const f of funnels) {
      const home = acct.domain && f.id === acct.home_funnel_id;
      const fbase = acct.domain ? `https://${acct.domain}${home ? '' : `/${f.slug}`}` : `${base()}/f/${f.slug}`;
      const steps = await db().all('SELECT id, name, slug FROM funnel_steps WHERE funnel_id = ? ORDER BY position, id', f.id);
      for (const s of steps) {
        const entry = s.id === f.entry_step_id || (!f.entry_step_id && s === steps[0]);
        if (!entry && f.kind !== 'website') continue;
        out.push({ funnel_id: f.id, name: f.kind === 'website' && !entry ? `${f.name}: ${s.name}` : f.name, url: entry ? (fbase || `https://${acct.domain}`) + (home ? '/' : '') : `${fbase}/${s.slug}` });
      }
    }
    return out;
  }
  async function newCode(q, name) {
    const stem = String(name || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '').slice(0, 16) || 'friend';
    for (;;) {
      const code = `${stem.length < 3 ? `${stem}friend`.slice(0, 8) : stem}-${crypto.randomBytes(3).toString('hex').slice(0, 4)}`;
      if (!await q.get('SELECT 1 FROM affiliates WHERE code = ?', code)) return code;
    }
  }
  // The person's referral record (created the first time, as a customer referrer).
  async function ensureAffiliate(q, accountId, contactId, { kind = 'customer', status = 'active', application = '' } = {}) {
    const have = await q.get('SELECT * FROM affiliates WHERE account_id = ? AND contact_id = ?', accountId, contactId);
    if (have) return { aff: have, created: false };
    const c = await q.get('SELECT first_name, email FROM contacts WHERE id = ? AND account_id = ?', contactId, accountId);
    if (!c) throw new HttpError(404, 'Person not found');
    const aff = await q.get(`INSERT INTO affiliates (account_id, contact_id, kind, code, status, application) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (account_id, contact_id) DO NOTHING RETURNING *`, accountId, contactId, kind, await newCode(q, c.first_name || c.email.split('@')[0]), status, application);
    return aff ? { aff, created: true } : { aff: await q.get('SELECT * FROM affiliates WHERE account_id = ? AND contact_id = ?', accountId, contactId), created: false };
  }

  // ---------- Cookie ----------
  function setRefCookie(req, res, accountId, affiliateId, days) {
    const exp = Math.floor(Date.now() / 1000) + days * 86400;
    const body = `${affiliateId}.${exp}`;
    res.cookie(cookieName(accountId), `${body}.${members.sign(`ref:${accountId}:${body}`)}`, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: days * DAY });
  }
  function refFromCookie(req, accountId) {
    const raw = String(req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(`${cookieName(accountId)}=`));
    if (!raw) return null;
    const [aid, exp, sig] = decodeURIComponent(raw.slice(raw.indexOf('=') + 1)).split('.');
    if (!/^\d{1,9}$/.test(aid || '') || !/^\d{1,12}$/.test(exp || '') || !sig) return null;
    if (!members.same(sig, members.sign(`ref:${accountId}:${aid}.${exp}`)) || Number(exp) * 1000 < Date.now()) return null;
    return Number(aid);
  }

  // A public page opened with ?ref=<code>: count the click (once per visitor) and remember the partner.
  async function track(req, res, accountId) {
    const code = String(req.query.ref || '').trim().toLowerCase().slice(0, 40);
    if (!CODE_RE.test(code)) return;
    const aff = await db().get("SELECT id FROM affiliates WHERE account_id = ? AND code = ? AND status = 'active'", accountId, code);
    if (!aff) return;
    const prog = await program(accountId);
    if (refFromCookie(req, accountId) !== aff.id) await db().run('UPDATE affiliates SET clicks = clicks + 1 WHERE id = ?', aff.id);
    setRefCookie(req, res, accountId, aff.id, prog.cookie_days);
  }

  // The friend's code, used at checkout when the buyer didn't type one (only if it works for this product).
  async function friendCoupon(req, accountId, product, email = '') {
    const aid = refFromCookie(req, accountId);
    if (!aid) return '';
    const prog = await program(accountId);
    const c = prog.friend_coupon_id && await db().get('SELECT code FROM coupons WHERE id = ? AND account_id = ?', prog.friend_coupon_id, accountId);
    if (!c) return '';
    const aff = await db().get("SELECT c.email FROM affiliates a JOIN contacts c ON c.id = a.contact_id WHERE a.id = ? AND a.account_id = ? AND a.status = 'active'", aid, accountId);
    if (!aff || (email && aff.email === String(email).toLowerCase())) return '';
    return (await checkout.checkCoupon(accountId, c.code, product)).error ? '' : c.code;
  }

  // Called by the buy route right after the order is created.
  async function attachOrder(req, orderId, accountId) {
    const aid = refFromCookie(req, accountId);
    if (!aid) return;
    await db().run(`UPDATE orders SET affiliate_id = ? WHERE id = ? AND account_id = ?
      AND EXISTS (SELECT 1 FROM affiliates WHERE id = ? AND account_id = ? AND status = 'active')`, aid, orderId, accountId, aid, accountId);
  }

  // ---------- Earning ----------
  async function addCommission(o, aff, prog, { paymentNo, saleCents, at, ref = '', sub = null }) {
    const customer = aff.kind === 'customer';
    let amount = customer ? (prog.reward_type === 'amount' ? prog.reward_cents : 0)
      : prog.commission_type === 'amount' ? Math.min(prog.commission_value, saleCents) : Math.round(saleCents * prog.commission_value / 100);
    let note = '';
    if (customer && prog.reward_type === 'coupon') {
      const c = prog.reward_coupon_id && await db().get('SELECT * FROM coupons WHERE id = ? AND account_id = ?', prog.reward_coupon_id, o.account_id);
      note = c ? `Thank-you code ${c.code} (${couponText(c, o.currency)})` : 'Thank-you code';
    }
    const trial = saleCents <= 0;
    if (trial) amount = 0;
    const r = await db().get(`INSERT INTO affiliate_commissions (account_id, affiliate_id, order_id, buyer_contact_id, payment_no, sale_cents, amount_cents, currency,
        status, sale_at, available_at, stripe_ref, stripe_subscription, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (order_id, payment_no) DO NOTHING RETURNING id`,
    o.account_id, aff.id, o.id, o.contact_id, paymentNo, Math.max(0, saleCents), amount, o.currency, trial ? 'trial' : 'pending',
    at.toISOString(), new Date(at.getTime() + prog.hold_days * DAY).toISOString(), ref, sub, trial ? 'Free trial: earns from the first payment' : note);
    if (!r || trial) return r;
    const buyer = o.contact_id && await db().get('SELECT first_name, last_name, email FROM contacts WHERE id = ?', o.contact_id);
    const who = buyer ? personName(buyer) : 'someone';
    const first = !await db().get("SELECT 1 FROM affiliate_commissions WHERE order_id = ? AND id <> ? AND status NOT IN ('trial')", o.id, r.id);
    // The partner's timeline (and the "Sends a referral that buys" trigger on a first sale); the buyer's timeline says who sent them.
    await logEvent(db(), o.account_id, { person_id: aff.contact_id, type: first ? 'referral' : 'note', source: 'referral',
      meta: { note: first ? `Referred ${who} (paid ${formatMoney(saleCents, o.currency)})` : `${who} paid again: ${formatMoney(saleCents, o.currency)} (payment ${paymentNo})`,
        order_id: o.id, product: o.product_name, earned: formatMoney(amount, o.currency), buyer_id: o.contact_id } }, { recompute: false });
    if (first && o.contact_id) {
      const partner = await db().get('SELECT first_name, last_name, email FROM contacts WHERE id = ?', aff.contact_id);
      await logEvent(db(), o.account_id, { person_id: o.contact_id, type: 'note', source: 'referral', meta: { note: `Referred by ${personName(partner)}` } }, { recompute: false });
    }
    return r;
  }

  // Called by fulfilOrder once an order is paid for the first time.
  async function onOrderPaid(order) {
    const o = await db().get('SELECT * FROM orders WHERE id = ?', order.id);
    if (!o?.affiliate_id || o.status !== 'paid') return;
    const aff = await db().get(`SELECT a.*, c.email FROM affiliates a JOIN contacts c ON c.id = a.contact_id
      WHERE a.id = ? AND a.account_id = ? AND a.status = 'active'`, o.affiliate_id, o.account_id);
    if (!aff) return;
    if (aff.contact_id === o.contact_id || (aff.email && aff.email === String(o.email || '').toLowerCase())) return; // no earning from your own purchase
    const prog = await program(o.account_id);
    if (!o.amount_cents && !o.trial_days) return; // free with a code: nothing was sold
    if (aff.kind === 'customer' && await db().get("SELECT 1 FROM orders WHERE account_id = ? AND contact_id = ? AND status = 'paid' AND id <> ? LIMIT 1", o.account_id, o.contact_id, o.id)) return; // only a friend's first purchase
    await addCommission(o, aff, prog, { paymentNo: 1, saleCents: o.amount_cents, at: new Date(o.paid_at || Date.now()),
      ref: /^pi_/.test(o.stripe_session_id || '') ? o.stripe_session_id : '' });
  }

  const sid = (x) => (typeof x === 'string' ? x : x?.id || null);
  // Stripe webhook events (after the app's own handling).
  async function onStripeEvent(accountId, event) {
    const obj = event?.data?.object || {};
    if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) {
      const oid = id(obj.client_reference_id);
      const ref = sid(obj.invoice) || sid(obj.payment_intent) || '';
      await db().run(`UPDATE affiliate_commissions SET stripe_subscription = COALESCE(?, stripe_subscription),
        stripe_ref = CASE WHEN stripe_ref = '' THEN ? ELSE stripe_ref END WHERE order_id = ? AND account_id = ? AND payment_no = 1`, sid(obj.subscription), ref, oid, accountId);
      return;
    }
    if (['invoice.paid', 'invoice.payment_succeeded'].includes(event.type)) {
      if (obj.billing_reason === 'subscription_create' || !obj.amount_paid) return; // the first payment is counted at checkout
      const sub = sid(obj.subscription) || sid(obj.parent?.subscription_details?.subscription);
      const first = sub && await db().get('SELECT * FROM affiliate_commissions WHERE account_id = ? AND stripe_subscription = ? ORDER BY payment_no LIMIT 1', accountId, sub);
      if (!first || !obj.id || await db().get('SELECT 1 FROM affiliate_commissions WHERE account_id = ? AND stripe_ref = ?', accountId, obj.id)) return;
      const o = await db().get('SELECT * FROM orders WHERE id = ? AND account_id = ?', first.order_id, accountId);
      const aff = o && await db().get("SELECT * FROM affiliates WHERE id = ? AND account_id = ? AND status = 'active'", first.affiliate_id, accountId);
      if (!aff) return;
      const prog = await program(accountId);
      const at = obj.status_transitions?.paid_at ? new Date(obj.status_transitions.paid_at * 1000) : new Date();
      const rows = await db().all("SELECT payment_no, sale_at, sale_cents FROM affiliate_commissions WHERE order_id = ? AND status <> 'trial' AND sale_cents > 0 ORDER BY payment_no", o.id);
      const n = (await db().get('SELECT MAX(payment_no) AS n FROM affiliate_commissions WHERE order_id = ?', o.id)).n + 1;
      if (rows.length) { // a later payment: earns on a payment plan, or within the program's months
        if (aff.kind === 'customer') return;
        const ok = o.plan_parts ? rows.length < o.plan_parts
          : prog.recurring_months > 0 && at.getTime() < addMonths(rows[0].sale_at, prog.recurring_months).getTime() - 3 * DAY;
        if (!ok) return;
      }
      await addCommission(o, aff, prog, { paymentNo: n, saleCents: obj.amount_paid, at, ref: obj.id, sub });
      return;
    }
    if (event.type === 'charge.refunded') {
      const refs = [sid(obj.invoice), sid(obj.payment_intent)].filter(Boolean);
      if (!refs.length) return;
      const full = obj.refunded || (obj.amount && obj.amount_refunded >= obj.amount);
      for (const c of await db().all(`SELECT * FROM affiliate_commissions WHERE account_id = ? AND stripe_ref IN (${refs.map(() => '?').join(', ')})
        AND status IN ('pending', 'approved', 'trial')`, accountId, ...refs)) {
        if (full) await db().run("UPDATE affiliate_commissions SET status = 'void', note = 'Refunded' WHERE id = ?", c.id);
        else if (obj.amount) {
          const kept = Math.round(c.amount_cents * Math.max(0, obj.amount - obj.amount_refunded) / obj.amount);
          await db().run("UPDATE affiliate_commissions SET amount_cents = ?, note = 'Partly refunded' WHERE id = ?", kept, c.id);
        }
      }
    }
  }

  // ---------- Background job: approve after the hold, tell partners, monthly owner summary ----------
  async function processDue(now = new Date()) {
    // A cancelled/refunded order inside the hold period earns nothing.
    await db().run(`UPDATE affiliate_commissions c SET status = 'void', note = 'Order refunded or cancelled'
      FROM orders o WHERE o.id = c.order_id AND c.status = 'pending' AND o.status <> 'paid'`);
    const due = await db().all("SELECT id FROM affiliate_commissions WHERE status = 'pending' AND available_at <= ? ORDER BY id", now.toISOString());
    const byAff = new Map();
    for (const { id: cid } of due) {
      const c = await db().get(`UPDATE affiliate_commissions SET status = CASE WHEN amount_cents = 0 THEN 'paid' ELSE 'approved' END, approved_at = ?
        WHERE id = ? AND status = 'pending' RETURNING *`, now.toISOString(), cid);
      if (c) byAff.set(c.affiliate_id, [...(byAff.get(c.affiliate_id) || []), c]);
    }
    let told = 0;
    for (const [affId, list] of byAff) {
      const aff = await db().get('SELECT a.*, c.email, c.first_name FROM affiliates a JOIN contacts c ON c.id = a.contact_id WHERE a.id = ?', affId);
      if (!aff?.email) continue;
      const acct = await db().get('SELECT * FROM accounts WHERE id = ?', aff.account_id);
      const prog = await program(aff.account_id);
      const money = {};
      for (const c of list) money[c.currency] = (money[c.currency] || 0) + c.amount_cents;
      const codes = list.filter((c) => /^Thank-you code/.test(c.note)).map((c) => c.note.replace(/^Thank-you code /, ''));
      const sign = acct.from_name || acct.name;
      const subject = sumOf(money) ? `You earned ${moneyLabel(money)}` : 'A thank-you for your referral';
      const minLine = prog.min_payout_cents ? ` We pay once you reach ${formatMoney(prog.min_payout_cents, list[0].currency)}.` : '';
      const text = `Hi ${aff.first_name || 'there'},\n\n${sumOf(money)
        ? `Good news: ${moneyLabel(money)} from ${list.length === 1 ? 'a sale you sent' : `${list.length} sales you sent`} is now yours. We’ll pay you soon.${minLine}`
        : `Someone you sent bought from ${acct.name}. Thank you!`}${codes.length ? `\n\nYour thank-you code: ${codes.join(', ')}. Use it at checkout.` : ''}\n\nSee your sales and your link: ${portalLink(acct, aff.contact_id)}\n\n${sign}`;
      await messaging.sendTransactional({ account: acct, to: aff.email, contactId: aff.contact_id, subject, text }).catch((e) => console.error('partner earned:', e.message));
      told++;
    }
    return { commissions_approved: due.length, partners_told: told, ...(await ownerSummaries(now)) };
  }

  async function owedRows(accountId) {
    return db().all(`SELECT a.id, a.code, a.kind, a.payout_details, c.first_name, c.last_name, c.email, x.currency, SUM(x.amount_cents)::int AS owed, COUNT(*)::int AS n
      FROM affiliate_commissions x JOIN affiliates a ON a.id = x.affiliate_id JOIN contacts c ON c.id = a.contact_id
      WHERE x.account_id = ? AND x.status = 'approved' GROUP BY a.id, a.code, a.kind, a.payout_details, c.first_name, c.last_name, c.email, x.currency
      HAVING SUM(x.amount_cents) > 0 ORDER BY owed DESC`, accountId);
  }
  async function ownerSummaries(now) {
    const month = monthKey(now);
    let sent = 0;
    for (const p of await db().all('SELECT * FROM affiliate_programs WHERE summary_month <> ?', month)) {
      const claimed = await db().get('UPDATE affiliate_programs SET summary_month = ? WHERE account_id = ? AND summary_month <> ? RETURNING account_id', month, p.account_id, month);
      if (!claimed) continue;
      const ready = (await owedRows(p.account_id)).filter((r) => r.owed >= p.min_payout_cents);
      if (!ready.length) continue;
      const acct = await db().get('SELECT * FROM accounts WHERE id = ?', p.account_id);
      const total = {};
      for (const r of ready) total[r.currency] = (total[r.currency] || 0) + r.owed;
      const body = `Hi,\n\nThese partners are ready to be paid (${moneyLabel(total)} in all):\n\n${ready.map((r) => `• ${personName(r)}: ${formatMoney(r.owed, r.currency)}${r.payout_details ? ` (pay to: ${r.payout_details})` : ''}`).join('\n')}\n\nPay them the usual way (PayPal or a bank transfer; Rilly doesn’t move the money), then press “Mark as paid” next to each one so their dashboard shows it:\n${base()}/#/products/partners\n\nRilly`;
      const r = await messaging.sendToOwner({ account: acct, subject: `Partners to pay: ${moneyLabel(total)} to ${ready.length} ${ready.length === 1 ? 'person' : 'people'}`, body });
      if (r.status === 'sent' || r.status === 'logged') sent++;
    }
    return { partner_summaries: sent };
  }

  // ---------- Fill-ins for emails: {{referral_link}} and {{referral_reward}} ----------
  async function emailFields(account, person) {
    const prog = await program(account.id);
    const currency = await mainCurrency(account.id);
    const friend = prog.friend_coupon_id && await db().get('SELECT * FROM coupons WHERE id = ? AND account_id = ?', prog.friend_coupon_id, account.id);
    const mine = prog.reward_type === 'amount' && prog.reward_cents ? `you get ${formatMoney(prog.reward_cents, currency)} as a thank-you`
      : prog.reward_type === 'coupon' ? 'you get a thank-you code' : '';
    const reward = [friend && `They get ${couponText(friend, currency)}`, mine].filter(Boolean).join(' and ');
    const fields = { referral_reward: reward ? `${reward.charAt(0).toUpperCase()}${reward.slice(1)} when they buy.` : '' };
    const acct = await accountRow(account.id);
    if (!person?.id) return { ...fields, referral_link: `${siteBase(acct)}/r/yourname-1a2b` }; // a test email
    const { aff } = await ensureAffiliate(db(), account.id, person.id);
    return { ...fields, referral_link: linkFor(acct, aff.code) };
  }

  // ---------- Owner API ----------
  const progOut = (p, currency) => ({
    commission_type: p.commission_type, commission: p.commission_type === 'amount' ? p.commission_value / 100 : p.commission_value,
    recurring_months: p.recurring_months, cookie_days: p.cookie_days, hold_days: p.hold_days, min_payout: p.min_payout_cents / 100,
    signup_open: Boolean(p.signup_open), friend_coupon_id: p.friend_coupon_id, reward_type: p.reward_type, reward: p.reward_cents / 100,
    reward_coupon_id: p.reward_coupon_id, landing_funnel_id: p.landing_funnel_id, terms: termsText(p, currency), customer_terms: termsText(p, currency, 'customer'),
  });
  const statsFor = async (accountId, affiliateId = null) => {
    const rows = await db().all(`SELECT affiliate_id, currency,
        COUNT(DISTINCT order_id) FILTER (WHERE status IN ('pending', 'approved', 'paid'))::int AS sales,
        COALESCE(SUM(amount_cents) FILTER (WHERE status IN ('pending', 'approved', 'paid')), 0)::int AS earned,
        COALESCE(SUM(amount_cents) FILTER (WHERE status = 'pending'), 0)::int AS pending,
        COALESCE(SUM(amount_cents) FILTER (WHERE status = 'approved'), 0)::int AS owed,
        COALESCE(SUM(amount_cents) FILTER (WHERE status = 'paid'), 0)::int AS paid
      FROM affiliate_commissions WHERE account_id = ?${affiliateId ? ' AND affiliate_id = ?' : ''} GROUP BY affiliate_id, currency`, accountId, ...(affiliateId ? [affiliateId] : []));
    const out = {};
    for (const r of rows) {
      const s = out[r.affiliate_id] ||= { sales: 0, earned: {}, pending: {}, owed: {}, paid: {} };
      s.sales += r.sales;
      for (const k of ['earned', 'pending', 'owed', 'paid']) s[k][r.currency] = r[k];
    }
    return out;
  };
  const partnerOut = (a, acct, s = {}, prog, currency) => {
    const owedCents = sumOf(s.owed);
    return { id: a.id, contact_id: a.contact_id, name: personName(a), email: a.email, kind: a.kind, status: a.status, code: a.code, link: linkFor(acct, a.code),
      clicks: a.clicks, sales: s.sales || 0, earned: moneyLabel(s.earned, currency), pending: moneyLabel(s.pending, currency), owed: moneyLabel(s.owed, currency),
      paid: moneyLabel(s.paid, currency), owed_cents: owedCents, ready: owedCents > 0 && owedCents >= prog.min_payout_cents,
      payout_details: a.payout_details, application: a.application, created_at: a.created_at };
  };
  const getPartner = async (accountId, raw) => {
    const a = await db().get(`SELECT a.*, c.first_name, c.last_name, c.email FROM affiliates a JOIN contacts c ON c.id = a.contact_id
      WHERE a.id = ? AND a.account_id = ?`, id(raw), accountId);
    if (!a) throw new HttpError(404, 'Partner not found');
    return a;
  };
  const ownCoupon = async (accountId, raw) => {
    if (raw === null || raw === undefined || raw === '') return null;
    const c = await db().get('SELECT id FROM coupons WHERE id = ? AND account_id = ?', id(raw), accountId);
    if (!c) throw new HttpError(400, 'Pick one of your codes');
    return c.id;
  };
  const numIn = (v, { min, max, label }) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${label} must be between ${min} and ${max}`);
    return n;
  };

  api.get('/partners', async (req, res) => {
    const [prog, acct, currency] = await Promise.all([program(req.accountId), accountRow(req.accountId), mainCurrency(req.accountId)]);
    const list = await db().all(`SELECT a.*, c.first_name, c.last_name, c.email FROM affiliates a JOIN contacts c ON c.id = a.contact_id
      WHERE a.account_id = ? ORDER BY (a.status = 'applied') DESC, a.id DESC`, req.accountId);
    const stats = await statsFor(req.accountId);
    const coupons = (await db().all('SELECT id, code, percent_off, amount_off_cents FROM coupons WHERE account_id = ? ORDER BY code', req.accountId))
      .map((c) => ({ id: c.id, code: c.code, label: couponText(c, currency) }));
    const funnels = await db().all("SELECT id, name FROM funnels WHERE account_id = ? AND status = 'live' AND kind <> 'members' ORDER BY name", req.accountId);
    const owedAll = {};
    for (const s of Object.values(stats)) for (const [cur, c] of Object.entries(s.owed)) owedAll[cur] = (owedAll[cur] || 0) + c;
    res.json({ program: progOut(prog, currency), currency, partners: list.map((a) => partnerOut(a, acct, stats[a.id], prog, currency)), coupons, funnels,
      owed_total: moneyLabel(owedAll, currency), signup_url: `${base()}/my/${acct.handle}/partner/join`, dashboard_url: `${base()}/my/${acct.handle}/partner` });
  });

  api.put('/partners/program', async (req, res) => {
    const b = req.body || {};
    const cur = await program(req.accountId);
    const type = b.commission_type === 'amount' ? 'amount' : 'percent';
    const value = type === 'amount' ? Math.round(numIn(b.commission, { min: 0.01, max: 100000, label: 'The amount per sale' }) * 100)
      : Math.round(numIn(b.commission, { min: 1, max: 100, label: 'The percent' }));
    const months = Math.round(numIn(b.recurring_months || 0, { min: 0, max: 120, label: 'Months' }));
    const cookie = Math.round(numIn(b.cookie_days ?? 30, { min: 1, max: 365, label: 'Days a click counts' }));
    const hold = Math.round(numIn(b.hold_days ?? 30, { min: 0, max: 365, label: 'Days to wait' }));
    const min = Math.round(numIn(b.min_payout || 0, { min: 0, max: 100000, label: 'The minimum payout' }) * 100);
    const rewardType = ['amount', 'coupon', 'none'].includes(b.reward_type) ? b.reward_type : 'amount';
    const reward = rewardType === 'amount' ? Math.round(numIn(b.reward ?? 0, { min: 0, max: 100000, label: 'The thank-you' }) * 100) : cur.reward_cents;
    const rewardCoupon = rewardType === 'coupon' ? await ownCoupon(req.accountId, b.reward_coupon_id) : null;
    if (rewardType === 'coupon' && !rewardCoupon) throw new HttpError(400, 'Pick the code customers get as a thank-you');
    const landing = b.landing_funnel_id ? (await db().get('SELECT id FROM funnels WHERE id = ? AND account_id = ?', id(b.landing_funnel_id), req.accountId))?.id : null;
    if (b.landing_funnel_id && !landing) throw new HttpError(400, 'Pick one of your pages');
    await db().run(`INSERT INTO affiliate_programs (account_id, commission_type, commission_value, recurring_months, cookie_days, hold_days, min_payout_cents, signup_open,
        friend_coupon_id, reward_type, reward_cents, reward_coupon_id, landing_funnel_id, summary_month, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now())
      ON CONFLICT (account_id) DO UPDATE SET commission_type = excluded.commission_type, commission_value = excluded.commission_value,
        recurring_months = excluded.recurring_months, cookie_days = excluded.cookie_days, hold_days = excluded.hold_days, min_payout_cents = excluded.min_payout_cents,
        signup_open = excluded.signup_open, friend_coupon_id = excluded.friend_coupon_id, reward_type = excluded.reward_type, reward_cents = excluded.reward_cents,
        reward_coupon_id = excluded.reward_coupon_id, landing_funnel_id = excluded.landing_funnel_id, updated_at = now()`,
    req.accountId, type, value, months, cookie, hold, min, b.signup_open ? 1 : 0, await ownCoupon(req.accountId, b.friend_coupon_id),
    rewardType, reward, rewardCoupon, landing, monthKey(new Date()));
    res.json({ ok: true });
  });
  // Saves the program with its defaults the first time a partner is added (so the monthly summary starts next month).
  const ensureProgram = (accountId) => db().run('INSERT INTO affiliate_programs (account_id, summary_month) VALUES (?, ?) ON CONFLICT (account_id) DO NOTHING', accountId, monthKey(new Date()));

  async function welcome(accountId, affId, { approved = false } = {}) {
    const a = await db().get('SELECT a.*, c.first_name, c.email FROM affiliates a JOIN contacts c ON c.id = a.contact_id WHERE a.id = ?', affId);
    const acct = await db().get('SELECT * FROM accounts WHERE id = ?', accountId);
    const prog = await program(accountId);
    const currency = await mainCurrency(accountId);
    const link = linkFor(acct, a.code);
    await messaging.sendTransactional({ account: acct, to: a.email, contactId: a.contact_id,
      subject: approved ? `You’re approved as a ${acct.name} partner` : `Your partner link for ${acct.name}`,
      text: `Hi ${a.first_name || 'there'},\n\n${approved ? 'Good news: you’re approved.' : `You’re now a partner of ${acct.name}.`} Share your link and you earn ${termsText(prog, currency, a.kind)}.\n\nYour link: ${link}\n\nSee your clicks, sales and earnings any time: ${portalLink(acct, a.contact_id)}\n\n${acct.from_name || acct.name}` })
      .catch((e) => console.error('partner welcome:', e.message));
  }

  api.post('/partners', async (req, res) => {
    const b = req.body || {};
    const email = String(b.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter their email address');
    const kind = KINDS.includes(b.kind) ? b.kind : 'partner';
    await ensureProgram(req.accountId);
    const contact = await upsertContact(db(), req.accountId, { email, name: String(b.name || '').trim().slice(0, 80), source: 'other', entry: kind === 'partner' ? 'Added as a partner' : 'Added as a referrer' });
    const { aff, created } = await ensureAffiliate(db(), req.accountId, contact.id, { kind });
    if (!created) {
      if (aff.status === 'active' && aff.kind === kind) throw new HttpError(409, 'They’re already in your list');
      await db().run("UPDATE affiliates SET status = 'active', kind = ? WHERE id = ?", kind, aff.id);
    }
    if (b.send !== false) await welcome(req.accountId, aff.id);
    res.status(201).json({ id: aff.id });
  });

  api.get('/partners/owed.csv', async (req, res) => {
    const prog = await program(req.accountId);
    const rows = (await owedRows(req.accountId)).filter((r) => r.owed >= prog.min_payout_cents);
    res.attachment(`partners-to-pay-${new Date().toISOString().slice(0, 10)}.csv`).type('text/csv')
      .send(toCsv(rows.map((r) => ({ name: personName(r), email: r.email, pay_to: r.payout_details, amount: (r.owed / 100).toFixed(2), currency: r.currency.toUpperCase(), sales: r.n, code: r.code }))));
  });

  api.get('/partners/:id', async (req, res) => {
    const a = await getPartner(req.accountId, req.params.id);
    const [prog, acct, currency] = await Promise.all([program(req.accountId), accountRow(req.accountId), mainCurrency(req.accountId)]);
    const s = (await statsFor(req.accountId, a.id))[a.id];
    const commissions = await db().all(`SELECT x.*, o.product_name, c.first_name, c.last_name, c.email FROM affiliate_commissions x
      LEFT JOIN orders o ON o.id = x.order_id LEFT JOIN contacts c ON c.id = x.buyer_contact_id
      WHERE x.affiliate_id = ? AND x.account_id = ? AND x.status <> 'trial' ORDER BY x.id DESC LIMIT 300`, a.id, req.accountId);
    const payouts = await db().all('SELECT * FROM affiliate_payouts WHERE affiliate_id = ? AND account_id = ? ORDER BY paid_on DESC, id DESC', a.id, req.accountId);
    res.json({ ...partnerOut(a, acct, s, prog, currency),
      commissions: commissions.map((x) => ({ id: x.id, status: x.status, product: x.product_name || '', buyer: x.buyer_contact_id ? personName(x) : '', buyer_id: x.buyer_contact_id,
        payment_no: x.payment_no, sale: formatMoney(x.sale_cents, x.currency), amount: formatMoney(x.amount_cents, x.currency), sale_at: x.sale_at, available_at: x.available_at, note: x.note })),
      payouts: payouts.map((p) => ({ id: p.id, amount: formatMoney(p.amount_cents, p.currency), paid_on: p.paid_on instanceof Date ? p.paid_on.toISOString().slice(0, 10) : String(p.paid_on).slice(0, 10), note: p.note })) });
  });

  api.put('/partners/:id', async (req, res) => {
    const a = await getPartner(req.accountId, req.params.id);
    const b = req.body || {};
    const status = b.status === undefined ? a.status : b.status;
    if (!STATUSES.includes(status)) throw new HttpError(400, 'Unknown status');
    const kind = KINDS.includes(b.kind) ? b.kind : a.kind;
    let code = a.code;
    if (b.code !== undefined && String(b.code).trim().toLowerCase() !== a.code) {
      code = String(b.code).trim().toLowerCase();
      if (!CODE_RE.test(code)) throw new HttpError(400, 'Use 3 to 30 letters, numbers or dashes for the link name, like jamie');
      if (await db().get('SELECT 1 FROM affiliates WHERE code = ?', code)) throw new HttpError(400, 'That link name is taken. Try another');
    }
    await db().run('UPDATE affiliates SET status = ?, kind = ?, code = ? WHERE id = ? AND account_id = ?', status, kind, code, a.id, req.accountId);
    if (a.status === 'applied' && status === 'active') await welcome(req.accountId, a.id, { approved: true });
    res.json({ ok: true });
  });

  // "Mark as paid": the owner paid outside Rilly; every approved commission moves into this payout.
  api.post('/partners/:id/payouts', async (req, res) => {
    const a = await getPartner(req.accountId, req.params.id);
    const b = req.body || {};
    const date = String(b.paid_on || '').trim() || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'Pick the date you paid');
    const out = await db().tx(async (t) => {
      const owed = await t.all("SELECT id, amount_cents, currency FROM affiliate_commissions WHERE affiliate_id = ? AND account_id = ? AND status = 'approved' FOR UPDATE", a.id, req.accountId);
      if (!owed.length) throw new HttpError(400, `Nothing is owed to ${personName(a)} right now`);
      const total = owed.reduce((n, x) => n + x.amount_cents, 0);
      const amount = b.amount === undefined || b.amount === '' ? total : Math.round(numIn(b.amount, { min: 0, max: 1e7, label: 'The amount' }) * 100);
      const p = await t.get('INSERT INTO affiliate_payouts (account_id, affiliate_id, amount_cents, currency, paid_on, note) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
        req.accountId, a.id, amount, owed[0].currency, date, String(b.note || '').trim().slice(0, 300));
      await t.run(`UPDATE affiliate_commissions SET status = 'paid', payout_id = ? WHERE id IN (${owed.map(() => '?').join(', ')})`, p.id, ...owed.map((x) => x.id));
      return { id: p.id, amount: formatMoney(amount, owed[0].currency) };
    });
    res.status(201).json(out);
  });
  // Undo of "Mark as paid".
  api.delete('/partners/payouts/:pid', async (req, res) => {
    await db().tx(async (t) => {
      const p = await t.get('SELECT id FROM affiliate_payouts WHERE id = ? AND account_id = ?', id(req.params.pid), req.accountId);
      if (!p) throw new HttpError(404, 'Payment not found');
      await t.run("UPDATE affiliate_commissions SET status = 'approved', payout_id = NULL WHERE payout_id = ? AND account_id = ?", p.id, req.accountId);
      await t.run('DELETE FROM affiliate_payouts WHERE id = ?', p.id);
    });
    res.json({ ok: true });
  });
  // Cancel one commission (e.g. refunded outside Stripe), or bring it back (Undo).
  api.put('/partners/commissions/:cid', async (req, res) => {
    const to = req.body?.status;
    if (!['void', 'pending', 'approved'].includes(to)) throw new HttpError(400, 'Unknown status');
    const r = await db().run(`UPDATE affiliate_commissions SET status = ?, note = CASE WHEN ? = 'void' THEN 'Cancelled by you' ELSE '' END
      WHERE id = ? AND account_id = ? AND status IN ('pending', 'approved', 'void')`, to, to, id(req.params.cid), req.accountId);
    if (!r.changes) throw new HttpError(400, 'Paid commissions can’t be changed');
    res.json({ ok: true });
  });

  // ---------- Partner side (public) ----------
  const form = express.urlencoded({ extended: false, limit: '4kb' });
  const publicAccount = (raw, opts) => require('./handles').accountByHandle(db(), raw, { ...opts, columns: 'id, name, from_name, from_email, domain, brand_color, home_funnel_id, handle' });
  function portalLink(acct, contactId, days = 7) {
    const exp = Math.floor(Date.now() / 1000) + days * 86400;
    const body = `${contactId}.${acct.id}.${exp}`;
    return `${base()}/my/${acct.handle}/partner/enter/${body}.${members.sign(`partner:${body}`)}`;
  }
  const page = (res, acct, title, html, { status = 200, who = '' } = {}) => {
    const brand = /^#[0-9a-f]{6}$/i.test(acct.brand_color || '') ? acct.brand_color : '#1B736D';
    res.set('X-Robots-Tag', 'noindex').status(status).type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · ${esc(acct.name)}</title>
<style>${PARTNER_CSS.replace(/BRAND/g, brand)}</style></head><body><header class="top"><div class="in"><b>${esc(acct.name)}</b>${who ? `<span class="who">${esc(who)} · <a href="/my/${acct.handle}/logout">Sign out</a></span>` : ''}</div></header>
<main>${html}</main><script>document.querySelectorAll('[data-copy]').forEach(function(b){b.onclick=function(){var t=b.getAttribute('data-copy')||document.getElementById(b.getAttribute('data-from')).value;navigator.clipboard.writeText(t).then(function(){var o=b.textContent;b.textContent='Copied';setTimeout(function(){b.textContent=o},1500)})}});
var pg=document.getElementById('pg');if(pg){var out=document.getElementById('pglink'),f=function(){var u=pg.value;out.value=u+(u.indexOf('?')<0?'?':'&')+'ref='+pg.getAttribute('data-code')};pg.onchange=f;f()}</script></body></html>`);
  };
  const signedInPartner = async (req, acct) => {
    const cid = members.memberOf(req, { account_id: acct.id });
    if (!cid) return { contact: null, aff: null };
    const contact = await db().get('SELECT * FROM contacts WHERE id = ? AND account_id = ?', cid, acct.id);
    const aff = contact && await db().get('SELECT * FROM affiliates WHERE contact_id = ? AND account_id = ?', contact.id, acct.id);
    return { contact, aff };
  };
  const loginHtml = (acct, prog, { sent = false } = {}) => `<div class="card narrow"><h1>Partner dashboard</h1>
    ${sent ? '<p class="ok">If that email is one of our partners, a sign-in link is on its way. Check your inbox (and spam, just in case).</p>'
    : `<p class="m">Enter your email and we’ll send you a sign-in link. No password needed.</p>
    <form method="post" action="/my/${acct.handle}/partner/login"><input type="email" name="email" required autocomplete="email" placeholder="you@example.com" aria-label="Your email"><button class="b">Email me a sign-in link</button></form>`}
    ${prog.signup_open ? `<p class="m small">Not a partner yet? <a href="/my/${acct.handle}/partner/join">Become a partner</a></p>` : ''}</div>`;

  app.get('/my/:acct/partner', async (req, res) => {
    const acct = await publicAccount(req.params.acct);
    if (!acct) return res.status(404).type('text').send('Not found');
    const prog = await program(acct.id);
    const { contact, aff } = await signedInPartner(req, acct);
    if (!contact) return page(res, acct, 'Partner dashboard', loginHtml(acct, prog));
    const who = contact.email;
    if (!aff || aff.status === 'declined') {
      return page(res, acct, 'Partner dashboard', `<div class="card narrow"><h1>Partner dashboard</h1><p class="m">${esc(contact.email)} isn’t one of our partners.</p>
        ${prog.signup_open ? `<p><a class="b" href="/my/${acct.handle}/partner/join">Become a partner</a></p>` : ''}</div>`, { who });
    }
    if (aff.status === 'applied') return page(res, acct, 'Partner dashboard', `<div class="card narrow"><h1>Thanks for applying</h1><p class="m">We’ll email you as soon as you’re approved.</p></div>`, { who });
    const currency = await mainCurrency(acct.id);
    const s = (await statsFor(acct.id, aff.id))[aff.id] || {};
    const link = linkFor(acct, aff.code);
    const pages = await pagesOf(acct);
    const list = await db().all(`SELECT x.*, o.product_name FROM affiliate_commissions x LEFT JOIN orders o ON o.id = x.order_id
      WHERE x.affiliate_id = ? AND x.account_id = ? AND x.status <> 'trial' ORDER BY x.id DESC LIMIT 100`, aff.id, acct.id);
    const payouts = await db().all('SELECT * FROM affiliate_payouts WHERE affiliate_id = ? AND account_id = ? ORDER BY paid_on DESC, id DESC LIMIT 50', aff.id, acct.id);
    const day = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    const pill = (x) => (x.status === 'pending' ? `<span class="pill wait">On hold until ${esc(day(x.available_at))}</span>` : x.status === 'approved' ? '<span class="pill ok">Approved</span>'
      : x.status === 'paid' ? '<span class="pill paid">Paid</span>' : '<span class="pill void">Cancelled</span>');
    const share = `I love ${acct.name}. If you’re curious, take a look: ${link}`;
    const friend = prog.friend_coupon_id && await db().get('SELECT * FROM coupons WHERE id = ? AND account_id = ?', prog.friend_coupon_id, acct.id);
    const shareFriend = friend ? `I love ${acct.name}. Use my link and you get ${couponText(friend, currency)}: ${link}` : share;
    const terms = termsText(prog, currency, aff.kind);
    page(res, acct, 'Partner dashboard', `<h1>Hi ${esc(contact.first_name || 'there')}</h1>
      <p class="m">You earn ${esc(terms)}. A click counts for ${prog.cookie_days} days. Earnings are approved ${prog.hold_days ? `${prog.hold_days} days after the sale (in case of refunds)` : 'straight away'}${prog.min_payout_cents ? `, and paid once you reach ${esc(formatMoney(prog.min_payout_cents, currency))}` : ''}.</p>
      <div class="card hero"><label class="lbl" for="mylink">Your link</label><div class="copyrow"><input id="mylink" readonly value="${esc(link)}"><button class="b sm" data-from="mylink">Copy</button></div>
        ${friend ? `<p class="m small">Friends who use it get ${esc(couponText(friend, currency))}.</p>` : ''}</div>
      <div class="stats"><div><b>${aff.clicks}</b><span>clicks</span></div><div><b>${s.sales || 0}</b><span>sales</span></div>
        <div><b>${esc(moneyLabel(s.pending, currency))}</b><span>on hold</span></div><div><b>${esc(moneyLabel(s.owed, currency))}</b><span>approved, to be paid</span></div><div><b>${esc(moneyLabel(s.paid, currency))}</b><span>paid to you</span></div></div>
      <h2>Share it</h2><div class="card"><p class="quote" id="sharetext">${esc(shareFriend)}</p><button class="b sm ghost" data-copy="${esc(shareFriend)}">Copy message</button></div>
      ${pages.length > 1 ? `<h2>Link to a different page</h2><div class="card"><label class="lbl" for="pg">Page</label><select id="pg" data-code="${esc(aff.code)}">${pages.map((p) => `<option value="${esc(p.url)}">${esc(p.name)}</option>`).join('')}</select>
        <div class="copyrow"><input id="pglink" readonly aria-label="Link to this page"><button class="b sm" data-from="pglink">Copy</button></div><p class="m small">Any page link works too: add <code>?ref=${esc(aff.code)}</code> to the end.</p></div>` : ''}
      <h2>Your sales</h2>${list.length ? `<div class="card list">${list.map((x) => `<div class="row"><span><b>${esc(x.product_name || 'A sale')}</b>${x.payment_no > 1 ? ` <span class="m">payment ${x.payment_no}</span>` : ''}<br><span class="m small">${esc(day(x.sale_at))} · sale ${esc(formatMoney(x.sale_cents, x.currency))}</span></span>
        <span class="amt">${x.note && /^Thank-you code/.test(x.note) ? 'Thank-you code' : esc(formatMoney(x.amount_cents, x.currency))}</span>${pill(x)}</div>`).join('')}</div>` : '<p class="m card">No sales yet. Share your link and they show up here.</p>'}
      ${payouts.length ? `<h2>Payments to you</h2><div class="card list">${payouts.map((p) => `<div class="row"><span>${esc(day(p.paid_on))}${p.note ? ` <span class="m">· ${esc(p.note)}</span>` : ''}</span><span class="amt">${esc(formatMoney(p.amount_cents, p.currency))}</span></div>`).join('')}</div>` : ''}
      ${aff.kind === 'partner' ? `<h2>How you get paid</h2><div class="card"><p class="m small">${esc(acct.name)} pays you directly, by PayPal or bank transfer. Tell them where to send it.</p>
        <form method="post" action="/my/${acct.handle}/partner/details"><input name="payout_details" maxlength="200" value="${esc(aff.payout_details)}" placeholder="e.g. PayPal: you@example.com" aria-label="Where to send your money"><button class="b sm">Save</button>${req.query.saved ? ' <span class="m">Saved</span>' : ''}</form></div>` : ''}`, { who });
  });

  app.post('/my/:acct/partner/details', form, async (req, res) => {
    const acct = await publicAccount(req.params.acct);
    if (!acct) return res.status(404).type('text').send('Not found');
    const { aff } = await signedInPartner(req, acct);
    if (!aff) return res.redirect(303, `/my/${acct.handle}/partner`);
    await db().run('UPDATE affiliates SET payout_details = ? WHERE id = ? AND account_id = ?', String(req.body.payout_details || '').trim().slice(0, 200), aff.id, acct.id);
    res.redirect(303, `/my/${acct.handle}/partner?saved=1`);
  });

  app.post('/my/:acct/partner/login', form, async (req, res) => {
    const acct = await publicAccount(req.params.acct);
    if (!acct) return res.status(404).type('text').send('Not found');
    const email = String(req.body.email || '').trim().toLowerCase();
    if (EMAIL_RE.test(email)) { // same answer either way
      const a = await db().get(`SELECT a.contact_id, c.first_name, c.email FROM affiliates a JOIN contacts c ON c.id = a.contact_id
        WHERE a.account_id = ? AND c.email = ? AND a.status IN ('active', 'applied')`, acct.id, email);
      const recent = a && await db().get("SELECT 1 FROM email_log WHERE contact_id = ? AND subject LIKE 'Your partner sign-in link%' AND created_at > now() - interval '2 minutes'", a.contact_id);
      if (a && !recent) {
        const full = await db().get('SELECT * FROM accounts WHERE id = ?', acct.id);
        await messaging.sendTransactional({ account: full, to: a.email, contactId: a.contact_id, subject: `Your partner sign-in link for ${acct.name}`,
          text: `Hi ${a.first_name || 'there'},\n\nHere’s your link to see your clicks, sales and earnings with ${acct.name}:\n\n${portalLink(acct, a.contact_id)}\n\nThe link works for 7 days and keeps you signed in on this device.\n\n${full.from_name || acct.name}` })
          .catch((e) => console.error('partner link:', e.message));
      }
    }
    page(res, acct, 'Partner dashboard', loginHtml(acct, await program(acct.id), { sent: true }));
  });

  app.get('/my/:acct/partner/enter/:token', async (req, res) => {
    const acct = await publicAccount(req.params.acct, { allowId: true });
    if (!acct) return res.status(404).type('text').send('Not found');
    const parts = String(req.params.token).split('.');
    const [cid, aid, exp, sig] = parts;
    const ok = parts.length === 4 && /^\d{1,9}$/.test(cid) && members.same(sig, members.sign(`partner:${cid}.${aid}.${exp}`)) && Number(aid) === acct.id && Number(exp) * 1000 > Date.now()
      && await db().get('SELECT 1 FROM affiliates WHERE contact_id = ? AND account_id = ?', Number(cid), acct.id);
    if (!ok) return page(res, acct, 'Partner dashboard', loginHtml(acct, await program(acct.id)), { status: 401 });
    members.signIn(res, acct.id, Number(cid));
    res.redirect(303, `/my/${acct.handle}/partner`);
  });

  // Public "Become a partner" page (only while the owner has it turned on).
  const joinHtml = (acct, prog, currency, { done = false, error = '' } = {}) => `<div class="card narrow"><h1>Become a ${esc(acct.name)} partner</h1>
    ${done ? '<p class="ok">Thanks! We’ll look at your application and email you when you’re approved.</p>'
    : `<p class="m">Share ${esc(acct.name)} with your audience and earn ${esc(termsText(prog, currency))}.</p>${error ? `<p class="err">${esc(error)}</p>` : ''}
    <form method="post" action="/my/${acct.handle}/partner/join"><input name="name" required maxlength="80" autocomplete="name" placeholder="Your name" aria-label="Your name">
    <input type="email" name="email" required autocomplete="email" placeholder="you@example.com" aria-label="Your email">
    <textarea name="how" rows="3" maxlength="600" placeholder="Where will you share it? (your site, newsletter, Instagram…)" aria-label="Where will you share it?"></textarea>
    <input name="website" tabindex="-1" autocomplete="off" class="hp" aria-hidden="true"><button class="b">Apply</button></form>
    <p class="m small">Already a partner? <a href="/my/${acct.handle}/partner">Sign in</a></p>`}</div>`;
  app.get('/my/:acct/partner/join', async (req, res) => {
    const acct = await publicAccount(req.params.acct);
    const prog = acct && await program(acct.id);
    if (!acct || !prog.signup_open) return res.status(404).type('text').send('Not found');
    page(res, acct, 'Become a partner', joinHtml(acct, prog, await mainCurrency(acct.id)));
  });
  app.post('/my/:acct/partner/join', form, async (req, res) => {
    const acct = await publicAccount(req.params.acct);
    const prog = acct && await program(acct.id);
    if (!acct || !prog.signup_open) return res.status(404).type('text').send('Not found');
    const currency = await mainCurrency(acct.id);
    if (req.body.website) return page(res, acct, 'Become a partner', joinHtml(acct, prog, currency, { done: true })); // bots fill the hidden field
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return page(res, acct, 'Become a partner', joinHtml(acct, prog, currency, { error: 'Please enter a valid email.' }), { status: 400 });
    const contact = await upsertContact(db(), acct.id, { email, name: String(req.body.name || '').trim().slice(0, 80), source: 'other', entry: 'Applied to be a partner' });
    const { created } = await ensureAffiliate(db(), acct.id, contact.id, { kind: 'partner', status: 'applied', application: String(req.body.how || '').trim().slice(0, 600) });
    if (created) {
      const full = await db().get('SELECT * FROM accounts WHERE id = ?', acct.id);
      await messaging.sendToOwner({ account: full, subject: `New partner application: ${String(req.body.name || email).slice(0, 80)}`,
        body: `${String(req.body.name || '').trim() || email} (${email}) applied to be a partner.${req.body.how ? `\n\nWhere they’ll share it: ${String(req.body.how).slice(0, 600)}` : ''}\n\nApprove or decline: ${base()}/#/products/partners\n\nRilly` })
        .catch((e) => console.error('partner application:', e.message));
    }
    page(res, acct, 'Become a partner', joinHtml(acct, prog, currency, { done: true }));
  });

  // ---------- Short link ----------
  app.get('/r/:code', async (req, res) => {
    const code = String(req.params.code || '').trim().toLowerCase();
    const aff = CODE_RE.test(code) && await db().get('SELECT * FROM affiliates WHERE code = ?', code);
    const acct = aff && await accountRow(aff.account_id);
    const prog = acct && await program(acct.id);
    const live = (fid) => fid && db().get("SELECT id FROM funnels WHERE id = ? AND account_id = ? AND status = 'live' AND kind <> 'members'", fid, acct.id);
    const target = acct && ((await live(prog.landing_funnel_id)) || (await live(acct.home_funnel_id))
      || await db().get("SELECT id FROM funnels WHERE account_id = ? AND status = 'live' AND kind <> 'members' ORDER BY id LIMIT 1", acct.id));
    if (!target) return res.status(404).type('html').send('<!doctype html><meta name="viewport" content="width=device-width"><title>Link not found</title><p style="font:18px system-ui;text-align:center;margin-top:20vh;padding:0 20px">This link isn’t working any more.</p>');
    const url = (await pagesOf(acct)).find((p) => p.funnel_id === target.id)?.url || `${base()}/`;
    const friend = aff.status === 'active' && prog.friend_coupon_id && await db().get('SELECT code FROM coupons WHERE id = ? AND account_id = ?', prog.friend_coupon_id, acct.id);
    const q = aff.status === 'active' ? `ref=${encodeURIComponent(aff.code)}${friend ? `&coupon=${encodeURIComponent(friend.code)}` : ''}` : '';
    // Same host: a relative redirect keeps the cookie on the address the visitor is on.
    const rel = url.startsWith(base()) && !req.publicHost ? url.slice(base().length) || '/' : url;
    res.redirect(302, q ? `${rel}${rel.includes('?') ? '&' : '?'}${q}` : rel);
  });

  return { track, attachOrder, friendCoupon, onOrderPaid, onStripeEvent, processDue, emailFields, refFromCookie };
}

const PARTNER_CSS = `*{box-sizing:border-box}body{margin:0;font:16px/1.55 -apple-system,system-ui,sans-serif;color:#14282B;background:#F4F7F6}
.top{background:#fff;border-bottom:1px solid #E3E9E8}.top .in{max-width:860px;margin:0 auto;padding:14px 16px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.who{color:#5B6B70;font-size:.9rem}
main{max-width:860px;margin:0 auto;padding:28px 16px 60px}h1{font-size:1.6rem;margin:0 0 6px}h2{font-size:1.1rem;margin:28px 0 12px}a{color:BRAND}
.card{background:#fff;border:1px solid #E3E9E8;border-radius:16px;padding:20px 22px}.narrow{max-width:460px;margin:8vh auto 0}.m{color:#5B6B70}.small{font-size:.9rem}
input,select,textarea{width:100%;padding:12px;border:1px solid #c9d1d3;border-radius:10px;font:inherit;margin:10px 0 8px;background:#fff}textarea{resize:vertical}
.b{display:inline-block;text-align:center;text-decoration:none;width:100%;background:BRAND;color:#fff;border:0;border-radius:10px;padding:13px;font:600 1rem system-ui;cursor:pointer}
.b.sm{width:auto;padding:11px 18px;font-size:.95rem;white-space:nowrap}.b.ghost{background:#fff;color:BRAND;border:1px solid currentColor}
.ok{background:#e6f4f2;color:#14524d;border-radius:10px;padding:12px}.err{background:#fdecec;color:#8a1c1c;border-radius:10px;padding:10px 12px}.hp{position:absolute;left:-9999px;width:1px;height:1px}
.hero p{margin:4px 0 0}.hero{margin-top:18px;border-color:BRAND;box-shadow:0 6px 24px rgba(20,40,43,.06)}.lbl{font-weight:600;font-size:.9rem}
.copyrow{display:flex;gap:10px;align-items:center}.copyrow input{margin:8px 0;font-family:ui-monospace,Menlo,monospace;font-size:.95rem;background:#F8FAFA}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-top:16px}.stats div{background:#fff;border:1px solid #E3E9E8;border-radius:14px;padding:14px 16px}
.stats b{display:block;font-size:1.35rem}.stats span{color:#5B6B70;font-size:.88rem}
.quote{margin:0 0 12px;padding:12px 14px;background:#F8FAFA;border-left:3px solid BRAND;border-radius:8px}
.list{padding:4px 22px}.row{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:12px 0;border-bottom:1px solid #EEF2F1}.list .row:last-child{border-bottom:0}.row .amt{margin-left:auto;font-weight:600}
.pill{font-size:.78rem;padding:3px 10px;border-radius:99px;white-space:nowrap;background:#EEF2F1;color:#3b4b4f}.pill.ok{background:#e6f4f2;color:#14524d}.pill.paid{background:BRAND;color:#fff}.pill.wait{background:#fef3c7;color:#92400e}.pill.void{text-decoration:line-through}
code{background:#EEF2F1;padding:1px 6px;border-radius:6px}form .b.sm{margin-top:4px}
@media (max-width:560px){.row{flex-wrap:wrap}.copyrow{flex-direction:column;align-items:stretch}}`;

module.exports = { registerAffiliates, termsText, moneyLabel };
