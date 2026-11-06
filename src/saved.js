// Saved sections: a block (a header, a testimonial, an offer…) saved once per
// business and placed on any page. Pages keep a copy marked with savedId; when
// the saved section changes, every copy is rewritten, so it changes everywhere.
const NOT_SAVABLE = new Set(['form', 'pricing', 'booking', 'saved']);

function registerSaved(api, { getDb, HttpError, id }) {
  const db = () => getDb();
  const content = (b) => { const { id: _i, savedId: _s, ...rest } = b || {}; return rest; };
  const parse = (v) => { try { return JSON.parse(v || '[]'); } catch { return []; } };
  const usedOn = async (accountId, savedId) => db().all(`SELECT s.id, s.name, s.blocks, s.variant_blocks FROM funnel_steps s JOIN funnels f ON f.id = s.funnel_id
    WHERE f.account_id = ? AND (s.blocks LIKE ? OR s.variant_blocks LIKE ?)`, accountId, `%"savedId":${savedId}%`, `%"savedId":${savedId}%`);
  // Rewrite (or unlink) every copy of a saved section.
  async function eachCopy(accountId, savedId, fn) {
    let pages = 0;
    for (const s of await usedOn(accountId, savedId)) {
      let hit = false;
      const fix = (list) => list.map((b) => { if (b.savedId !== savedId) return b; hit = true; return fn(b); });
      const blocks = fix(parse(s.blocks));
      const variant = s.variant_blocks ? fix(parse(s.variant_blocks)) : null;
      if (!hit) continue;
      pages++;
      await db().run('UPDATE funnel_steps SET blocks = ?, variant_blocks = ? WHERE id = ?', JSON.stringify(blocks), variant ? JSON.stringify(variant) : null, s.id);
    }
    return pages;
  }
  const out = async (accountId, r) => ({ id: r.id, name: r.name, type: JSON.parse(r.block).type, block: JSON.parse(r.block), pages: (await usedOn(accountId, r.id)).length });

  api.get('/saved-blocks', async (req, res) => {
    const rows = await db().all('SELECT * FROM saved_blocks WHERE account_id = ? ORDER BY name, id', req.accountId);
    res.json(await Promise.all(rows.map((r) => out(req.accountId, r))));
  });

  api.post('/saved-blocks', async (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 80);
    const block = content(req.body?.block);
    if (!name) throw new HttpError(400, 'Name it, e.g. “Main header” or “Sam’s testimonial”');
    if (!block.type || NOT_SAVABLE.has(block.type)) throw new HttpError(400, 'Forms, pricing cards and bookings can’t be saved for reuse yet');
    const r = await db().get('INSERT INTO saved_blocks (account_id, name, block) VALUES (?, ?, ?) RETURNING *', req.accountId, name, JSON.stringify(block));
    res.status(201).json(await out(req.accountId, r));
  });

  // Change it once: every page that uses it changes too.
  api.put('/saved-blocks/:id', async (req, res) => {
    const r = await db().get('SELECT * FROM saved_blocks WHERE id = ? AND account_id = ?', id(req.params.id), req.accountId);
    if (!r) throw new HttpError(404, 'Saved section not found');
    const name = req.body?.name !== undefined ? String(req.body.name).trim().slice(0, 80) || r.name : r.name;
    const block = req.body?.block ? { ...content(req.body.block), type: JSON.parse(r.block).type } : JSON.parse(r.block);
    await db().run('UPDATE saved_blocks SET name = ?, block = ?, updated_at = now() WHERE id = ?', name, JSON.stringify(block), r.id);
    const pages = await eachCopy(req.accountId, r.id, (b) => ({ ...block, id: b.id, savedId: r.id }));
    res.json({ ok: true, pages });
  });

  // Deleting keeps every page as it is, just no longer linked.
  api.delete('/saved-blocks/:id', async (req, res) => {
    const r = await db().get('SELECT id FROM saved_blocks WHERE id = ? AND account_id = ?', id(req.params.id), req.accountId);
    if (!r) throw new HttpError(404, 'Saved section not found');
    await eachCopy(req.accountId, r.id, (b) => { const { savedId: _s, ...rest } = b; return rest; });
    await db().run('DELETE FROM saved_blocks WHERE id = ?', r.id);
    res.json({ ok: true });
  });
}

module.exports = { registerSaved, NOT_SAVABLE };
