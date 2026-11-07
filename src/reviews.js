// Review requests that also collect testimonials. The email links to a short
// page on Rilly: tap a star, add a few words, tick "you may show my words".
// The words wait in Testimonials for the owner's approval. Everyone, whatever
// their rating, is then offered the Google review button (asking only happy
// customers, "review gating", is against Google's rules).
'use strict';
const crypto = require('node:crypto');
const express = require('express');
const { esc } = require('./render');

function registerReviews(app, { getDb, id, getSecret, logEvent }) {
  const db = () => getDb();
  const sig = (cid) => crypto.createHmac('sha256', getSecret()).update(`review:${cid}`).digest('hex').slice(0, 16);
  const reviewToken = (contactId) => `${contactId}.${sig(contactId)}`;
  const check = (token) => {
    const [cid, s] = String(token || '').split('.');
    if (!/^\d+$/.test(cid || '') || !s || s.length !== 16) return null;
    return crypto.timingSafeEqual(Buffer.from(s), Buffer.from(sig(cid))) ? Number(cid) : null;
  };
  const load = async (token) => {
    const cid = check(token);
    if (!cid) return null;
    const person = await db().get('SELECT * FROM contacts WHERE id = ?', id(cid));
    if (!person) return null;
    const account = await db().get('SELECT id, name, review_url, brand_color FROM accounts WHERE id = ?', person.account_id);
    return { person, account };
  };
  const page = (account, inner) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(account.name)}: how did we do?</title><style>
:root{--b:${/^#[0-9a-f]{6}$/i.test(account.brand_color || '') ? account.brand_color : '#0f766e'}}
*{box-sizing:border-box}body{margin:0;font:17px/1.55 system-ui,-apple-system,sans-serif;color:#1f2328;background:#f6f7f9;display:grid;place-items:center;min-height:100vh;padding:16px}
.card{background:#fff;border-radius:18px;box-shadow:0 10px 40px rgba(0,0,0,.08);padding:32px 28px;max-width:460px;width:100%;text-align:center}
.biz{font-size:14px;color:#6b7280;letter-spacing:.04em;text-transform:uppercase}h1{font-size:26px;margin:6px 0 18px}
.stars{display:flex;flex-direction:row-reverse;justify-content:center;gap:6px;margin:4px 0 18px}.stars input{position:absolute;opacity:0;pointer-events:none}
.stars label{font-size:44px;line-height:1;color:#d1d5db;cursor:pointer;transition:transform .1s}.stars label:hover{transform:scale(1.12)}
.stars input:checked~label,.stars label:hover,.stars label:hover~label{color:#f5b301}.stars input:focus-visible+label{outline:2px solid var(--b);border-radius:6px}
textarea{width:100%;border:1px solid #d6d9de;border-radius:12px;padding:12px;font:inherit;min-height:110px;resize:vertical}
.ok{display:flex;gap:8px;align-items:flex-start;text-align:left;font-size:14px;color:#4b5563;margin:12px 0 18px}
.btn{display:inline-block;background:var(--b);color:#fff;border:0;border-radius:999px;padding:13px 26px;font:600 16px system-ui,sans-serif;cursor:pointer;text-decoration:none}
.btn.ghost{background:#fff;color:var(--b);border:1px solid var(--b);margin-top:10px}.muted{color:#6b7280;font-size:14px}blockquote{margin:16px 0;padding:12px 16px;background:#f6f7f9;border-radius:12px;text-align:left}
</style></head><body><main class="card">${inner}</main></body></html>`;

  app.get('/rv/:token', async (req, res) => {
    const r = await load(req.params.token);
    if (!r) return res.status(404).type('text').send('This link has expired.');
    res.type('html').send(page(r.account, `<div class="biz">${esc(r.account.name)}</div><h1>How did we do${r.person.first_name ? `, ${esc(r.person.first_name)}` : ''}?</h1>
<form method="post"><div class="stars" role="radiogroup" aria-label="Your rating">${[5, 4, 3, 2, 1].map((n) => `<input type="radio" id="s${n}" name="rating" value="${n}" required${req.query.r == n ? ' checked' : ''}><label for="s${n}" title="${n} star${n > 1 ? 's' : ''}">★</label>`).join('')}</div>
<textarea name="words" maxlength="1500" placeholder="A few words about your experience (optional)"></textarea>
<label class="ok"><input type="checkbox" name="share" value="1" checked> ${esc(r.account.name)} may show my words and first name on their website.</label>
<button class="btn">Send</button></form>`));
  });

  app.post('/rv/:token', express.urlencoded({ extended: false, limit: '20kb' }), async (req, res) => {
    const r = await load(req.params.token);
    if (!r) return res.status(404).type('text').send('This link has expired.');
    const rating = Math.min(5, Math.max(1, Number(req.body.rating) || 0)) || null;
    const words = String(req.body.words || '').trim().slice(0, 1500);
    const share = req.body.share === '1';
    if (!rating) return res.redirect(303, req.originalUrl);
    const name = [r.person.first_name, r.person.last_name ? `${r.person.last_name[0]}.` : ''].filter(Boolean).join(' ') || 'A customer';
    // One review per person per request: a second send replaces the first.
    const prior = await db().get("SELECT id FROM testimonials WHERE account_id = ? AND person_id = ? AND source = 'review request' AND created_at > now() - interval '30 days'", r.account.id, r.person.id);
    if (words) {
      if (prior) await db().run('UPDATE testimonials SET quote = ?, rating = ?, shareable = ?, name = ? WHERE id = ?', words, rating, share ? 1 : 0, name, prior.id);
      else await db().run("INSERT INTO testimonials (account_id, person_id, quote, name, source, approved, rating, shareable) VALUES (?, ?, ?, ?, 'review request', 0, ?, ?)", r.account.id, r.person.id, words, name, rating, share ? 1 : 0);
    }
    await logEvent(db(), r.account.id, { person_id: r.person.id, type: 'note', source: 'other', meta: { note: `Rated us ${rating}/5${words ? `: “${words.slice(0, 200)}”` : ''}${words && !share ? ' (private)' : ''}`, rating } });
    const google = /^https?:\/\//.test(r.account.review_url || '') ? r.account.review_url : '';
    res.type('html').send(page(r.account, `<div class="biz">${esc(r.account.name)}</div><h1>Thank you!</h1>
${google ? `<p>Would you share it on Google too? It helps other people find us.</p>
${words ? `<blockquote id="w">${esc(words)}</blockquote><button class="btn ghost" type="button" onclick="navigator.clipboard&&navigator.clipboard.writeText(document.getElementById('w').textContent);this.textContent='Copied, now paste it on Google'">Copy my words</button><br><br>` : ''}
<a class="btn" href="${esc(google)}" rel="noopener">Leave a Google review</a><p class="muted" style="margin-top:14px">Totally optional.</p>`
    : '<p>We read every one.</p>'}`));
  });

  return { reviewToken };
}

module.exports = { registerReviews };
