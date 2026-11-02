// Funnel builder extras: pre-flight checks before publishing, draft/live
// state, version history with one-click restore, the growth lever of each
// page, and plain-language step metrics with the leakiest step flagged.
const { formatMoney } = require('./render');

const LEVER_OF_PAGE = (s) => {
  const blocks = JSON.parse(typeof s.blocks === 'string' ? s.blocks : JSON.stringify(s.blocks || []));
  const settings = typeof s.settings === 'string' ? JSON.parse(s.settings) : s.settings || {};
  if (['lead', 'conversion', 'upsell', 'continuity'].includes(settings.lever)) return settings.lever;
  const hasPricing = blocks.some((b) => b.type === 'pricing');
  const hasNo = blocks.some((b) => b.type === 'button' && b.url === '#no');
  if (hasPricing && hasNo) return 'upsell';
  if (hasPricing) return 'conversion';
  const form = blocks.find((b) => b.type === 'form');
  if (form && String(form.purpose || '').toLowerCase() === 'newsletter') return 'continuity';
  if (form) return 'lead';
  return 'continuity';
};

const YT = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|embed\/|shorts\/)|youtu\.be\/)[\w-]{6,}/i;

// Plain-language problems. "block" stops publishing; "warn" doesn't.
function preflight({ funnel, steps, products, account }) {
  const out = [];
  const add = (severity, step, text, fix) => out.push({ severity, step_id: step?.id ?? null, step_name: step?.name ?? '', text, fix });
  const edit = (s) => ({ label: 'Edit page', href: `#/editor/${s.id}` });
  const map = { label: 'Open the map', href: `#/funnels/${funnel.id}` };
  if (!steps.length) add('block', null, 'This funnel has no pages yet.', map);
  for (const s of steps) {
    const blocks = typeof s.blocks === 'string' ? JSON.parse(s.blocks) : s.blocks;
    if (!blocks.length) add('block', s, `“${s.name}” is empty.`, edit(s));
    for (const b of blocks) {
      if (b.type === 'pricing') {
        if (!b.productId || !products[b.productId]) add('block', s, `A buy button on “${s.name}” has no product.`, edit(s));
        if (b.bumpProductId && !products[b.bumpProductId]) add('block', s, `The order bump on “${s.name}” points to a product that no longer exists.`, edit(s));
      }
      if (b.type === 'button') {
        const url = String(b.url || '');
        if (url === '#next' && !s.next_step_id) add('block', s, `The “${b.label || 'button'}” button on “${s.name}” leads nowhere. Connect its ✓ exit to a page.`, map);
        else if (url === '#no' && !s.no_step_id) add('block', s, `The “${b.label || 'button'}” button on “${s.name}” leads nowhere. Connect its ✕ exit to a page.`, map);
        else if (!url.startsWith('#') && !/^https?:\/\/\S+\.\S+/i.test(url)) add('block', s, `The “${b.label || 'button'}” button on “${s.name}” has a broken link.`, edit(s));
        if (String(b.label || '').length > 40) add('warn', s, `The “${String(b.label).slice(0, 30)}…” button text is long and may wrap awkwardly on phones.`, edit(s));
      }
      if (b.type === 'image') {
        if (!/^https?:\/\//i.test(b.url || '')) add('block', s, `An image on “${s.name}” has no picture yet.`, edit(s));
        else if (!String(b.alt || '').trim()) add('warn', s, `An image on “${s.name}” has no description (needed for screen readers).`, edit(s));
      }
      if (b.type === 'video' && b.url && !YT.test(b.url)) add('block', s, `The video link on “${s.name}” isn’t a YouTube link.`, edit(s));
      if (b.type === 'testimonial' && !String(b.quote || '').trim()) add('block', s, `A testimonial on “${s.name}” has no quote.`, edit(s));
      if ((b.type === 'heading' || b.type === 'hero') && String(b.text || '').length > 140) add('warn', s, `A headline on “${s.name}” is very long for a phone screen.`, edit(s));
    }
  }
  if (!account.stripe_secret_key && steps.some((s) => (typeof s.blocks === 'string' ? JSON.parse(s.blocks) : s.blocks).some((b) => b.type === 'pricing'))) {
    add('warn', null, 'Payments aren’t connected, so checkout runs in test mode and no one is charged.', { label: 'Connect Stripe', href: '#/settings' });
  }
  return out;
}

// Suggested fix for the leakiest step, by what kind of page it is.
function suggestion(step) {
  const lever = LEVER_OF_PAGE(step);
  return {
    lead: 'Ask only for an email (drop the name field) and make the headline promise one specific result.',
    conversion: 'Move the buy button above the fold and add one short testimonial right next to it.',
    upsell: 'Make the offer smaller and clearer: one item, one price, and a plainly worded “No thanks”.',
    continuity: 'Add one clear next step here, such as a newsletter signup or a link back to the shop.',
  }[lever];
}

function registerFunnelKit(api, { getDb, HttpError, id, getFunnel, getStep }) {
  const db = () => getDb();
  const loadAll = async (accountId, funnelId) => {
    const funnel = await getFunnel(accountId, funnelId);
    const [steps, prods, account] = await Promise.all([
      db().all('SELECT * FROM funnel_steps WHERE funnel_id = ? ORDER BY position', funnel.id),
      db().all('SELECT * FROM products WHERE account_id = ?', accountId),
      db().get('SELECT * FROM accounts WHERE id = ?', accountId),
    ]);
    return { funnel, steps, products: Object.fromEntries(prods.map((p) => [p.id, p])), account };
  };
  const snapshot = (q, step, reason) => q.run('INSERT INTO step_versions (step_id, name, blocks, settings, reason) VALUES (?, ?, ?, ?, ?)',
    step.id, step.name, step.blocks, step.settings, reason);

  api.get('/funnels/:id/preflight', async (req, res) => {
    const problems = preflight(await loadAll(req.accountId, req.params.id));
    res.json({ problems, ready: !problems.some((p) => p.severity === 'block') });
  });

  // Publishing is blocked while any "block" problem remains.
  api.post('/funnels/:id/publish', async (req, res) => {
    const all = await loadAll(req.accountId, req.params.id);
    const problems = preflight(all);
    if (problems.some((p) => p.severity === 'block')) return res.status(400).json({ error: 'Fix these before publishing', problems });
    await db().tx(async (t) => {
      for (const s of all.steps) await snapshot(t, s, 'published');
      await t.run("UPDATE funnels SET status = 'live', published_at = now() WHERE id = ?", all.funnel.id);
    });
    res.json({ ok: true, status: 'live', warnings: problems });
  });

  api.post('/funnels/:id/unpublish', async (req, res) => {
    const f = await getFunnel(req.accountId, req.params.id);
    await db().run("UPDATE funnels SET status = 'draft' WHERE id = ?", f.id);
    res.json({ ok: true, status: 'draft' });
  });

  // Plain-language metrics for the map: how many people went on from each page.
  api.get('/funnels/:id/flow', async (req, res) => {
    const f = await getFunnel(req.accountId, req.params.id);
    const steps = await db().all(`SELECT s.*,
        (SELECT COUNT(*)::int FROM page_events e WHERE e.step_id = s.id AND e.type = 'view') AS views,
        (SELECT COUNT(*)::int FROM page_events e WHERE e.step_id = s.id AND e.type = 'optin') AS optins,
        (SELECT COUNT(*)::int FROM page_events e WHERE e.step_id = s.id AND e.type = 'sale') AS sales
      FROM funnel_steps s WHERE s.funnel_id = ?`, f.id);
    const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
    const edges = [];
    for (const s of steps) {
      const blocks = JSON.parse(s.blocks);
      for (const [port, key] of [['yes', 'next_step_id'], ['no', 'no_step_id']]) {
        const t = byId[s[key]];
        if (!t) continue;
        // "Yes" means they did the thing: opted in on a form page, bought on a sales page, else reached the next page.
        const wentOn = port === 'yes'
          ? (blocks.some((b) => b.type === 'pricing') ? s.sales : blocks.some((b) => b.type === 'form') ? s.optins : t.views)
          : t.views;
        const rate = s.views ? Math.min(1, wentOn / s.views) : null;
        edges.push({ from: s.id, to: t.id, port, visitors: s.views, went_on: Math.min(wentOn, s.views), rate,
          plain: s.views ? `${Math.round((rate ?? 0) * 10)} of every 10 ${port === 'yes' ? 'go on' : 'say no thanks'}` : 'No visitors yet' });
      }
    }
    // The leakiest step: lowest "yes" rate among pages with enough visitors to judge.
    const MIN = Number(process.env.LEAK_MIN_VISITS || 20);
    const judged = edges.filter((e) => e.port === 'yes' && e.visitors >= MIN);
    const leak = judged.length ? judged.reduce((lo, e) => (e.rate < lo.rate ? e : lo), judged[0]) : null;
    res.json({
      levers: Object.fromEntries(steps.map((s) => [s.id, LEVER_OF_PAGE(s)])), edges,
      leak: leak && { step_id: leak.from, plain: leak.plain, suggestion: suggestion(byId[leak.from]) },
    });
  });

  api.get('/steps/:id/versions', async (req, res) => {
    const s = await getStep(req.accountId, req.params.id);
    res.json(await db().all('SELECT id, name, reason, created_at FROM step_versions WHERE step_id = ? ORDER BY id DESC LIMIT 50', s.id));
  });

  // Restore: the current page is saved as a version first, so restoring is undoable too.
  api.post('/steps/:id/versions/:vid/restore', async (req, res) => {
    const s = await getStep(req.accountId, req.params.id);
    const v = await db().get('SELECT * FROM step_versions WHERE id = ? AND step_id = ?', id(req.params.vid), s.id);
    if (!v) throw new HttpError(404, 'Version not found');
    await db().tx(async (t) => {
      await snapshot(t, s, 'before restore');
      await t.run('UPDATE funnel_steps SET blocks = ?, settings = ?, updated_at = now() WHERE id = ?', v.blocks, v.settings, s.id);
    });
    res.json({ ok: true });
  });

  return {
    // Called after each page save: keeps a checkpoint at most every 5 minutes.
    async autosaveCheckpoint(step) {
      const last = await db().get('SELECT created_at FROM step_versions WHERE step_id = ? ORDER BY id DESC LIMIT 1', step.id);
      if (!last || Date.now() - new Date(last.created_at).getTime() > 5 * 60e3) await snapshot(db(), step, 'autosave');
    },
  };
}

module.exports = { registerFunnelKit, preflight, LEVER_OF_PAGE, suggestion, formatMoney };
