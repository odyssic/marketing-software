// The weekly digest: the only alert the app sends. On the owner's chosen day,
// one email with lever health, this week's move, and inquiries older than 14 days.
const mailer = require('./mailer');
const ai = require('./ai');
const { inquiriesWaiting } = require('./dashboard');

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const bar = (score) => (score === null ? '··········' : '█'.repeat(Math.round(score / 10)).padEnd(10, '·'));

function createDigest({ getDb, leversFor, moves, publicBase }) {
  async function build(accountId) {
    const db = getDb();
    const account = await db.get('SELECT * FROM accounts WHERE id = ?', accountId);
    const levers = await leversFor(accountId);
    const move = await moves.current(accountId);
    const old = (await inquiriesWaiting(db, accountId)).filter((r) => r.days >= 14);
    const base = publicBase();
    const lines = [
      `Your week at ${account.name}`,
      '',
      'LEVER HEALTH',
      ...['lead', 'conversion', 'upsell', 'continuity'].map((k) => {
        const l = levers[k];
        return `${l.label.padEnd(11)} ${bar(l.score)} ${l.score === null ? 'not enough data' : `${l.score}/100`}  ${l.valueLabel}${l.changeLabel ? ` (${l.changeLabel})` : ''}${k === levers.focus ? '  ← focus' : ''}`;
      }),
      '',
      'THIS WEEK’S MOVE',
      move.status === 'empty' ? move.title : `${move.title}\n${move.reason}`,
      move.campaign_id ? `${move.status === 'sent' ? 'See results' : 'Draft and send it'}: ${base}/#/campaigns/${move.campaign_id}` : '',
      '',
      old.length ? `INQUIRIES WAITING MORE THAN 14 DAYS (${old.length})` : 'No inquiries have waited more than 14 days. Nice.',
      ...old.slice(0, 10).map((r) => `• ${r.name}: ${r.days} days — ${base}/#/people/${r.id}`),
      old.length > 10 ? `…and ${old.length - 10} more` : '',
      '',
      `Open your dashboard: ${base}/#/`,
      '',
      `You get this every ${DAYS[account.digest_day]}. Change the day in Settings.`,
    ].filter((l) => l !== null && l !== undefined);
    return { subject: `Your week: focus on ${levers[levers.focus].label}${old.length ? `, ${old.length} inquir${old.length === 1 ? 'y' : 'ies'} waiting` : ''}`, text: lines.join('\n').replace(/\n{3,}/g, '\n\n'), account };
  }

  async function ownerEmail(accountId) {
    return (await getDb().get(`SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.account_id = ? ORDER BY m.user_id LIMIT 1`, accountId))?.email;
  }

  async function send(accountId, now = new Date()) {
    const { subject, text, account } = await build(accountId);
    const to = await ownerEmail(accountId);
    if (!to) return { status: 'skipped' };
    const r = await mailer.sendEmail({ from: process.env.SMTP_FROM || 'no-reply@localhost', to, subject, text });
    await getDb().run('INSERT INTO email_log (account_id, to_email, subject, body, status) VALUES (?, ?, ?, ?, ?)', accountId, to, subject, text, r.status);
    await getDb().run('UPDATE accounts SET last_digest_at = ? WHERE id = ?', now.toISOString(), accountId);
    return { status: r.status, to, subject };
  }

  // Run by the job runner: every workspace whose digest day is today (UTC),
  // that hasn't had one today, and is more than a day old (nothing to report yet).
  async function sendDue(now = new Date()) {
    const at = now.toISOString();
    const due = await getDb().all(`SELECT id FROM accounts WHERE digest_day = ?
      AND created_at < ?::timestamptz - interval '1 day'
      AND (last_digest_at IS NULL OR last_digest_at < date_trunc('day', ?::timestamptz))`, now.getUTCDay(), at, at);
    let sent = 0;
    for (const a of due) {
      try { if ((await send(a.id, now)).status !== 'skipped') sent++; } catch (e) { console.error(`digest ${a.id}:`, e.message); }
    }
    return { digests: sent };
  }

  function register(api, { HttpError }) {
    api.get('/digest/preview', async (req, res) => {
      const { subject, text } = await build(req.accountId);
      res.json({ subject, text, day: DAYS[(await getDb().get('SELECT digest_day FROM accounts WHERE id = ?', req.accountId)).digest_day] });
    });
    api.post('/digest/send', async (req, res) => res.json(await send(req.accountId)));
    api.put('/account/digest', async (req, res) => {
      const day = Number(req.body?.day);
      if (!Number.isInteger(day) || day < 0 || day > 6) throw new HttpError(400, 'Pick a day of the week');
      await getDb().run('UPDATE accounts SET digest_day = ? WHERE id = ?', day, req.accountId);
      res.json({ ok: true, day: DAYS[day] });
    });

    // Repurpose: one essay or episode transcript → drafts for other channels.
    api.post('/repurpose', async (req, res) => {
      const text = String(req.body?.text || '').trim();
      if (text.length < 200) throw new HttpError(400, 'Paste at least a few paragraphs (200+ characters)');
      if (text.length > 60000) throw new HttpError(400, 'That’s too long. Paste one essay or episode at a time (up to about 10,000 words)');
      const account = await getDb().get('SELECT * FROM accounts WHERE id = ?', req.accountId);
      try { res.json(await ai.repurpose({ account, text, kind: req.body?.kind === 'episode' ? 'episode' : 'essay' })); } catch (e) {
        if (e instanceof ai.AIError) throw new HttpError(e.status, e.message);
        throw e;
      }
    });
  }

  return { build, send, sendDue, register };
}

module.exports = { createDigest, DAYS };
