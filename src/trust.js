'use strict';
// The things people get burned by elsewhere, handled up front:
// - texting costs you can see and cap (no surprise bills),
// - an email health check with plain fixes, and a gentle warm-up for a new sending domain,
// - a daily check that every live checkout and form still works (and an email when one doesn't),
// - a public status page, a heads-up before a free trial ends, and help inside the app.
const dns = require('dns').promises;

// About what a text costs (US carrier + Twilio, per 160-character part). Shown as an estimate.
const SEGMENT_CENTS = () => Number(process.env.SMS_SEGMENT_CENTS) || 1.1;
const DEFAULT_CAP_CENTS = 5000; // $50 a month unless the business changes it

// How many parts a text is sent as: 160 plain characters (153 when split), or 70 (67) with emoji/accents.
function segments(body) {
  const s = String(body || '');
  if (!s) return 0;
  // eslint-disable-next-line no-control-regex
  const plain = /^[\x0A\x0D\x20-\x7E£¥èéùìòÇØøÅå_ÆæßÉ¡ÄÖÑÜ§¿äöñüà€^{}\\[~\]|]*$/.test(s);
  const [one, many] = plain ? [160, 153] : [70, 67];
  const len = [...s].length;
  return len <= one ? 1 : Math.ceil(len / many);
}
const costCents = (body) => segments(body) * SEGMENT_CENTS();
const monthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

// Words and habits that make inbox filters (and people) suspicious.
const SPAMMY = ['free money', 'act now', '100% free', 'risk-free', 'risk free', 'guaranteed income', 'click here', 'buy now', 'limited time only', 'winner', 'you have been selected',
  'cash bonus', 'no credit check', 'double your', 'earn extra cash', 'urgent', 'once in a lifetime', 'not spam', 'this is not spam', 'dear friend', 'congratulations', 'make money fast', '$$$'];
function spamCheck(subject = '', body = '') {
  const text = `${subject}\n${body}`.toLowerCase();
  const out = [];
  const hits = SPAMMY.filter((w) => text.includes(w));
  if (hits.length) out.push(`Words filters dislike: “${hits.slice(0, 4).join('”, “')}”. Try plainer words.`);
  const letters = String(subject).replace(/[^A-Za-z]/g, '');
  if (letters.length >= 8 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.6) out.push('The subject is mostly CAPITALS. It reads as shouting and trips filters.');
  if (/!{2,}|\?{3,}/.test(subject)) out.push('Several !!! or ??? in the subject. One at most.');
  const links = (body.match(/https?:\/\//g) || []).length;
  if (links > 6) out.push(`${links} links. Three or four is plenty; lots of links looks like spam.`);
  if (/bit\.ly|tinyurl|goo\.gl|t\.co\//i.test(body)) out.push('Link shorteners (bit.ly and friends) are often blocked. Use the full address.');
  return out;
}

// A new sending domain earns trust slowly: about 50 emails on its first day, roughly doubling each day.
function warmupAllowance(account, now = new Date()) {
  if (!account?.send_domain || account.send_domain_status !== 'verified' || !account.send_domain_verified_at) return Infinity;
  const days = Math.floor((now - new Date(account.send_domain_verified_at)) / 864e5);
  if (days >= 14) return Infinity;
  return Math.min(50 * 2 ** days, 100000);
}

async function txt(name) {
  try {
    const r = await Promise.race([dns.resolveTxt(name), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 4000))]);
    return r.map((parts) => parts.join(''));
  } catch { return []; }
}

function registerTrust(app, api, { getDb, HttpError, mailer, publicBase, renderCheck, formatMoney }) {
  const db = () => getDb();

  // ---------- Texting costs ----------
  const smsUsage = async (accountId, now = new Date()) => {
    const rows = await db().all(`SELECT body FROM messages WHERE account_id = ? AND channel = 'sms' AND direction = 'out' AND status IN ('sent', 'delivered', 'logged') AND created_at >= ?`,
      accountId, monthStart(now).toISOString());
    return Math.round(rows.reduce((n, r) => n + costCents(r.body), 0));
  };
  const capOf = (a) => (a.sms_cap_cents === null || a.sms_cap_cents === undefined ? DEFAULT_CAP_CENTS : a.sms_cap_cents);
  // Before an automatic text goes out: would it pass this month's limit? Warn the owner once at 80%.
  async function smsAllowed(account, body, now = new Date()) {
    const cap = capOf(account);
    if (!cap) return { ok: true };
    const used = await smsUsage(account.id, now);
    const month = monthStart(now).toISOString().slice(0, 7);
    if (used + costCents(body) > cap) return { ok: false, reason: `this month’s texting limit (${formatMoney(cap, 'usd')}) is reached` };
    if (used >= cap * 0.8 && account.sms_warned_month !== month) {
      await db().run('UPDATE accounts SET sms_warned_month = ? WHERE id = ?', month, account.id);
      const owner = await db().get("SELECT email FROM users WHERE id = (SELECT user_id FROM memberships WHERE account_id = ? ORDER BY (role = 'owner') DESC LIMIT 1)", account.id).catch(() => null);
      if (owner?.email) await mailer.sendEmail({ ...mailer.senderFor({ name: 'Rilly' }), to: owner.email, subject: `Texting is at 80% of this month’s limit`, text: `${account.name} has used about ${formatMoney(used, 'usd')} of its ${formatMoney(cap, 'usd')} texting limit this month.\n\nAutomatic texts stop at the limit so there are no surprises. Replies you type yourself still go out.\n\nChange the limit: ${publicBase()}/#/settings` }).catch(() => {});
    }
    return { ok: true };
  }
  api.get('/account/sms-usage', async (req, res) => {
    const a = await db().get('SELECT id, sms_cap_cents FROM accounts WHERE id = ?', req.accountId);
    const used = await smsUsage(req.accountId);
    res.json({ used_cents: used, cap_cents: capOf(a), per_text_cents: SEGMENT_CENTS(), month: monthStart().toISOString().slice(0, 7) });
  });
  api.put('/account/sms-cap', async (req, res) => {
    const cap = Math.round(Number(req.body?.cap) * 100);
    if (!Number.isFinite(cap) || cap < 0 || cap > 1000000) throw new HttpError(400, 'Enter a monthly limit between $0 and $10,000 (0 means no limit)');
    await db().run('UPDATE accounts SET sms_cap_cents = ? WHERE id = ?', cap, req.accountId);
    res.json({ cap_cents: cap });
  });
  api.post('/sms/estimate', async (req, res) => {
    const body = String(req.body?.body || '');
    const people = Math.max(1, Math.min(1000000, Number(req.body?.people) || 1));
    res.json({ segments: segments(body), each_cents: costCents(body), total_cents: Math.round(costCents(body) * people) });
  });

  // ---------- Email health ----------
  api.get('/account/email-health', async (req, res) => {
    const a = await db().get('SELECT name, domain, send_domain, send_domain_status, send_domain_verified_at FROM accounts WHERE id = ?', req.accountId);
    const domain = (a.send_domain || String(a.domain || '').replace(/^www\./, '')).toLowerCase();
    const checks = [];
    if (!a.send_domain) checks.push({ ok: false, level: 'info', title: 'Sending from Rilly’s address', fix: 'Fine to start. Sending from your own domain (Settings → Send from your own domain) lands in more inboxes and looks like you.' });
    else checks.push(a.send_domain_status === 'verified' ? { ok: true, title: `Your domain ${a.send_domain} is verified for sending` } : { ok: false, level: 'warn', title: `${a.send_domain} isn’t verified yet`, fix: 'Add the records shown under “Send from your own domain”, then press Check now.' });
    if (domain) {
      const dmarc = (await txt(`_dmarc.${domain}`)).find((r) => /^v=DMARC1/i.test(r));
      checks.push(dmarc ? { ok: true, title: 'DMARC is set', detail: dmarc }
        : { ok: false, level: 'warn', title: 'No DMARC record', fix: `Gmail and Yahoo expect one from anyone sending to lots of people. At your domain’s DNS settings, add a TXT record named “_dmarc” with the value “v=DMARC1; p=none;”. It changes nothing for your normal email.`, record: { type: 'TXT', name: '_dmarc', value: 'v=DMARC1; p=none;' } });
      const spf = (await txt(domain)).filter((r) => /^v=spf1/i.test(r));
      if (spf.length > 1) checks.push({ ok: false, level: 'bad', title: 'Two SPF records', fix: 'A domain can only have one TXT record starting with “v=spf1”. Merge them into one (keep every include: part) or ask whoever set up your email to.' });
      else if (spf.length) checks.push({ ok: true, title: 'SPF is set', detail: spf[0] });
    }
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const r = await db().get(`SELECT COUNT(*)::int AS sent, COUNT(*) FILTER (WHERE status = 'bounced')::int AS bounced, COUNT(opened_at)::int AS opened FROM email_log WHERE account_id = ? AND created_at >= ?`, req.accountId, since);
    if (r.sent >= 20) {
      const bounce = r.bounced / r.sent;
      checks.push(bounce > 0.03 ? { ok: false, level: 'bad', title: `${Math.round(bounce * 100)}% of emails bounced this month`, fix: 'Above about 2% hurts your reputation. Bounced addresses are already taken off your list; avoid importing old or bought lists.' }
        : { ok: true, title: `Bounces are low (${(bounce * 100).toFixed(1)}%)` });
    }
    const allowance = warmupAllowance({ ...a });
    if (allowance !== Infinity) checks.push({ ok: true, level: 'info', title: `Warming up your new domain: up to ${allowance.toLocaleString('en-US')} emails today`, fix: 'Bigger sends carry on automatically the next day. After two weeks there’s no limit.' });
    res.json({ domain, checks, good: checks.every((c) => c.ok || c.level === 'info') });
  });
  api.post('/email/spam-check', (req, res) => res.json({ warnings: spamCheck(String(req.body?.subject || ''), String(req.body?.body || '')) }));

  // ---------- Daily checkout and form watchdog ----------
  // Looks at every live page that takes money or sign-ups: it must still draw, its product must
  // still exist, and the business's payments must still be connected. Tells the owner once per new problem.
  async function watchAccount(accountId) {
    const a = await db().get('SELECT id, name, stripe_secret_key FROM accounts WHERE id = ?', accountId);
    const steps = await db().all(`SELECT s.id, s.name, s.slug, s.blocks, f.slug AS fslug, f.name AS fname FROM funnel_steps s JOIN funnels f ON f.id = s.funnel_id
      WHERE f.account_id = ? AND f.status = 'live'`, accountId);
    const products = new Map((await db().all('SELECT id, name FROM products WHERE account_id = ?', accountId)).map((p) => [p.id, p]));
    const problems = [];
    let checked = 0;
    for (const s of steps) {
      let blocks = []; try { blocks = JSON.parse(s.blocks || '[]'); } catch { problems.push(`“${s.name}” in “${s.fname}” couldn’t be read.`); continue; }
      const sells = blocks.filter((b) => b.type === 'pricing' && b.productId);
      const forms = blocks.some((b) => b.type === 'form');
      if (!sells.length && !forms) continue;
      checked++;
      for (const b of sells) if (!products.has(Number(b.productId))) problems.push(`The buy button on “${s.name}” (${s.fname}) points to a product that was deleted. Visitors can’t buy.`);
      try { await renderCheck(accountId, s.id); } catch (e) { problems.push(`“${s.name}” (${s.fname}) didn’t load: ${e.message}`); }
    }
    if (steps.some((s) => /"type":"pricing"/.test(s.blocks)) && a.stripe_secret_key) {
      const ok = await fetch('https://api.stripe.com/v1/balance', { headers: { Authorization: `Bearer ${a.stripe_secret_key}` } }).then((r) => r.status !== 401).catch(() => true);
      if (!ok) problems.push('Your Stripe connection stopped working (the key was revoked or changed). Checkouts can’t take payment until you reconnect it in Settings → Payments.');
    }
    return { checked, problems };
  }
  async function watchAll(now = new Date()) {
    const due = await db().all(`SELECT id, name, watch_problems FROM accounts WHERE watch_checked_at IS NULL OR watch_checked_at < ? ORDER BY id LIMIT 40`, new Date(now - 864e5).toISOString());
    let alerted = 0;
    for (const a of due) {
      const { checked, problems } = await watchAccount(a.id).catch((e) => ({ checked: 0, problems: [], err: e }));
      const key = problems.join('\n');
      await db().run('UPDATE accounts SET watch_checked_at = ?, watch_problems = ?, watch_count = ? WHERE id = ?', now.toISOString(), key, checked, a.id);
      if (problems.length && key !== (a.watch_problems || '')) {
        const owner = await db().get("SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.account_id = ? ORDER BY (m.role = 'owner') DESC LIMIT 1", a.id).catch(() => null);
        if (owner?.email) {
          await mailer.sendEmail({ ...mailer.senderFor({ name: 'Rilly' }), to: owner.email, subject: `Something on ${a.name}’s pages needs a look`, text: `Rilly checks your live checkouts and forms every day. Today it found:\n\n${problems.map((p) => `• ${p}`).join('\n')}\n\nOpen Rilly: ${publicBase()}/#/flows` }).catch(() => {});
          alerted++;
        }
      }
    }
    await db().run("INSERT INTO app_status (key, value, at) VALUES ('watchdog', ?, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now()", String(due.length));
    return { watched: due.length, watchAlerts: alerted };
  }
  api.get('/account/watchdog', async (req, res) => {
    const a = await db().get('SELECT watch_checked_at, watch_problems, watch_count FROM accounts WHERE id = ?', req.accountId);
    res.json({ checked_at: a.watch_checked_at, pages: a.watch_count || 0, problems: a.watch_problems ? a.watch_problems.split('\n') : [] });
  });
  api.post('/account/watchdog/run', async (req, res) => {
    const r = await watchAccount(req.accountId);
    await db().run('UPDATE accounts SET watch_checked_at = now(), watch_problems = ?, watch_count = ? WHERE id = ?', r.problems.join('\n'), r.checked, req.accountId);
    res.json({ checked_at: new Date().toISOString(), pages: r.checked, problems: r.problems });
  });

  // ---------- Public status page ----------
  app.get('/status', async (req, res) => {
    const t0 = Date.now();
    let dbOk = true; try { await db().get('SELECT 1 AS x'); } catch { dbOk = false; }
    const ms = Date.now() - t0;
    const jobs = await db().get("SELECT at FROM app_status WHERE key = 'jobs'").catch(() => null);
    const recent = jobs?.at && Date.now() - new Date(jobs.at).getTime() < 30 * 60e3;
    const rows = [['Pages and checkout', dbOk, dbOk ? `Responding (${ms} ms)` : 'Not responding'], ['Emails, follow-ups and reminders', recent, recent ? `Last run ${Math.max(1, Math.round((Date.now() - new Date(jobs.at)) / 60e3))} min ago` : 'Delayed']];
    const all = rows.every((r) => r[1]);
    if (req.query.format === 'json') return res.json({ ok: all, parts: rows.map(([name, ok, note]) => ({ name, ok, note })) });
    res.status(all ? 200 : 503).type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rilly status</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:560px;margin:60px auto;padding:0 20px;color:#14282b;background:#f6fafa}h1{font-size:1.6rem}.r{display:flex;justify-content:space-between;gap:12px;background:#fff;border:1px solid #e3ecec;border-radius:12px;padding:14px 18px;margin:10px 0}.ok{color:#15803d}.bad{color:#b91c1c}small{opacity:.6}</style></head>
<body><h1>${all ? '● All systems running' : '● Something is slow right now'}</h1>${rows.map(([n, ok, note]) => `<div class="r"><b>${n}</b><span class="${ok ? 'ok' : 'bad'}">${note}</span></div>`).join('')}
<p><small>Checked ${new Date().toUTCString()}. Every business’s live checkouts and forms are also checked once a day.</small></p></body></html>`);
  });
  const markJobs = () => db().run("INSERT INTO app_status (key, value, at) VALUES ('jobs', 'ok', now()) ON CONFLICT (key) DO UPDATE SET at = now()").catch(() => {});

  // ---------- A heads-up three days before a free trial ends ----------
  async function trialReminders(now = new Date(), { trialDays = 14, enabled = false, price = '' } = {}) {
    if (!enabled) return { trialReminders: 0 };
    const users = await db().all(`SELECT id, email, name, trial_ends_at, created_at FROM users WHERE plan_status = 'trialing' AND trial_reminded_at IS NULL`);
    let n = 0;
    for (const u of users) {
      const end = new Date(u.trial_ends_at || new Date(new Date(u.created_at).getTime() + trialDays * 864e5));
      const left = (end - now) / 864e5;
      if (left > 3 || left < 0) continue;
      await db().run('UPDATE users SET trial_reminded_at = now() WHERE id = ?', u.id);
      await mailer.sendEmail({ ...mailer.senderFor({ name: 'Rilly' }), to: u.email, subject: `Your Rilly trial ends ${end.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}`,
        text: `Hi ${String(u.name || '').split(' ')[0] || 'there'},\n\nA quick heads-up so nothing surprises you: your free trial ends on ${end.toDateString()}.\n\n• To keep going, choose a plan in Settings${price ? ` (${price} a month)` : ''}.\n• Not for you? Do nothing. You won’t be charged, and your pages stay safe if you come back.\n• Want your data? Settings → Download everything, any time.\n\n${publicBase()}/#/settings\n\nThanks for trying Rilly.` }).catch(() => {});
      n++;
    }
    return { trialReminders: n };
  }

  // ---------- Help from inside the app ----------
  const GUIDE = `Flows (left menu): every page, website, course and follow-up. New → pick a template; it starts as Untitled; click its name to rename.
A flow's map: pages are cards; drag from a card's exit to link pages; + Add page; ⋯ menu → Settings and address, Give it its own domain, Duplicate, Unpublish.
Page editor: Add a block (left) by click or drag; click text on the page to type; each block has settings, Background, Show on (phone/computer), and Motion (comes in, leaves, while on screen). Page style: palettes, type styles, gentle motion, sticky phone button. Publish button top right. Undo/History top bar.
After someone buys or signs up they go to the page linked from the card's yes exit (usually Thank you).
Products (left menu): name, price, photo, what buyers get, shipping, limited offer. "Make its page" builds a sales page. Put a Pricing card or Products block on a page to sell.
Email (left menu): New email, audience, Before you send checklist, send now or later. Follow-ups: emails/texts that run on their own when someone signs up, buys, gets a tag.
People: contacts, import from spreadsheet or paste, tags, testimonials (People → Testimonials).
Analytics: visits, sign-ups, sales, sources, top pages, clicks.
Settings: business, logo and colours, domain (one for the business; a flow can have its own), send email from your own domain + Check my email health, Texting and calls (number, monthly limit, approval details), Payments (connect Stripe), Daily checkout check, plan (cancel or pause), Download everything.
Calendar: booking page and availability. Inbox: texts and emails from customers.`;
  api.post('/help', async (req, res) => {
    const question = String(req.body?.question || '').trim().slice(0, 2000);
    if (!question) throw new HttpError(400, 'Tell us what you’re trying to do');
    const page = String(req.body?.page || '').slice(0, 200), errors = String(req.body?.errors || '').slice(0, 1200);
    let answer = '', passed = true;
    const ai = require('./ai');
    if (ai.isLive()) {
      try { const r = await ai.helpAnswer({ question, page, guide: GUIDE }); answer = r.answer; passed = r.passToPerson || Boolean(errors); } catch { answer = ''; }
    }
    if (!answer) answer = 'Thanks, your question is with a real person now. You’ll get an email reply, usually within one business day.';
    await db().run('INSERT INTO help_requests (account_id, user_id, question, page, errors, answer) VALUES (?, ?, ?, ?, ?, ?)', req.accountId, req.user?.id || null, question, page, errors, answer);
    const to = process.env.SUPPORT_EMAIL;
    if (passed && to) {
      const who = await db().get('SELECT u.email, a.name FROM users u, accounts a WHERE u.id = ? AND a.id = ?', req.user?.id || 0, req.accountId).catch(() => null);
      await mailer.sendEmail({ ...mailer.senderFor({ name: 'Rilly help', replyTo: who?.email }), to, subject: `Help: ${question.slice(0, 70)}`,
        text: `From: ${who?.email || '?'} (${who?.name || '?'})\nScreen: ${page}\n\n${question}\n\n${errors ? `Recent errors:\n${errors}\n\n` : ''}Answer shown:\n${answer}` }).catch(() => {});
    }
    res.json({ answer, passed });
  });

  return { smsAllowed, smsUsage, spamCheck, warmupAllowance, watchAll, watchAccount, trialReminders, markJobs, segments, costCents };
}

module.exports = { registerTrust, segments, costCents, spamCheck, warmupAllowance, SEGMENT_CENTS };
