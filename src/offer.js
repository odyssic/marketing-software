// A limited offer, told honestly: "Founder price, 125 of 150 claimed".
// The count is real paid orders (test orders only while the shop is in test mode),
// and when the last one goes the price really changes (or the product sells out).
const CLAIMED_SQL = `(SELECT COUNT(*)::int FROM orders o WHERE o.product_id = p.id AND o.status = 'paid'
  AND (o.mode <> 'test' OR COALESCE((SELECT stripe_secret_key FROM accounts a WHERE a.id = p.account_id), '') = ''))`;

function offerState(p) {
  const limit = Number(p?.offer_limit) || 0;
  if (!p || limit <= 0) return { on: false, price_cents: p?.price_cents ?? 0, soldOut: false };
  const claimed = Math.max(0, Number(p.claimed) || 0);
  const left = Math.max(0, limit - claimed);
  const after = Number(p.offer_after_cents) || 0;
  if (left > 0) return { on: true, live: true, limit, claimed, left, label: p.offer_label || 'Launch price', price_cents: p.price_cents, after_cents: after, soldOut: false };
  // Over: the regular price from now on, or sold out when there isn't one.
  return { on: true, live: false, limit, claimed, left: 0, label: p.offer_label || 'Launch price', price_cents: after || p.price_cents, after_cents: after, soldOut: !after };
}

module.exports = { offerState, CLAIMED_SQL };
