// Send email from the business's own domain (hello@theirbusiness.com) instead
// of Rilly's address. The domain is added to Rilly's Resend account; the owner
// adds a few DNS records, Rilly checks them, and once verified their emails go
// out from it. Needs RESEND_API_KEY (or Resend SMTP, whose password is the key).
const API = () => process.env.RESEND_API_BASE || 'https://api.resend.com';
const key = () => process.env.RESEND_API_KEY || (/resend/.test(process.env.SMTP_HOST || '') ? process.env.SMTP_PASS : '') || '';
const DOMAIN_RE = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const LOCAL_RE = /^[a-z0-9][a-z0-9._+-]{0,40}$/i;

async function resend(method, path, body) {
  const res = await fetch(`${API()}${path}`, { method, headers: { Authorization: `Bearer ${key()}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || `Email provider error ${res.status}`), { status: res.status });
  return data;
}

function registerDomains(api, { getDb, HttpError }) {
  const db = () => getDb();
  const out = (a, records = []) => ({
    available: Boolean(key()), domain: a.send_domain || '', local: a.send_local || 'hello', status: a.send_domain_status || '',
    address: a.send_domain ? `${a.send_local || 'hello'}@${a.send_domain}` : '', records,
  });
  const recordsOf = (d) => (d.records || []).map((r) => ({ type: r.type, name: r.name, value: r.value, priority: r.priority ?? null, ttl: r.ttl || 'Auto', status: r.status || '' }));
  const get = (accountId) => db().get('SELECT send_domain, send_local, send_domain_id, send_domain_status FROM accounts WHERE id = ?', accountId);

  // Current domain, with its DNS records and a fresh status from the provider.
  api.get('/account/sending-domain', async (req, res) => {
    const a = await get(req.accountId);
    if (!a.send_domain_id || !key()) return res.json(out(a));
    try {
      const d = await resend('GET', `/domains/${encodeURIComponent(a.send_domain_id)}`);
      if (d.status && d.status !== a.send_domain_status) {
        await db().run('UPDATE accounts SET send_domain_status = ? WHERE id = ?', d.status, req.accountId);
        a.send_domain_status = d.status;
      }
      res.json(out(a, recordsOf(d)));
    } catch { res.json(out(a)); }
  });

  api.post('/account/sending-domain', async (req, res) => {
    if (!key()) throw new HttpError(400, 'Sending from your own domain isn’t available yet');
    const domain = String(req.body?.domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
    const local = String(req.body?.local || 'hello').trim().toLowerCase();
    if (!DOMAIN_RE.test(domain)) throw new HttpError(400, 'Enter a domain like yourbusiness.com');
    if (/(^|\.)(gmail|yahoo|hotmail|outlook|icloud|aol|proton)\.[a-z.]+$/.test(domain)) throw new HttpError(400, 'Use a domain you own, not a free email service. Without one, Rilly sends from its own address and replies still come to you.');
    if (!LOCAL_RE.test(local)) throw new HttpError(400, 'The part before @ can use letters, numbers, dots and dashes');
    const a = await get(req.accountId);
    if (a.send_domain_id && a.send_domain !== domain) await resend('DELETE', `/domains/${encodeURIComponent(a.send_domain_id)}`).catch(() => {});
    let d;
    if (a.send_domain === domain && a.send_domain_id) d = await resend('GET', `/domains/${encodeURIComponent(a.send_domain_id)}`);
    else {
      try { d = await resend('POST', '/domains', { name: domain }); } catch (e) {
        throw new HttpError(400, /already/i.test(e.message) ? 'That domain is already set up in Rilly for another business. Contact support to move it.' : e.message);
      }
    }
    await db().run('UPDATE accounts SET send_domain = ?, send_local = ?, send_domain_id = ?, send_domain_status = ? WHERE id = ?',
      domain, local, d.id, d.status || 'not_started', req.accountId);
    res.json(out({ send_domain: domain, send_local: local, send_domain_status: d.status || 'not_started' }, recordsOf(d)));
  });

  // "I've added the records": ask the provider to check now.
  api.post('/account/sending-domain/verify', async (req, res) => {
    const a = await get(req.accountId);
    if (!a.send_domain_id) throw new HttpError(400, 'Add a domain first');
    await resend('POST', `/domains/${encodeURIComponent(a.send_domain_id)}/verify`).catch(() => {});
    const d = await resend('GET', `/domains/${encodeURIComponent(a.send_domain_id)}`);
    await db().run('UPDATE accounts SET send_domain_status = ? WHERE id = ?', d.status, req.accountId);
    res.json(out({ ...a, send_domain_status: d.status }, recordsOf(d)));
  });

  api.delete('/account/sending-domain', async (req, res) => {
    const a = await get(req.accountId);
    if (a.send_domain_id) await resend('DELETE', `/domains/${encodeURIComponent(a.send_domain_id)}`).catch(() => {});
    await db().run("UPDATE accounts SET send_domain = '', send_domain_id = '', send_domain_status = '' WHERE id = ?", req.accountId);
    res.json({ ok: true });
  });
}

// The From address for a business: its own once verified, otherwise Rilly's.
const ownAddress = (account) => (account?.send_domain && account.send_domain_status === 'verified' ? `${account.send_local || 'hello'}@${account.send_domain}` : null);

module.exports = { registerDomains, ownAddress };
