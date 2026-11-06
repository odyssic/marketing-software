// People with access to one business: the owner invites a client or teammate
// by email. Members can do everything in that business except invite or
// remove people, delete the business, or see the owner's plan.
const crypto = require('node:crypto');
const auth = require('./auth');
const mailer = require('./mailer');
const { rillyEmail } = require('./emailhtml');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const hashOf = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

function registerTeam(api, { getDb, HttpError, id, publicBase }) {
  const db = () => getDb();
  const roleIn = async (userId, accountId) => (await db().get('SELECT role FROM memberships WHERE user_id = ? AND account_id = ?', userId, accountId))?.role;
  const ownerOnly = async (req) => { if (await roleIn(req.user.id, req.accountId) !== 'owner') throw new HttpError(403, 'Only the business owner can do that'); };
  const findInvite = (token) => db().get(`SELECT i.*, a.name AS business FROM invites i JOIN accounts a ON a.id = i.account_id
    WHERE i.token_hash = ? AND i.accepted_at IS NULL AND i.expires_at > now()`, hashOf(token));

  // ---------- Public: opening an invite link ----------
  const publicRoutes = (router) => {
    router.get('/invites/:token', async (req, res) => {
      const inv = await findInvite(req.params.token);
      if (!inv) throw new HttpError(404, 'This invite has expired or was already used. Ask for a new one.');
      const existing = await db().get('SELECT 1 FROM users WHERE email = ?', inv.email);
      res.json({ business: inv.business, email: inv.email, hasAccount: Boolean(existing) });
    });
    // New to Rilly: choose a name and password and join. Already have an account: sign in first.
    router.post('/invites/:token/accept', async (req, res) => {
      const inv = await findInvite(req.params.token);
      if (!inv) throw new HttpError(404, 'This invite has expired or was already used. Ask for a new one.');
      const sid = auth.parseCookies(req.headers.cookie).sid;
      const signedIn = sid && await db().get('SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > now()', sid);
      let userId;
      if (signedIn) {
        if (signedIn.email.toLowerCase() !== inv.email) throw new HttpError(403, `This invite is for ${inv.email}. Sign out, then open the link again.`);
        userId = signedIn.id;
      } else {
        if (await db().get('SELECT 1 FROM users WHERE email = ?', inv.email)) throw new HttpError(409, 'You already have a Rilly account. Sign in, then open the invite link again.');
        const name = String(req.body?.name || '').trim().slice(0, 80), password = String(req.body?.password || '');
        if (!name) throw new HttpError(400, 'Add your name');
        if (password.length < 8) throw new HttpError(400, 'Use at least 8 characters for your password');
        // Invited people use the owner's plan, so they're never asked to pay.
        userId = (await db().get("INSERT INTO users (email, name, password_hash, plan_status, onboarding_step) VALUES (?, ?, ?, 'comped', 3) RETURNING id", inv.email, name, auth.hashPassword(password))).id;
      }
      await db().run("INSERT INTO memberships (user_id, account_id, role) VALUES (?, ?, ?) ON CONFLICT (user_id, account_id) DO NOTHING", userId, inv.account_id, inv.role);
      await db().run('UPDATE invites SET accepted_at = now() WHERE id = ?', inv.id);
      if (signedIn) await auth.switchAccount(db(), req, inv.account_id);
      else await auth.createSession(db(), req, req.res, userId, inv.account_id);
      res.json({ ok: true, business: inv.business });
    });
  };

  // ---------- Signed in: managing who has access ----------
  const privateRoutes = (router) => {
    router.get('/team', async (req, res) => {
      const members = await db().all(`SELECT u.id, u.name, u.email, m.role FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.account_id = ? ORDER BY (m.role = 'owner') DESC, u.name`, req.accountId);
      const owner = await roleIn(req.user.id, req.accountId) === 'owner';
      const invites = owner ? await db().all('SELECT id, email, role, created_at FROM invites WHERE account_id = ? AND accepted_at IS NULL AND expires_at > now() ORDER BY id DESC', req.accountId) : [];
      res.json({ canManage: owner, members: members.map((m) => ({ ...m, you: m.id === req.user.id })), invites });
    });

    router.post('/team/invites', async (req, res) => {
      await ownerOnly(req);
      const email = String(req.body?.email || '').trim().toLowerCase();
      if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter their email');
      const already = await db().get('SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.account_id = ? AND u.email = ?', req.accountId, email);
      if (already) throw new HttpError(409, 'They already have access');
      const token = crypto.randomBytes(24).toString('base64url');
      await db().run("DELETE FROM invites WHERE account_id = ? AND email = ? AND accepted_at IS NULL", req.accountId, email);
      await db().run("INSERT INTO invites (account_id, email, role, token_hash, invited_by, expires_at) VALUES (?, ?, 'member', ?, ?, now() + interval '14 days')",
        req.accountId, email, hashOf(token), req.user.id);
      const a = await db().get('SELECT name FROM accounts WHERE id = ?', req.accountId);
      const link = `${publicBase()}/#/invite/${token}`;
      const from = req.user.name.split(' ')[0];
      await mailer.sendEmail({
        ...mailer.senderFor({ name: 'Rilly', replyTo: req.user.email }), to: email, subject: `${from} invited you to ${a.name} on Rilly`,
        text: `${req.user.name} invited you to work on ${a.name} in Rilly: its pages, emails, people and results.\n\nJoin here (the link works for 14 days):\n${link}`,
        html: rillyEmail({ base: publicBase(), title: `Join ${a.name} on Rilly`, preheader: `${req.user.name} invited you.`, blocks: [
          { p: `${req.user.name} invited you to work on ${a.name} in Rilly: its pages, emails, people and results.` },
          { button: [`Join ${a.name}`, link] },
          { small: 'The link works for 14 days. If you weren’t expecting this, you can ignore it.' },
        ] }),
      });
      res.status(201).json({ ok: true, ...(!mailer.isLive() && process.env.NODE_ENV !== 'production' ? { devLink: link } : {}) });
    });

    router.delete('/team/invites/:id', async (req, res) => {
      await ownerOnly(req);
      await db().run('DELETE FROM invites WHERE id = ? AND account_id = ?', id(req.params.id), req.accountId);
      res.json({ ok: true });
    });

    router.delete('/team/members/:userId', async (req, res) => {
      await ownerOnly(req);
      const uid = id(req.params.userId);
      if (uid === req.user.id) throw new HttpError(400, 'You can’t remove yourself');
      if (await roleIn(uid, req.accountId) === 'owner') throw new HttpError(400, 'Owners can’t be removed');
      await db().run('DELETE FROM memberships WHERE user_id = ? AND account_id = ?', uid, req.accountId);
      // Their sessions in this business end; they keep any businesses of their own.
      await db().run('DELETE FROM sessions WHERE user_id = ? AND account_id = ?', uid, req.accountId);
      res.json({ ok: true });
    });
  };

  return { publicRoutes, privateRoutes, roleIn };
}

module.exports = { registerTeam };
