'use strict';

// ---------------- Landing page ----------------
// What a first-time visitor sees at getrilly.com: what Rilly is, the price,
// and two buttons. People who have signed in on this browser go straight to sign in.
// The sales page is plain HTML in index.html (so search engines read it); keep a
// copy so it can be shown again after the app has replaced it.
const LANDING_HTML = (() => { const el = document.querySelector('[data-static-landing]'); return el ? el.outerHTML : ''; })();

function renderLanding(status) {
  document.documentElement.classList.remove('returning');
  if (!$('[data-static-landing]', app)) app.innerHTML = LANDING_HTML;
  $$('.boot', app).forEach((x) => x.remove());
  const plan = status.plan || {};
  const fmt = (c) => new Intl.NumberFormat('en-US', { style: 'currency', currency: (plan.currency || 'usd').toUpperCase(), minimumFractionDigits: c % 100 ? 2 : 0 }).format(c / 100);
  const main = plan.priceCents || 2900, extra = plan.extraCents ?? 1900;
  $$('[data-price-main]').forEach((x) => { x.textContent = fmt(main); });
  $$('[data-price-extra]').forEach((x) => { x.textContent = fmt(extra); });
  $$('[data-price-three]').forEach((x) => { x.textContent = fmt(main + 2 * extra); });
  $$('[data-trial]').forEach((x) => { x.textContent = String(plan.trialDays || 14); });
  $$('[data-start]').forEach((b) => { b.onclick = (e) => { e.preventDefault(); scrollTo(0, 0); renderAuth('setup'); }; });
  $$('[data-signin]').forEach((b) => { b.onclick = (e) => { e.preventDefault(); scrollTo(0, 0); renderAuth('link'); }; });
  $$('[data-jump]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); $(`#${a.dataset.jump}`)?.scrollIntoView({ behavior: 'smooth' }); }; });
}
