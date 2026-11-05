'use strict';

// ---------------- First-run setup ----------------
// Four short screens, one question each: kind of business → about it → what the
// page should do (with hours, or a price) → a ready page to preview and publish.
const SETUP_OFFER_HINT = {
  shop: 'e.g. Hand-poured soy candles, made in Portland',
  services: 'e.g. Plumbing repairs and remodels across Austin',
  coach: 'e.g. 1:1 strength coaching for busy parents',
  local: 'e.g. Neighbourhood bakery with fresh bread every morning',
  nonprofit: 'e.g. Community garden feeding 200 families a year',
  other: 'e.g. What you do and who it’s for',
};
const SETUP_GOALS = [
  ['booked', 'Get booked', 'People pick a time from your calendar', 'calendar'],
  ['inquiries', 'Get inquiries', 'A quote or request form; you reply', 'chat'],
  ['list', 'Grow my list', 'Collect emails for news and offers', 'mail'],
  ['sell', 'Sell something', 'One product with checkout', 'bag'],
];
const SETUP_DEFAULT_GOAL = { services: 'inquiries', coach: 'booked', local: 'list', shop: 'list', nonprofit: 'list', other: 'inquiries' };

async function viewSetup() {
  const a = state.me.account;
  const s = {
    step: 1, type: a.business_type || '', name: /workspace$/i.test(a.name) ? '' : a.name, offer: '', goal: '',
    days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', length: 30, price: '',
  };
  const frame = (inner, { back = true } = {}) => {
    app.innerHTML = `<div class="setup"><div class="setup-card card">
      <div class="setup-top">${back && s.step > 1 && s.step < 4 ? `<button class="btn ghost sm" data-back>${icon('arrowRight')} Back</button>` : '<span></span>'}
        <div class="dots" role="img" aria-label="Step ${s.step} of 4">${[1, 2, 3, 4].map((i) => `<i class="${i <= s.step ? 'on' : ''}"></i>`).join('')}</div>
        ${s.step < 4 ? '<a href="#/" class="muted small" data-skip>Skip for now</a>' : '<span></span>'}</div>${inner}</div></div>`;
    const bk = $('[data-back]'); if (bk) bk.onclick = () => { s.step--; render(); };
  };
  const render = () => [null, step1, step2, step3][s.step]?.();

  // 1. What kind of business?
  const step1 = () => {
    frame(`<h1>What kind of business is this?</h1><p class="muted">We’ll set up the right page and follow-ups. You can change anything later.</p>
      <div class="choice-grid">${state.me.businessTypes.map((t) => `<button class="choice ${s.type === t.key ? 'on' : ''}" data-type="${t.key}">
        <b>${esc(t.label)}</b><span>${esc(t.hint)}</span></button>`).join('')}</div>`);
    $$('[data-type]').forEach((b) => { b.onclick = () => { s.type = b.dataset.type; s.goal = ''; s.step = 2; render(); }; });
  };

  // 2. About it.
  const step2 = () => {
    frame(`<h1>Tell us about it</h1><p class="muted">A sentence is plenty. ${state.me.aiLive ? 'We’ll write your page from it.' : 'It goes on your page.'}</p>
      <form data-f><label class="f">Business name<input name="name" required value="${esc(s.name)}" autocomplete="organization"></label>
      <label class="f">What do you do, and for whom?<textarea name="offer" rows="2" placeholder="${esc(SETUP_OFFER_HINT[s.type] || SETUP_OFFER_HINT.other)}">${esc(s.offer)}</textarea></label>
      <button class="btn primary big">Continue</button></form>`);
    $('[data-f]').onsubmit = (e) => { e.preventDefault(); const v = Object.fromEntries(new FormData(e.target)); s.name = v.name.trim(); s.offer = v.offer.trim(); s.step = 3; render(); };
    $('[name=name]').focus();
  };

  // 3. What should the page do? (Hours or a price only when needed.)
  const step3 = () => {
    s.goal = s.goal || SETUP_DEFAULT_GOAL[s.type] || 'inquiries';
    const extra = s.goal === 'booked' ? `<div class="setup-extra"><div class="f"><span>When can people book?</span>
        <div class="day-chips">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<button type="button" class="chip ${s.days.includes(d) ? 'on' : ''}" data-day="${d}" aria-pressed="${s.days.includes(d)}">${WEEKDAYS[d]}</button>`).join('')}</div></div>
        <div class="colors"><label class="f">From<input type="time" name="start" value="${s.start}"></label><label class="f">Until<input type="time" name="end" value="${s.end}"></label>
        <label class="f">Each booking<select name="length">${[15, 30, 45, 60, 90].map((m) => `<option value="${m}" ${s.length === m ? 'selected' : ''}>${m} min</option>`).join('')}</select></label></div></div>`
      : s.goal === 'sell' ? `<div class="setup-extra"><div class="colors"><label class="f">What are you selling?<input name="offer2" value="${esc(s.offer)}" required></label>
        <label class="f">Price<input name="price" type="number" min="0.5" step="0.01" inputmode="decimal" required value="${esc(s.price)}" placeholder="24.00"></label></div></div>` : '';
    frame(`<h1>What should your page do first?</h1><p class="muted">Start with one. You can add more pages any time.</p>
      <form data-f><div class="choice-grid two">${SETUP_GOALS.map(([k, l, h, ic]) => `<button type="button" class="choice ${s.goal === k ? 'on' : ''}" data-goal="${k}" aria-pressed="${s.goal === k}">
        <span class="ic">${icon(ic)}</span><b>${l}</b><span>${h}</span></button>`).join('')}</div>${extra}
      <div class="err"></div><button class="btn primary big">Build my page</button></form>`);
    const keep = () => {
      const f = $('[data-f]');
      if (f.start) { s.start = f.start.value; s.end = f.end.value; s.length = Number(f.length.value); }
      if (f.price) { s.price = f.price.value; s.offer = f.offer2.value.trim(); }
    };
    $$('[data-goal]').forEach((b) => { b.onclick = () => { keep(); s.goal = b.dataset.goal; step3(); }; });
    $$('[data-day]').forEach((b) => { b.onclick = () => { const d = Number(b.dataset.day); s.days = s.days.includes(d) ? s.days.filter((x) => x !== d) : [...s.days, d]; b.classList.toggle('on'); b.setAttribute('aria-pressed', s.days.includes(d)); }; });
    $('[data-f]').onsubmit = async (e) => {
      e.preventDefault(); keep();
      if (s.goal === 'booked' && !s.days.length) { $('.err').textContent = 'Pick at least one day'; return; }
      s.step = 4; building();
      try {
        const r = await api('POST', '/api/setup/build', { business_type: s.type, name: s.name, offer: s.offer, goal: s.goal, days: s.days, start: s.start, end: s.end, length: s.length, price: s.price, tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
        state.me = await api('GET', '/api/me');
        ready(r);
      } catch (err) { s.step = 3; step3(); $('.err').textContent = err.message; }
    };
  };

  const building = () => frame(`<h1>Building your page…</h1><p class="muted">${state.me.aiLive ? 'Writing it in your words, ' : ''}setting up follow-ups${s.goal === 'booked' ? ' and your booking hours' : ''}.</p>
    <div class="skel-page"><i class="h"></i><i></i><i></i><i class="b"></i></div>`, { back: false });

  // 4. Preview, choose follow-ups, publish.
  const ready = async (r) => {
    const f = await api('GET', `/api/funnels/${r.funnel_id}`);
    const url = publicUrl(`/f/${f.slug}`);
    frame(`<h1>Here’s your page</h1><p class="muted">Have a look. Nothing is public until you publish.</p>
      <div class="setup-preview"><div class="bar"><i></i><i></i><i></i><span>${esc(url.replace(/^https?:\/\//, ''))}</span></div><iframe src="/f/${esc(f.slug)}" title="Page preview" loading="lazy"></iframe></div>
      ${followupsHtml(r)}
      <div class="err"></div>
      <div class="setup-actions"><a class="btn" href="#/funnels/${f.id}">Edit the page first</a><button class="btn primary big" data-pub>Publish my page</button></div>`, { back: false });
    $('[data-pub]').onclick = async (e) => {
      e.target.disabled = true;
      try {
        await api('POST', `/api/funnels/${f.id}/publish`);
        for (const c of $$('[data-wf]:checked')) await api('PUT', `/api/workflows/${c.dataset.wf}/status`, { status: 'active' }).catch(() => {});
        live(url, $$('[data-wf]:checked').length);
      } catch (err) { $('.err').textContent = err.problems ? err.problems.map((p) => p.message).join(' ') : err.message; e.target.disabled = false; }
    };
  };

  const live = (url, n) => {
    frame(`<div class="setup-done"><div class="big-ok">${icon('check')}</div><h1>You’re live</h1>
      <p class="muted">${n ? `${n} follow-up${n === 1 ? ' is' : 's are'} on. ` : ''}Share your link anywhere: your bio, email signature, a text.</p>
      <div class="copy-row"><input readonly value="${esc(url)}" aria-label="Your page link"><button class="btn primary" data-copy>${icon('copy')} Copy</button></div>
      <a class="btn big" href="#/">Go to my dashboard</a></div>`, { back: false });
    $('[data-copy]').onclick = async () => { await navigator.clipboard.writeText(url).catch(() => {}); toast('Link copied'); };
  };

  render();
}

// Ready follow-ups are ticked; the ones that still need something from the owner are one calm line, not a wall of greyed-out boxes.
function followupsHtml(r) {
  const ready = r.followups.filter((w) => w.ready), later = r.followups.filter((w) => !w.ready);
  const sample = (t) => esc(t.replace(/\{\{first_name\|?[^}]*\}\}/g, 'Sam').replace(/\{\{business\}\}/g, state.me.account.name));
  return `<h2 class="section-h">What happens next</h2><div class="su-fu-list">
    ${r.booking ? `<div class="su-fu on">${icon('check')}<span><b>Booking confirmations and reminders</b><span class="muted small">Sent for every booking, with a link to change the time.</span></span></div>` : ''}
    ${ready.map((w) => `<label class="su-fu"><input type="checkbox" data-wf="${w.id}" checked><span><b>${esc(w.name)}</b>
      <span class="muted small">${w.emails} email${w.emails === 1 ? '' : 's'}${w.first ? `, starting “${sample(w.first)}”` : ''}</span></span></label>`).join('')}
    ${!r.booking && !ready.length ? `<div class="su-fu on">${icon('check')}<span><b>You’ll hear about every new lead</b><span class="muted small">They show up in People and in your Monday summary.</span></span></div>` : ''}</div>
    ${later.length ? `<p class="muted small" style="margin-top:10px">${later.length} more follow-up${later.length === 1 ? '' : 's'} (${esc(later.map((w) => w.name).join(', '))}) need a link or a few words from you. <a href="#/flows?show=followups">Finish them in Flows</a> when you’re ready.</p>` : ''}`;
}
