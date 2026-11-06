'use strict';

// ---------------- Landing page ----------------
// What a first-time visitor sees at getrilly.com: what Rilly is, the price,
// and two buttons. People who have signed in on this browser go straight to sign in.
function renderLanding(status) {
  const plan = status.plan || {};
  const price = plan.priceCents ? new Intl.NumberFormat('en-US', { style: 'currency', currency: (plan.currency || 'usd').toUpperCase(), minimumFractionDigits: plan.priceCents % 100 ? 2 : 0 }).format(plan.priceCents / 100) : '$29';
  const trial = plan.trialDays || 14;
  const extra = plan.extraCents === 0 ? '' : new Intl.NumberFormat('en-US', { style: 'currency', currency: (plan.currency || 'usd').toUpperCase(), minimumFractionDigits: (plan.extraCents ?? 1900) % 100 ? 2 : 0 }).format((plan.extraCents ?? 1900) / 100);
  const FEATURES = [
    ['globe', 'Website and pages', 'A website, sign-up pages, sales pages and members areas. Pick a look, change the words, publish.'],
    ['mail', 'Email and texts', 'Newsletters, plus follow-ups that send themselves after someone signs up, books or buys.'],
    ['people', 'Your people', 'Everyone who signs up, books or buys, with where they came from and what they did.'],
    ['calendar', 'Bookings', 'Let people pick a time from your calendar. Confirmations and reminders go out on their own.'],
    ['bag', 'Products and payments', 'Sell products and subscriptions, send invoices and payment links. Paid through your Stripe.'],
    ['trend', 'One dashboard', 'Revenue, new customers and leads in plain words, with one suggested move each week.'],
  ];
  const STEPS = [
    ['Answer three questions', 'What you do, who it’s for, and what you want: bookings, inquiries, a list, or sales.'],
    ['Rilly builds it', 'Your page, the emails that follow it, and your booking hours. All in your words, ready to change.'],
    ['Publish and get on with your day', 'New people arrive in one place, and the follow-ups run on their own.'],
  ];
  app.innerHTML = `<div class="land">
    <header class="land-nav"><a href="#/" class="land-logo" aria-label="Rilly home">${LOGO_INK}</a>
      <nav><a href="#pricing" data-jump="pricing">Pricing</a><button type="button" class="btn" data-signin>Sign in</button><button type="button" class="btn primary" data-start>Start free</button></nav></header>
    <main>
      <section class="land-hero">
        <div class="land-copy">
          <p class="land-kicker">${esc(TAGLINE)}</p>
          <h1>All your marketing in one simple place.</h1>
          <p class="land-sub">Your website, sign-up pages, emails, follow-ups, bookings and customers, set up together. No juggling five tools. No setting the same thing up three times.</p>
          <div class="land-cta"><button type="button" class="btn primary big" data-start>Start free for ${trial} days</button><button type="button" class="btn big" data-signin>Sign in</button></div>
          <p class="muted small">No card needed to start. Then ${price}/month. Cancel any time.</p>
        </div>
        <div class="land-art" aria-hidden="true">
          <div class="la-card la-page"><span class="la-tag">Page</span><b>Get the free guide</b><i></i><i class="short"></i><span class="la-btn">Send it to me</span></div>
          <div class="la-arrow">${icon('arrowRight')}</div>
          <div class="la-card la-mail"><span class="la-tag mail">${icon('mail')} Email · right away</span><b>Here’s your guide, Sam</b><i></i><i class="short"></i></div>
          <div class="la-arrow">${icon('arrowRight')}</div>
          <div class="la-card la-mail"><span class="la-tag mail">${icon('clock')} 2 days later</span><b>Did you get a chance to read it?</b><i></i></div>
          <div class="la-note">${icon('sparkle')} One flow: the page and its follow-ups, set up together</div>
        </div>
      </section>
      <section class="land-sec">
        <h2>Everything a small business needs to grow</h2>
        <p class="land-lead">Instead of a website builder, an email tool, a booking app and a spreadsheet of customers.</p>
        <div class="land-grid">${FEATURES.map(([i, t, d]) => `<div class="land-feat"><span class="lf-ico">${icon(i)}</span><h3>${t}</h3><p>${d}</p></div>`).join('')}</div>
      </section>
      <section class="land-sec alt">
        <h2>Set up in about ten minutes</h2>
        <ol class="land-steps">${STEPS.map(([t, d], i) => `<li><span class="ls-n">${i + 1}</span><div><h3>${t}</h3><p>${d}</p></div></li>`).join('')}</ol>
      </section>
      <section class="land-sec" id="pricing">
        <h2>One simple price</h2>
        <div class="land-price card">
          <div class="lp-amt">${price}<span>/month</span></div>
          <p class="muted">Everything included, for one business.${extra ? ` Run more? Each extra business is ${extra}/month.` : ''}</p>
          <ul>${['Websites, pages and members areas', 'Email, texting and automatic follow-ups', 'Bookings, products, invoices and payments', 'Unlimited contacts, pages and emails', ...(extra ? [`Extra businesses ${extra}/month each (great for agencies)`] : []), `${trial}-day free trial, no card needed`].map((x) => `<li>${icon('check')}${x}</li>`).join('')}</ul>
          <button type="button" class="btn primary big" data-start>Start free</button>
        </div>
      </section>
      <section class="land-end"><h2>Ready to make marketing simple?</h2><button type="button" class="btn primary big" data-start>Start free for ${trial} days</button></section>
    </main>
    <footer class="land-foot"><span>${LOGO_INK}</span><span class="muted small">© ${new Date().getFullYear()} Rilly · ${esc(TAGLINE)}</span><a href="#" data-signin class="small">Sign in</a></footer>
  </div>`;
  $$('[data-start]').forEach((b) => { b.onclick = () => { scrollTo(0, 0); renderAuth('setup'); }; });
  $$('[data-signin]').forEach((b) => { b.onclick = (e) => { e.preventDefault(); scrollTo(0, 0); renderAuth('link'); }; });
  $$('[data-jump]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); $(`#${a.dataset.jump}`).scrollIntoView({ behavior: 'smooth' }); }; });
}
