// Segments from email behaviour: who clicks, who opens but doesn't click,
// who has gone quiet, who has never been emailed, plus per-email groups
// ("didn't open <that email>"). Computed live from the send log, so they
// always reflect the latest opens and clicks. Note: some mail apps (Apple
// Mail) open every email automatically, so clicks are the stronger signal.

// Each returns SQL selecting contact ids for one account (param 1 = account id).
const RECEIVED = "SELECT contact_id FROM email_log WHERE account_id = $1 AND contact_id IS NOT NULL AND status IN ('sent', 'logged')";
const SEGMENTS = {
  engaged: { label: 'Engaged', description: 'Opened or clicked an email in the last 30 days',
    sql: `${RECEIVED} AND (opened_at > now() - interval '30 days' OR clicked_at > now() - interval '30 days')` },
  clicked: { label: 'Clicked', description: 'Clicked a link in an email in the last 90 days',
    sql: `${RECEIVED} AND clicked_at > now() - interval '90 days'` },
  opened_no_click: { label: 'Opened, no clicks', description: 'Opened in the last 90 days but never clicked',
    sql: `${RECEIVED} AND opened_at > now() - interval '90 days' EXCEPT ${RECEIVED} AND clicked_at IS NOT NULL` },
  unengaged: { label: 'No engagement', description: 'Got emails in the last 90 days but opened and clicked none',
    sql: `${RECEIVED} AND created_at > now() - interval '90 days' AND created_at < now() - interval '2 days'
      EXCEPT ${RECEIVED} AND (opened_at IS NOT NULL OR clicked_at IS NOT NULL) AND created_at > now() - interval '90 days'` },
  never_emailed: { label: 'Never emailed', description: 'In your contacts but never sent an email',
    sql: `SELECT id FROM contacts WHERE account_id = $1 AND email <> '' EXCEPT ${RECEIVED}` },
  new_14: { label: 'New this fortnight', description: 'Added in the last 14 days',
    sql: "SELECT id FROM contacts WHERE account_id = $1 AND created_at > now() - interval '14 days'" },
};
// Per-email segments for a sent broadcast: bc_open:12, bc_noopen:12, bc_click:12.
const BC = {
  bc_noopen: { label: (s) => `Didn’t open “${s}”`, sql: 'opened_at IS NULL AND clicked_at IS NULL' },
  bc_open: { label: (s) => `Opened “${s}”`, sql: '(opened_at IS NOT NULL OR clicked_at IS NOT NULL)' },
  bc_click: { label: (s) => `Clicked “${s}”`, sql: 'clicked_at IS NOT NULL' },
};
// The offer ladder: each product and what its buyers should be offered next. The
// owner can choose; otherwise it's the next pricier product (yearly counts as 12
// months, monthly as roughly a year's worth, so a small subscription isn't "above" a big course).
const yearly = (p) => (p.billing === 'monthly' ? p.price_cents * 12 : p.price_cents);
async function ladder(db, accountId) {
  const ps = await db.all('SELECT id, name, price_cents, billing, next_product_id FROM products WHERE account_id = ? ORDER BY id', accountId);
  const byId = new Map(ps.map((p) => [p.id, p]));
  const sorted = [...ps].sort((a, b) => yearly(a) - yearly(b) || a.id - b.id);
  return ps.map((a) => {
    const b = byId.get(a.next_product_id) || sorted.find((x) => x.id !== a.id && yearly(x) > yearly(a));
    return b ? { from: a, to: b } : null;
  }).filter(Boolean);
}
// Ready for the next offer: bought A at least a week ago (within a year), haven't
// bought B, and did something lately (opened, clicked, visited, replied) in the last 45 days.
const READY_SQL = `(SELECT o.contact_id AS id FROM orders o WHERE o.account_id = ? AND o.product_id = ? AND o.status = 'paid' AND o.contact_id IS NOT NULL
    AND o.paid_at < now() - interval '7 days' AND o.paid_at > now() - interval '365 days'
  EXCEPT SELECT contact_id FROM orders WHERE account_id = ? AND product_id = ? AND status = 'paid' AND contact_id IS NOT NULL)
  INTERSECT (SELECT person_id FROM events WHERE account_id = ? AND person_id IS NOT NULL AND type <> 'purchase' AND occurred_at > now() - interval '45 days'
    UNION SELECT contact_id FROM email_log WHERE account_id = ? AND contact_id IS NOT NULL AND (opened_at > now() - interval '45 days' OR clicked_at > now() - interval '45 days'))`;

const parseKey = (key) => {
  // One person: "person:42" (email a single contact).
  const p = String(key || '').match(/^person:(\d{1,9})$/);
  if (p) return { kind: 'person', personId: Number(p[1]) };
  const n = String(key || '').match(/^next:(\d{1,9}):(\d{1,9})$/);
  if (n) return { kind: 'next', from: Number(n[1]), to: Number(n[2]) };
  const m = String(key || '').match(/^(bc_noopen|bc_open|bc_click):(\d{1,9})$/);
  return m ? { kind: m[1], broadcastId: Number(m[2]) } : SEGMENTS[key] ? { kind: key } : null;
};
const isSegment = (key) => Boolean(parseKey(key));

// Contact ids in a segment (only people who can still be emailed when `emailable`).
async function members(db, accountId, key, { emailable = false } = {}) {
  const k = parseKey(key);
  if (!k) return [];
  if (k.kind === 'next') {
    const rows = await db.all(`SELECT r.id FROM (${READY_SQL}) r JOIN contacts c ON c.id = r.id WHERE c.account_id = ?${emailable ? " AND c.unsubscribed = 0 AND c.email <> ''" : ''}`,
      accountId, k.from, accountId, k.to, accountId, accountId, accountId);
    return rows.map((r) => r.id);
  }
  if (k.personId) {
    const c = await db.get(`SELECT id FROM contacts WHERE account_id = ? AND id = ?${emailable ? " AND unsubscribed = 0 AND email <> ''" : ''}`, accountId, k.personId);
    return c ? [c.id] : [];
  }
  // The db wrapper uses ? placeholders; the definitions use $1, so swap them in.
  const sql = k.broadcastId
    ? `SELECT contact_id AS id FROM email_log WHERE account_id = ? AND broadcast_id = ? AND contact_id IS NOT NULL AND ${BC[k.kind].sql}`
    : `SELECT * FROM (${SEGMENTS[k.kind].sql.replace(/\$1/g, '?')}) s`;
  const params = k.broadcastId ? [accountId, k.broadcastId] : Array((SEGMENTS[k.kind].sql.match(/\$1/g) || []).length).fill(accountId);
  const ids = new Set((await db.all(sql, ...params)).map((r) => r.id ?? r.contact_id));
  if (!emailable || !ids.size) return [...ids];
  const ok = await db.all("SELECT id FROM contacts WHERE account_id = ? AND unsubscribed = 0 AND email <> ''", accountId);
  return ok.map((r) => r.id).filter((i) => ids.has(i));
}

// Everything the pickers show, with live counts.
async function list(db, accountId) {
  const out = [];
  for (const [key, s] of Object.entries(SEGMENTS)) out.push({ key, label: s.label, description: s.description, group: 'Email behaviour', count: (await members(db, accountId, key)).length });
  for (const step of await ladder(db, accountId)) {
    out.push({ key: `next:${step.from.id}:${step.to.id}`, label: `Ready for ${step.to.name}`, description: `Bought ${step.from.name} a while ago, active lately, haven’t bought ${step.to.name} yet`,
      group: 'Ready for your next offer', count: (await members(db, accountId, `next:${step.from.id}:${step.to.id}`)).length });
  }
  const sent = await db.all("SELECT id, subject FROM broadcasts WHERE account_id = ? AND status = 'sent' ORDER BY sent_at DESC LIMIT 5", accountId);
  for (const b of sent) {
    const subj = b.subject.replace(/\{\{[^}]*\}\}/g, '…').slice(0, 40);
    for (const kind of ['bc_noopen', 'bc_click']) {
      const key = `${kind}:${b.id}`;
      out.push({ key, label: BC[kind].label(subj), description: kind === 'bc_noopen' ? 'Good for a resend with a new subject line' : 'Your most interested readers for this topic', group: 'Recent emails', count: (await members(db, accountId, key)).length });
    }
  }
  return out;
}

module.exports = { SEGMENTS, members, list, isSegment, ladder };
