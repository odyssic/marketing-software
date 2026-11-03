// "Your week in plain English": a few sentences comparing the last 7 days with
// the 7 before, about the things an owner actually cares about. Results, not
// data: each line says what happened and whether it's better or worse. Lines
// with nothing to say are left out rather than reporting zeros.
const DAY = 864e5;
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
const money = (cents) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// "up from 8%", "down from 9", "the same as last week", or '' when last week had nothing.
function versus(now, before, fmt = String) {
  if (before === null || before === undefined) return '';
  if (now === before) return 'the same as last week';
  if (!before) return 'up from none last week';
  return `${now > before ? 'up' : 'down'} from ${fmt(before)}`;
}

const PAGE_WORD = { bookings: ['booking', 'into bookings'], sales: ['sale', 'into buyers'], leads: ['sign-up', 'into leads'], newsletter: ['sign-up', 'into subscribers'] };

async function weekResults(db, accountId, now = new Date()) {
  const t0 = new Date(now.getTime() - 7 * DAY).toISOString(), tm = new Date(now.getTime() - 14 * DAY).toISOString(), t1 = now.toISOString();
  const lines = [];

  // Each live page with enough visits: how well it turned visitors into results.
  const pages = await db.all(`SELECT f.id, f.name, f.purpose,
      COUNT(*) FILTER (WHERE e.type = 'view' AND e.step_id = f.entry_step_id AND e.created_at >= ?) AS v1, COUNT(*) FILTER (WHERE e.type = 'view' AND e.step_id = f.entry_step_id AND e.created_at < ?) AS v0,
      COUNT(*) FILTER (WHERE e.type IN ('optin', 'sale') AND e.created_at >= ?) AS c1, COUNT(*) FILTER (WHERE e.type IN ('optin', 'sale') AND e.created_at < ?) AS c0
    FROM funnels f JOIN page_events e ON e.funnel_id = f.id AND e.created_at >= ? AND e.created_at < ?
    WHERE f.account_id = ? GROUP BY f.id, f.name, f.purpose ORDER BY COUNT(*) DESC LIMIT 3`, t0, t0, t0, t0, tm, t1, accountId);
  for (const p of pages) {
    const v1 = Number(p.v1), v0 = Number(p.v0), c1 = Number(p.c1), c0 = Number(p.c0);
    if (!v1) continue;
    const [word, into] = PAGE_WORD[p.purpose] || ['sign-up', 'into sign-ups'];
    if (v1 >= 20) {
      const r1 = pct(c1, v1), r0 = v0 >= 20 ? pct(c0, v0) : null;
      const vs = versus(r1, r0, (x) => `${x}%`);
      lines.push(`Your “${p.name}” page turned ${r1}% of visitors ${into} this week${vs ? `, ${vs}` : ''} (${plural(v1, 'visit')}, ${plural(c1, word)}).`);
    } else {
      lines.push(`Your “${p.name}” page had ${plural(v1, 'visit')} and ${plural(c1, word)} this week.`);
    }
  }

  // New people, and where most of them came from.
  const ppl = await db.get(`SELECT COUNT(*) FILTER (WHERE created_at >= ?) AS n1, COUNT(*) FILTER (WHERE created_at < ?) AS n0
    FROM contacts WHERE account_id = ? AND created_at >= ? AND created_at < ?`, t0, t0, accountId, tm, t1);
  const n1 = Number(ppl.n1), n0 = Number(ppl.n0);
  if (n1 || n0) {
    const top = n1 >= 3 && await db.get(`SELECT source, COUNT(*) AS n FROM page_events WHERE account_id = ? AND type = 'optin' AND created_at >= ? AND source <> ''
      GROUP BY source ORDER BY COUNT(*) DESC LIMIT 1`, accountId, t0);
    const vs = versus(n1, n0);
    lines.push(n1 ? `${plural(n1, 'new person', 'new people')} joined${vs ? `, ${vs}` : ''}.${top && top.source !== 'Direct' && Number(top.n) >= 2 ? ` Most came from ${top.source}.` : ''}`
      : `No new people joined this week (${plural(n0, 'person', 'people')} the week before). A post or an email to past customers usually helps.`);
  }

  // Money in.
  const sales = await db.get(`SELECT COALESCE(SUM(amount_cents) FILTER (WHERE paid_at >= ?), 0) AS s1, COUNT(*) FILTER (WHERE paid_at >= ?) AS k1,
      COALESCE(SUM(amount_cents) FILTER (WHERE paid_at < ?), 0) AS s0
    FROM orders WHERE account_id = ? AND status = 'paid' AND mode <> 'test' AND paid_at >= ? AND paid_at < ?`, t0, t0, t0, accountId, tm, t1);
  const s1 = Number(sales.s1), s0 = Number(sales.s0);
  if (s1 || s0) {
    const vs = versus(s1, s0, money);
    lines.push(s1 ? `You took ${money(s1)} from ${plural(Number(sales.k1), 'payment')}${vs ? `, ${vs}` : ''}.` : `No payments came in this week (${money(s0)} the week before).`);
  }

  // Bookings made this week.
  const bk = await db.get(`SELECT COUNT(*) FILTER (WHERE created_at >= ?) AS b1, COUNT(*) FILTER (WHERE created_at < ?) AS b0,
      COUNT(*) FILTER (WHERE status = 'confirmed' AND starts_at >= ? AND starts_at < ?) AS ahead
    FROM bookings WHERE account_id = ? AND (created_at >= ? OR (status = 'confirmed' AND starts_at >= ?))`, t0, t0, t1, new Date(now.getTime() + 7 * DAY).toISOString(), accountId, tm, t1).catch(() => null);
  if (bk && (Number(bk.b1) || Number(bk.ahead))) {
    const vs = versus(Number(bk.b1), Number(bk.b0));
    lines.push(`${plural(Number(bk.b1), 'new booking')}${vs ? `, ${vs}` : ''}. ${Number(bk.ahead) ? `${plural(Number(bk.ahead), 'appointment')} in the next 7 days.` : ''}`.trim());
  }

  // Invoices still waiting.
  const inv = await db.get(`SELECT COUNT(*) AS n, COALESCE(SUM(total_cents), 0) AS s, COUNT(*) FILTER (WHERE due_date < ?) AS late
    FROM invoices WHERE account_id = ? AND kind = 'invoice' AND status = 'sent'`, t1.slice(0, 10), accountId).catch(() => null);
  if (inv && Number(inv.n)) {
    lines.push(`${money(Number(inv.s))} is waiting on ${plural(Number(inv.n), 'invoice')}${Number(inv.late) ? ` (${Number(inv.late)} overdue; we send one polite reminder)` : ''}.`);
  }

  // The week's emails: how many people opened and clicked.
  const bc = await db.all(`SELECT b.subject, b.sent_count,
      (SELECT COUNT(*) FROM email_log e WHERE e.broadcast_id = b.id AND e.opened_at IS NOT NULL) AS opened,
      (SELECT COUNT(*) FROM email_log e WHERE e.broadcast_id = b.id AND e.clicked_at IS NOT NULL) AS clicked
    FROM broadcasts b WHERE b.account_id = ? AND b.status = 'sent' AND b.sent_at >= ? ORDER BY b.sent_at DESC LIMIT 2`, accountId, t0);
  for (const b of bc) {
    if (!Number(b.sent_count)) continue;
    const o = pct(Number(b.opened), Number(b.sent_count)), c = pct(Number(b.clicked), Number(b.sent_count));
    lines.push(`Your email “${b.subject}” reached ${plural(Number(b.sent_count), 'person', 'people')}: ${o}% opened it${c ? ` and ${c}% clicked` : ''}.`);
  }

  return lines;
}

module.exports = { weekResults, versus };
