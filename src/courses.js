// Courses: turns a members area into a course.
//
// - Lessons: every page of a members area except the first (the course home)
//   is a lesson unless the owner says otherwise (settings.lesson === false).
//   A lesson can sit in a module (settings.module) and can open later
//   (settings.dripDays after the member joined, or settings.dripDate).
// - Progress: members mark lessons done; the course home shows how far they are.
// - Navigation: a course menu (modules, lessons, ticks, locks) and previous/next.
// - Customer login (/my/<business>): one sign-in for all of a buyer's courses,
//   orders and receipts with this business.
// - "Lesson is ready" emails when a dripped lesson opens (job in app.runJobs).
'use strict';
const express = require('express');
const { esc, formatMoney } = require('./render');

const DAY = 86400e3;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const parse = (s) => { try { return typeof s === 'string' ? JSON.parse(s || '{}') : s || {}; } catch { return {}; } };

// When a lesson opens for someone who joined at `joined` (null: open from the start).
function unlockAt(st, joined) {
  if (DATE_RE.test(String(st.dripDate || ''))) return new Date(`${st.dripDate}T00:00:00Z`);
  const days = Math.floor(Number(st.dripDays) || 0);
  return days > 0 && joined ? new Date(new Date(joined).getTime() + days * DAY) : null;
}
const fmtDay = (d, now = new Date()) => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC',
  ...(d.getUTCFullYear() !== now.getUTCFullYear() ? { year: 'numeric' } : {}) });
const shortDay = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

function registerCourses(app, api, { getDb, HttpError, id, messaging, members, getFunnel }) {
  const db = () => getDb();

  // The course in menu order. Hidden pages stay out of the menu (but keep working by link).
  async function outline(funnel) {
    const steps = await db().all('SELECT id, name, slug, settings FROM funnel_steps WHERE funnel_id = ? ORDER BY position, id', funnel.id);
    return steps.map((s) => {
      const st = parse(s.settings);
      const entry = s.id === funnel.entry_step_id;
      return { id: s.id, name: s.name, slug: s.slug, entry, st, hidden: Boolean(st.hideInMenu) && !entry,
        lesson: !entry && st.lesson !== false, module: String(st.module || '').trim().slice(0, 80) };
    });
  }
  async function memberState(funnelId, contactId) {
    if (!contactId) return null;
    const acc = await db().get('SELECT granted_at FROM member_access WHERE funnel_id = ? AND contact_id = ? AND revoked_at IS NULL', funnelId, contactId);
    if (!acc) return null;
    const rows = await db().all('SELECT step_id FROM member_lessons WHERE funnel_id = ? AND contact_id = ? AND completed_at IS NOT NULL', funnelId, contactId);
    return { joined: acc.granted_at, done: new Set(rows.map((r) => r.step_id)) };
  }
  const progressOf = (items, me) => {
    const lessons = items.filter((x) => x.lesson && !x.hidden);
    const done = me ? lessons.filter((x) => me.done.has(x.id)).length : 0;
    return { done, total: lessons.length, pct: lessons.length ? Math.round((done / lessons.length) * 100) : 0 };
  };

  // What a members page needs: whether it's locked for this viewer, and the course menu around it.
  async function view(req, funnel, step, { owner, pageHref, home, now = new Date() }) {
    const cid = owner ? null : members.memberOf(req, funnel);
    const me = await memberState(funnel.id, cid);
    const items = await outline(funnel);
    const href = (x) => (x.entry ? home : pageHref(x.slug));
    const opensAt = (x) => (x.lesson ? unlockAt(x.st, me?.joined) : null);
    const isLocked = (x) => !owner && Boolean(opensAt(x) && opensAt(x) > now);
    const cur = items.find((x) => x.id === step.id) || { id: step.id, name: step.name, slug: step.slug, st: {}, lesson: false };
    const locked = isLocked(cur);
    const shown = items.filter((x) => !x.hidden || x.id === step.id);
    const at = shown.findIndex((x) => x.id === step.id);
    const prev = at > 0 ? shown[at - 1] : null;
    const next = at >= 0 && at < shown.length - 1 ? shown[at + 1] : null;
    const prog = progressOf(items, me);

    // The menu: modules (a heading wherever the module name changes), lessons with ticks and locks.
    let lastModule = '';
    const links = shown.map((x) => {
      const mod = x.lesson && x.module && x.module !== lastModule ? `<div class="crs-mod">${esc(x.module)}</div>` : '';
      if (x.lesson) lastModule = x.module; else if (!x.entry) lastModule = '';
      const lk = isLocked(x);
      const done = me?.done.has(x.id);
      const mark = lk ? '<span class="crs-ic lock" aria-label="Locked">&#128274;</span>' : done ? '<span class="crs-ic done" aria-label="Done">&#10003;</span>'
        : x.entry ? '<span class="crs-ic home">&#8962;</span>' : x.lesson ? '<span class="crs-ic"></span>' : '<span class="crs-ic page">&#8226;</span>';
      return `${mod}<a class="crs-l${x.id === step.id ? ' cur' : ''}${lk ? ' locked' : ''}${done ? ' done' : ''}" href="${esc(href(x))}"${x.id === step.id ? ' aria-current="page"' : ''}>${mark}<span class="crs-n">${esc(x.entry ? 'Course home' : x.name)}${lk ? `<small>Opens ${esc(shortDay(opensAt(x)))}</small>` : ''}</span></a>`;
    }).join('');
    const bar = `<span class="crs-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${prog.total}" aria-valuenow="${prog.done}"><i style="width:${prog.pct}%"></i></span>`;
    const count = owner && !me ? `${prog.total} lesson${prog.total === 1 ? '' : 's'}` : `${prog.done} of ${prog.total} done`;
    const nav = `<aside class="crs" aria-label="Course contents"><input type="checkbox" id="crs-t" hidden>
      <label for="crs-t" class="crs-head"><b>${esc(funnel.name)}</b><span class="crs-count">${count}</span>${bar}<span class="crs-tog">Lessons &#9662;</span></label>
      <nav class="crs-list">${links}</nav></aside>`;

    let top = '';
    if (owner && cur.lesson && (cur.st.dripDays || cur.st.dripDate)) {
      top += `<div class="crs-note">Only you see this now. Members can open this lesson ${DATE_RE.test(String(cur.st.dripDate || '')) ? `from ${esc(fmtDay(unlockAt(cur.st), now))}` : `${Number(cur.st.dripDays)} day${Number(cur.st.dripDays) === 1 ? '' : 's'} after they join`}.</div>`;
    }
    if (cur.entry && prog.total) {
      const upNext = items.find((x) => x.lesson && !x.hidden && !me?.done.has(x.id) && !isLocked(x));
      const waiting = !upNext && items.find((x) => x.lesson && !x.hidden && !me?.done.has(x.id));
      top += `<section class="crs-home"><div class="crs-home-t">${me ? (prog.done === prog.total ? 'You finished the course. Well done!' : prog.done ? 'Welcome back' : 'Your course') : 'Course progress (members see theirs here)'}</div>
        <div class="crs-big">${prog.done} of ${prog.total} lessons done</div>${bar}
        ${upNext ? `<a class="btn crs-go" href="${esc(href(upNext))}">${prog.done ? 'Continue' : 'Start'}: ${esc(upNext.name)} &rarr;</a>`
    : waiting ? `<p class="crs-wait">Next lesson opens ${esc(fmtDay(opensAt(waiting), now))}.</p>` : ''}</section>`;
    }

    // Under the lesson: mark it done, then previous / next.
    let bottom = '';
    if (cur.lesson && !locked) {
      const done = me?.done.has(cur.id);
      bottom += done
        ? `<div class="crs-done"><span class="crs-ok">&#10003; You finished this lesson</span>${next ? `<a class="btn" href="${esc(href(next))}">Next: ${esc(next.name)} &rarr;</a>` : ''}
          <form method="post" action="/m/${esc(funnel.slug)}/done/${esc(cur.slug)}"><input type="hidden" name="undo" value="1"><button class="crs-undo">Mark as not done</button></form></div>`
        : `<form class="crs-done" method="post" action="/m/${esc(funnel.slug)}/done/${esc(cur.slug)}"><button class="btn">${next ? 'Mark complete &amp; continue &rarr;' : 'Mark complete'}</button></form>`;
    }
    if (prev || next) {
      bottom += `<nav class="crs-pn" aria-label="Previous and next">${prev ? `<a href="${esc(href(prev))}">&larr; ${esc(prev.entry ? 'Course home' : prev.name)}</a>` : '<span></span>'}${next ? `<a href="${esc(href(next))}">${esc(next.name)} &rarr;</a>` : ''}</nav>`;
    }

    const lockedBlocks = locked ? [
      { id: 'lk1', type: 'heading', text: cur.name, size: 'large', align: 'center' },
      { id: 'lk2', type: 'text', text: `This lesson opens on ${fmtDay(opensAt(cur), now)}.${funnel.drip_emails ? ' We’ll email you when it’s ready.' : ''} Until then, catch up on the lessons you already have.`, align: 'center' },
      { id: 'lk3', type: 'button', label: 'Back to the course', url: home, align: 'center' },
    ] : null;
    return { locked, lockedBlocks, course: { nav, top, bottom, css: COURSE_CSS } };
  }

  // ---------- Mark a lesson done (or not) ----------
  const form = express.urlencoded({ extended: false, limit: '2kb' });
  app.post('/m/:slug/done/:step', form, async (req, res) => {
    const funnel = await db().get("SELECT * FROM funnels WHERE slug = ? AND kind = 'members'", String(req.params.slug).slice(0, 80));
    if (!funnel) return res.status(404).type('text').send('Not found');
    const items = await outline(funnel);
    const cur = items.find((x) => x.slug === String(req.params.step));
    if (!cur) return res.status(404).type('text').send('Not found');
    const base = `/f/${funnel.slug}`;
    const href = (x) => (x.entry ? base : `${base}/${x.slug}`);
    const cid = members.memberOf(req, funnel);
    const me = await memberState(funnel.id, cid);
    const open = !(unlockAt(cur.st, me?.joined) > new Date());
    const undo = req.body.undo === '1';
    if (me && cur.lesson && open) {
      await db().run(`INSERT INTO member_lessons (account_id, funnel_id, step_id, contact_id, completed_at) VALUES (?, ?, ?, ?, ${undo ? 'NULL' : 'now()'})
        ON CONFLICT (step_id, contact_id) DO UPDATE SET completed_at = ${undo ? 'NULL' : 'COALESCE(member_lessons.completed_at, now())'}`, funnel.account_id, funnel.id, cur.id, cid);
    }
    const shown = items.filter((x) => !x.hidden || x.id === cur.id);
    const next = shown[shown.findIndex((x) => x.id === cur.id) + 1];
    res.redirect(303, undo || !next ? href(undo ? cur : items[0] || cur) : href(next));
  });

  // ---------- Owner: course settings and each member's progress ----------
  const area = async (req) => {
    const f = await getFunnel(req.accountId, req.params.id);
    if (f.kind !== 'members') throw new HttpError(404, 'Not found');
    return f;
  };
  api.get('/members-areas/:id/course', async (req, res) => {
    const f = await area(req);
    const row = await db().get('SELECT drip_emails FROM funnels WHERE id = ?', f.id);
    const items = await outline({ id: f.id, entry_step_id: f.entry_step_id });
    const ids = new Set(items.filter((x) => x.lesson && !x.hidden).map((x) => x.id));
    const rows = await db().all('SELECT contact_id, step_id FROM member_lessons WHERE funnel_id = ? AND account_id = ? AND completed_at IS NOT NULL', f.id, req.accountId);
    const progress = {};
    for (const r of rows) if (ids.has(r.step_id)) progress[r.contact_id] = (progress[r.contact_id] || 0) + 1;
    res.json({ lessons: ids.size, dripped: items.filter((x) => x.lesson && (x.st.dripDays || x.st.dripDate)).length,
      drip_emails: Boolean(row.drip_emails), portal_url: members.portalUrl(req.accountId), progress });
  });
  api.put('/members-areas/:id/course', async (req, res) => {
    const f = await area(req);
    if ('drip_emails' in (req.body || {})) await db().run('UPDATE funnels SET drip_emails = ? WHERE id = ? AND account_id = ?', req.body.drip_emails ? 1 : 0, f.id, req.accountId);
    res.json({ ok: true });
  });

  // ---------- Customer login: all courses and orders in one place ----------
  const account = async (raw) => (/^\d{1,9}$/.test(String(raw)) ? db().get('SELECT id, name, from_name, brand_color FROM accounts WHERE id = ?', Number(raw)) : null);
  const signedInContact = async (req, acct) => {
    const cid = members.memberOf(req, { account_id: acct.id });
    return cid ? db().get('SELECT * FROM contacts WHERE id = ? AND account_id = ?', cid, acct.id) : null;
  };
  const portalLink = (acct, contactId, days = 7) => {
    const exp = Math.floor(Date.now() / 1000) + days * 86400;
    const body = `${contactId}.${acct.id}.${exp}`;
    return `${members.base()}/my/${acct.id}/enter/${body}.${members.sign(`portal:${body}`)}`;
  };
  const page = (res, acct, title, inner, status = 200) => {
    const brand = /^#[0-9a-f]{6}$/i.test(acct.brand_color || '') ? acct.brand_color : '#1B736D';
    res.set('X-Robots-Tag', 'noindex').status(status).type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · ${esc(acct.name)}</title>
<style>${PORTAL_CSS.replace(/BRAND/g, brand)}</style></head><body><header class="top"><div class="in"><b>${esc(acct.name)}</b>${inner.signedIn ? `<span class="who">${esc(inner.signedIn)} · <a href="/my/${acct.id}/logout">Sign out</a></span>` : ''}</div></header>
<main>${inner.html}</main></body></html>`);
  };
  const loginForm = (res, acct, { sent = false, status = 200 } = {}) => page(res, acct, 'Your account', { html: `<div class="card narrow"><h1>Your courses and orders</h1>
    ${sent ? '<p class="ok">If that email has bought from us or has a course, a sign-in link is on its way. Check your inbox (and spam, just in case).</p>'
    : `<p class="m">Enter the email you used when you bought or joined, and we’ll email you a sign-in link. No password needed.</p>
    <form method="post" action="/my/${acct.id}/login"><input type="email" name="email" required autocomplete="email" placeholder="you@example.com" aria-label="Your email"><button class="b">Email me a sign-in link</button></form>`}</div>` }, status);

  app.get('/my/:acct', async (req, res) => {
    const acct = await account(req.params.acct);
    if (!acct) return res.status(404).type('text').send('Not found');
    const c = await signedInContact(req, acct);
    if (!c) return loginForm(res, acct);
    const areas = await db().all(`SELECT f.id, f.name, f.slug, f.entry_step_id, f.drip_emails FROM member_access m JOIN funnels f ON f.id = m.funnel_id
      WHERE m.contact_id = ? AND m.account_id = ? AND m.revoked_at IS NULL AND f.kind = 'members' AND f.status = 'live' ORDER BY m.granted_at DESC`, c.id, acct.id);
    const cards = [];
    for (const f of areas) {
      const prog = progressOf(await outline(f), await memberState(f.id, c.id));
      cards.push(`<a class="course" href="/f/${esc(f.slug)}"><b>${esc(f.name)}</b>
        ${prog.total ? `<span class="m">${prog.done} of ${prog.total} lessons done</span><span class="bar"><i style="width:${prog.pct}%"></i></span>` : '<span class="m">Members area</span>'}
        <span class="go">${prog.done && prog.done < prog.total ? 'Continue' : 'Open'} &rarr;</span></a>`);
    }
    const orders = await db().all(`SELECT id, product_name, amount_cents, currency, paid_at, created_at FROM orders
      WHERE account_id = ? AND contact_id = ? AND status = 'paid' ORDER BY COALESCE(paid_at, created_at) DESC LIMIT 100`, acct.id, c.id);
    page(res, acct, 'Your account', { signedIn: c.email, html: `<h1>Hi ${esc(c.first_name || 'there')}</h1>
      <h2>Your courses</h2>${cards.length ? `<div class="grid">${cards.join('')}</div>` : '<p class="m card">No courses yet.</p>'}
      <h2>Your orders</h2>${orders.length ? `<div class="card list">${orders.map((o) => `<div class="row"><span><b>${esc(o.product_name)}</b><br><span class="m">${esc(shortDay(new Date(o.paid_at || o.created_at)))}, ${new Date(o.paid_at || o.created_at).getUTCFullYear()}</span></span>
        <span class="amt">${esc(formatMoney(o.amount_cents, o.currency))}</span><a href="/my/${acct.id}/receipt/${o.id}">Receipt</a></div>`).join('')}</div>` : '<p class="m card">No orders yet.</p>'}` });
  });
  app.post('/my/:acct/login', form, async (req, res) => {
    const acct = await account(req.params.acct);
    if (!acct) return res.status(404).type('text').send('Not found');
    const email = String(req.body.email || '').trim().toLowerCase();
    // Same answer either way, so the form can't be used to find out who's a customer.
    if (EMAIL_RE.test(email)) {
      const c = await db().get('SELECT * FROM contacts WHERE account_id = ? AND email = ?', acct.id, email);
      const known = c && (await db().get('SELECT 1 FROM member_access WHERE contact_id = ? AND account_id = ? AND revoked_at IS NULL', c.id, acct.id)
        || await db().get("SELECT 1 FROM orders WHERE contact_id = ? AND account_id = ? AND status = 'paid'", c.id, acct.id));
      const recent = known && await db().get("SELECT 1 FROM email_log WHERE contact_id = ? AND subject LIKE 'Your sign-in link%' AND created_at > now() - interval '2 minutes'", c.id);
      if (known && !recent) {
        const full = await db().get('SELECT * FROM accounts WHERE id = ?', acct.id);
        await messaging.sendTransactional({ account: full, to: c.email, contactId: c.id, subject: `Your sign-in link for ${acct.name}`,
          text: `Hi ${c.first_name || 'there'},\n\nHere’s your link to see all your courses and orders with ${acct.name}:\n\n${portalLink(acct, c.id)}\n\nThe link works for 7 days and keeps you signed in on this device.\n\n${full.from_name || acct.name}` })
          .catch((e) => console.error('portal link:', e.message));
      }
    }
    loginForm(res, acct, { sent: true });
  });
  app.get('/my/:acct/enter/:token', async (req, res) => {
    const acct = await account(req.params.acct);
    if (!acct) return res.status(404).type('text').send('Not found');
    const parts = String(req.params.token).split('.');
    const [cid, aid, exp, sig] = parts;
    const ok = parts.length === 4 && members.same(sig, members.sign(`portal:${cid}.${aid}.${exp}`)) && Number(aid) === acct.id && Number(exp) * 1000 > Date.now()
      && await db().get('SELECT 1 FROM contacts WHERE id = ? AND account_id = ?', Number(cid), acct.id);
    if (!ok) return loginForm(res, acct, { status: 401 });
    members.signIn(res, acct.id, Number(cid));
    res.redirect(303, `/my/${acct.id}`);
  });
  app.get('/my/:acct/logout', async (req, res) => {
    const acct = await account(req.params.acct);
    if (!acct) return res.status(404).type('text').send('Not found');
    members.signOut(res, acct.id);
    res.redirect(303, `/my/${acct.id}`);
  });
  app.get('/my/:acct/receipt/:order', async (req, res) => {
    const acct = await account(req.params.acct);
    if (!acct) return res.status(404).type('text').send('Not found');
    const c = await signedInContact(req, acct);
    if (!c) return loginForm(res, acct, { status: 401 });
    const o = /^\d{1,9}$/.test(req.params.order) && await db().get("SELECT * FROM orders WHERE id = ? AND account_id = ? AND contact_id = ? AND status = 'paid'", Number(req.params.order), acct.id, c.id);
    if (!o) return res.status(404).type('text').send('Not found');
    let items = parse(o.items); if (!Array.isArray(items) || !items.length) items = [{ name: o.product_name, qty: 1, price_cents: o.amount_cents }];
    const when = new Date(o.paid_at || o.created_at);
    page(res, acct, `Receipt #${o.id}`, { signedIn: c.email, html: `<p><a href="/my/${acct.id}">&larr; Your account</a></p><div class="card receipt">
      <div class="row"><h1>Receipt</h1><span class="m">#${o.id}</span></div>
      <p class="m">${esc(acct.name)}<br>Paid ${esc(fmtDay(when))}, ${when.getUTCFullYear()}${o.mode === 'test' ? ' (test purchase)' : ''}<br>To: ${esc(o.email || c.email)}</p>
      ${items.map((x) => `<div class="row"><span>${esc(x.name)}${Number(x.qty) > 1 ? ` &times; ${Number(x.qty)}` : ''}</span><span>${esc(formatMoney(Number(x.price_cents) * (Number(x.qty) || 1), o.currency))}</span></div>`).join('')}
      <div class="row total"><b>Total paid</b><b>${esc(formatMoney(o.amount_cents, o.currency))}</b></div>
      <button class="b print" onclick="print()">Print or save as PDF</button></div>` });
  });

  // ---------- "Lesson is ready" emails ----------
  async function sendUnlocks(now = new Date()) {
    let sent = 0;
    const areas = await db().all("SELECT * FROM funnels WHERE kind = 'members' AND status = 'live' AND drip_emails = 1");
    for (const f of areas) {
      const dripped = (await outline(f)).filter((x) => x.lesson && !x.hidden && (x.st.dripDays || x.st.dripDate));
      if (!dripped.length) continue;
      const people = await db().all(`SELECT m.contact_id, m.granted_at, c.email, c.first_name FROM member_access m JOIN contacts c ON c.id = m.contact_id
        WHERE m.funnel_id = ? AND m.revoked_at IS NULL`, f.id);
      let account;
      for (const x of dripped) {
        for (const p of people) {
          const at = unlockAt(x.st, p.granted_at);
          // Only lessons that opened in the last 2 days, after the person joined (not ones they had from day one).
          if (!at || at > now || at <= new Date(p.granted_at) || at < new Date(now.getTime() - 2 * DAY)) continue;
          const claim = await db().get(`INSERT INTO member_lessons (account_id, funnel_id, step_id, contact_id, notified_at) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (step_id, contact_id) DO UPDATE SET notified_at = EXCLUDED.notified_at WHERE member_lessons.notified_at IS NULL RETURNING id`, f.account_id, f.id, x.id, p.contact_id, now.toISOString());
          if (!claim) continue;
          account ??= await db().get('SELECT * FROM accounts WHERE id = ?', f.account_id);
          await messaging.sendTransactional({ account, to: p.email, contactId: p.contact_id, subject: `${x.name} is ready`,
            text: `Hi ${p.first_name || 'there'},\n\nA new lesson just opened in ${f.name}: ${x.name}.\n\nOpen it here: ${members.enterLink(f, p.contact_id, 7, x.slug)}\n\n${account.from_name || account.name}` })
            .then(() => { sent++; }).catch((e) => console.error('lesson ready:', e.message));
        }
      }
    }
    return { lesson_ready_emails: sent };
  }

  return { view, sendUnlocks };
}

const COURSE_CSS = `
.crs{font:15px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;border-bottom:1px solid rgba(0,0,0,.1);background:color-mix(in srgb,var(--crs-accent) 4%,var(--crs-bg))}
.crs-head{display:grid;grid-template-columns:1fr auto;gap:4px 14px;align-items:center;max-width:var(--crs-w);margin:0 auto;padding:12px 20px;cursor:pointer}
.crs-head b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.crs-count{font-size:.85rem;opacity:.75;text-align:right}
.crs-bar{grid-column:1/-1;display:block;height:6px;border-radius:99px;background:rgba(0,0,0,.08);overflow:hidden}.crs-bar i{display:block;height:100%;background:var(--crs-accent);border-radius:99px}
.crs-tog{grid-column:1/-1;font-size:.85rem;color:var(--crs-accent);font-weight:600}
.crs-list{display:none;max-width:var(--crs-w);margin:0 auto;padding:0 12px 12px}#crs-t:checked~.crs-list{display:block}
.crs-mod{font-size:.75rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;opacity:.6;padding:14px 8px 4px}
.crs-l{display:flex;gap:10px;align-items:flex-start;padding:8px;border-radius:8px;color:inherit;text-decoration:none}.crs-l:hover{background:rgba(0,0,0,.05)}
.crs-l.cur{background:color-mix(in srgb,var(--crs-accent) 12%,transparent);font-weight:600}.crs-l.locked{opacity:.6}
.crs-n small{display:block;font-size:.78rem;font-weight:400;opacity:.8}
.crs-ic{flex:none;width:20px;height:20px;border-radius:50%;border:2px solid rgba(0,0,0,.2);display:grid;place-items:center;font-size:.7rem;margin-top:1px}
.crs-ic.done{background:var(--crs-accent);border-color:var(--crs-accent);color:#fff;font-weight:800}.crs-ic.lock,.crs-ic.home,.crs-ic.page{border:0;font-size:.85rem}
.crs-note{background:#fef3c7;color:#92400e;border-radius:10px;padding:10px 14px;font-size:.9rem}
.crs-home{border:1px solid rgba(0,0,0,.1);border-radius:14px;padding:20px 22px;background:color-mix(in srgb,var(--crs-accent) 5%,var(--crs-bg))}
.crs-home .crs-bar{margin:10px 0 16px;height:8px}.crs-home-t{font-size:.85rem;opacity:.7;text-transform:uppercase;letter-spacing:.06em;font-weight:600}.crs-big{font-size:1.4rem;font-weight:700}.crs-wait{margin:0;opacity:.8}
.crs-done{display:flex;flex-wrap:wrap;gap:12px 16px;align-items:center;margin-top:40px;padding-top:24px;border-top:1px solid rgba(0,0,0,.1)}.crs-done form{margin:0}
.crs-ok{color:var(--crs-accent);font-weight:600}.crs-undo{background:none;border:0;padding:0;font:inherit;font-size:.85rem;opacity:.65;text-decoration:underline;cursor:pointer;color:inherit}
.crs-pn{display:flex;justify-content:space-between;gap:16px;margin-top:24px;font-size:.95rem}.crs-pn a{color:var(--crs-accent);text-decoration:none;font-weight:600}
@media(min-width:1180px){body.has-crs{padding-left:300px}.crs{position:fixed;left:0;top:0;bottom:0;width:300px;overflow:auto;border-bottom:0;border-right:1px solid rgba(0,0,0,.1);z-index:6}
.crs-head{cursor:default;padding:20px 20px 8px}.crs-tog{display:none}.crs-list{display:block;padding:0 12px 24px}}
`;

const PORTAL_CSS = `*{box-sizing:border-box}body{margin:0;font:16px/1.55 -apple-system,system-ui,sans-serif;color:#14282B;background:#F4F7F6}
.top{background:#fff;border-bottom:1px solid #E3E9E8}.top .in{max-width:860px;margin:0 auto;padding:14px 16px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.who{color:#5B6B70;font-size:.9rem}
main{max-width:860px;margin:0 auto;padding:28px 16px 60px}h1{font-size:1.6rem;margin:0 0 6px}h2{font-size:1.1rem;margin:28px 0 12px}a{color:BRAND}
.card{background:#fff;border:1px solid #E3E9E8;border-radius:16px;padding:22px}.narrow{max-width:440px;margin:8vh auto 0}.m{color:#5B6B70}
input{width:100%;padding:12px;border:1px solid #c9d1d3;border-radius:10px;font:inherit;margin:14px 0 8px}
.b{width:100%;background:BRAND;color:#fff;border:0;border-radius:10px;padding:13px;font:600 1rem system-ui;cursor:pointer}.ok{background:#e6f4f2;color:#14524d;border-radius:10px;padding:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px}
.course{display:flex;flex-direction:column;gap:6px;background:#fff;border:1px solid #E3E9E8;border-radius:16px;padding:20px;color:inherit;text-decoration:none}.course:hover{border-color:BRAND}
.bar{display:block;height:8px;border-radius:99px;background:#E3E9E8;overflow:hidden}.bar i{display:block;height:100%;background:BRAND}.go{color:BRAND;font-weight:600;margin-top:6px}
.list{padding:6px 22px}.row{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:12px 0;border-bottom:1px solid #EEF2F1}.list .row:last-child{border-bottom:0}.row .amt{margin-left:auto}
.receipt{max-width:560px}.receipt h1{margin:0}.receipt .total{border-bottom:0;font-size:1.1rem}.print{margin-top:18px}
@media print{.top,.print,main>p{display:none}.card{border:0}}`;

module.exports = { registerCourses, unlockAt };
