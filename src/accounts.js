// Sub-accounts (agency mode): one owner runs several businesses, each a fully
// separate workspace (every table is scoped by account_id). The session holds
// the active workspace; switching just repoints it.
const auth = require('./auth');

function registerAccounts(api, { getDb, HttpError, id }) {
  const myAccounts = (userId) => getDb().all(`SELECT a.id, a.name, m.role, a.created_at,
      (SELECT COUNT(*)::int FROM contacts c WHERE c.account_id = a.id) AS people,
      (SELECT COUNT(*)::int FROM funnels f WHERE f.account_id = a.id) AS funnels
    FROM memberships m JOIN accounts a ON a.id = m.account_id WHERE m.user_id = ? ORDER BY a.name, a.id`, userId);
  const membership = async (userId, accountId) => {
    const m = await getDb().get('SELECT * FROM memberships WHERE user_id = ? AND account_id = ?', userId, id(accountId));
    if (!m) throw new HttpError(404, 'Sub-account not found');
    return m;
  };

  api.get('/accounts', async (req, res) => {
    res.json({ current: req.accountId, accounts: await myAccounts(req.user.id) });
  });

  // New sub-account for another business. No limits on how many.
  api.post('/accounts', async (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 100);
    if (!name) throw new HttpError(400, 'Name the business');
    const accountId = await getDb().tx(async (t) => {
      const a = await t.get('INSERT INTO accounts (name, from_name, from_email) VALUES (?, ?, ?) RETURNING id', name, name, req.user.email);
      await t.run("INSERT INTO memberships (user_id, account_id, role) VALUES (?, ?, 'owner')", req.user.id, a.id);
      return a.id;
    });
    if (req.body?.switch) await auth.switchAccount(getDb(), req, accountId);
    res.status(201).json({ id: accountId });
  });

  api.post('/accounts/:id/switch', async (req, res) => {
    const m = await membership(req.user.id, req.params.id);
    await auth.switchAccount(getDb(), req, m.account_id);
    res.json({ ok: true, id: m.account_id });
  });

  // Deleting removes the business and everything in it, so the exact name must be typed.
  api.delete('/accounts/:id', async (req, res) => {
    const m = await membership(req.user.id, req.params.id);
    if (m.role !== 'owner') throw new HttpError(403, 'Only an owner can delete a sub-account');
    const db = getDb();
    const a = await db.get('SELECT id, name FROM accounts WHERE id = ?', m.account_id);
    if (String(req.body?.confirm || '').trim() !== a.name) throw new HttpError(400, `Type “${a.name}” to confirm`);
    const mine = await myAccounts(req.user.id);
    if (mine.length < 2) throw new HttpError(400, 'You can’t delete your only workspace');
    // Sessions are deleted with their workspace, so move off it first.
    let current = req.accountId;
    if (a.id === req.accountId) {
      current = mine.find((x) => x.id !== a.id).id;
      await auth.switchAccount(db, req, current);
    }
    // Funnel steps point at each other; clear those links, then the cascade does the rest.
    await db.tx(async (t) => {
      await t.run('UPDATE funnel_steps SET next_step_id = NULL, no_step_id = NULL WHERE funnel_id IN (SELECT id FROM funnels WHERE account_id = ?)', a.id);
      await t.run('DELETE FROM accounts WHERE id = ?', a.id);
    });
    res.json({ ok: true, current });
  });
}

module.exports = { registerAccounts };
