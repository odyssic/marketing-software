// The weekly move: one recommended action per week, for the focus lever
// (pinned, or the one with the lowest health). Chosen without AI from simple
// candidate checks; "Draft it" then writes the email in the owner's voice,
// and nothing is sent until the owner approves it.
const { inquiriesWaiting } = require('./dashboard');
const ai = require('./ai');

const LEVER_LABEL = { lead: 'Lead gen', conversion: 'Conversion', upsell: 'Upsell', continuity: 'Continuity' };
const RECENTLY_MAILED_DAYS = 14;

// Monday of this week (UTC), the key for "this week's move".
function weekOf(d = new Date()) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
}

const emailable = "c.email <> '' AND c.unsubscribed = 0";
const nameOf = "TRIM(c.first_name || ' ' || c.last_name)";

// Each candidate: who it targets and how to describe it.
const CANDIDATES = {
  conversion: [
    { key: 'stale_inquiries', title: (n) => `Follow up personally on ${n} inquir${n === 1 ? 'y' : 'ies'} older than two weeks`,
      why: 'They asked and haven’t bought. A personal reply is the cheapest sale you’ll make this week.',
      people: async (db, a) => (await inquiriesWaiting(db, a)).filter((r) => r.days >= 14 && r.email) },
    { key: 'first_order', title: (n) => `Offer a first-order welcome to ${n} new lead${n === 1 ? '' : 's'}`,
      why: 'They signed up in the last 60 days but haven’t bought yet.',
      people: (db, a) => db.all(`SELECT c.id, ${nameOf} AS name, c.email FROM contacts c WHERE c.account_id = ? AND c.stage = 'lead' AND ${emailable}
        AND EXISTS (SELECT 1 FROM events e WHERE e.person_id = c.id AND e.type IN ('signup', 'subscribe', 'inquiry') AND e.occurred_at > now() - interval '60 days')`, a) },
  ],
  lead: [
    { key: 'referral', title: (n) => `Ask ${n} recent buyer${n === 1 ? '' : 's'} to share with a friend`,
      why: 'Happy recent customers are your best source of new leads.',
      people: (db, a) => db.all(`SELECT DISTINCT c.id, ${nameOf} AS name, c.email FROM contacts c JOIN events e ON e.person_id = c.id
        WHERE c.account_id = ? AND ${emailable} AND e.type = 'purchase' AND e.occurred_at > now() - interval '90 days'`, a) },
    { key: 'audience_invite', title: (n) => `Invite ${n} people in your audience to your free offer`,
      why: 'They know you but haven’t signed up for anything yet.',
      people: (db, a) => db.all(`SELECT c.id, ${nameOf} AS name, c.email FROM contacts c WHERE c.account_id = ? AND c.stage = 'audience' AND ${emailable}`, a) },
  ],
  upsell: [
    { key: 'addon', title: (n) => `Offer a matching add-on to ${n} recent buyer${n === 1 ? '' : 's'}`,
      why: 'People who just bought are the most likely to add the natural next piece.',
      people: (db, a) => db.all(`SELECT DISTINCT c.id, ${nameOf} AS name, c.email FROM contacts c JOIN events e ON e.person_id = c.id
        WHERE c.account_id = ? AND ${emailable} AND e.type = 'purchase' AND e.occurred_at > now() - interval '30 days'`, a) },
    { key: 'bundle', title: (n) => `Suggest a bundle to ${n} one-time buyer${n === 1 ? '' : 's'}`,
      why: 'They bought one thing. A set that pairs with it raises your average order.',
      people: (db, a) => db.all(`SELECT c.id, ${nameOf} AS name, c.email FROM contacts c WHERE c.account_id = ? AND ${emailable}
        AND (SELECT COUNT(*) FROM events e WHERE e.person_id = c.id AND e.type = 'purchase') = 1
        AND NOT EXISTS (SELECT 1 FROM events e WHERE e.person_id = c.id AND e.type = 'purchase' AND e.occurred_at > now() - interval '14 days')`, a) },
  ],
  continuity: [
    { key: 'winback', title: (n) => `Win back ${n} customer${n === 1 ? '' : 's'} who’ve gone quiet`,
      why: 'They bought before but haven’t done anything in six months.',
      people: (db, a) => db.all(`SELECT c.id, ${nameOf} AS name, c.email FROM contacts c WHERE c.account_id = ? AND ${emailable}
        AND EXISTS (SELECT 1 FROM events e WHERE e.person_id = c.id AND e.type = 'purchase')
        AND NOT EXISTS (SELECT 1 FROM events e WHERE e.person_id = c.id AND e.occurred_at > now() - interval '180 days')`, a) },
    { key: 'newsletter_invite', title: (n) => `Invite ${n} past buyer${n === 1 ? '' : 's'} to your newsletter`,
      why: 'Subscribers come back and buy again; these buyers aren’t subscribed yet.',
      people: (db, a) => db.all(`SELECT c.id, ${nameOf} AS name, c.email FROM contacts c WHERE c.account_id = ? AND ${emailable}
        AND EXISTS (SELECT 1 FROM events e WHERE e.person_id = c.id AND e.type = 'purchase')
        AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.person_id = c.id AND s.status = 'active')`, a) },
  ],
};

function createMoves({ getDb, HttpError, id, leversFor, getAccount, messaging, formatMoney }) {
  const campaignOut = (c) => ({ ...c, audience: JSON.parse(c.audience || '[]'), move: JSON.parse(c.move || '{}'), results: JSON.parse(c.results || '{}') });

  async function recentlyMailed(db, a) {
    return new Set((await db.all(`SELECT audience FROM campaigns WHERE account_id = ? AND status = 'sent' AND sent_at > now() - interval '${RECENTLY_MAILED_DAYS} days'`, a))
      .flatMap((r) => JSON.parse(r.audience)));
  }

  // Picks the candidate with the most people × average order value.
  async function propose(accountId) {
    const db = getDb();
    const levers = await leversFor(accountId);
    const lever = levers.focus;
    const aov = (await db.get("SELECT COALESCE(AVG(value_cents), 0)::float AS v FROM events WHERE account_id = ? AND type = 'purchase' AND value_cents > 0", accountId)).v || 100;
    const skip = await recentlyMailed(db, accountId);
    let best = null;
    for (const c of CANDIDATES[lever]) {
      const people = (await c.people(db, accountId)).filter((p) => !skip.has(p.id));
      if (!people.length) continue;
      const value = people.length * aov;
      if (!best || value > best.value) best = { c, people, value };
    }
    const l = levers[lever];
    const focusWhy = (await getAccount(accountId)).pinned_lever === lever ? `You pinned ${LEVER_LABEL[lever]} as this week’s focus.`
      : l.score === null ? `${LEVER_LABEL[lever]} is where to start.` : `${LEVER_LABEL[lever]} is your weakest lever (health ${l.score}/100).`;
    if (!best) return { lever, key: null, title: `Nothing to send for ${LEVER_LABEL[lever]} this week`, reason: `${focusWhy} No one fits a move right now. Import more people or orders, or pin a different lever.`, people: [] };
    return { lever, key: best.c.key, title: best.c.title(best.people.length), reason: `${focusWhy} ${best.c.why}`, people: best.people, estimated_cents: Math.round(best.value) };
  }

  // This week's move, created on first look each week (or by the Monday job).
  async function current(accountId) {
    const db = getDb();
    const week = weekOf();
    let c = await db.get("SELECT * FROM campaigns WHERE account_id = ? AND week = ? AND move <> '{}' ORDER BY id DESC LIMIT 1", accountId, week);
    if (!c) {
      const m = await propose(accountId);
      if (!m.key) return { lever: m.lever, title: m.title, reason: m.reason, count: 0, people: [], status: 'empty' };
      c = await db.get(`INSERT INTO campaigns (account_id, lever, channel, status, title, audience, move, week)
        VALUES (?, ?, 'email', 'proposed', ?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING *`,
      accountId, m.lever, m.title, JSON.stringify(m.people.map((p) => p.id)),
      JSON.stringify({ key: m.key, title: m.title, reason: m.reason, lever: m.lever, estimated_cents: m.estimated_cents }), week);
      // Another request created it at the same moment: use that one.
      c ??= await db.get("SELECT * FROM campaigns WHERE account_id = ? AND week = ? AND move <> '{}' ORDER BY id DESC LIMIT 1", accountId, week);
    }
    const out = campaignOut(c);
    const people = out.audience.length ? await db.all(`SELECT id, TRIM(first_name || ' ' || last_name) AS name, email FROM contacts
      WHERE id IN (SELECT (jsonb_array_elements_text(?::jsonb))::int) ORDER BY id LIMIT 5`, JSON.stringify(out.audience)) : [];
    return { campaign_id: out.id, lever: out.lever, title: out.move.title, reason: out.move.reason, count: out.audience.length,
      people: people.map((p) => ({ id: p.id, name: p.name || p.email })), status: out.status };
  }

  const getCampaign = async (accountId, campaignId) => {
    const c = await getDb().get('SELECT * FROM campaigns WHERE id = ? AND account_id = ?', id(campaignId), accountId);
    if (!c) throw new HttpError(404, 'Campaign not found');
    return campaignOut(c);
  };

  async function results(c) {
    const db = getDb();
    if (c.status !== 'sent') return null;
    const mail = await db.get(`SELECT COUNT(*)::int AS sent, COUNT(opened_at)::int AS opened, COUNT(clicked_at)::int AS clicked
      FROM email_log WHERE campaign_id = ?`, c.id);
    const buys = await db.get(`SELECT COUNT(DISTINCT person_id)::int AS buyers, COALESCE(SUM(value_cents), 0)::int AS cents FROM events
      WHERE type = 'purchase' AND occurred_at >= ? AND occurred_at < ?::timestamptz + interval '14 days'
      AND person_id IN (SELECT (jsonb_array_elements_text(?::jsonb))::int)`, c.sent_at, c.sent_at, JSON.stringify(c.audience));
    return { ...mail, buyers: buys.buyers, revenue: formatMoney(buys.cents, 'usd'),
      plain: `${mail.sent} sent · ${mail.opened} opened · ${mail.clicked} clicked · ${buys.buyers} bought within 14 days (${formatMoney(buys.cents, 'usd')})` };
  }

  function register(api) {
    api.get('/moves/current', async (req, res) => res.json(await current(req.accountId)));

    api.get('/campaigns', async (req, res) => {
      const rows = await getDb().all('SELECT * FROM campaigns WHERE account_id = ? ORDER BY id DESC LIMIT 100', req.accountId);
      res.json(rows.map(campaignOut).map((c) => ({ ...c, audience: undefined, audience_count: c.audience.length })));
    });

    api.get('/campaigns/:id', async (req, res) => {
      const c = await getCampaign(req.accountId, req.params.id);
      const people = c.audience.length ? await getDb().all(`SELECT id, first_name, last_name, email, stage FROM contacts
        WHERE id IN (SELECT (jsonb_array_elements_text(?::jsonb))::int) ORDER BY id`, JSON.stringify(c.audience)) : [];
      res.json({ ...c, people, stats: await results(c), aiLive: ai.isLive() });
    });

    // "Draft it": writes the email in the owner's voice.
    api.post('/campaigns/:id/draft', async (req, res) => {
      const c = await getCampaign(req.accountId, req.params.id);
      if (c.status === 'sent') throw new HttpError(409, 'This campaign was already sent');
      const account = await getAccount(req.accountId);
      const who = `${c.audience.length} ${c.audience.length === 1 ? 'person' : 'people'} (${c.move.title || c.title})`;
      let d;
      try { d = await ai.draftEmail({ account, move: { ...c.move, lever: c.lever }, audience: who }); } catch (e) {
        if (e instanceof ai.AIError) throw new HttpError(e.status, e.message);
        throw e;
      }
      await getDb().run("UPDATE campaigns SET subject = ?, draft_body = ?, status = 'draft' WHERE id = ?", d.subject, d.body, c.id);
      res.json({ subject: d.subject, body: d.body, template: d.template });
    });

    api.put('/campaigns/:id', async (req, res) => {
      const c = await getCampaign(req.accountId, req.params.id);
      if (c.status === 'sent') throw new HttpError(409, 'This campaign was already sent');
      await getDb().run('UPDATE campaigns SET subject = ?, draft_body = ? WHERE id = ?',
        String(req.body?.subject ?? c.subject).slice(0, 300), String(req.body?.body ?? c.draft_body).slice(0, 20000), c.id);
      res.json({ ok: true });
    });

    api.post('/campaigns/:id/skip', async (req, res) => {
      const c = await getCampaign(req.accountId, req.params.id);
      if (c.status === 'sent') throw new HttpError(409, 'This campaign was already sent');
      await getDb().run("UPDATE campaigns SET status = 'skipped' WHERE id = ?", c.id);
      res.json({ ok: true });
    });

    // "Approve": sends to the audience. Claimed atomically so it can't go out twice.
    api.post('/campaigns/:id/send', async (req, res) => {
      const c = await getCampaign(req.accountId, req.params.id);
      if (!c.subject.trim() || !c.draft_body.trim()) throw new HttpError(400, 'Write or draft the email first');
      const claimed = await getDb().get("UPDATE campaigns SET status = 'sending' WHERE id = ? AND status IN ('draft', 'proposed') RETURNING id", c.id);
      if (!claimed) throw new HttpError(409, c.status === 'sent' ? 'This campaign was already sent' : 'This campaign can’t be sent right now');
      const account = await getAccount(req.accountId);
      const people = c.audience.length ? await getDb().all(`SELECT * FROM contacts WHERE account_id = ? AND id IN (SELECT (jsonb_array_elements_text(?::jsonb))::int)`,
        req.accountId, JSON.stringify(c.audience)) : [];
      const tally = { sent: 0, skipped: 0, failed: 0 };
      for (const p of people) {
        const r = await messaging.sendToPerson({ account, person: p, subject: c.subject, body: c.draft_body, campaignId: c.id });
        tally[r.status === 'skipped' ? 'skipped' : r.status === 'failed' ? 'failed' : 'sent']++;
      }
      await getDb().run("UPDATE campaigns SET status = 'sent', sent_at = now(), results = ? WHERE id = ?", JSON.stringify(tally), c.id);
      res.json(tally);
    });

    // Voice profile: 3-5 samples of the owner's writing plus tone notes.
    api.put('/account/voice', async (req, res) => {
      const samples = (Array.isArray(req.body?.samples) ? req.body.samples : []).map((s) => String(s).trim().slice(0, 6000)).filter(Boolean).slice(0, 5);
      await getDb().run('UPDATE accounts SET voice_samples = ?, voice_notes = ? WHERE id = ?',
        JSON.stringify(samples), String(req.body?.notes || '').slice(0, 1000), req.accountId);
      res.json({ ok: true, samples: samples.length });
    });
  }

  return { register, current, propose, weekOf };
}

module.exports = { createMoves, CANDIDATES, weekOf };
