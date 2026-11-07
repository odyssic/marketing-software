// Paid bookings: a Booking block can be Free, "Pay in full" or "Deposit".
// Picking a time holds it for 15 minutes while they pay (Stripe Checkout, or
// the test checkout when Stripe isn't connected). Payment creates an ordinary
// order, so it shows in Orders and reports; the booking is confirmed only when
// the order is paid (return page or Stripe webhook, both via fulfilOrder).
// Free cancellation up to N hours before; later, the payment is kept.
// Refunds are done by the owner in Stripe; a deposit's balance can be sent as
// an invoice.
const crypto = require('node:crypto');

const HOLD_MIN = 15;
const CURRENCIES = ['usd', 'eur', 'gbp', 'cad', 'aud'];
const money = (cents, cur = 'usd') => new Intl.NumberFormat('en-US', { style: 'currency', currency: String(cur || 'usd').toUpperCase() }).format((cents || 0) / 100).replace(/\.00$/, '');
const cents = (v) => { const n = parseFloat(String(v ?? '').replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? Math.max(0, Math.round(n * 100)) : 0; };

// What a Booking block charges. Stripe can't charge under 50 cents, so less counts as free.
function payOf(block = {}) {
  const want = String(block.payment || '');
  let kind = /deposit/i.test(want) ? 'deposit' : /full/i.test(want) ? 'full' : '';
  const price = Math.min(cents(block.price), 10_000_000);
  let deposit = cents(block.deposit);
  const currency = CURRENCIES.includes(String(block.currency || '').toLowerCase()) ? String(block.currency).toLowerCase() : 'usd';
  if (!kind || price < 50) return { kind: '', price: 0, due: 0, balance: 0, currency };
  if (kind === 'deposit' && (!deposit || deposit >= price)) kind = 'full';
  if (kind === 'deposit' && deposit < 50) deposit = 50;
  const due = kind === 'full' ? price : deposit;
  return { kind, price, due, balance: price - due, currency };
}
function payLabel(p) {
  if (!p.kind) return '';
  return p.kind === 'full' ? `${money(p.price, p.currency)}, paid when you book` : `${money(p.due, p.currency)} deposit to book · ${money(p.balance, p.currency)} at the appointment`;
}
const hoursText = (h) => (h >= 48 && h % 24 === 0 ? `${h / 24} days` : h === 1 ? '1 hour' : `${h} hours`);
// The owner's rule, in plain words, and whether cancelling now is still free.
function cancelRule(s, bk, now = new Date()) {
  const hours = Number.isFinite(+s.cancel_hours) ? +s.cancel_hours : 24;
  const cutoff = new Date(new Date(bk.starts_at).getTime() - hours * 3600e3);
  const what = bk.pay_kind === 'deposit' ? 'deposit' : 'payment';
  return { hours, cutoff, free: now < cutoff, what,
    text: hours ? `Free cancellation up to ${hoursText(hours)} before. After that, your ${what} is kept.` : `Free cancellation any time before it starts.` };
}
const balanceOf = (bk) => Math.max(0, (bk.price_cents || 0) - (bk.paid_cents || 0));
function paidLine(bk, { balanceStatus = '' } = {}) {
  if (!bk.pay_kind || !bk.paid_cents) return '';
  if (bk.pay_kind === 'full' || !balanceOf(bk)) return `Paid ${money(bk.paid_cents, bk.currency)}`;
  return `Paid ${money(bk.paid_cents, bk.currency)} deposit · ${balanceStatus === 'paid' ? 'balance paid' : `balance ${money(balanceOf(bk), bk.currency)} due at the appointment`}`;
}
// Where the owner refunds it. Test-mode payments have nothing to refund.
function refundUrl(bk, { mode, testKey, email }) {
  if (!bk.paid_cents || mode !== 'stripe') return '';
  const base = `https://dashboard.stripe.com/${testKey ? 'test/' : ''}`;
  return /^pi_[\w]+$/.test(bk.stripe_payment || '') ? `${base}payments/${bk.stripe_payment}` : `${base}search?query=${encodeURIComponent(email || '')}`;
}

function createPaidBookings({ getDb, HttpError, stripe, orderToken, checkout, invoices, fulfilOrder, messaging, publicBase, logEvent, settingsOf, when, sendConfirmation, escH }) {
  const db = () => getDb();
  const unique = (e) => String(e?.code) === '23505' || /unique/i.test(e?.message || '');

  // Holds nobody paid for within 15 minutes free their time again.
  async function expireHolds(now = new Date(), accountId = null) {
    const rows = await db().all(`UPDATE bookings SET status = 'expired' WHERE status = 'held' AND hold_until <= ?${accountId ? ' AND account_id = ?' : ''} RETURNING order_id`,
      ...[now.toISOString(), ...(accountId ? [accountId] : [])]);
    for (const r of rows) if (r.order_id) await db().run("UPDATE orders SET status = 'expired' WHERE id = ? AND status = 'pending'", r.order_id);
    return { holds_released: rows.length };
  }

  // A Stripe session (or the test checkout) for a held booking's order.
  async function payUrl(bk, order, account) {
    if (order.mode !== 'stripe') return `/checkout/test/${order.id}/${orderToken(order.id)}`;
    const s = settingsOf(account);
    const base = publicBase();
    const session = await stripe.createCheckoutSession(account.stripe_secret_key, {
      product: { name: order.product_name, description: `${s.title} with ${account.name}, ${when(bk.starts_at, s.tz)}`, price_cents: order.amount_cents, currency: order.currency, billing: 'one_time' },
      orderId: order.id, email: bk.email, couponCode: order.coupon_code || '', unitAmount: order.amount_cents,
      // Stripe's shortest allowed expiry is 30 minutes; a payment after our 15-minute hold is still confirmed if the time is free.
      expiresAt: Math.floor(Date.now() / 1000) + 31 * 60,
      successUrl: `${base}/checkout/success/${order.id}?session_id={CHECKOUT_SESSION_ID}`, cancelUrl: `${base}/b/${bk.token}`,
    });
    await db().run('UPDATE orders SET stripe_session_id = ? WHERE id = ?', session.id, order.id);
    return session.url;
  }

  // From the booking route: hold the time, make the order, return where to pay.
  async function start({ account, funnel, step, s, slot, contact, name, email, b, pay, source }) {
    await expireHolds(new Date(), account.id);
    let off = 0, code = '';
    const typed = String(b.code || '').trim().slice(0, 40);
    if (typed) {
      const got = await checkout.checkCoupon(account.id, typed, { id: -1 });
      if (got.error) throw new HttpError(400, got.error);
      code = got.coupon.code;
      off = got.coupon.percent_off ? Math.round(pay.due * got.coupon.percent_off / 100) : Math.min(got.coupon.amount_off_cents, pay.due);
      if (pay.due - off > 0 && pay.due - off < 50) off = Math.max(0, pay.due - 50);
    }
    const charge = pay.due - off;
    const token = crypto.randomBytes(18).toString('base64url');
    let bk;
    try {
      bk = await db().get(`INSERT INTO bookings (account_id, contact_id, funnel_id, starts_at, ends_at, name, email, phone, note, token, status, hold_until, pay_kind, price_cents, currency)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'held', ?, ?, ?, ?) RETURNING *`, account.id, contact.id, funnel.id, slot.start, slot.end, name, email,
      String(b.phone || '').slice(0, 40), String(b.note || '').slice(0, 2000), token, new Date(Date.now() + HOLD_MIN * 60e3).toISOString(), pay.kind, charge + pay.balance, pay.currency);
    } catch (e) {
      if (unique(e)) throw new HttpError(409, 'Sorry, that time was just taken. Please pick another.');
      throw e;
    }
    const label = `${pay.kind === 'deposit' ? 'Deposit: ' : ''}${s.title}`;
    const order = await db().get(`INSERT INTO orders (account_id, product_name, amount_cents, currency, mode, source, external_id, funnel_id, step_id, items, email, attribution, coupon_code, discount_cents)
      VALUES (?, ?, ?, ?, ?, 'booking', ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`, account.id, label, charge, pay.currency, account.stripe_secret_key ? 'stripe' : 'test',
    `bk:${bk.id}`, funnel.id, step.id, JSON.stringify([{ name: label, qty: 1, price_cents: charge, ...(off ? { discount_cents: off, coupon: code } : {}) }]), email,
    source ? JSON.stringify(source) : '', code, off);
    await db().run('UPDATE bookings SET order_id = ? WHERE id = ?', order.id, bk.id);
    bk.order_id = order.id;
    if (!charge) { // a 100% code: nothing to pay
      await fulfilOrder(order, { email, name });
      return { ok: true, start: slot.start, end: slot.end, manage: `/b/${token}` };
    }
    try {
      return { ok: true, pay: await payUrl(bk, order, account), hold_minutes: HOLD_MIN, manage: `/b/${token}` };
    } catch (e) {
      console.error('booking checkout:', e.message);
      await db().run("UPDATE bookings SET status = 'expired' WHERE id = ?", bk.id);
      throw new HttpError(502, 'Payment is temporarily unavailable. Please try again in a moment.');
    }
  }

  // fulfilOrder calls this for every paid order; only booking orders matter here.
  async function onOrderPaid(order) {
    const m = String(order.external_id || '').match(/^bk:(\d+)$/);
    if (order.source !== 'booking' || !m) return;
    const bk = await db().get('SELECT * FROM bookings WHERE id = ? AND account_id = ?', Number(m[1]), order.account_id);
    if (!bk || bk.status === 'confirmed') return;
    const account = await db().get('SELECT * FROM accounts WHERE id = ?', order.account_id);
    const s = settingsOf(account);
    // Paid after the hold ran out: still fine if nobody else has the time.
    const clash = await db().get(`SELECT 1 FROM bookings WHERE account_id = ? AND id <> ? AND starts_at < ? AND ends_at > ?
      AND (status = 'confirmed' OR (status = 'held' AND hold_until > now()))`, bk.account_id, bk.id, bk.ends_at, bk.starts_at);
    let row = null;
    if (!clash) {
      try {
        row = await db().get(`UPDATE bookings SET status = 'confirmed', hold_until = NULL, paid_cents = ?, contact_id = COALESCE(?, contact_id)
          WHERE id = ? AND status IN ('held', 'expired') RETURNING *`, order.amount_cents, order.contact_id ?? null, bk.id);
      } catch (e) { if (!unique(e)) throw e; }
    }
    const fresh = await db().get('SELECT * FROM orders WHERE id = ?', order.id);
    if (fresh?.mode === 'stripe' && fresh.stripe_session_id && account.stripe_secret_key) {
      const session = await stripe.retrieveCheckoutSession(account.stripe_secret_key, fresh.stripe_session_id).catch(() => null);
      const pi = typeof session?.payment_intent === 'string' ? session.payment_intent : session?.payment_intent?.id;
      if (pi) await db().run('UPDATE bookings SET stripe_payment = ? WHERE id = ?', String(pi).slice(0, 100), bk.id);
    }
    if (!row) {
      await db().run("UPDATE bookings SET status = 'clash', paid_cents = ?, hold_until = NULL WHERE id = ? AND status <> 'confirmed'", order.amount_cents, bk.id);
      const whenTxt = when(bk.starts_at, s.tz);
      await messaging.sendToOwner({ account, subject: `Paid, but the time was taken: ${bk.name}`,
        body: `${bk.name} <${bk.email}> paid ${money(order.amount_cents, order.currency)} for ${s.title} on ${whenTxt}, but that time was no longer free when the payment came through.\n\nPlease refund them in Stripe or offer another time.\n\nCalendar: ${publicBase()}/#/calendar` }).catch(() => {});
      await messaging.sendTransactional({ account, to: bk.email, contactId: bk.contact_id, subject: `About your booking: ${s.title}`,
        text: `Hi ${bk.name.split(' ')[0]},\n\nThank you for your payment. Sorry, someone else booked ${whenTxt} while you were paying. ${account.name} has been told and will refund you or find you another time.\n\n${account.from_name || account.name}` }).catch(() => {});
      return;
    }
    await logEvent(db(), account.id, { person_id: row.contact_id, type: 'booking', source: 'funnel', meta: { funnel_id: row.funnel_id, starts_at: new Date(row.starts_at).toISOString(), paid_cents: row.paid_cents, note: row.note } });
    await sendConfirmation(account, row, s).catch((e) => console.error('booking email:', e.message));
  }
  // Where Stripe's return page (or the test checkout) sends them.
  async function returnUrl(order) {
    const m = String(order.external_id || '').match(/^bk:(\d+)$/);
    const bk = m && await db().get('SELECT token FROM bookings WHERE id = ? AND account_id = ?', Number(m[1]), order.account_id);
    return bk ? `/b/${bk.token}?paid=1` : null;
  }

  // ---------- The visitor's booking page ----------
  // Extra bits for /b/<token>: returns { html, final } (final = nothing else to show).
  async function pagePart(bk, s, query = {}) {
    const now = new Date();
    if (bk.status === 'held' && new Date(bk.hold_until) <= now) bk.status = 'expired';
    if (bk.status === 'held') {
      const order = bk.order_id && await db().get('SELECT amount_cents, currency FROM orders WHERE id = ?', bk.order_id);
      const until = new Intl.DateTimeFormat('en-US', { timeZone: s.tz, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(bk.hold_until));
      return { final: true, html: `<p class="pill">Waiting for payment</p><h1>Almost booked</h1>
        <p><b>${escH(when(bk.starts_at, s.tz))}</b><br><span class="m">${escH(s.title)} with ${escH(bk.acct_name)} · ${s.length} minutes</span></p>
        <p>We’re holding this time for you until <b>${escH(until)}</b>. Pay ${order ? escH(money(order.amount_cents, order.currency)) : ''} to confirm it.</p>
        <form method="post" action="/b/${escH(bk.token)}/pay"><button>Pay ${order ? escH(money(order.amount_cents, order.currency)) : 'now'}</button></form>
        <form method="post" action="/b/${escH(bk.token)}/release" style="margin-top:12px"><button class="link">Let this time go</button></form>` };
    }
    if (bk.status === 'expired') {
      const f = bk.funnel_id && await db().get('SELECT slug FROM funnels WHERE id = ? AND account_id = ?', bk.funnel_id, bk.account_id);
      return { final: true, html: `<h1>This time was released</h1><p class="m">${escH(when(bk.starts_at, s.tz))} wasn’t paid for within ${HOLD_MIN} minutes, so we let it go. Nothing was charged.</p>
        ${f ? `<p><a class="btn" href="/f/${escH(f.slug)}">Pick a new time</a></p>` : ''}` };
    }
    if (bk.status === 'clash') {
      return { final: true, html: `<h1>Payment received, but the time was taken</h1><p class="m">Sorry, someone else booked ${escH(when(bk.starts_at, s.tz))} while you were paying. ${escH(bk.acct_name)} has been told and will refund you or find you another time.</p>` };
    }
    if (bk.status !== 'confirmed' || !bk.pay_kind || !bk.paid_cents) return { final: false, html: '' };
    const rule = cancelRule(s, bk, now);
    const balance = bk.balance_invoice_id && await db().get('SELECT status FROM invoices WHERE id = ? AND account_id = ?', bk.balance_invoice_id, bk.account_id);
    const ruleText = rule.hours && rule.free ? `Free cancellation until ${when(rule.cutoff, s.tz)}. After that, your ${rule.what} is kept.`
      : rule.hours ? `It’s within ${rule.hours} hours of the time, so if you cancel now your ${rule.what} is kept.` : rule.text;
    return { final: false, rule, top: query.paid ? '<p class="ok">Payment received. You’re booked! A confirmation is on its way to your inbox.</p>' : '',
      html: `<p class="paybox"><b>${escH(paidLine(bk, { balanceStatus: balance?.status }))}</b><br><span class="m">${escH(ruleText)}</span></p>` };
  }

  // "Pay now" from the booking page while the hold lasts.
  async function resume(bk) {
    if (bk.status !== 'held' || new Date(bk.hold_until) <= new Date()) return null;
    const [order, account] = await Promise.all([db().get('SELECT * FROM orders WHERE id = ? AND account_id = ?', bk.order_id, bk.account_id), db().get('SELECT * FROM accounts WHERE id = ?', bk.account_id)]);
    if (!order || order.status === 'paid') return null;
    return payUrl(bk, order, account);
  }
  async function release(bk) {
    const r = await db().get("UPDATE bookings SET status = 'cancelled', cancelled_at = now() WHERE id = ? AND status = 'held' RETURNING order_id", bk.id);
    if (r?.order_id) await db().run("UPDATE orders SET status = 'expired' WHERE id = ? AND status = 'pending'", r.order_id);
    return Boolean(r);
  }

  // What the owner sees about the money on a booking card.
  async function ownerView(rows, accountId) {
    const account = await db().get('SELECT stripe_secret_key FROM accounts WHERE id = ?', accountId);
    const testKey = /^(sk|rk)_test_/.test(account?.stripe_secret_key || '');
    const ids = rows.filter((r) => r.pay_kind).map((r) => r.id);
    const extra = ids.length ? await db().all(`SELECT b.id, o.mode, i.status AS balance_status, i.token AS balance_token FROM bookings b LEFT JOIN orders o ON o.id = b.order_id
      LEFT JOIN invoices i ON i.id = b.balance_invoice_id WHERE b.account_id = ? AND b.id IN (${ids.map(() => '?').join(',')})`, accountId, ...ids) : [];
    const by = Object.fromEntries(extra.map((x) => [x.id, x]));
    return rows.map((r) => {
      const x = by[r.id] || {};
      const balance = balanceOf(r);
      return { ...r, pay_line: r.status === 'held' ? 'Waiting for payment' : paidLine(r, { balanceStatus: x.balance_status }),
        refund_url: refundUrl(r, { mode: x.mode, testKey, email: r.email }), test_payment: x.mode === 'test' && r.paid_cents > 0,
        balance_cents: r.pay_kind === 'deposit' && r.paid_cents ? balance : 0, balance_label: balance ? money(balance, r.currency) : '',
        balance_status: x.balance_status || '', balance_url: x.balance_token ? `${publicBase()}/pay/${x.balance_token}` : '' };
    });
  }

  // "Send a payment link for the balance": an invoice for what's left, emailed to them.
  async function sendBalance(accountId, bookingId) {
    const bk = await db().get('SELECT * FROM bookings WHERE id = ? AND account_id = ?', bookingId, accountId);
    if (!bk) throw new HttpError(404, 'Booking not found');
    if (bk.status !== 'confirmed' || bk.pay_kind !== 'deposit' || !balanceOf(bk)) throw new HttpError(400, 'There’s no balance to pay on this booking');
    const prev = bk.balance_invoice_id && await db().get('SELECT * FROM invoices WHERE id = ? AND account_id = ?', bk.balance_invoice_id, accountId);
    if (prev?.status === 'paid') throw new HttpError(409, 'The balance is already paid');
    const s = settingsOf(await db().get('SELECT booking FROM accounts WHERE id = ?', accountId));
    const inv = await invoices.createInvoice(accountId, { kind: 'invoice', client_email: bk.email, client_name: bk.name, currency: bk.currency, send: true,
      title: `Balance for ${s.title}`, note: `${s.title} on ${when(bk.starts_at, s.tz)}. Your ${money(bk.paid_cents, bk.currency)} deposit is already paid.`,
      due_date: new Date(bk.starts_at).toISOString().slice(0, 10), items: [{ description: `${s.title}: balance after deposit`, qty: 1, price_cents: balanceOf(bk) }] });
    await db().run('UPDATE bookings SET balance_invoice_id = ? WHERE id = ?', inv.id, bk.id);
    if (prev && prev.status !== 'paid') await db().run("UPDATE invoices SET status = 'void' WHERE id = ?", prev.id);
    return inv;
  }

  return { start, onOrderPaid, returnUrl, expireHolds, pagePart, resume, release, ownerView, sendBalance };
}

module.exports = { createPaidBookings, payOf, payLabel, cancelRule, paidLine, balanceOf, refundUrl, money, HOLD_MIN };
