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
  if (!res.ok) throw new Error(data.error?.message || `Stripe error ${res.status}`);
  return data;
}

function createCheckoutSession(secretKey, { product, orderId, email, successUrl, cancelUrl }) {
  const recurring = product.billing === 'monthly' ? { interval: 'month' }
    : product.billing === 'yearly' ? { interval: 'year' } : undefined;
  return call(secretKey, 'POST', '/checkout/sessions', {
    mode: recurring ? 'subscription' : 'payment',
    line_items: { 0: {
      quantity: 1,
      price_data: {
        currency: product.currency,
        unit_amount: product.price_cents,
        product_data: { name: product.name, description: product.description || undefined },
        recurring,
      },
    } },
    client_reference_id: orderId,
    customer_email: email || undefined,
    metadata: { order_id: orderId },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
}

const retrieveCheckoutSession = (secretKey, id) => call(secretKey, 'GET', `/checkout/sessions/${encodeURIComponent(id)}`);

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

module.exports = { createCheckoutSession, retrieveCheckoutSession, verifyWebhook, isPaid };
