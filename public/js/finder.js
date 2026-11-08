'use strict';

// "What do you want to do?": one box that finds any action, page or person.
// Opens from the search button in the menu, Ctrl+K / ⌘K, or "/".

const FINDER_ACTIONS = [
  // [label, words people might type, where it goes, section it belongs to (hidden sections are left out)]
  ['Build a page with setup', 'new page website landing sign up start setup wizard', '#/setup'],
  ['New page, website or follow-up', 'create flow page funnel website follow-up automation sequence', '#/flows'],
  ['Send a newsletter or announcement', 'email newsletter broadcast announcement send mail campaign', '#/email/new', 'email'],
  ['See every email sent', 'outbox sent emails history', '#/email/outbox', 'email'],
  ['Turn follow-ups on or off', 'follow-up automation workflow sequence drip autoresponder', '#/flows?show=followups'],
  ['Add people or import a list', 'add lead import contacts csv spreadsheet upload list people customer', '#/people?add=1'],
  ['Find someone', 'people contacts customers clients search', '#/people'],
  ['Testimonials and reviews', 'testimonial review rating quotes stars google', '#/people/testimonials'],
  ['Deals board', 'deals pipeline jobs quotes board kanban', '#/pipelines', 'pipelines'],
  ['Inbox: texts, chats and replies', 'inbox messages texts sms chat replies conversations', '#/inbox'],
  ['Add a product to sell', 'product sell price checkout stripe new product', '#/products', 'products'],
  ['Orders', 'orders sales purchases receipts', '#/products/orders', 'products'],
  ['Discount codes', 'coupon discount code promo sale percent off', '#/products/coupons', 'coupons'],
  ['Send an invoice or payment link', 'invoice bill payment link charge client', '#/products/invoices', 'invoices'],
  ['Partners and referrals', 'affiliate partner referral commission', '#/products/partners', 'partners'],
  ['Files and downloads', 'files pdf download upload guide ebook', '#/products/files', 'files'],
  ['Calendar and bookings', 'calendar booking appointments schedule availability hours', '#/calendar', 'calendar'],
  ['Write a blog post', 'blog post article seo', '#/flows?show=blog', 'blog'],
  ['Community', 'community forum members posts group', '#/flows?show=community', 'community'],
  ['Courses and members areas', 'course lessons members area membership', '#/flows?show=members', 'members'],
  ['Monthly report', 'report pdf export results numbers', '#/report'],
  ['Change my logo or colours', 'logo brand colour color palette', '#/settings?s=business'],
  ['Sales style (gentle to direct)', 'sales style tone pressure gentle direct', '#/settings?s=business'],
  ['Turn features on or off', 'features menu sections hide show', '#/settings?s=business'],
  ['Connect Stripe payments', 'stripe payments connect card money', '#/settings?s=payments'],
  ['Texting, calls and website chat', 'texting sms phone number twilio chat widget calls', '#/settings?s=texting'],
  ['Use my own domain', 'domain website address url dns custom domain', '#/settings?s=address'],
  ['Customer login address', 'customer login portal my address short name handle', '#/settings?s=address'],
  ['Webhooks, API and Zapier', 'zapier make webhook api integration connect', '#/settings?s=integrations'],
  ['Add a teammate', 'team invite user staff access', '#/settings?s=team'],
  ['My plan and billing', 'plan billing subscription price pay rilly', '#/settings?s=plan'],
];

function openFinder() {
  if ($('.finder-bg')) return;
  const hidden = state.me.account.hidden_sections || [];
  const actions = FINDER_ACTIONS.filter(([, , , sec]) => !sec || !hidden.includes(sec));
  const bg = document.createElement('div');
  bg.className = 'finder-bg';
  bg.innerHTML = `<div class="finder" role="dialog" aria-label="Find anything">
    <div class="finder-in">${icon('search') || ''}<input data-fq placeholder="What do you want to do? Try “newsletter”, “logo” or a name" aria-label="What do you want to do?" autocomplete="off"></div>
    <div class="finder-list" role="listbox"></div><div class="finder-foot muted small">↑ ↓ to choose · Enter to open · Esc to close</div></div>`;
  document.body.appendChild(bg);
  const input = $('[data-fq]', bg), list = $('.finder-list', bg);
  let rows = [], sel = 0, seq = 0, flows = null;
  const close = () => bg.remove();
  const score = (text, q) => {
    const t = text.toLowerCase(), words = q.toLowerCase().split(/\s+/).filter(Boolean);
    let s = 0;
    for (const w of words) { const i = t.indexOf(w); if (i < 0) return 0; s += i === 0 || t[i - 1] === ' ' ? 3 : 1; }
    return s;
  };
  const draw = () => {
    list.innerHTML = rows.length ? rows.map((r, i) => `<a role="option" href="${esc(r.href)}" class="${i === sel ? 'on' : ''}" aria-selected="${i === sel}">
      <span class="fi">${icon(r.icon)}</span><span>${esc(r.label)}${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</span></a>`).join('')
      : `<p class="muted small" style="padding:10px 14px">Nothing found. Try another word, like “email”, “page” or “coupon”.</p>`;
    $$('a', list).forEach((a) => { a.onclick = () => close(); });
  };
  const search = async () => {
    const q = input.value.trim(), my = ++seq;
    const found = (q ? actions.map(([l, w, h]) => ({ label: l, href: h, icon: 'arrowRight', s: score(`${l} ${w}`, q) })).filter((x) => x.s).sort((a, b) => b.s - a.s)
      : actions.slice(0, 8).map(([l, , h]) => ({ label: l, href: h, icon: 'arrowRight' }))).slice(0, 8);
    rows = found; sel = 0; draw();
    if (q.length < 2) return;
    flows ??= await api('GET', '/api/funnels').catch(() => []);
    const pages = flows.filter((f) => score(f.name, q)).slice(0, 4).map((f) => ({ label: f.name, sub: f.kind === 'website' ? 'Website' : f.kind === 'members' ? 'Course' : 'Page', href: `#/${f.kind === 'website' ? 'websites' : f.kind === 'members' ? 'members' : 'funnels'}/${f.id}`, icon: 'page' }));
    const people = await api('GET', `/api/contacts?q=${encodeURIComponent(q)}`).catch(() => []);
    if (my !== seq) return;
    rows = [...found, ...pages, ...(Array.isArray(people) ? people : []).slice(0, 5).map((p) => ({ label: [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email || p.phone, sub: p.email || p.phone || '', href: `#/people/${p.id}`, icon: 'user' }))];
    draw();
  };
  input.oninput = search;
  input.onkeydown = (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(rows.length - 1, sel + 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
    else if (e.key === 'Enter' && rows[sel]) { location.hash = rows[sel].href.replace(/^#/, ''); close(); }
    else if (e.key === 'Escape') close();
  };
  bg.onclick = (e) => { if (e.target === bg) close(); };
  search();
  input.focus();
}

addEventListener('keydown', (e) => {
  if (!state.me || $('.finder-bg')) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing)) { e.preventDefault(); openFinder(); }
});
