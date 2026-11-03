// Account-wide things: every page in one place (whoever built it), the one
// domain the account connects, and testimonials as real records.
const HOST_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

function registerLibrary(api, { getDb, HttpError, id, ownHost, clearDomainCache }) {
  const db = () => getDb();

  // ---------- One place for pages ----------
  api.get('/pages', async (req, res) => {
    const account = await db().get('SELECT domain, home_funnel_id FROM accounts WHERE id = ?', req.accountId);
    const rows = await db().all(`SELECT s.id, s.name, s.slug, s.position, s.updated_at, s.variant_blocks IS NOT NULL AS testing,
        f.id AS funnel_id, f.name AS funnel_name, f.slug AS funnel_slug, f.kind, f.status, f.entry_step_id,
        (SELECT COUNT(*)::int FROM page_events e WHERE e.step_id = s.id AND e.type = 'view' AND e.created_at > now() - interval '30 days') AS views,
        (SELECT COUNT(*)::int FROM page_events e WHERE e.step_id = s.id AND e.type IN ('optin', 'sale') AND e.created_at > now() - interval '30 days') AS leads
      FROM funnel_steps s JOIN funnels f ON f.id = s.funnel_id WHERE f.account_id = ? ORDER BY s.updated_at DESC, s.id DESC`, req.accountId);
    res.json(rows.map((r) => {
      const home = account.home_funnel_id === r.funnel_id;
      const path = account.domain ? `${home ? '' : `/${r.funnel_slug}`}${r.id === r.entry_step_id ? '' : `/${r.slug}`}` || '/' : null;
      return { ...r, testing: Boolean(r.testing), address: account.domain ? `https://${account.domain}${path}` : `/f/${r.funnel_slug}${r.id === r.entry_step_id ? '' : `/${r.slug}`}` };
    }));
  });

  // Funnels and websites as groups, each with its pages in the order visitors
  // move through them (start page, then each "Yes / Next"), plus 30-day numbers.
  api.get('/page-groups', async (req, res) => {
    const funnels = await db().all(`SELECT f.id, f.name, f.slug, f.kind, f.status, f.entry_step_id, f.created_at,
        (SELECT COUNT(*)::int FROM workflows w WHERE w.funnel_id = f.id) AS followups
      FROM funnels f WHERE f.account_id = ? ORDER BY f.id DESC`, req.accountId);
    const steps = await db().all(`SELECT s.id, s.funnel_id, s.name, s.slug, s.position, s.blocks, s.settings, s.next_step_id, s.no_step_id,
        s.variant_blocks IS NOT NULL AS testing,
        (SELECT COUNT(*)::int FROM page_events e WHERE e.step_id = s.id AND e.type = 'view' AND e.created_at > now() - interval '30 days') AS views,
        (SELECT COUNT(*)::int FROM page_events e WHERE e.step_id = s.id AND e.type IN ('optin', 'sale') AND e.created_at > now() - interval '30 days') AS leads
      FROM funnel_steps s JOIN funnels f ON f.id = s.funnel_id WHERE f.account_id = ? ORDER BY s.position, s.id`, req.accountId);
    const parse = (v) => (typeof v === 'string' ? JSON.parse(v || 'null') : v);
    res.json(funnels.map((f) => {
      const mine = steps.filter((s) => s.funnel_id === f.id).map((s) => ({ ...s, blocks: parse(s.blocks) || [], settings: parse(s.settings) || {}, testing: Boolean(s.testing) }));
      const byId = Object.fromEntries(mine.map((s) => [s.id, s]));
      const order = [], seen = new Set();
      // Websites keep menu order; funnels follow the path from the start page.
      for (let s = f.kind === 'website' ? null : byId[f.entry_step_id]; s && !seen.has(s.id); s = byId[s.next_step_id]) { order.push(s); seen.add(s.id); }
      for (const s of mine) if (!seen.has(s.id)) order.push(s);
      const views = order[0]?.views || 0, leads = order.reduce((n, s) => n + s.leads, 0);
      return { ...f, pages: order, views, leads, rate: views ? Math.round((leads / views) * 1000) / 10 : null };
    }));
  });

  // ---------- One domain for the whole account ----------
  api.put('/account/domain', async (req, res) => {
    let domain = String(req.body?.domain ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '') || null;
    if (domain && !HOST_RE.test(domain)) throw new HttpError(400, 'Enter a domain like www.yourbusiness.com');
    if (domain && ownHost(domain)) throw new HttpError(400, 'That’s the app’s own address; use a domain of your own');
    if (domain && await db().get('SELECT 1 FROM accounts WHERE domain = ? AND id <> ?', domain, req.accountId)) throw new HttpError(409, 'Another business already uses that domain');
    let home = req.body?.home_funnel_id === undefined ? undefined : req.body.home_funnel_id ? id(req.body.home_funnel_id) : null;
    if (home) {
      const f = await db().get('SELECT id FROM funnels WHERE id = ? AND account_id = ?', home, req.accountId);
      if (!f) throw new HttpError(400, 'Pick one of your websites or funnels as the home page');
    }
    if (req.body?.domain === undefined) domain = (await db().get('SELECT domain FROM accounts WHERE id = ?', req.accountId)).domain;
    await db().run(`UPDATE accounts SET domain = ?${home !== undefined ? ', home_funnel_id = ?' : ''} WHERE id = ?`, ...[domain, ...(home !== undefined ? [home] : []), req.accountId]);
    clearDomainCache();
    res.json({ ok: true, domain });
  });

  // ---------- Testimonials: real records only ----------
  const out = (t) => ({ ...t, approved: Boolean(t.approved) });
  api.get('/testimonials', async (req, res) => {
    res.json((await db().all(`SELECT t.*, TRIM(c.first_name || ' ' || c.last_name) AS person_name FROM testimonials t
      LEFT JOIN contacts c ON c.id = t.person_id WHERE t.account_id = ? ORDER BY t.approved, t.id DESC`, req.accountId)).map(out));
  });
  // Entered by the owner: from a real customer, who agreed to share it.
  api.post('/testimonials', async (req, res) => {
    const b = req.body || {};
    const quote = String(b.quote || '').trim().slice(0, 1000);
    if (!quote) throw new HttpError(400, 'Paste what the customer said');
    if (!b.consent) throw new HttpError(400, 'Confirm these are a real customer’s words and they agreed to share them');
    let personId = null, name = String(b.name || '').trim().slice(0, 80);
    if (b.person_id) {
      const p = await db().get('SELECT id, first_name, last_name FROM contacts WHERE id = ? AND account_id = ?', id(b.person_id), req.accountId);
      if (!p) throw new HttpError(400, 'Person not found');
      personId = p.id;
      name ||= [p.first_name, p.last_name ? `${p.last_name[0]}.` : ''].filter(Boolean).join(' ');
    }
    if (!name) throw new HttpError(400, 'Add the customer’s name as it should appear');
    const r = await db().get(`INSERT INTO testimonials (account_id, person_id, quote, name, detail, source, approved)
      VALUES (?, ?, ?, ?, ?, ?, 1) RETURNING *`, req.accountId, personId, quote, name, String(b.detail || '').trim().slice(0, 80), String(b.source || 'manual').slice(0, 40));
    res.status(201).json(out(r));
  });
  api.put('/testimonials/:id', async (req, res) => {
    const r = await db().get('UPDATE testimonials SET approved = ? WHERE id = ? AND account_id = ? RETURNING *', req.body?.approved ? 1 : 0, id(req.params.id), req.accountId);
    if (!r) throw new HttpError(404, 'Testimonial not found');
    res.json(out(r));
  });
  api.delete('/testimonials/:id', async (req, res) => {
    await db().run('DELETE FROM testimonials WHERE id = ? AND account_id = ?', id(req.params.id), req.accountId);
    res.json({ ok: true });
  });
}

// Approved testimonials for rendering, keyed by id.
async function approvedTestimonials(db, accountId) {
  return Object.fromEntries((await db.all('SELECT id, quote, name, detail FROM testimonials WHERE account_id = ? AND approved = 1', accountId)).map((t) => [t.id, t]));
}

module.exports = { registerLibrary, approvedTestimonials, HOST_RE };
