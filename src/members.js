// Members areas: lesson pages only members can open (course menu, progress
// and lessons that open later are in courses.js) (courses, client
// portals, paid communities' resources). Stored like a website (funnel
// kind = 'members'): pages in menu order, edited in the same page editor.
//
// Access: buying a product linked to the area, or the owner adding someone.
// Members sign in with a link emailed to them (no password to forget); the
// link is good for 7 days and signs them in on that device for 30 days.
const crypto = require('node:crypto');
const express = require('express');

const uid = () => Math.random().toString(36).slice(2, 10);
const h = (text, size = 'medium', align = 'left') => ({ id: uid(), type: 'heading', text, size, align });
const p = (text, align = 'left') => ({ id: uid(), type: 'text', text, align });
const MEMBERS_TEMPLATE = {
  members: {
    label: 'Members area', description: 'A welcome page and lessons only members can open.', workflows: [],
    steps: () => [
      { name: 'Welcome', slug: 'welcome', settings: { accent: '#1f7f78', width: 760 }, blocks: [
        h('Welcome in!', 'large'), p('Here’s everything that comes with your membership. Start with Lesson 1 and go at your own pace. Come back any time on this device and you’ll still be signed in.')] },
      { name: 'Lesson 1', slug: 'lesson-1', settings: { accent: '#1f7f78', width: 760 }, blocks: [
        h('Lesson 1: [Title]'), { id: uid(), type: 'video', url: '' }, p('[What this lesson covers, and the one thing to do after watching.]')] },
      { name: 'Lesson 2', slug: 'lesson-2', settings: { accent: '#1f7f78', width: 760 }, blocks: [
        h('Lesson 2: [Title]'), { id: uid(), type: 'video', url: '' }, p('[What this lesson covers.]')] },
      { name: 'Downloads', slug: 'downloads', settings: { accent: '#1f7f78', width: 760, lesson: false }, blocks: [
        h('Downloads'), p('[Worksheets, templates and recordings. Add a button for each file.]')] },
    ],
  },
};

const escH = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function registerMembers(app, api, { getDb, HttpError, id, upsertContact, messaging, publicBase, getSecret, createFunnel, getFunnel }) {
  const db = () => getDb();
  const mac = (s) => crypto.createHmac('sha256', getSecret()).update(s).digest('base64url').slice(0, 22);
  const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const cookieName = (accountId) => `rm${accountId}`;
  const base = () => (process.env.PUBLIC_URL || publicBase()).replace(/\/$/, '');

  // `to`: a page of the area to land on (e.g. a lesson that just unlocked).
  const enterLink = (funnel, contactId, days = 7, to = '') => {
    const exp = Math.floor(Date.now() / 1000) + days * 86400;
    const body = `${contactId}.${funnel.id}.${exp}`;
    return `${base()}/m/${funnel.slug}/enter/${body}.${mac(`enter:${body}`)}${to ? `?to=${encodeURIComponent(to)}` : ''}`;
  };
  const portalUrl = (accountId) => `${base()}/my/${accountId}`;
  const hasAccess = (funnelId, contactId) => db().get('SELECT 1 FROM member_access WHERE funnel_id = ? AND contact_id = ? AND revoked_at IS NULL', funnelId, contactId);

  async function grant(funnel, contactId, source) {
    const r = await db().get(`INSERT INTO member_access (account_id, funnel_id, contact_id, source) VALUES (?, ?, ?, ?)
      ON CONFLICT (funnel_id, contact_id) DO UPDATE SET revoked_at = NULL RETURNING id`, funnel.account_id, funnel.id, contactId, source);
    return r;
  }
  async function sendAccess(funnel, contact, { first = false } = {}) {
    const account = await db().get('SELECT * FROM accounts WHERE id = ?', funnel.account_id);
    const link = enterLink(funnel, contact.id);
    await messaging.sendTransactional({ account, to: contact.email, contactId: contact.id,
      subject: first ? `You’re in: ${funnel.name}` : `Your link to ${funnel.name}`,
      text: `Hi ${contact.first_name || 'there'},\n\n${first ? `You now have access to ${funnel.name}.` : `Here’s your sign-in link for ${funnel.name}.`}\n\nOpen it here: ${link}\n\nThe link works for 7 days and keeps you signed in on this device. Lost it? Go to ${base()}/f/${funnel.slug} and ask for a new one.\n\nAll your courses and orders, in one place: ${portalUrl(funnel.account_id)}\n\n${account.from_name || account.name}` });
  }

  // Signed in on this device for 30 days: one cookie per business, so it opens every area they have.
  const signIn = (res, accountId, cid) => {
    const secure = /^https:/.test(base()) ? '; Secure' : '';
    res.append('Set-Cookie', `${cookieName(accountId)}=${encodeURIComponent(`${cid}.${mac(`member:${cid}`)}`)}; Path=/; Max-Age=${30 * 86400}; HttpOnly; SameSite=Lax${secure}`);
  };
  const signOut = (res, accountId) => res.append('Set-Cookie', `${cookieName(accountId)}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
  // Who is looking at a members page: the signed-in member, or nobody.
  function memberOf(req, funnel) {
    const raw = String(req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(`${cookieName(funnel.account_id)}=`));
    if (!raw) return null;
    const [cid, sig] = decodeURIComponent(raw.split('=')[1]).split('.');
    return cid && sig && same(sig, mac(`member:${cid}`)) ? Number(cid) : null;
  }

  const loginPage = (res, funnel, accountName, { sent = false, status = 200 } = {}) => res.status(status).type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escH(funnel.name)}</title>
    <style>body{font:16px/1.55 -apple-system,system-ui,sans-serif;color:#14282B;background:#F4F7F6;margin:0;padding:12vh 16px}.c{max-width:420px;margin:0 auto;background:#fff;border:1px solid #E3E9E8;border-radius:16px;padding:28px}
    h1{font-size:1.3rem;margin:0 0 4px}.m{color:#5B6B70}input{width:100%;box-sizing:border-box;padding:12px;border:1px solid #c9d1d3;border-radius:10px;font:inherit;margin:14px 0 8px}
    button{width:100%;background:#1B736D;color:#fff;border:0;border-radius:10px;padding:13px;font:600 1rem system-ui;cursor:pointer}.ok{background:#e6f4f2;color:#14524d;border-radius:10px;padding:12px;margin-top:14px}</style></head>
    <body><div class="c"><div class="m">${escH(accountName)}</div><h1>${escH(funnel.name)}</h1>
    ${sent ? '<p class="ok">If that email has access, a sign-in link is on its way. Check your inbox (and spam, just in case).</p>'
    : `<p class="m">Members only. Enter the email you joined with and we’ll send you a sign-in link.</p>
      <form method="post" action="/m/${escH(funnel.slug)}/login"><input type="email" name="email" required autocomplete="email" placeholder="you@example.com" aria-label="Your email"><button>Email me a sign-in link</button></form>`}
    <p class="m" style="font-size:.9rem;margin:16px 0 0"><a href="/my/${Number(funnel.account_id)}" style="color:#1B736D">See all your courses and orders</a></p></div></body></html>`);

  // Called by the public page route before showing a members page. Returns true to show it.
  async function gate(req, res, funnel, ownerViewing) {
    if (await ownerViewing(req, funnel)) return true;
    const cid = memberOf(req, funnel);
    if (cid && await hasAccess(funnel.id, cid)) {
      db().run('UPDATE member_access SET last_seen_at = now() WHERE funnel_id = ? AND contact_id = ?', funnel.id, cid).catch(() => {});
      return true;
    }
    const acct = await db().get('SELECT name FROM accounts WHERE id = ?', funnel.account_id);
    res.set('X-Robots-Tag', 'noindex');
    loginPage(res, funnel, acct.name, { status: 401 });
    return false;
  }

  const areaBySlug = (slug) => db().get("SELECT * FROM funnels WHERE slug = ? AND kind = 'members'", String(slug).slice(0, 80));
  const form = express.urlencoded({ extended: false, limit: '4kb' });
  app.post('/m/:slug/login', form, async (req, res) => {
    const funnel = await areaBySlug(req.params.slug);
    if (!funnel) return res.status(404).type('text').send('Not found');
    const acct = await db().get('SELECT name FROM accounts WHERE id = ?', funnel.account_id);
    const email = String(req.body.email || '').trim().toLowerCase();
    // Same answer either way, so the form can't be used to find out who's a member.
    if (EMAIL_RE.test(email)) {
      const c = await db().get('SELECT * FROM contacts WHERE account_id = ? AND email = ?', funnel.account_id, email);
      const recent = c && await db().get("SELECT 1 FROM email_log WHERE contact_id = ? AND subject LIKE 'Your link to %' AND created_at > now() - interval '2 minutes'", c.id);
      if (c && !recent && await hasAccess(funnel.id, c.id)) await sendAccess(funnel, c).catch((e) => console.error('member link:', e.message));
    }
    loginPage(res, funnel, acct.name, { sent: true });
  });
  app.get('/m/:slug/enter/:token', async (req, res) => {
    const funnel = await areaBySlug(req.params.slug);
    const parts = String(req.params.token).split('.');
    if (!funnel || parts.length !== 4) return res.status(404).type('text').send('This link isn’t valid.');
    const [cid, fid, exp, sig] = parts;
    const acct = await db().get('SELECT name FROM accounts WHERE id = ?', funnel.account_id);
    const ok = same(sig, mac(`enter:${cid}.${fid}.${exp}`)) && Number(fid) === funnel.id && Number(exp) * 1000 > Date.now() && await hasAccess(funnel.id, Number(cid));
    if (!ok) return loginPage(res, funnel, acct.name, { status: 401 });
    signIn(res, funnel.account_id, cid);
    const to = String(req.query.to || '');
    res.redirect(303, `/f/${funnel.slug}${/^[a-z0-9-]{1,80}$/.test(to) ? `/${to}` : ''}`);
  });
  app.get('/m/:slug/logout', async (req, res) => {
    const funnel = await areaBySlug(req.params.slug);
    if (funnel) signOut(res, funnel.account_id);
    res.redirect(303, funnel ? `/f/${funnel.slug}` : '/');
  });

  // ---------- Owner API ----------
  api.get('/members-areas', async (req, res) => {
    res.json(await db().all(`SELECT f.id, f.name, f.slug, f.status,
        (SELECT COUNT(*)::int FROM funnel_steps s WHERE s.funnel_id = f.id) AS pages,
        (SELECT COUNT(*)::int FROM member_access m WHERE m.funnel_id = f.id AND m.revoked_at IS NULL) AS members,
        (SELECT COUNT(*)::int FROM member_access m WHERE m.funnel_id = f.id AND m.revoked_at IS NULL AND m.last_seen_at > now() - interval '30 days') AS active
      FROM funnels f WHERE f.account_id = ? AND f.kind = 'members' ORDER BY f.id DESC`, req.accountId));
  });
  api.post('/members-areas', async (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 80);
    if (!name) throw new HttpError(400, 'Name it, e.g. “Pottery Basics course” or “Client portal”');
    res.status(201).json(await createFunnel(req.accountId, name, 'members', null, { kind: 'members', templates: MEMBERS_TEMPLATE }));
  });
  const area = async (req) => {
    const f = await getFunnel(req.accountId, req.params.id);
    if (f.kind !== 'members') throw new HttpError(404, 'Not found');
    return f;
  };
  api.get('/members-areas/:id/members', async (req, res) => {
    const f = await area(req);
    const members = await db().all(`SELECT c.id, c.first_name, c.last_name, c.email, m.source, m.granted_at, m.last_seen_at
      FROM member_access m JOIN contacts c ON c.id = m.contact_id WHERE m.funnel_id = ? AND m.revoked_at IS NULL ORDER BY m.granted_at DESC LIMIT 1000`, f.id);
    const products = await db().all('SELECT id, name, members_funnel_id FROM products WHERE account_id = ? ORDER BY name', req.accountId);
    res.json({ members, products: products.map((x) => ({ id: x.id, name: x.name, linked: x.members_funnel_id === f.id, elsewhere: Boolean(x.members_funnel_id && x.members_funnel_id !== f.id) })) });
  });
  api.post('/members-areas/:id/members', async (req, res) => {
    const f = await area(req);
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Add their email address');
    const [first, ...rest] = String(req.body?.name || '').trim().split(/\s+/);
    const { id: cid } = await upsertContact(db(), req.accountId, { email, first_name: first || '', last_name: rest.join(' '), tags: ['member'], source: 'manual', entry: `Added by hand (members area: ${f.name})` });
    await grant(f, cid, 'added by hand');
    if (req.body?.send !== false) await sendAccess(f, await db().get('SELECT * FROM contacts WHERE id = ?', cid), { first: true });
    res.status(201).json({ ok: true, contact_id: cid });
  });
  api.delete('/members-areas/:id/members/:contactId', async (req, res) => {
    const f = await area(req);
    await db().run('UPDATE member_access SET revoked_at = now() WHERE funnel_id = ? AND contact_id = ?', f.id, id(req.params.contactId));
    res.json({ ok: true });
  });
  // Undo for a removal.
  api.post('/members-areas/:id/members/:contactId/restore', async (req, res) => {
    const f = await area(req);
    await db().run('UPDATE member_access SET revoked_at = NULL WHERE funnel_id = ? AND contact_id = ?', f.id, id(req.params.contactId));
    res.json({ ok: true });
  });
  // Which products give access (each product opens at most one area).
  api.put('/members-areas/:id/products', async (req, res) => {
    const f = await area(req);
    const ids = (Array.isArray(req.body?.product_ids) ? req.body.product_ids : []).map(Number).filter(Number.isInteger);
    await db().tx(async (t) => {
      await t.run('UPDATE products SET members_funnel_id = NULL WHERE account_id = ? AND members_funnel_id = ?', req.accountId, f.id);
      for (const pid of ids) await t.run('UPDATE products SET members_funnel_id = ? WHERE id = ? AND account_id = ?', f.id, pid, req.accountId);
    });
    res.json({ ok: true });
  });

  // A paid order for a linked product: let them in and send the link.
  async function onOrderPaid(order) {
    if (!order.product_id) return;
    const prod = await db().get('SELECT members_funnel_id FROM products WHERE id = ?', order.product_id);
    const f = prod?.members_funnel_id && await db().get("SELECT * FROM funnels WHERE id = ? AND kind = 'members'", prod.members_funnel_id);
    const o = await db().get('SELECT contact_id FROM orders WHERE id = ?', order.id);
    if (!f || !o?.contact_id) return;
    await grant(f, o.contact_id, 'purchase');
    await sendAccess(f, await db().get('SELECT * FROM contacts WHERE id = ?', o.contact_id), { first: true });
  }

  return { gate, onOrderPaid, memberOf, hasAccess, enterLink, portalUrl, signIn, signOut, sign: mac, same, base };
}

module.exports = { registerMembers, MEMBERS_TEMPLATE };
