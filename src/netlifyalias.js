// Connecting a customer's domain to the host (Netlify) so it serves Rilly with HTTPS.
// With NETLIFY_AUTH_TOKEN (a personal access token) and the site's id, Rilly adds and
// removes the domain itself; without them, the owner adds it once in Netlify by hand.
const API = 'https://api.netlify.com/api/v1';
const token = () => process.env.NETLIFY_AUTH_TOKEN || '';
const siteId = () => process.env.NETLIFY_SITE_ID || process.env.SITE_ID || '';
const ready = () => Boolean(token() && siteId());

async function call(method, body) {
  const res = await fetch(`${API}/sites/${encodeURIComponent(siteId())}`, { method, headers: { Authorization: `Bearer ${token()}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`Netlify ${res.status}`);
  return res.json();
}
async function change(hosts, add) {
  if (!ready()) return false;
  const site = await call('GET');
  const now = new Set(site.domain_aliases || []);
  for (const h of hosts) if (h !== site.custom_domain) { if (add) now.add(h); else now.delete(h); }
  await call('PATCH', { domain_aliases: [...now] });
  return true;
}

module.exports = { ready, addAlias: (hosts) => change(hosts, true), removeAlias: (hosts) => change(hosts, false) };
