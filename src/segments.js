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
const parseKey = (key) => {
  const m = String(key || '').match(/^(bc_noopen|bc_open|bc_click):(\d{1,9})$/);
  return m ? { kind: m[1], broadcastId: Number(m[2]) } : SEGMENTS[key] ? { kind: key } : null;
};
const isSegment = (key) => Boolean(parseKey(key));

// Contact ids in a segment (only people who can still be emailed when `emailable`).
async function members(db, accountId, key, { emailable = false } = {}) {
  const k = parseKey(key);
  if (!k) return [];
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

module.exports = { SEGMENTS, members, list, isSegment };
