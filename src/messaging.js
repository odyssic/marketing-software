// Sending email to a person, with open and click tracking. Used by
// workflows, campaigns and broadcasts so every send behaves the same:
// merge fields, skip unsubscribed people, an unsubscribe link, an Outbox
// record, and open/click events that feed the lever metrics.
const crypto = require('node:crypto');
const mailer = require('./mailer');

const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

// {{first_name}}, {{first_name|there}} (with a fallback), {{last_name}}, {{email}}, {{business}}.
function merge(text, person, account) {
  const values = { first_name: person.first_name, last_name: person.last_name, email: person.email, business: account?.name, name: [person.first_name, person.last_name].filter(Boolean).join(' ') };
  return String(text || '').replace(/\{\{\s*(\w+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g, (m, k, fallback) => (k in values ? values[k] || fallback || '' : m));
}

function createMessaging({ getDb, getSecret, publicBase, logEvent }) {
  const sign = (emailId) => `${emailId}.${crypto.createHmac('sha256', getSecret()).update(`email:${emailId}`).digest('hex').slice(0, 16)}`;
  const verify = (token) => {
    const [idPart] = String(token).split('.');
    if (!/^\d{1,9}$/.test(idPart)) return null;
    const expected = sign(Number(idPart));
    return token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected)) ? Number(idPart) : null;
  };
  const unsubToken = (contactId) => `${contactId}.${crypto.createHmac('sha256', getSecret()).update(`unsub:${contactId}`).digest('hex').slice(0, 24)}`;
  // The business's name on the verified sending address; replies go to the owner.
  const fromFor = (account) => mailer.senderFor({ name: account.from_name || account.name, replyTo: account.from_email });

  // Plain text in, plain text + simple HTML out. Links are rewritten through
  // the click tracker; a 1px image records opens.
  function toHtml(text, token, base, preheader = '') {
    const linked = escHtml(text).replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, (url) => {
      const raw = url.replace(/&amp;/g, '&');
      return `<a href="${base}/t/c/${token}?u=${encodeURIComponent(raw)}">${url}</a>`;
    });
    const paras = linked.split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, '<br>')}</p>`).join('');
    const pre = preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escHtml(preheader)}</div>` : '';
    return `<!doctype html><html><body style="font:16px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;color:#111827;max-width:580px;margin:0 auto;padding:24px">${pre}${paras}<img src="${base}/t/o/${token}.gif" width="1" height="1" alt="" style="display:block;border:0"></body></html>`;
  }

  // Sends one email to one person. Never throws for a bad address or an
  // unsubscribed person; returns { status: 'sent' | 'logged' | 'skipped' | 'failed', reason }.
  async function sendToPerson({ account, person, subject, body, preheader = '', workflowId = null, campaignId = null, broadcastId = null }) {
    if (!person.email) return { status: 'skipped', reason: 'no email address' };
    if (person.unsubscribed) return { status: 'skipped', reason: 'unsubscribed' };
    const db = getDb();
    const base = publicBase();
    const subj = merge(subject, person, account);
    const unsub = `${base}/unsubscribe/${unsubToken(person.id)}`;
    const text = `${merge(body, person, account)}\n\n--\nUnsubscribe: ${unsub}`;
    const row = await db.get(`INSERT INTO email_log (account_id, broadcast_id, contact_id, to_email, subject, body, status, workflow_id, campaign_id)
      VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?) RETURNING id`, account.id, broadcastId, person.id, person.email, subj, text, workflowId, campaignId);
    const html = toHtml(text, sign(row.id), base, merge(preheader, person, account));
    try {
      // One-click unsubscribe headers (required by Gmail and Yahoo for bulk senders).
      const headers = { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
      const r = await mailer.sendEmail({ ...fromFor(account), to: person.email, subject: subj, text, html, headers });
      await db.run('UPDATE email_log SET status = ? WHERE id = ?', r.status, row.id);
      return { status: r.status, emailId: row.id };
    } catch (e) {
      await db.run("UPDATE email_log SET status = 'failed', error = ? WHERE id = ?", e.message, row.id);
      return { status: 'failed', reason: e.message, emailId: row.id };
    }
  }

  // A test copy for the owner: real sender and layout, sample merge values,
  // "[Test]" in the subject, and no tracking, so it never counts in results.
  async function sendTest({ account, to, name, subject, body, preheader = '' }) {
    const [first, ...rest] = String(name || '').split(' ');
    const person = { first_name: first, last_name: rest.join(' '), email: to };
    const subj = `[Test] ${merge(subject, person, account)}`;
    const text = `${merge(body, person, account)}\n\n--\nUnsubscribe: (your readers get a working link here)`;
    const base = publicBase();
    const html = toHtml(text, 'test', base, merge(preheader, person, account)).replace(/<img src="[^"]*\/t\/o\/[^"]*"[^>]*>/, '').replace(/href="[^"]*\/t\/c\/test\?u=([^"]*)"/g, (_, u) => `href="${decodeURIComponent(u)}"`);
    const r = await mailer.sendEmail({ ...fromFor(account), to, subject: subj, text, html });
    await getDb().run('INSERT INTO email_log (account_id, to_email, subject, body, status) VALUES (?, ?, ?, ?, ?)', account.id, to, subj, text, r.status);
    return r;
  }

  // A note to the business owner (e.g. "follow up personally with Ann").
  async function sendToOwner({ account, subject, body, html }) {
    const to = account.from_email || (await getDb().get(`SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.account_id = ? ORDER BY m.user_id LIMIT 1`, account.id))?.email;
    if (!to) return { status: 'skipped', reason: 'no owner email' };
    const r = await mailer.sendEmail({ ...mailer.senderFor({ name: 'Rilly' }), to, subject, text: body, ...(html ? { html } : {}) });
    await getDb().run(`INSERT INTO email_log (account_id, to_email, subject, body, status) VALUES (?, ?, ?, ?, ?)`, account.id, to, subject, body, r.status);
    return r;
  }

  async function track(emailId, kind) {
    const db = getDb();
    const col = kind === 'open' ? 'opened_at' : 'clicked_at';
    const e = await db.get(`UPDATE email_log SET ${col} = now()${kind === 'click' ? ', opened_at = COALESCE(opened_at, now())' : ''}
      WHERE id = ? AND ${col} IS NULL RETURNING *`, emailId);
    if (e?.contact_id) {
      await logEvent(db, e.account_id, {
        person_id: e.contact_id, type: kind, source: 'email', campaign_id: e.campaign_id,
        meta: { subject: e.subject, workflow_id: e.workflow_id, campaign_id: e.campaign_id },
      });
    }
  }

  function registerTracking(app) {
    app.get('/t/o/:token', async (req, res) => {
      const emailId = verify(String(req.params.token).replace(/\.gif$/, ''));
      if (emailId) await track(emailId, 'open').catch((e) => console.error('open tracking:', e.message));
      res.set('Cache-Control', 'no-store').type('gif').send(GIF);
    });
    // Only redirects to a link that is actually in that signed email, so the
    // tracker can't be used to bounce people to arbitrary sites.
    app.get('/t/c/:token', async (req, res) => {
      const url = String(req.query.u || '');
      const emailId = verify(req.params.token);
      const email = emailId && /^https?:\/\//i.test(url) && await getDb().get('SELECT body FROM email_log WHERE id = ?', emailId);
      if (!email || !email.body.includes(url)) return res.status(400).type('text').send('This link is no longer valid.');
      await track(emailId, 'click').catch((e) => console.error('click tracking:', e.message));
      res.redirect(302, url);
    });
  }

  return { sendToPerson, sendTest, sendToOwner, registerTracking, merge, unsubToken, sign, verify };
}

module.exports = { createMessaging, merge };
