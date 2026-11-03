// Texting, calls and the unified inbox.
//
// Every conversation lands in one place (messages): texts in and out, missed
// calls, replies to emails, and inquiry forms. The owner answers by text or
// email from the same thread.
//
// Texting goes through Twilio when TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are
// set and the workspace has a number; otherwise it runs in test mode (logged,
// not sent), like email without a provider.
//
// Rules that keep texting legal and kind (TCPA / carrier 10DLC rules):
// - Marketing texts (workflows) only go to people who opted in on a form or
//   texted first, never after STOP, and never 9pm to 8am their time.
// - STOP, UNSUBSCRIBE, CANCEL, END, QUIT stop all texts; START resumes; HELP
//   gets the business name and how to opt out.
// - The first marketing text to someone says how to opt out.
const crypto = require('node:crypto');
const express = require('express');

const STOP_WORDS = ['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'revoke', 'optout'];
const START_WORDS = ['start', 'unstop', 'yes'];
const live = () => Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);

// +15551234567 from whatever people type. Assumes US/Canada for 10-digit numbers.
function e164(raw) {
  const s = String(raw || '').trim();
  const d = s.replace(/\D/g, '');
  if (!d) return '';
  if (s.startsWith('+')) return d.length >= 8 && d.length <= 15 ? `+${d}` : '';
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return d.length >= 8 && d.length <= 15 ? `+${d}` : '';
}
const last10 = (p) => String(p || '').replace(/\D/g, '').slice(-10);

// Twilio signs webhooks: base64 HMAC-SHA1 of the full URL followed by each
// POST field name and value, sorted by name.
function twilioSignature(token, url, params) {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  return crypto.createHmac('sha1', token).update(data, 'utf8').digest('base64');
}
function validTwilio(req, url) {
  const sig = req.get('x-twilio-signature') || '';
  const expected = twilioSignature(process.env.TWILIO_AUTH_TOKEN || '', url, req.body || {});
  return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

async function twilioSend({ from, to, body, statusCallback }) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ From: from, To: to, Body: body, ...(statusCallback ? { StatusCallback: statusCallback } : {}) }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.message || `Twilio error ${res.status}`);
  return j.sid;
}

const xml = (res, inner = '') => res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`);
const escX = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

// Hour of day in a time zone (for quiet hours).
function hourIn(tz, now) {
  try { return Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(now)); } catch { return now.getUTCHours(); }
}
const tzOf = (account) => { try { return JSON.parse(account.booking || '{}').tz || 'America/New_York'; } catch { return 'America/New_York'; } };
// When texting may resume: null if now is fine (8am to 9pm in the business's time zone).
function quietUntil(account, now = new Date()) {
  const h = hourIn(tzOf(account), now);
  if (h >= 8 && h < 21) return null;
  const hoursToGo = h >= 21 ? 24 - h + 8 : 8 - h;
  const t = new Date(now.getTime() + hoursToGo * 3600e3);
  t.setUTCMinutes(0, 0, 0);
  return t;
}

function registerTexting(app, api, { getDb, HttpError, id, upsertContact, logEvent, messaging, publicBase, getSecret }) {
  const db = () => getDb();
  const hookUrl = (req) => `${(process.env.PUBLIC_URL || publicBase()).replace(/\/$/, '')}${req.originalUrl}`;

  async function record(m) {
    return db().get(`INSERT INTO messages (account_id, contact_id, channel, direction, from_addr, to_addr, subject, body, status, external_id, read_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`, m.account_id, m.contact_id ?? null, m.channel, m.direction, m.from || '', m.to || '',
    m.subject || '', String(m.body || '').slice(0, 20000), m.status || '', m.external_id || null, m.direction === 'out' ? new Date().toISOString() : null);
  }

  // Send one text. kind: 'conversation' (a reply, a missed-call text) or 'marketing' (workflows).
  async function sendText({ account, contact, body, kind = 'conversation', now = new Date() }) {
    const to = e164(contact.phone);
    if (!to) return { status: 'skipped', reason: 'no mobile number' };
    if (contact.sms_opt_out) return { status: 'skipped', reason: 'they replied STOP' };
    if (kind === 'marketing') {
      const texted = await db().get("SELECT 1 FROM messages WHERE contact_id = ? AND channel = 'sms' AND direction = 'in' LIMIT 1", contact.id);
      if (!contact.sms_consent_at && !texted) return { status: 'skipped', reason: 'no permission to text' };
      const wait = quietUntil(account, now);
      if (wait) return { status: 'quiet', until: wait };
      const before = await db().get("SELECT 1 FROM messages WHERE contact_id = ? AND channel = 'sms' AND direction = 'out' LIMIT 1", contact.id);
      if (!before) body = `${body}\n\nReply STOP to opt out.`;
    }
    let status = 'logged', external = null, reason = '';
    if (live() && account.sms_number) {
      try {
        external = await twilioSend({ from: account.sms_number, to, body, statusCallback: `${(process.env.PUBLIC_URL || publicBase()).replace(/\/$/, '')}/hooks/sms/status` });
        status = 'sent';
      } catch (e) { status = 'failed'; reason = e.message; }
    }
    await record({ account_id: account.id, contact_id: contact.id, channel: 'sms', direction: 'out', from: account.sms_number, to, body, status, external_id: external });
    return { status, reason };
  }
  messaging.sendText = sendText;
  messaging.quietUntil = quietUntil;

  // Who is texting or calling: an existing person by phone, or a new one.
  async function personByPhone(account, phone) {
    const p = await db().get("SELECT * FROM contacts WHERE account_id = ? AND phone <> '' AND right(regexp_replace(phone, '\\D', '', 'g'), 10) = ? ORDER BY id LIMIT 1", account.id, last10(phone));
    if (p) return p;
    const { id: cid } = await upsertContact(db(), account.id, { email: '', phone, source: 'other' });
    return db().get('SELECT * FROM contacts WHERE id = ?', cid);
  }
  const accountByNumber = (to) => db().get("SELECT * FROM accounts WHERE sms_number <> '' AND right(regexp_replace(sms_number, '\\D', '', 'g'), 10) = ? ORDER BY id LIMIT 1", last10(to));

  async function tellOwner(account, contact, text, channel) {
    // At most one heads-up per conversation every 30 minutes; the inbox has the rest.
    const recent = await db().get(`SELECT 1 FROM messages WHERE contact_id = ? AND direction = 'in' AND created_at > now() - interval '30 minutes' AND id <> (SELECT MAX(id) FROM messages WHERE contact_id = ?)`, contact.id, contact.id);
    if (recent) return;
    const who = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.phone || contact.email || 'Someone';
    await messaging.sendToOwner({ account, subject: `${channel === 'call' ? 'Missed call' : 'New message'} from ${who}`,
      body: `${text}\n\nReply from your inbox: ${(process.env.PUBLIC_URL || publicBase()).replace(/\/$/, '')}/#/inbox/${contact.id}` }).catch((e) => console.error('owner heads-up:', e.message));
  }

  // ---------- Twilio webhooks ----------
  const form = express.urlencoded({ extended: false, limit: '64kb' });
  const guard = (req, res) => {
    if (!process.env.TWILIO_AUTH_TOKEN) { res.status(503).type('text').send('Texting is not set up'); return false; }
    if (!validTwilio(req, hookUrl(req))) { res.status(403).type('text').send('Bad signature'); return false; }
    return true;
  };

  app.post('/hooks/sms', form, async (req, res) => {
    if (!guard(req, res)) return;
    const account = await accountByNumber(req.body.To);
    if (!account) return xml(res);
    const body = String(req.body.Body || '').trim();
    if (req.body.MessageSid && await db().get('SELECT 1 FROM messages WHERE external_id = ?', req.body.MessageSid)) return xml(res); // retried delivery
    const contact = await personByPhone(account, e164(req.body.From) || req.body.From);
    await record({ account_id: account.id, contact_id: contact.id, channel: 'sms', direction: 'in', from: req.body.From, to: req.body.To, body, status: 'received', external_id: req.body.MessageSid });
    const word = body.toLowerCase().replace(/[^a-z]/g, '');
    if (STOP_WORDS.includes(word)) {
      await db().run('UPDATE contacts SET sms_opt_out = 1 WHERE id = ?', contact.id);
      await logEvent(db(), account.id, { person_id: contact.id, type: 'unsubscribe', source: 'other', meta: { format: 'sms', via: body } });
      return xml(res); // the carrier sends the opt-out confirmation
    }
    if (START_WORDS.includes(word) && contact.sms_opt_out) {
      await db().run('UPDATE contacts SET sms_opt_out = 0 WHERE id = ?', contact.id);
      return xml(res);
    }
    if (word === 'help' || word === 'info') {
      await sendText({ account, contact, body: `${account.name}: reply here and we’ll get back to you. Reply STOP to opt out. Msg & data rates may apply.` });
      return xml(res);
    }
    await logEvent(db(), account.id, { person_id: contact.id, type: 'inquiry', source: 'other', meta: { note: body.slice(0, 500), via: 'text' } });
    await tellOwner(account, contact, `“${body.slice(0, 300)}”`, 'sms');
    xml(res);
  });

  app.post('/hooks/sms/status', form, async (req, res) => {
    if (!guard(req, res)) return;
    const st = String(req.body.MessageStatus || '');
    if (req.body.MessageSid && ['delivered', 'undelivered', 'failed'].includes(st)) await db().run('UPDATE messages SET status = ? WHERE external_id = ?', st, req.body.MessageSid);
    res.status(204).end();
  });

  // Calls: ring the owner's phone; if nobody answers, text the caller straight back.
  const DEFAULT_TEXT_BACK = (a) => `Hi, it’s ${a.name}. Sorry we missed your call! How can we help? You can reply right here.`;
  async function missed(account, from) {
    const contact = await personByPhone(account, e164(from) || from);
    await record({ account_id: account.id, contact_id: contact.id, channel: 'call', direction: 'in', from, to: account.sms_number, body: 'Missed call', status: 'missed' });
    // One text-back per caller every 12 hours, so repeat calls don't get repeat texts.
    const lately = await db().get("SELECT 1 FROM messages WHERE contact_id = ? AND channel = 'sms' AND direction = 'out' AND created_at > now() - interval '12 hours'", contact.id);
    if (!lately && account.missed_call_text !== '-') await sendText({ account, contact, body: account.missed_call_text || DEFAULT_TEXT_BACK(account) });
    await tellOwner(account, contact, `Missed call from ${contact.phone}. ${lately ? '' : 'We texted them back.'}`, 'call');
  }
  app.post('/hooks/voice', form, async (req, res) => {
    if (!guard(req, res)) return;
    const account = await accountByNumber(req.body.To);
    if (!account) return xml(res, '<Reject/>');
    const fwd = e164(account.forward_to);
    if (fwd) return xml(res, `<Dial timeout="20" answerOnBridge="true" callerId="${escX(req.body.From || '')}" action="/hooks/voice/done">${escX(fwd)}</Dial>`);
    await missed(account, req.body.From);
    xml(res, `<Say>Sorry, we can’t take your call right now. We’ve just sent you a text so we can help.</Say><Hangup/>`);
  });
  app.post('/hooks/voice/done', form, async (req, res) => {
    if (!guard(req, res)) return;
    const account = await accountByNumber(req.body.To);
    if (!account) return xml(res);
    const st = String(req.body.DialCallStatus || '');
    if (st === 'completed') {
      const contact = await personByPhone(account, e164(req.body.From) || req.body.From);
      const mins = Math.max(1, Math.round(Number(req.body.DialCallDuration || 0) / 60));
      await record({ account_id: account.id, contact_id: contact.id, channel: 'call', direction: 'in', from: req.body.From, to: account.sms_number, body: `Answered call (${mins} min)`, status: 'answered' });
      return xml(res);
    }
    await missed(account, req.body.From);
    xml(res, '<Say>Sorry we missed you. We’ve just sent you a text so we can help.</Say><Hangup/>');
  });

  // ---------- Inbox API ----------
  api.get('/inbox', async (req, res) => {
    const rows = await db().all(`SELECT c.id, c.first_name, c.last_name, c.email, c.phone, m.channel, m.direction, m.body, m.created_at,
        (SELECT COUNT(*)::int FROM messages u WHERE u.contact_id = c.id AND u.direction = 'in' AND u.read_at IS NULL) AS unread
      FROM contacts c JOIN LATERAL (SELECT * FROM messages x WHERE x.contact_id = c.id ORDER BY x.id DESC LIMIT 1) m ON true
      WHERE c.account_id = ? ORDER BY m.id DESC LIMIT 200`, req.accountId);
    res.json({ conversations: rows, texting: { live: live(), number: (await db().get('SELECT sms_number FROM accounts WHERE id = ?', req.accountId)).sms_number } });
  });
  api.get('/inbox/unread', async (req, res) => {
    res.json({ unread: (await db().get("SELECT COUNT(DISTINCT contact_id)::int AS n FROM messages WHERE account_id = ? AND direction = 'in' AND read_at IS NULL", req.accountId)).n });
  });
  api.get('/inbox/:contactId', async (req, res) => {
    const c = await db().get('SELECT id, first_name, last_name, email, phone, sms_opt_out, sms_consent_at, unsubscribed FROM contacts WHERE id = ? AND account_id = ?', id(req.params.contactId), req.accountId);
    if (!c) throw new HttpError(404, 'Not found');
    const msgs = await db().all('SELECT id, channel, direction, subject, body, status, created_at FROM messages WHERE contact_id = ? ORDER BY id DESC LIMIT 200', c.id);
    await db().run("UPDATE messages SET read_at = now() WHERE contact_id = ? AND direction = 'in' AND read_at IS NULL", c.id);
    res.json({ contact: c, messages: msgs.reverse() });
  });
  api.post('/inbox/:contactId/reply', async (req, res) => {
    const contact = await db().get('SELECT * FROM contacts WHERE id = ? AND account_id = ?', id(req.params.contactId), req.accountId);
    if (!contact) throw new HttpError(404, 'Not found');
    const account = await db().get('SELECT * FROM accounts WHERE id = ?', req.accountId);
    const body = String(req.body?.body || '').trim().slice(0, 5000);
    if (!body) throw new HttpError(400, 'Write a message first');
    if (req.body?.channel === 'sms') {
      if (body.length > 640) throw new HttpError(400, 'Keep texts under 640 characters (about 4 texts)');
      const r = await sendText({ account, contact, body });
      if (r.status === 'skipped') throw new HttpError(409, `Can’t text them: ${r.reason}`);
      if (r.status === 'failed') throw new HttpError(502, `The text didn’t send: ${r.reason}`);
      return res.json({ ok: true, status: r.status });
    }
    if (!contact.email) throw new HttpError(409, 'They don’t have an email address');
    const last = await db().get("SELECT subject FROM messages WHERE contact_id = ? AND channel = 'email' AND subject <> '' ORDER BY id DESC LIMIT 1", contact.id);
    const subject = String(req.body?.subject || '').trim() || (last ? `Re: ${last.subject.replace(/^(re:\s*)+/i, '')}` : `A note from ${account.name}`);
    await messaging.sendTransactional({ account, to: contact.email, contactId: contact.id, subject, text: body, replyTo: inboxAddress(contact) });
    await record({ account_id: account.id, contact_id: contact.id, channel: 'email', direction: 'out', from: account.name, to: contact.email, subject, body, status: 'sent' });
    res.json({ ok: true, status: 'sent' });
  });

  // Texting settings: the workspace's number, where calls ring, the missed-call text,
  // and the business details carriers need to approve texting (10DLC).
  api.put('/account/texting', async (req, res) => {
    const b = req.body || {};
    const num = b.sms_number ? e164(b.sms_number) : '';
    if (b.sms_number && !num) throw new HttpError(400, 'That doesn’t look like a phone number');
    if (num && await db().get('SELECT 1 FROM accounts WHERE sms_number = ? AND id <> ?', num, req.accountId)) throw new HttpError(409, 'That number belongs to another workspace');
    const fwd = b.forward_to ? e164(b.forward_to) : '';
    if (b.forward_to && !fwd) throw new HttpError(400, 'Check the number calls should ring');
    const brand = {};
    for (const k of ['legal_name', 'ein', 'address', 'website', 'contact_name', 'contact_email', 'contact_phone', 'use_case', 'sample'])
      if (b.brand?.[k] !== undefined) brand[k] = String(b.brand[k]).trim().slice(0, 500);
    await db().run('UPDATE accounts SET sms_number = ?, forward_to = ?, missed_call_text = ?, sms_brand = ? WHERE id = ?',
      num, fwd, String(b.missed_call_text ?? '').trim().slice(0, 320), JSON.stringify(brand), req.accountId);
    res.json({ ok: true, sms_number: num, forward_to: fwd });
  });
  api.get('/account/texting', async (req, res) => {
    const a = await db().get('SELECT name, sms_number, forward_to, missed_call_text, sms_brand FROM accounts WHERE id = ?', req.accountId);
    let brand = {}; try { brand = JSON.parse(a.sms_brand || '{}'); } catch { /* empty */ }
    const base = (process.env.PUBLIC_URL || publicBase()).replace(/\/$/, '');
    res.json({ live: live(), sms_number: a.sms_number, forward_to: a.forward_to, missed_call_text: a.missed_call_text, default_text: DEFAULT_TEXT_BACK(a), brand,
      hooks: { sms: `${base}/hooks/sms`, voice: `${base}/hooks/voice` } });
  });

  // ---------- Email replies into the inbox ----------
  // Emails sent from the inbox carry a Reply-To like reply+12-ab34cd@INBOUND_DOMAIN,
  // so the person's reply finds its way back to the right thread.
  const replyToken = (cid) => `${cid}-${crypto.createHmac('sha256', getSecret()).update(`reply:${cid}`).digest('hex').slice(0, 10)}`;
  function inboxAddress(contact) {
    const domain = process.env.INBOUND_DOMAIN;
    return domain ? `reply+${replyToken(contact.id)}@${domain}` : undefined;
  }
  messaging.inboxAddress = inboxAddress;

  // Called from the email webhook for "email.received".
  async function receiveEmail(data, fetchContent = fetchResendEmail) {
    const to = [].concat(data?.to || []).map((a) => String(a).replace(/^.*<|>.*$/g, '').trim().toLowerCase());
    const m = to.map((a) => a.match(/^reply\+(\d+)-([0-9a-f]{10})@/)).find(Boolean);
    if (!m || replyToken(Number(m[1])) !== `${m[1]}-${m[2]}`) return { ignored: 'not a reply address' };
    const contact = await db().get('SELECT * FROM contacts WHERE id = ?', Number(m[1]));
    if (!contact) return { ignored: 'unknown person' };
    if (data.email_id && await db().get('SELECT 1 FROM messages WHERE external_id = ?', `email:${data.email_id}`)) return { duplicate: true };
    const full = data.email_id ? await fetchContent(data.email_id).catch((e) => { console.error('inbound fetch:', e.message); return null; }) : null;
    const text = stripQuoted(full?.text || htmlToText(full?.html || '') || data.text || '');
    const account = await db().get('SELECT * FROM accounts WHERE id = ?', contact.account_id);
    await record({ account_id: account.id, contact_id: contact.id, channel: 'email', direction: 'in', from: String(data.from || ''), to: to[0], subject: String(data.subject || ''), body: text || '(no text)', status: 'received', external_id: data.email_id ? `email:${data.email_id}` : null });
    await tellOwner(account, contact, `“${text.slice(0, 300)}”`, 'email');
    return { ok: true, contact_id: contact.id };
  }

  // Inquiry forms also start a conversation.
  async function noteInquiry(accountId, contactId, text) {
    if (!String(text || '').trim()) return;
    await record({ account_id: accountId, contact_id: contactId, channel: 'form', direction: 'in', body: String(text).trim(), status: 'received' });
  }

  return { sendText, receiveEmail, noteInquiry, inboxAddress };
}

async function fetchResendEmail(emailId) {
  const key = process.env.RESEND_API_KEY || (/resend/.test(process.env.SMTP_HOST || '') ? process.env.SMTP_PASS : '');
  if (!key) throw new Error('No Resend API key');
  const res = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`Resend ${res.status}`);
  return res.json();
}
const htmlToText = (h) => String(h).replace(/<(br|\/p|\/div)[^>]*>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
// Keep only what they wrote, not the quoted email below it.
function stripQuoted(t) {
  const lines = String(t).replace(/\r/g, '').split('\n');
  const cut = lines.findIndex((l) => /^On .+wrote:\s*$/.test(l.trim()) || /^-{2,}\s*Original Message/i.test(l.trim()) || /^>/.test(l) || /^From: .+/.test(l.trim()));
  return (cut > 0 ? lines.slice(0, cut) : lines).join('\n').trim().slice(0, 20000);
}

module.exports = { registerTexting, e164, twilioSignature, quietUntil, stripQuoted };
