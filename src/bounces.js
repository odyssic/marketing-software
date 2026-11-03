// Bounces and spam complaints from the email provider (Resend, signed the
// Svix way). A bounced address stops getting email everywhere in the app; a
// spam complaint unsubscribes the person from the business that emailed them.
// Protecting the sender reputation matters more than any single send.
const crypto = require('node:crypto');
const express = require('express');

// Svix signature: HMAC-SHA256 over "id.timestamp.body" with the base64 secret
// after "whsec_"; the header holds one or more "v1,<base64>" signatures.
function verifySvix({ secret, id, timestamp, signature, body, now = Date.now() }) {
  if (!secret || !id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 5 * 60) return false; // replay window
  let key;
  try { key = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64'); } catch { return false; }
  const expected = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest();
  return String(signature).split(' ').some((part) => {
    const [ver, sig] = part.split(',');
    if (ver !== 'v1' || !sig) return false;
    const got = Buffer.from(sig, 'base64');
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  });
}

function registerBounces(app, { getDb, logEvent, onReceived }) {
  app.post('/hooks/email', express.raw({ type: () => true, limit: '256kb' }), async (req, res) => {
    const secret = process.env.EMAIL_WEBHOOK_SECRET;
    if (!secret) return res.status(503).json({ error: 'Email webhook is not set up (EMAIL_WEBHOOK_SECRET)' });
    const body = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    const ok = verifySvix({ secret, id: req.get('svix-id'), timestamp: req.get('svix-timestamp'), signature: req.get('svix-signature'), body });
    if (!ok) return res.status(401).json({ error: 'Bad signature' });
    let evt;
    try { evt = JSON.parse(body); } catch { return res.status(400).json({ error: 'Bad JSON' }); }
    if (evt.type === 'email.received' && onReceived) return res.json(await onReceived(evt.data || {}));
    const kind = evt.type === 'email.bounced' ? 'bounced' : evt.type === 'email.complained' ? 'complained' : null;
    if (!kind) return res.json({ ignored: evt.type || 'unknown' });

    const db = getDb();
    const addresses = [].concat(evt.data?.to || []).map((a) => String(a).replace(/^.*<|>.*$/g, '').trim().toLowerCase()).filter(Boolean);
    let stopped = 0;
    for (const email of addresses.slice(0, 50)) {
      // Complaints: only the business that last emailed them. Bounces: everywhere.
      const last = kind === 'complained' && await db.get('SELECT account_id FROM email_log WHERE lower(to_email) = ? ORDER BY id DESC LIMIT 1', email);
      const rows = kind === 'complained'
        ? (last ? await db.all('UPDATE contacts SET unsubscribed = 1 WHERE lower(email) = ? AND account_id = ? AND unsubscribed = 0 RETURNING id, account_id', email, last.account_id) : [])
        : await db.all('UPDATE contacts SET unsubscribed = 1 WHERE lower(email) = ? AND unsubscribed = 0 RETURNING id, account_id', email);
      for (const c of rows) {
        await logEvent(db, c.account_id, { person_id: c.id, type: 'unsubscribe', source: 'email', meta: { reason: kind === 'bounced' ? 'Email bounced' : 'Marked as spam' } });
        stopped++;
      }
    }
    res.json({ ok: true, kind, stopped });
  });
}

module.exports = { registerBounces, verifySvix };
