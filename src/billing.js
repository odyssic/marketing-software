// Rilly's own plans: a free trial, then a monthly subscription paid through
// Rilly's Stripe account (not the customer's). Billing is per person, covering
// every workspace they own.
//
// Off until RILLY_STRIPE_KEY is set: then everyone uses Rilly free, with no
// trial clock. Settings:
//   RILLY_STRIPE_KEY            Rilly's own Stripe secret key
//   RILLY_STRIPE_WEBHOOK_SECRET signing secret of the /stripe/rilly webhook (optional; the
//                               return from checkout also confirms)
//   RILLY_PRICE_CENTS           monthly price in cents (default 2900 = $29), includes one business
//   RILLY_EXTRA_CENTS           monthly price of each extra business (default 1900 = $19)
//   RILLY_TRIAL_DAYS            free trial length (default 14)
const stripe = require('./stripe');

const cfg = () => ({
  key: process.env.RILLY_STRIPE_KEY || '',
  priceCents: Math.max(50, Number(process.env.RILLY_PRICE_CENTS) || 2900),
  extraCents: Math.max(0, Number(process.env.RILLY_EXTRA_CENTS ?? 1900) || 0),
  trialDays: Math.max(0, Number(process.env.RILLY_TRIAL_DAYS ?? 14) || 0),
  currency: (process.env.RILLY_CURRENCY || 'usd').toLowerCase(),
});
const enabled = () => Boolean(cfg().key);

// Plan state for a user row (plan_status, trial_ends_at, created_at).
function planOf(u, now = new Date()) {
  const c = cfg();
  const status = u.plan_status || 'trialing';
  const trialEnd = new Date(u.trial_ends_at || new Date(new Date(u.created_at || now).getTime() + c.trialDays * 864e5));
  const daysLeft = Math.max(0, Math.ceil((trialEnd - now) / 864e5));
  const inTrial = status === 'trialing' && trialEnd > now;
  const locked = enabled() && !['active', 'comped', 'past_due'].includes(status) && !inTrial;
  return { enabled: enabled(), status, trialEndsAt: trialEnd.toISOString(), daysLeft: status === 'trialing' ? daysLeft : null,
    locked, priceCents: c.priceCents, extraCents: c.extraCents, currency: c.currency, trialDays: c.trialDays };
}

const EXTRA_PRODUCT = 'rilly_extra_business';
const MONTHLY = { interval: 'month' };

function registerBilling(app, api, { getDb, HttpError, publicBase, express }) {
  const db = () => getDb();
  // Businesses this person owns: the first is included, each one after it is an extra.
  const businesses = async (userId) => (await db().get("SELECT COUNT(*)::int AS n FROM memberships WHERE user_id = ? AND role = 'owner'", userId)).n;
  const extrasFor = async (userId) => Math.max(0, (await businesses(userId)) - 1);
  // One Stripe product for extra businesses, made the first time it's needed.
  const extraProduct = async (key) => {
    try { await stripe.call(key, 'GET', `/products/${EXTRA_PRODUCT}`); } catch (e) {
      if (e.status !== 404) throw e;
      await stripe.call(key, 'POST', '/products', { id: EXTRA_PRODUCT, name: 'Extra business', description: 'Each business after the first' }).catch((x) => { if (!/exists/i.test(x.message)) throw x; });
    }
    return EXTRA_PRODUCT;
  };
  // Keep the subscription's extra-business line equal to the businesses they run.
  async function syncExtras(userId) {
    const c = cfg();
    if (!enabled() || !c.extraCents) return;
    const u = await userRow(userId);
    if (!u?.billing_subscription || !['active', 'past_due'].includes(u.plan_status)) return;
    const want = await extrasFor(userId);
    const sub = await stripe.call(c.key, 'GET', `/subscriptions/${encodeURIComponent(u.billing_subscription)}`);
    const item = (sub.items?.data || []).find((i) => i.price?.product === EXTRA_PRODUCT);
    if (item && item.quantity === want) return;
    if (item && want === 0) await stripe.call(c.key, 'DELETE', `/subscription_items/${item.id}`);
    else if (item) await stripe.call(c.key, 'POST', `/subscription_items/${item.id}`, { quantity: want });
    else if (want > 0) {
      await stripe.call(c.key, 'POST', '/subscription_items', { subscription: u.billing_subscription, quantity: want,
        price_data: { currency: c.currency, unit_amount: c.extraCents, recurring: MONTHLY, product: await extraProduct(c.key) } });
    }
  }
  const syncLater = (userId) => syncExtras(userId).catch((e) => console.error('billing extras:', e.message));
  const userRow = (id) => db().get('SELECT id, email, name, plan_status, trial_ends_at, created_at, billing_customer, billing_subscription FROM users WHERE id = ?', id);
  const fromStripe = (s) => (s === 'active' || s === 'trialing' ? 'active' : s === 'past_due' ? 'past_due' : 'canceled');

  // While billing is on and the trial is over, only billing, sign-out and reading work.
  api.use((req, res, next) => {
    if (!req.user || req.method === 'GET' || !planOf(req.user).locked) return next();
    if (/^\/(billing|auth)\b/.test(req.path)) return next();
    res.status(402).json({ error: 'Your free trial has ended. Choose a plan in Settings to keep going.' });
  });

  api.get('/billing', async (req, res) => {
    const u = await userRow(req.user.id);
    res.json({ ...planOf(u), hasCustomer: Boolean(u.billing_customer), businesses: await businesses(u.id) });
  });

  // Subscribe: Stripe Checkout. Trial days left carry over, so paying early costs nothing extra.
  api.post('/billing/checkout', async (req, res) => {
    if (!enabled()) throw new HttpError(400, 'Billing isn’t set up yet');
    const c = cfg(), u = await userRow(req.user.id), plan = planOf(u);
    const trialEnd = Math.floor(new Date(plan.trialEndsAt).getTime() / 1000);
    const base = publicBase(req);
    const extras = c.extraCents ? await extrasFor(u.id) : 0;
    const s = await stripe.call(c.key, 'POST', '/checkout/sessions', {
      mode: 'subscription',
      line_items: { 0: { quantity: 1, price_data: { currency: c.currency, unit_amount: c.priceCents, recurring: MONTHLY,
        product_data: { name: 'Rilly', description: 'Simple Marketing: pages, emails, follow-ups and customers, for one business' } } },
      ...(extras ? { 1: { quantity: extras, price_data: { currency: c.currency, unit_amount: c.extraCents, recurring: MONTHLY, product: await extraProduct(c.key) } } } : {}) },
      ...(u.billing_customer ? { customer: u.billing_customer } : { customer_email: u.email }),
      client_reference_id: String(u.id),
      subscription_data: { metadata: { rilly_user: String(u.id) }, ...(u.plan_status === 'trialing' && trialEnd > Date.now() / 1000 + 172800 ? { trial_end: trialEnd } : {}) },
      allow_promotion_codes: 'true',
      success_url: `${base}/#/settings?billing={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/#/settings?billing=cancel`,
    });
    res.json({ url: s.url });
  });

  // Back from Checkout: confirm the subscription without waiting for the webhook.
  api.post('/billing/confirm', async (req, res) => {
    if (!enabled()) throw new HttpError(400, 'Billing isn’t set up yet');
    const s = await stripe.call(cfg().key, 'GET', `/checkout/sessions/${encodeURIComponent(String(req.body?.session_id || ''))}`).catch(() => null);
    if (!s || String(s.client_reference_id) !== String(req.user.id)) throw new HttpError(400, 'That checkout wasn’t found');
    if (s.status !== 'complete') return res.json({ ok: false });
    await db().run("UPDATE users SET plan_status = 'active', billing_customer = ?, billing_subscription = ? WHERE id = ?", s.customer || '', s.subscription || '', req.user.id);
    syncLater(req.user.id); // in case businesses were added while they were paying
    res.json({ ok: true });
  });

  // Change card, see invoices or cancel: Stripe's own billing page.
  api.post('/billing/portal', async (req, res) => {
    const u = await userRow(req.user.id);
    if (!enabled() || !u.billing_customer) throw new HttpError(400, 'No subscription yet');
    const s = await stripe.call(cfg().key, 'POST', '/billing_portal/sessions', { customer: u.billing_customer, return_url: `${publicBase(req)}/#/settings` });
    res.json({ url: s.url });
  });

  // Subscription changes from Stripe (payment failed, cancelled, renewed).
  app.post('/stripe/rilly', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
    const secret = process.env.RILLY_STRIPE_WEBHOOK_SECRET;
    if (!secret) return res.status(404).json({ error: 'Not configured' });
    let event;
    try { event = stripe.verifyWebhook(req.body.toString('utf8'), req.get('stripe-signature'), secret); } catch { return res.status(400).json({ error: 'Bad signature' }); }
    const o = event.data?.object || {};
    if (event.type === 'checkout.session.completed' && o.mode === 'subscription' && o.client_reference_id) {
      await db().run("UPDATE users SET plan_status = 'active', billing_customer = ?, billing_subscription = ? WHERE id = ?", o.customer || '', o.subscription || '', Number(o.client_reference_id) || 0);
    } else if (event.type.startsWith('customer.subscription.')) {
      const status = event.type === 'customer.subscription.deleted' ? 'canceled' : fromStripe(o.status);
      await db().run("UPDATE users SET plan_status = ? WHERE billing_subscription = ? AND plan_status <> 'comped'", status, o.id);
    } else if (event.type === 'invoice.payment_failed' && o.subscription) {
      await db().run("UPDATE users SET plan_status = 'past_due' WHERE billing_subscription = ? AND plan_status <> 'comped'", o.subscription);
    }
    res.json({ received: true });
  });

  return { syncExtras: syncLater };
}

module.exports = { registerBilling, planOf, enabled };
