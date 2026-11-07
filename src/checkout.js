// Checkout extras: coupons, payment plans ("pay in 3 parts"), free trials and
// the abandoned-checkout reminders (an hour later, then a day later with an
// optional code). The buy route in app.js asks priceOrder() what to charge.
const { formatMoney } = require('./render');

const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{1,29}$/;
const cleanCode = (c) => String(c || '').trim().toUpperCase().replace(/\s+/g, '');
const PER = { monthly: 'month', yearly: 'year' };

// Amount of one part of a payment plan: what the owner set, or the price split evenly (rounded up).
const partCents = (p) => (p.plan_parts >= 2 ? p.plan_part_cents || Math.ceil(p.price_cents / p.plan_parts) : 0);
const planOn = (p) => p.billing === 'one_time' && p.plan_parts >= 2;
const trialOn = (p) => p.billing !== 'one_time' && p.trial_days > 0;

const couponLabel = (c, currency = 'usd') => (c.percent_off ? `${c.percent_off}% off` : `${formatMoney(c.amount_off_cents, currency)} off`);

// Cancel a payment plan after its last part: N-1 months after the first
// payment, plus a week's margin for a late retry (always well before part N+1).
function planEndsAt(parts, from = new Date()) {
  const d = new Date(from);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + parts - 1);
  d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
  return new Date(d.getTime() + 7 * 864e5);
}

function registerCheckout(app, api, { getDb, HttpError, id, messaging, publicBase, stripe, findPublicStep, findBlock }) {
  const db = () => getDb();

  // ---- Coupons ----
  const couponInput = (b) => {
    const code = cleanCode(b.code);
    if (!CODE_RE.test(code)) throw new HttpError(400, 'Use 2 to 30 letters or numbers for the code, like SPRING20');
    const value = Number(b.value);
    let percent = null, amount = null;
    if (b.kind === 'amount') {
      amount = Math.round(value * 100);
      if (!Number.isFinite(amount) || amount < 1) throw new HttpError(400, 'Enter how much money comes off');
    } else {
      percent = Math.round(value);
      if (!Number.isFinite(percent) || percent < 1 || percent > 100) throw new HttpError(400, 'The percent off must be between 1 and 100');
    }
    const exp = String(b.expires || '').trim();
    if (exp && !/^\d{4}-\d{2}-\d{2}$/.test(exp)) throw new HttpError(400, 'Pick a date for when the code stops working');
    const max = b.max_uses === '' || b.max_uses == null ? null : Math.round(Number(b.max_uses));
    if (max !== null && (!Number.isFinite(max) || max < 1)) throw new HttpError(400, 'Times it can be used must be 1 or more, or empty for no limit');
    const products = [...new Set((Array.isArray(b.product_ids) ? b.product_ids : String(b.product_ids || '').split(','))
      .map(Number).filter((n) => Number.isInteger(n) && n > 0))].join(',');
    return [code, percent, amount, exp ? `${exp}T23:59:59Z` : null, max, products];
  };
  const couponOut = (c) => ({ ...c, label: couponLabel(c),
    expires: c.expires_at ? new Date(c.expires_at).toISOString().slice(0, 10) : '',
    product_ids: c.product_ids ? c.product_ids.split(',').map(Number) : [],
    status: c.expires_at && new Date(c.expires_at) < new Date() ? 'expired' : c.max_uses && c.uses >= c.max_uses ? 'used up' : 'active' });
  const saveCoupon = async (fn) => {
    try { return await fn(); } catch (e) {
      if (e?.code === '23505') throw new HttpError(400, 'You already have a code with that name');
      throw e;
    }
  };

  api.get('/coupons', async (req, res) => {
    res.json((await db().all('SELECT * FROM coupons WHERE account_id = ? ORDER BY id DESC', req.accountId)).map(couponOut));
  });
  api.post('/coupons', async (req, res) => {
    const r = await saveCoupon(() => db().get(`INSERT INTO coupons (account_id, code, percent_off, amount_off_cents, expires_at, max_uses, product_ids)
      VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`, req.accountId, ...couponInput(req.body || {})));
    res.status(201).json({ id: r.id });
  });
  api.put('/coupons/:id', async (req, res) => {
    const r = await saveCoupon(() => db().run(`UPDATE coupons SET code = ?, percent_off = ?, amount_off_cents = ?, expires_at = ?, max_uses = ?, product_ids = ?
      WHERE id = ? AND account_id = ?`, ...couponInput(req.body || {}), id(req.params.id), req.accountId));
    if (!r.changes) throw new HttpError(404, 'Code not found');
    res.json({ ok: true });
  });
  api.delete('/coupons/:id', async (req, res) => {
    await db().run('DELETE FROM coupons WHERE id = ? AND account_id = ?', id(req.params.id), req.accountId);
    res.json({ ok: true });
  });
  // The code (if any) the second checkout reminder offers.
  api.put('/account/recovery-coupon', async (req, res) => {
    const cid = req.body?.coupon_id ? id(req.body.coupon_id) : null;
    if (cid && !await db().get('SELECT 1 FROM coupons WHERE id = ? AND account_id = ?', cid, req.accountId)) throw new HttpError(404, 'Code not found');
    await db().run('UPDATE accounts SET recover_coupon_id = ? WHERE id = ?', cid, req.accountId);
    res.json({ ok: true });
  });

  // Finds a usable code for this product, or says plainly why not.
  async function checkCoupon(accountId, code, product, now = new Date()) {
    const c = cleanCode(code);
    const row = c && await db().get('SELECT * FROM coupons WHERE account_id = ? AND code = ?', accountId, c);
    if (!row) return { error: 'That code isn’t valid.' };
    if (row.expires_at && new Date(row.expires_at) < now) return { error: 'That code has expired.' };
    if (row.max_uses && row.uses >= row.max_uses) return { error: 'That code has been used up.' };
    if (row.product_ids && !row.product_ids.split(',').map(Number).includes(product.id)) return { error: 'That code doesn’t work for this product.' };
    return { coupon: row };
  }

  // What one payment costs after the code; never below Stripe's 50-cent
  // minimum unless it's free.
  function discounted(cents, coupon) {
    if (!coupon) return { unit: cents, off: 0 };
    let off = coupon.percent_off ? Math.round(cents * coupon.percent_off / 100) : Math.min(coupon.amount_off_cents, cents);
    if (cents - off > 0 && cents - off < 50) off = Math.max(0, cents - 50);
    return { unit: cents - off, off };
  }

  // Everything the buy route needs to charge for the main product.
  // Throws HttpError(400) with a plain reason for a bad code.
  async function priceOrder(product, { coupon: code = '', plan = false } = {}) {
    let coupon = null;
    if (cleanCode(code)) {
      const got = await checkCoupon(product.account_id, code, product);
      if (got.error) throw new HttpError(400, got.error);
      coupon = got.coupon;
    }
    const parts = plan && planOn(product) ? product.plan_parts : 0;
    const { unit, off } = discounted(parts ? partCents(product) : product.price_cents, coupon);
    const trialDays = trialOn(product) ? product.trial_days : 0;
    return { unit, off, parts, trialDays, coupon,
      // Charged today: nothing during a free trial, the first part of a plan.
      today: trialDays ? 0 : unit,
      item: { name: product.name, qty: 1, price_cents: unit, ...(off ? { discount_cents: off, coupon: coupon.code } : {}),
        ...(parts ? { plan_parts: parts } : {}), ...(trialDays ? { trial_days: trialDays } : {}) } };
  }

  // Shown on the buyer's checkout, and in the order list.
  function orderTerms(order, product) {
    const out = [];
    if (order.plan_parts) out.push(`Payment 1 of ${order.plan_parts}. Then ${order.plan_parts - 1} more monthly payment${order.plan_parts > 2 ? 's' : ''}.`);
    if (order.trial_days && product) out.push(`${order.trial_days} days free, then ${formatMoney(product.price_cents - (order.discount_cents || 0), product.currency)}/${PER[product.billing] || 'month'}.`);
    if (order.coupon_code) out.push(`Code ${order.coupon_code}: ${formatMoney(order.discount_cents, order.currency)} off${order.plan_parts || order.trial_days ? ' each payment' : ''}.`);
    return out;
  }

  // After Stripe confirms a checkout: a payment plan's subscription is set to
  // end after its last part. Safe to call twice (success page and webhook).
  async function afterSession(order, session) {
    if (!order.plan_parts || !session?.subscription) return;
    const sub = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
    const claimed = await db().get('UPDATE orders SET stripe_subscription = ? WHERE id = ? AND stripe_subscription IS NULL RETURNING id', sub, order.id);
    if (!claimed) return;
    const account = await db().get('SELECT stripe_secret_key FROM accounts WHERE id = ?', order.account_id);
    try {
      await stripe.call(account.stripe_secret_key, 'POST', `/subscriptions/${encodeURIComponent(sub)}`, {
        cancel_at: Math.floor(planEndsAt(order.plan_parts).getTime() / 1000), proration_behavior: 'none',
      });
    } catch (e) {
      console.error('payment plan end:', e.message);
      await db().run('UPDATE orders SET stripe_subscription = NULL WHERE id = ?', order.id); // the webhook tries again
    }
  }

  async function onOrderPaid(order) {
    if (order.coupon_code) await db().run('UPDATE coupons SET uses = uses + 1 WHERE account_id = ? AND code = ?', order.account_id, order.coupon_code);
  }

  const hasCoupons = async (accountId) => Boolean(await db().get('SELECT 1 FROM coupons WHERE account_id = ? LIMIT 1', accountId));

  // The "Have a code?" box on a pricing card checks the code as you type it.
  app.get('/f/:funnel/:step/coupon', async (req, res) => {
    const found = await findPublicStep(req.params.funnel, req.params.step);
    const block = found && findBlock(found.step, 'pricing', String(req.query.block || ''));
    const product = block?.productId && await db().get('SELECT * FROM products WHERE id = ? AND account_id = ?', id(block.productId), found.funnel.account_id);
    if (!product) return res.status(404).json({ ok: false, message: 'This offer is no longer available.' });
    try {
      const p = await priceOrder(product, { coupon: String(req.query.code || '').slice(0, 40), plan: req.query.plan === '1' });
      const price = formatMoney(p.unit, product.currency);
      const per = p.parts ? ` per payment (${p.parts} payments)` : PER[product.billing] ? `/${PER[product.billing]}` : '';
      res.json({ ok: true, message: `${p.coupon.code} applied: ${couponLabel(p.coupon, product.currency)}. You pay ${price}${per}.` });
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      res.json({ ok: false, message: e.message });
    }
  });

  // ---- Abandoned checkouts: a short, polite sequence ----
  // 1 hour later: a reminder. 24 hours later: one more, with the owner's code
  // if they chose one. Stops as soon as they buy; never to people who
  // unsubscribed (sendToPerson checks); one sequence per person and product.
  async function recoverCheckouts(now = new Date()) {
    const ago = (h) => new Date(now.getTime() - h * 3600e3).toISOString();
    const due = await db().all(`SELECT o.*, f.slug AS funnel_slug, s.slug AS step_slug FROM orders o
        JOIN accounts a ON a.id = o.account_id AND a.recover_checkouts = 1
        LEFT JOIN funnels f ON f.id = o.funnel_id LEFT JOIN funnel_steps s ON s.id = o.step_id
      WHERE o.status = 'pending' AND o.email <> '' AND o.contact_id IS NOT NULL
        AND ((o.recovery_step = 0 AND o.recovery_sent_at IS NULL AND o.created_at <= ? AND o.created_at > ?)
          OR (o.recovery_step = 1 AND o.created_at <= ? AND o.created_at > ? AND o.recovery_sent_at <= ?))
      ORDER BY o.id`, ago(1), ago(48), ago(24), ago(72), ago(12));
    let sent = 0;
    for (const o of due) {
      const step = o.recovery_step + 1;
      const claimed = await db().get('UPDATE orders SET recovery_step = ?, recovery_sent_at = ? WHERE id = ? AND recovery_step = ? RETURNING id', step, now.toISOString(), o.id, o.recovery_step);
      if (!claimed || !o.funnel_slug) continue;
      const bought = await db().get("SELECT 1 FROM orders WHERE account_id = ? AND email = ? AND product_id IS NOT DISTINCT FROM ? AND status = 'paid' AND created_at >= ?", o.account_id, o.email, o.product_id, o.created_at);
      if (bought) continue;
      // They tried again later: the newer checkout gets the reminders instead.
      const newer = await db().get("SELECT 1 FROM orders WHERE account_id = ? AND email = ? AND product_id IS NOT DISTINCT FROM ? AND status = 'pending' AND id > ?", o.account_id, o.email, o.product_id, o.id);
      if (newer) continue;
      const [account, person, product] = await Promise.all([db().get('SELECT * FROM accounts WHERE id = ?', o.account_id),
        db().get('SELECT * FROM contacts WHERE id = ?', o.contact_id), o.product_id && db().get('SELECT * FROM products WHERE id = ?', o.product_id)]);
      if (!person) continue;
      const sign = account.from_name || account.name;
      let link = `${publicBase()}/f/${o.funnel_slug}${o.step_slug ? `/${o.step_slug}` : ''}`;
      let mail;
      if (step === 1) {
        mail = { subject: `Your ${o.product_name} is still waiting`, preheader: 'Pick up where you left off, or reply with any questions.',
          body: `Hi {{first_name|there}},\n\nYou started checking out ${o.product_name} but didn’t quite finish. If something got in the way or you have a question, just reply to this email.\n\nPick up where you left off: ${link}\n\n${sign}` };
      } else {
        const c = account.recover_coupon_id && product && await db().get('SELECT * FROM coupons WHERE id = ? AND account_id = ?', account.recover_coupon_id, account.id);
        const ok = c && !(await checkCoupon(account.id, c.code, product, now)).error;
        if (ok) link += `?coupon=${encodeURIComponent(c.code)}`;
        const offer = ok ? `\n\nHere’s a little thank-you for coming back: use the code ${c.code} for ${couponLabel(c, product.currency)}. It’s already filled in at the link below.` : '';
        mail = { subject: ok ? `${couponLabel(c, product.currency)} your ${o.product_name}` : `Still thinking about ${o.product_name}?`,
          preheader: ok ? `Use code ${c.code} when you check out.` : 'Your order is saved. Finish whenever you’re ready.',
          body: `Hi {{first_name|there}},\n\nJust a last note about ${o.product_name}. Your order is saved if you’d still like it.${offer}\n\nFinish your order: ${link}\n\nIf it’s not for you, no problem. You won’t hear about it again.\n\n${sign}` };
      }
      const r = await messaging.sendToPerson({ account, person, ...mail });
      if (r.status === 'sent' || r.status === 'logged') sent++;
    }
    return { recovered: sent };
  }

  return { priceOrder, checkCoupon, orderTerms, afterSession, onOrderPaid, hasCoupons, recoverCheckouts };
}

module.exports = { registerCheckout, planEndsAt, partCents, planOn, trialOn };
