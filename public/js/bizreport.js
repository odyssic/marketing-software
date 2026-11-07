'use strict';

// ---------------- Business report: a clean document to save as PDF or share ----------------
async function viewBizReport() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const range = ['7d', '30d', '90d', '12m', 'all'].includes(q.get('range')) ? q.get('range') : '30d';
  const [m, d] = await Promise.all([api('GET', `/api/metrics?range=${range}`), api('GET', `/api/reports/detail?range=${range}`)]);
  const cur = m.currency, c = m.current, p = m.previous;
  const label = RANGE_UI.find(([k]) => k === range)[1];
  const day = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  const span = range === 'all' ? 'All time' : `${day(d.from)} – ${day(d.to)}`;
  const brand = state.me.brand;
  const change = (now, before, isMoney) => {
    if (range === 'all' || before === null || before === undefined) return '';
    if (!before) return now ? '<span class="rp-ch up">New</span>' : '<span class="rp-ch">Same</span>';
    const pctv = Math.round(((now - before) / before) * 100);
    return `<span class="rp-ch ${pctv > 0 ? 'up' : pctv < 0 ? 'down' : ''}">${pctv > 0 ? '▲' : pctv < 0 ? '▼' : ''} ${pctv === 0 ? 'Same' : `${Math.abs(pctv)}%`}</span><span class="rp-was">was ${isMoney ? money(before, cur) : before}</span>`;
  };
  const conv = c.leads ? `${Math.round(((c.newCustomers) / c.leads) * 1000) / 10}%` : '—';
  const et = d.emailTotals;
  const rate = (n, of) => (of ? `${Math.round((n / of) * 100)}%` : '—');
  // A few plain-words highlights.
  const notes = [];
  if (c.revenue && p.revenue && range !== 'all') notes.push(`Revenue ${c.revenue >= p.revenue ? 'grew' : 'fell'} ${Math.abs(Math.round(((c.revenue - p.revenue) / p.revenue) * 100))}% on the period before.`);
  if (m.sources[0] && m.sources[0].name !== 'Other') notes.push(`${m.sources[0].name} brought the most revenue (${money(m.sources[0].cents, cur)}).`);
  const bestPage = [...d.pages].filter((x) => x.visitors >= 20).sort((a, b) => (b.signups + b.sales) / b.visitors - (a.signups + a.sales) / a.visitors)[0];
  if (bestPage) notes.push(`“${bestPage.name}” turned ${Math.round(((bestPage.signups + bestPage.sales) / bestPage.visitors) * 100)}% of its visitors into sign-ups or sales.`);
  if (et.sent >= 20) notes.push(`${rate(et.opened, et.sent)} of ${et.sent} emails were opened, and ${rate(et.clicked, et.sent)} got a click.`);
  if (d.bookings) notes.push(`${d.bookings} booking${d.bookings === 1 ? '' : 's'} came in.`);

  shell('', `
    <div class="rp-tools no-print"><a href="#/" class="small">← Dashboard</a>
      <div class="range-row" role="group" aria-label="Timeframe">${RANGE_UI.map(([k, l]) => `<a href="#/report?range=${k}" class="${k === range ? 'on' : ''}" aria-current="${k === range}">${l}</a>`).join('')}</div>
      <span class="rp-acts"><button class="btn" data-rpcsv>${icon('download')} Data (CSV)</button><button class="btn primary" data-rpprint>${icon('download')} Save as PDF</button></span></div>
    <article class="rp-doc">
      <header class="rp-head">
        <div>${brand?.logo ? `<img src="${esc(brand.logo)}" alt="${esc(brand.name || '')}" class="rp-logo">` : brand?.name ? `<b class="rp-brand">${esc(brand.name)}</b>` : '<img src="/brand/rilly-lockup-ink.svg" alt="Rilly" class="rp-logo">'}</div>
        <div class="rp-title"><span class="rp-kicker">Results report</span><h1>${esc(state.me.account.name)}</h1><p>${esc(span)}${range === 'all' ? '' : ` · compared with the ${esc(label)} before`}</p></div>
      </header>
      <section class="rp-kpis">
        ${[['Revenue', money(c.revenue, cur), change(c.revenue, p.revenue, true)], ['New customers', c.newCustomers, change(c.newCustomers, p.newCustomers)],
          ['New leads', c.leads, change(c.leads, p.leads)], ['Recurring per month', money(m.mrr, cur), `<span class="rp-was">${m.subscribers} subscriber${m.subscribers === 1 ? '' : 's'}</span>`],
          ['Orders', c.orders, change(c.orders, p.orders)], ['Leads who bought', conv, '<span class="rp-was">of new leads this period</span>']]
          .map(([l, v, s]) => `<div class="rp-kpi"><span>${l}</span><b>${v}</b><div>${s}</div></div>`).join('')}
      </section>
      ${notes.length ? `<section class="rp-notes"><h2>Highlights</h2><ul>${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></section>` : ''}
      <section class="rp-sec"><h2>Revenue</h2><div class="chart" data-rprev></div>${range === 'all' ? '' : '<p class="rp-legend"><i class="sw rev"></i>This period <i class="sw prev"></i>Period before</p>'}</section>
      <div class="rp-two">
        <section class="rp-sec"><h2>New leads and customers</h2><div class="chart" data-rppeople></div><p class="rp-legend"><i class="sw leads"></i>Leads <i class="sw cust"></i>Customers</p></section>
        <section class="rp-sec"><h2>Where revenue came from</h2><div data-rpsrc></div></section>
      </div>
      <div class="rp-two">
        <section class="rp-sec"><h2>Pages</h2>${d.pages.length ? `<table class="rp-table"><thead><tr><th>Page</th><th>Visitors</th><th>Sign-ups</th><th>Sales</th></tr></thead><tbody>
          ${d.pages.map((x) => `<tr><td>${esc(x.name)}</td><td>${x.visitors}</td><td>${x.signups}</td><td>${x.sales}</td></tr>`).join('')}</tbody></table>` : '<p class="muted small">No page visits in this period.</p>'}</section>
        <section class="rp-sec"><h2>Email</h2><div class="rp-mini"><span><b>${et.sent}</b> sent</span><span><b>${rate(et.opened, et.sent)}</b> opened</span><span><b>${rate(et.clicked, et.sent)}</b> clicked</span></div>
          ${d.emails.length ? `<table class="rp-table"><thead><tr><th>Email</th><th>Sent</th><th>Opened</th><th>Clicked</th></tr></thead><tbody>
          ${d.emails.map((e) => `<tr><td>${esc(readableMerge(e.subject))}</td><td>${e.sent}</td><td>${rate(e.opened, e.sent)}</td><td>${rate(e.clicked, e.sent)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted small">No newsletters sent in this period.</p>'}</section>
      </div>
      <footer class="rp-foot">Prepared ${esc(day(new Date().toISOString()))}${brand?.name ? ` by ${esc(brand.name)}` : ''}. Test purchases are left out.</footer>
    </article>`);
  revenueChart($('[data-rprev]'), m);
  peopleChart($('[data-rppeople]'), m);
  sourcesChart($('[data-rpsrc]'), m);
  $('[data-rpprint]').onclick = () => {
    const was = document.title;
    document.title = `${state.me.account.name} results ${span}`;
    window.print();
    setTimeout(() => { document.title = was; }, 500);
  };
  $('[data-rpcsv]').onclick = async () => {
    const res = await fetch('/api/reports/export.csv', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ range, metrics: m }) });
    if (!res.ok) { toast('Couldn’t make the file', true); return; }
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: `${state.me.account.name} report ${range}.csv` });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
}
