// Minimal Stripe client over plain HTTPS: just the Checkout calls we need.
// STRIPE_API_BASE can point at a fake server for tests.
const crypto = require('node:crypto');

// Stripe expects nested form fields: {a: {b: 1}} → "a[b]=1".
function encode(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') encode(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

async function call(secretKey, method, path, params) {
  const base = process.env.STRIPE_API_BASE || 'https://api.stripe.com';
  const res = await fetch(`${base}/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params ? encode(params) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error?.message || `Stripe error ${res.status}`), { status: res.status });
  return data;
}

// unitAmount: the price after any code. planParts: a payment plan, charged
// monthly as a subscription that we end after the last part (see checkout.js).
// trialDays: free days before a monthly/yearly subscription's first charge.
function createCheckoutSession(secretKey, { product, extra = null, orderId, email, successUrl, cancelUrl, unitAmount = product.price_cents, planParts = 0, trialDays = 0, couponCode = '', expiresAt }) {
  const recurring = planParts ? { interval: 'month' } : product.billing === 'monthly' ? { interval: 'month' }
    : product.billing === 'yearly' ? { interval: 'year' } : undefined;
  const subMeta = { order_id: orderId, ...(planParts ? { plan_parts: planParts } : {}), ...(couponCode ? { coupon: couponCode } : {}) };
  return call(secretKey, 'POST', '/checkout/sessions', {
    mode: recurring ? 'subscription' : 'payment',
    line_items: { 0: {
      quantity: 1,
      price_data: {
        currency: product.currency,
        unit_amount: unitAmount,
        product_data: { name: planParts ? `${product.name} (${planParts} monthly payments)` : product.name,
          description: [product.description, couponCode ? `Code ${couponCode} applied` : ''].filter(Boolean).join(' · ') || undefined },
        recurring,
      },
    },
    // Order bump: a second one-time item in the same payment.
    ...(extra ? { 1: { quantity: 1, price_data: { currency: extra.currency, unit_amount: extra.price_cents, product_data: { name: extra.name } } } } : {}) },
    // One-time payments save the card so a later upsell can be one click.
    ...(recurring ? { subscription_data: { metadata: subMeta, ...(trialDays ? { trial_period_days: trialDays } : {}) } }
      : { payment_intent_data: { setup_future_usage: 'off_session' }, customer_creation: 'always' }),
    client_reference_id: orderId,
    customer_email: email || undefined,
    metadata: { order_id: orderId },
    success_url: successUrl,
    cancel_url: cancelUrl,
    expires_at: expiresAt, // optional (unix seconds, 30 minutes to 24 hours ahead)
  });
}

const retrieveCheckoutSession = (secretKey, id) => call(secretKey, 'GET', `/checkout/sessions/${encodeURIComponent(id)}?expand[]=payment_intent`);

// One-click upsell: charge the card saved at the first checkout, without the buyer present.
const chargeSaved = (secretKey, { amount, currency, customer, paymentMethod, description, orderId }) => call(secretKey, 'POST', '/payment_intents', {
  amount, currency, customer, payment_method: paymentMethod, off_session: 'true', confirm: 'true', description, metadata: { order_id: orderId },
});

// Verifies a Stripe-Signature header (scheme v1) and returns the parsed event.
function verifyWebhook(rawBody, header, secret, toleranceSec = 300) {
  const parts = Object.groupBy(String(header || '').split(','), (p) => p.split('=')[0]);
  const t = parts.t?.[0]?.slice(2);
  const sigs = (parts.v1 || []).map((p) => p.slice(3));
  if (!t || !sigs.length) throw new Error('Missing signature');
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) throw new Error('Signature too old');
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const ok = sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
  if (!ok) throw new Error('Bad signature');
  return JSON.parse(rawBody);
}

// A checkout counts as paid once Stripe says so (trials/100% coupons report
// no_payment_required).
const isPaid = (session) => ['paid', 'no_payment_required'].includes(session.payment_status);

// Connect with just the secret key: check it works, then create the webhook in their
// Stripe account (replacing one we made before) so nobody has to copy a signing secret.
const WEBHOOK_EVENTS = ['checkout.session.completed', 'checkout.session.async_payment_succeeded'];
async function connect(secretKey, webhookUrl) {
  let account = null;
  try { account = await call(secretKey, 'GET', '/account'); } catch (e) {
    if (e.status === 401) throw Object.assign(new Error('Stripe didn’t accept that key. Copy the Secret key again (click Reveal, then copy).'), { bad: true });
  }
  const name = account?.settings?.dashboard?.display_name || account?.business_profile?.name || account?.email || '';
  if (!/^https:\/\//.test(webhookUrl)) return { name, webhookSecret: null, why: 'local address' };
  try {
    const list = await call(secretKey, 'GET', '/webhook_endpoints?limit=100');
    for (const w of list.data || []) if (w.url === webhookUrl) await call(secretKey, 'DELETE', `/webhook_endpoints/${w.id}`).catch(() => {});
    const w = await call(secretKey, 'POST', '/webhook_endpoints', { url: webhookUrl, enabled_events: WEBHOOK_EVENTS, description: 'Rilly: marks orders paid' });
    return { name, webhookSecret: w.secret || null };
  } catch (e) { return { name, webhookSecret: null, why: e.message }; }
}

module.exports = { call, connect, createCheckoutSession, retrieveCheckoutSession, chargeSaved, verifyWebhook, isPaid };
