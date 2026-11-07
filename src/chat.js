// Website chat: a small chat bubble for the business's pages (and any other
// website, with one line of code). Visitors leave their name and email first,
// so a conversation never gets lost: it lands in the Inbox like texts and
// emails, and if they've left the page when you reply, the reply goes by email.
'use strict';
const crypto = require('node:crypto');
const express = require('express');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_GREETING = 'Hi! Ask us anything. We usually reply within a few hours.';

function registerChat(app, api, { getDb, HttpError, id, upsertContact, logEvent, messaging, publicBase, getSecret }) {
  const db = () => getDb();
  const base = () => (process.env.PUBLIC_URL || publicBase()).replace(/\/$/, '');
  const sign = (acct, cid) => crypto.createHmac('sha256', getSecret()).update(`chat:${acct}:${cid}`).digest('hex').slice(0, 20);
  const tokenFor = (acct, cid) => `${cid}.${sign(acct, cid)}`;
  const fromToken = (acct, token) => {
    const [cid, s] = String(token || '').split('.');
    if (!/^\d{1,10}$/.test(cid || '') || !s || s.length !== 20) return null;
    return crypto.timingSafeEqual(Buffer.from(s), Buffer.from(sign(acct, cid))) ? Number(cid) : null;
  };

  // Any website can talk to the chat: no cookies, a signed visitor token instead.
  const cors = (req, res, next) => {
    res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type', 'Cache-Control': 'no-store' });
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  };
  app.use('/chat', cors);
  const json = express.json({ limit: '16kb' });

  // A simple limit per address so the chat can't be used to flood an inbox.
  const hits = new Map();
  const limited = (req) => {
    const k = `${req.ip}:${req.params.acct}`, now = Date.now();
    const h = (hits.get(k) || []).filter((t) => now - t < 10 * 60e3);
    h.push(now); hits.set(k, h);
    if (hits.size > 5000) hits.clear();
    return h.length > 30;
  };
  const account = async (acct) => {
    const a = await db().get('SELECT id, name, chat_on, chat_greeting, brand_color FROM accounts WHERE id = ?', id(acct));
    if (!a || !a.chat_on) throw new HttpError(404, 'Chat is off');
    return a;
  };
  const visitorMessages = async (cid, after = 0) => (await db().all(`SELECT id, direction, body, created_at FROM messages
    WHERE contact_id = ? AND channel = 'chat' AND id > ? ORDER BY id LIMIT 100`, cid, Number(after) || 0));

  async function headsUp(a, contact, text) {
    // One email per conversation every 30 minutes; the Inbox has the rest.
    const recent = await db().get(`SELECT 1 FROM messages WHERE contact_id = ? AND channel = 'chat' AND direction = 'in' AND created_at > now() - interval '30 minutes'
      AND id <> (SELECT MAX(id) FROM messages WHERE contact_id = ?)`, contact.id, contact.id);
    if (recent) return;
    const acct = await db().get('SELECT * FROM accounts WHERE id = ?', a.id);
    const who = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.email;
    await messaging.sendToOwner({ account: acct, subject: `Website chat from ${who}`,
      body: `“${text.slice(0, 400)}”\n\nReply from your inbox: ${base()}/#/inbox/${contact.id}` }).catch((e) => console.error('chat heads-up:', e.message));
  }
  const add = (a, cid, direction, body) => db().get(`INSERT INTO messages (account_id, contact_id, channel, direction, body, status, read_at)
    VALUES (?, ?, 'chat', ?, ?, 'sent', ?) RETURNING id`, a.id, cid, direction, body, direction === 'out' ? new Date().toISOString() : null);

  app.get('/chat/:acct/config', async (req, res) => {
    const a = await account(req.params.acct).catch(() => null);
    if (!a) return res.json({ on: false });
    res.json({ on: true, name: a.name, greeting: a.chat_greeting || DEFAULT_GREETING, color: /^#[0-9a-f]{6}$/i.test(a.brand_color || '') ? a.brand_color : '#0f766e' });
  });
  app.post('/chat/:acct/start', json, async (req, res) => {
    if (limited(req)) throw new HttpError(429, 'Please wait a few minutes');
    const a = await account(req.params.acct);
    const b = req.body || {};
    const email = String(b.email || '').trim().toLowerCase().slice(0, 200), name = String(b.name || '').trim().slice(0, 80);
    const text = String(b.message || '').trim().slice(0, 2000);
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Add your email so we can reply');
    if (!text) throw new HttpError(400, 'Write a message');
    const [first, ...rest] = name.split(/\s+/);
    const { id: cid } = await upsertContact(db(), a.id, { email, first_name: first || '', last_name: rest.join(' '), source: 'other', entry: 'Website chat' });
    const contact = await db().get('SELECT * FROM contacts WHERE id = ?', cid);
    if (!contact.first_name && first) await db().run('UPDATE contacts SET first_name = ?, last_name = ? WHERE id = ?', first, rest.join(' '), cid);
    await db().run('UPDATE contacts SET chat_seen_at = now() WHERE id = ?', cid);
    await add(a, cid, 'in', text);
    await logEvent(db(), a.id, { person_id: cid, type: 'inquiry', source: 'other', meta: { note: text.slice(0, 500), via: 'chat', page: String(b.page || '').slice(0, 300) } });
    await headsUp(a, { ...contact, first_name: contact.first_name || first }, text);
    res.json({ token: tokenFor(a.id, cid), messages: await visitorMessages(cid) });
  });
  app.post('/chat/:acct/send', json, async (req, res) => {
    if (limited(req)) throw new HttpError(429, 'Please wait a few minutes');
    const a = await account(req.params.acct);
    const cid = fromToken(a.id, req.body?.token);
    if (!cid) throw new HttpError(401, 'Start a new chat');
    const text = String(req.body?.message || '').trim().slice(0, 2000);
    if (!text) throw new HttpError(400, 'Write a message');
    const contact = await db().get('SELECT * FROM contacts WHERE id = ? AND account_id = ?', cid, a.id);
    if (!contact) throw new HttpError(401, 'Start a new chat');
    await db().run('UPDATE contacts SET chat_seen_at = now() WHERE id = ?', cid);
    await add(a, cid, 'in', text);
    await headsUp(a, contact, text);
    res.json({ messages: await visitorMessages(cid, req.body?.after) });
  });
  // The widget checks for replies every few seconds while it's open.
  app.get('/chat/:acct/poll', async (req, res) => {
    const a = await account(req.params.acct);
    const cid = fromToken(a.id, req.query.token);
    if (!cid) throw new HttpError(401, 'Start a new chat');
    await db().run('UPDATE contacts SET chat_seen_at = now() WHERE id = ? AND account_id = ?', cid, a.id);
    res.json({ messages: await visitorMessages(cid, req.query.after) });
  });

  // Replying from the Inbox: shows in their chat; if they've left, it's emailed too.
  messaging.sendChat = async ({ account: acct, contact, body, inboxAddress }) => {
    await add(acct, contact.id, 'out', body);
    const fresh = await db().get("SELECT chat_seen_at > now() - interval '2 minutes' AS here FROM contacts WHERE id = ?", contact.id);
    if (fresh?.here || !contact.email || contact.unsubscribed) return { status: 'sent', emailed: false };
    await messaging.sendTransactional({ account: acct, to: contact.email, contactId: contact.id, subject: `${acct.name} replied to your message`,
      text: `${body}\n\nJust reply to this email to continue.`, replyTo: inboxAddress?.(contact) });
    return { status: 'sent', emailed: true };
  };

  // Settings.
  api.get('/account/chat', async (req, res) => {
    const a = await db().get('SELECT chat_on, chat_greeting FROM accounts WHERE id = ?', req.accountId);
    res.json({ on: Boolean(a.chat_on), greeting: a.chat_greeting || '', default_greeting: DEFAULT_GREETING,
      snippet: `<script src="${base()}/chat.js" data-rilly-chat="${req.accountId}" defer></script>` });
  });
  api.put('/account/chat', async (req, res) => {
    await db().run('UPDATE accounts SET chat_on = ?, chat_greeting = ? WHERE id = ?', req.body?.on ? 1 : 0, String(req.body?.greeting || '').trim().slice(0, 300), req.accountId);
    res.json({ ok: true });
  });

  // The script tag for the business's own Rilly pages, when chat is on.
  const tagFor = (acct) => `<script src="${base()}/chat.js" data-rilly-chat="${acct.id}" defer></script>`;
  return { tagFor };
}

module.exports = { registerChat, DEFAULT_GREETING };
