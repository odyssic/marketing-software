// Invoices and payment links, for businesses that don't sell from a page.
// An invoice is for one client: line items, a due date, emailed with a Pay
// button, marked paid automatically, one polite reminder when overdue. A
// payment link is reusable: a fixed amount anyone can pay (deposits, sessions).
// Paying creates an ordinary order, so it flows into People, sales, workflows
// and review requests like any other sale.
const crypto = require('node:crypto');
const express = require('express');

const money = (cents, cur = 'usd') => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur.toUpperCase() }).format((cents || 0) / 100);
const escH = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanItems(items) {
  return (Array.isArray(items) ? items : []).map((i) => ({
    description: String(i?.description || '').trim().slice(0, 200),
    qty: Math.max(1, Math.min(9999, Math.round(Number(i?.qty) || 1))),
    price_cents: Math.max(0, Math.round(Number(i?.price) * 100 || Number(i?.price_cents) || 0)),
  })).filter((i) => i.description && i.price_cents > 0).slice(0, 50);
}
const totalOf = (items) => items.reduce((n, i) => n + i.qty * i.price_cents, 0);
const ymd = (d) => (d instanceof Date ? d.toISOString() : String(d || '')).slice(0, 10) || null;
const parse = (r) => ({ ...r, due_date: r.due_date ? ymd(r.due_date) : null, items: JSON.parse(r.items || '[]') });

function registerInvoices(app, api, { getDb, HttpError, id, upsertContact, messaging, publicBase, stripe, orderToken, ownerViewing }) {
  const db = () => getDb();
  const out = (r) => ({ ...parse(r), url: `${publicBase()}/pay/${r.token}`, totalLabel: money(r.total_cents, r.currency),
    overdue: r.kind === 'invoice' && r.status === 'sent' && r.due_date && new Date(`${ymd(r.due_date)}T23:59:59Z`) < new Date() });

  async function emailInvoice(inv, { reminder = false } = {}) {
    const account = await db().get('SELECT * FROM accounts WHERE id = ?', inv.account_id);
    const link = `${publicBase()}/pay/${inv.token}`;
    const items = parse(inv).items.map((i) => `• ${i.description}${i.qty > 1 ? ` × ${i.qty}` : ''}: ${money(i.qty * i.price_cents, inv.currency)}`).join('\n');
    const due = inv.due_date ? new Date(`${ymd(inv.due_date)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';
    const subject = reminder ? `Reminder: invoice #${inv.number} from ${account.name} (${money(inv.total_cents, inv.currency)})` : `Invoice #${inv.number} from ${account.name}: ${money(inv.total_cents, inv.currency)}`;
    const text = `Hi ${String(inv.client_name || '').split(' ')[0] || 'there'},\n\n${reminder ? `A friendly reminder that this invoice${due ? ` was due on ${due}` : ' is still open'}.` : `Here’s your invoice${inv.title ? ` for ${inv.title}` : ''}.`}\n\n${items}\n\nTotal: ${money(inv.total_cents, inv.currency)}${due && !reminder ? `\nDue: ${due}` : ''}\n${inv.note ? `\n${inv.note}\n` : ''}\nView and pay: ${link}\n\nThank you!\n${account.from_name || account.name}`;
    await messaging.sendTransactional({ account, to: inv.client_email, contactId: inv.contact_id, subject, text });
  }

  // ---------- Owner API ----------
  api.get('/invoices', async (req, res) => {
    const rows = await db().all('SELECT * FROM invoices WHERE account_id = ? AND status <> ? ORDER BY id DESC LIMIT 300', req.accountId, 'deleted');
    res.json(rows.map(out));
  });
  api.post('/invoices', async (req, res) => {
    const b = req.body || {};
    const kind = b.kind === 'link' ? 'link' : 'invoice';
    const items = cleanItems(b.items);
    if (!items.length) throw new HttpError(400, kind === 'link' ? 'Add what it’s for and the amount' : 'Add at least one line with an amount');
    let contactId = null, clientEmail = '', clientName = '';
    if (kind === 'invoice') {
      clientEmail = String(b.client_email || '').trim().toLowerCase();
      clientName = String(b.client_name || '').trim().slice(0, 120);
      if (!EMAIL_RE.test(clientEmail)) throw new HttpError(400, 'Add the client’s email so we can send it');
      const [first, ...rest] = clientName.split(/\s+/);
      contactId = (await upsertContact(db(), req.accountId, { email: clientEmail, first_name: first || '', last_name: rest.join(' '), source: 'manual' })).id;
    }
    const due = /^\d{4}-\d{2}-\d{2}$/.test(String(b.due_date || '')) ? b.due_date : null;
    const currency = /^[a-z]{3}$/.test(String(b.currency || '')) ? b.currency : 'usd';
    const num = (await db().get('SELECT COALESCE(MAX(number), 1000) + 1 AS n FROM invoices WHERE account_id = ?', req.accountId)).n;
    const r = await db().get(`INSERT INTO invoices (account_id, contact_id, kind, number, title, items, currency, total_cents, due_date, note, status, token, client_email, client_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`, req.accountId, contactId, kind, num, String(b.title || '').trim().slice(0, 120),
    JSON.stringify(items), currency, totalOf(items), due, String(b.note || '').trim().slice(0, 1000), kind === 'link' ? 'active' : 'draft',
    crypto.randomBytes(15).toString('base64url'), clientEmail, clientName);
    if (kind === 'invoice' && b.send) {
      await emailInvoice(r);
      await db().run("UPDATE invoices SET status = 'sent', sent_at = now() WHERE id = ?", r.id);
    }
    res.status(201).json(out(await db().get('SELECT * FROM invoices WHERE id = ?', r.id)));
  });
  const mine = async (req) => {
    const r = await db().get('SELECT * FROM invoices WHERE id = ? AND account_id = ?', id(req.params.id), req.accountId);
    if (!r) throw new HttpError(404, 'Not found');
    return r;
  };
  api.post('/invoices/:id/send', async (req, res) => {
    const r = await mine(req);
    if (r.kind !== 'invoice' || ['paid', 'void'].includes(r.status)) throw new HttpError(409, 'This can’t be sent');
    await emailInvoice(r, { reminder: r.status === 'sent' });
    await db().run("UPDATE invoices SET status = 'sent', sent_at = COALESCE(sent_at, now()) WHERE id = ?", r.id);
    res.json(out(await db().get('SELECT * FROM invoices WHERE id = ?', r.id)));
  });
  api.post('/invoices/:id/status', async (req, res) => {
    const r = await mine(req);
    const to = String(req.body?.status || '');
    const allowed = r.kind === 'link' ? ['active', 'archived'] : ['void', 'paid', 'sent', 'draft'];
    if (!allowed.includes(to)) throw new HttpError(400, 'Not allowed');
    await db().run(`UPDATE invoices SET status = ?, paid_at = ${to === 'paid' ? 'COALESCE(paid_at, now())' : 'paid_at'} WHERE id = ?`, to, r.id);
    res.json(out(await db().get('SELECT * FROM invoices WHERE id = ?', r.id)));
  });

  // ---------- Public pay page ----------
  const page = (res, title, body, status = 200) => res.status(status).type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escH(title)}</title>
    <style>body{font:16px/1.55 -apple-system,system-ui,sans-serif;color:#14282B;background:#F4F7F6;margin:0;padding:32px 16px}.c{max-width:520px;margin:0 auto;background:#fff;border:1px solid #E3E9E8;border-radius:16px;padding:28px}
    h1{font-size:1.25rem;margin:0}.m{color:#5B6B70}table{width:100%;border-collapse:collapse;margin:16px 0}td{padding:8px 0;border-top:1px solid #E3E9E8}td:last-child{text-align:right;white-space:nowrap}
    .tot td{font-weight:700;font-size:1.1rem}button{width:100%;background:#1F7F78;color:#fff;border:0;border-radius:12px;padding:14px;font:600 1.05rem system-ui;cursor:pointer;margin-top:8px}
    input{width:100%;box-sizing:border-box;padding:12px;border:1px solid #d1d5db;border-radius:10px;font:inherit;margin-top:8px}.paid{background:#e6f4f2;color:#14524d;border-radius:12px;padding:14px;text-align:center;font-weight:600}
    .hd{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:6px}.f{font-size:.8rem;color:#5B6B70;text-align:center;margin-top:16px}</style></head><body><div class="c">${body}</div><p class="f">Secure payment</p></body></html>`);
  const byToken = (t) => db().get('SELECT i.*, a.name AS acct_name, a.stripe_secret_key FROM invoices i JOIN accounts a ON a.id = i.account_id WHERE i.token = ?', String(t).slice(0, 64));

  app.get('/pay/:token', async (req, res) => {
    const inv = await byToken(req.params.token);
    if (!inv || inv.status === 'deleted' || inv.status === 'draft' && !await ownerViewing(req, inv)) return page(res, 'Not found', '<h1>This link isn’t available</h1>', 404);
    const r = parse(inv);
    const closed = (r.kind === 'invoice' && ['paid', 'void'].includes(r.status)) || (r.kind === 'link' && r.status === 'archived');
    const due = r.due_date ? new Date(`${ymd(r.due_date)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';
    const testMode = !inv.stripe_secret_key;
    return page(res, `${inv.acct_name}${r.kind === 'invoice' ? ` · Invoice #${r.number}` : ''}`, `
      <div class="hd"><div><h1>${escH(inv.acct_name)}</h1><div class="m">${r.kind === 'invoice' ? `Invoice #${r.number}${r.client_name ? ` for ${escH(r.client_name)}` : ''}` : escH(r.title || 'Payment')}</div></div>
        ${due && r.kind === 'invoice' ? `<div class="m" style="text-align:right">Due<br><b style="color:#14282B">${escH(due)}</b></div>` : ''}</div>
      ${r.kind === 'invoice' && r.title ? `<p>${escH(r.title)}</p>` : ''}
      <table>${r.items.map((i) => `<tr><td>${escH(i.description)}${i.qty > 1 ? ` <span class="m">× ${i.qty}</span>` : ''}</td><td>${money(i.qty * i.price_cents, r.currency)}</td></tr>`).join('')}
        <tr class="tot"><td>Total</td><td>${money(r.total_cents, r.currency)}</td></tr></table>
      ${r.note ? `<p class="m">${escH(r.note)}</p>` : ''}
      ${req.query.paid || (r.kind === 'invoice' && r.status === 'paid') ? '<div class="paid">Paid. Thank you!</div>'
        : closed ? '<p class="m">This is no longer open for payment.</p>'
          : `<form method="post" action="/pay/${escH(r.token)}">${r.kind === 'link' ? '<input type="email" name="email" required placeholder="Your email (for your receipt)" autocomplete="email"><input name="name" placeholder="Your name" autocomplete="name">' : ''}
          <button>Pay ${money(r.total_cents, r.currency)}</button>${testMode ? '<p class="m" style="font-size:.85rem;text-align:center">Test mode: no real card is charged until payments are connected.</p>' : ''}</form>`}`);
  });

  app.post('/pay/:token', express.urlencoded({ extended: false, limit: '4kb' }), async (req, res) => {
    const inv = await byToken(req.params.token);
    if (!inv) return page(res, 'Not found', '<h1>This link isn’t available</h1>', 404);
    const r = parse(inv);
    const open = r.kind === 'invoice' ? r.status === 'sent' || (r.status === 'draft' && await ownerViewing(req, inv)) : r.status === 'active';
    if (!open) return res.redirect(303, `/pay/${r.token}`);
    const email = r.kind === 'invoice' ? r.client_email : String(req.body.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return res.redirect(303, `/pay/${r.token}`);
    const name = r.kind === 'invoice' ? r.title || `Invoice #${r.number}` : r.title || 'Payment';
    const { id: orderId } = await db().get(`INSERT INTO orders (account_id, product_name, amount_cents, currency, mode, source, external_id, items, email, contact_id)
      VALUES (?, ?, ?, ?, ?, 'invoice', ?, ?, ?, ?) RETURNING id`, inv.account_id, name, r.total_cents, r.currency, inv.stripe_secret_key ? 'stripe' : 'test',
    `inv:${r.id}:${crypto.randomBytes(4).toString('hex')}`, JSON.stringify(r.items.map((i) => ({ name: i.description, qty: i.qty, price_cents: i.price_cents }))), email, r.contact_id);
    if (!inv.stripe_secret_key) return res.redirect(303, `/checkout/test/${orderId}/${orderToken(orderId)}`);
    try {
      const base = publicBase();
      const session = await stripe.createCheckoutSession(inv.stripe_secret_key, {
        product: { name: `${name} · ${inv.acct_name}`, price_cents: r.total_cents, currency: r.currency, billing: 'one_time' }, orderId, email,
        successUrl: `${base}/checkout/success/${orderId}?session_id={CHECKOUT_SESSION_ID}`, cancelUrl: `${base}/pay/${r.token}`,
      });
      await db().run('UPDATE orders SET stripe_session_id = ? WHERE id = ?', session.id, orderId);
      res.redirect(303, session.url);
    } catch (e) {
      console.error('invoice checkout:', e.message);
      page(res, 'Try again', '<h1>Payment is temporarily unavailable</h1><p class="m">Please try again in a moment.</p>', 502);
    }
  });

  // Called once an order is paid (any route): close the invoice / count the link payment.
  async function onOrderPaid(order) {
    const m = String(order.external_id || '').match(/^inv:(\d+):/);
    if (!m) return null;
    const inv = await db().get('SELECT * FROM invoices WHERE id = ? AND account_id = ?', Number(m[1]), order.account_id);
    if (!inv) return null;
    if (inv.kind === 'invoice') await db().run("UPDATE invoices SET status = 'paid', paid_at = COALESCE(paid_at, now()) WHERE id = ?", inv.id);
    else await db().run('UPDATE invoices SET payments = payments + 1, paid_at = now() WHERE id = ?', inv.id);
    return `/pay/${inv.token}?paid=1`;
  }

  // One polite reminder, three days after the due date.
  async function remindOverdue(now = new Date()) {
    const cutoff = new Date(now.getTime() - 3 * 864e5).toISOString().slice(0, 10);
    const due = await db().all("SELECT * FROM invoices WHERE kind = 'invoice' AND status = 'sent' AND due_date IS NOT NULL AND due_date <= ? AND reminded_at IS NULL", cutoff);
    let sent = 0;
    for (const inv of due) {
      const c = await db().get('UPDATE invoices SET reminded_at = ? WHERE id = ? AND reminded_at IS NULL RETURNING id', now.toISOString(), inv.id);
      if (!c) continue;
      await emailInvoice(inv, { reminder: true }).catch((e) => console.error('invoice reminder:', e.message));
      sent++;
    }
    return { invoice_reminders: sent };
  }

  return { onOrderPaid, remindOverdue };
}

module.exports = { registerInvoices, cleanItems, totalOf, money };
