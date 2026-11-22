'use strict';

// ---------------- Analytics ----------------
// One calm page, in the spirit of Squarespace's: headline numbers with their change,
// one chart for the number you pick, then ranked lists. Nothing to set up: live
// pages record visits, clicks and reading on their own.
const AN = { range: '30d', metric: 'visits' };
const AN_RANGES = [['7d', '7 days'], ['30d', '30 days'], ['90d', '90 days'], ['12m', '12 months']];

async function viewAnalytics() {
  shell('analytics', '<div class="an"><div class="skeleton" style="height:420px"></div></div>');
  let d;
  try { d = await api('GET', `/api/analytics?range=${AN.range}`); } catch (e) { $('.an').innerHTML = `<div class="card empty"><h2>${esc(e.message)}</h2></div>`; return; }
  const c = d.current, p = d.previous;
  const pct = (x) => (x === null || x === undefined ? '—' : `${Math.round(x * 1000) / 10}%`);
  const num = (n) => Number(n || 0).toLocaleString();
  // Change against the period before: "↑ 12%", or points for a rate.
  const change = (a, b, rate = false) => {
    if (rate) {
      if (a === null || b === null) return '';
      const pts = Math.round((a - b) * 1000) / 10;
      return pts ? `<span class="an-chg ${pts > 0 ? 'up' : 'down'}">${pts > 0 ? '↑' : '↓'} ${Math.abs(pts)} pts</span>` : '<span class="an-chg">no change</span>';
    }
    if (!b) return a ? '<span class="an-chg up">new</span>' : '';
    const v = Math.round(((a - b) / b) * 100);
    return v ? `<span class="an-chg ${v > 0 ? 'up' : 'down'}">${v > 0 ? '↑' : '↓'} ${Math.abs(v)}%</span>` : '<span class="an-chg">no change</span>';
  };
  const kpis = [
    ['visits', 'Visits', num(c.visits), change(c.visits, p.visits)],
    ['signups', 'Sign-ups', num(c.signups), change(c.signups, p.signups)],
    ['sales', 'Sales', num(c.sales), `${change(c.sales, p.sales)}${c.revenue ? `<small>${esc(c.revenueLabel)}</small>` : ''}`],
    ['conversion', 'Conversion', pct(c.conversion), change(c.conversion, p.conversion, true)],
    ['clicks', 'Button clicks', num(c.clicks), change(c.clicks, p.clicks)],
  ];
  const label = { visits: 'Visits', signups: 'Sign-ups', sales: 'Sales', conversion: 'Conversion', clicks: 'Visits' }[AN.metric];
  const rangeWord = AN_RANGES.find(([k]) => k === AN.range)[1];

  $('.an').innerHTML = `
    <div class="head an-head"><div><h1>Analytics</h1><div class="muted">How people find, read and act on your pages. Recorded on their own; nothing to set up.</div></div>
      <div class="seg an-range" role="group" aria-label="Period">${AN_RANGES.map(([k, l]) => `<button type="button" data-range="${k}" class="${k === AN.range ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <section class="card an-main">
      <div class="an-kpis" role="tablist">${kpis.map(([k, l, v, ch]) => `<button type="button" role="tab" aria-selected="${k === AN.metric}" class="an-kpi ${k === AN.metric ? 'on' : ''}" data-metric="${k}">
        <span class="an-l">${l}</span><span class="an-v">${v}</span><span class="an-c">${ch || '&nbsp;'}</span></button>`).join('')}</div>
      <div class="an-chart" data-chart></div>
      <div class="an-legend muted small"><span><i class="sw now"></i>${label}, last ${rangeWord}</span>${AN.metric === 'visits' || AN.metric === 'clicks' ? '<span><i class="sw before"></i>The period before</span>' : ''}</div>
    </section>
    ${!c.visits ? `<div class="card an-empty">${icon('trend')}<div><b>No visits in the last ${rangeWord} yet.</b><br><span class="muted">Share a page’s link (Flows → a page → Copy link). Visits, clicks and reading show up here within a minute.</span></div></div>` : ''}
    <div class="an-grid">
      <section class="card an-panel an-wide"><div class="an-ph"><h3>Top pages</h3><span class="muted small">Click a page to see its clicks on the page itself</span></div>
        ${d.pages.length ? `<table class="an-table"><thead><tr><th>Page</th><th>Visits</th><th>Signed up or bought</th><th>Read to the end</th></tr></thead><tbody>
          ${d.pages.map((r) => `<tr><td><a href="#/editor/${r.step_id}?clicks=1"><b>${esc(r.page)}</b></a><div class="muted small">${esc(r.flow)}</div></td><td>${num(r.visits)}</td><td>${pct(r.rate)}</td><td>${r.readToEnd === null ? '<span class="muted">—</span>' : pct(r.readToEnd)}</td></tr>`).join('')}</tbody></table>`
          : '<p class="muted small an-none">No visits yet.</p>'}</section>
    </div>
    <div class="an-grid an-three">
      ${anPanel('Traffic sources', 'Where visits came from', d.sources.map((s) => ({ label: s.source, value: s.visits, sub: `${pct(s.rate)} signed up or bought` })), 'No visits yet.')}
      ${anPanel('Most clicked', 'Buttons and links, by the share of a page’s visitors who clicked', d.clicks.map((k) => ({ label: `“${k.label}”`, value: k.people, sub: k.page, right: k.rate === null ? '' : pct(k.rate) })), 'No clicks yet.')}
      ${anPanel('Devices', 'What people visit on', d.devices.map((x) => ({ label: { phone: 'Phone', tablet: 'Tablet', computer: 'Computer' }[x.device], value: x.visits, icon: x.device === 'phone' || x.device === 'tablet' ? 'phone' : 'page' })), 'Shown for visits from now on.', true)}
    </div>`;
  drawAnChart($('[data-chart]'), d, AN.metric === 'clicks' ? 'visits' : AN.metric);
  $$('[data-range]').forEach((b) => { b.onclick = () => { AN.range = b.dataset.range; viewAnalytics(); }; });
  $$('[data-metric]').forEach((b) => { b.onclick = () => { AN.metric = b.dataset.metric; viewAnalytics(); }; });
}

// A ranked list: each row a label, its number and a thin bar. share=true shows % of the total.
function anPanel(title, hint, rows, empty, share = false) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const total = rows.reduce((t, r) => t + r.value, 0) || 1;
  return `<section class="card an-panel"><div class="an-ph"><h3>${esc(title)}</h3><span class="muted small">${esc(hint)}</span></div>
    ${rows.length ? `<ol class="an-rows">${rows.map((r) => `<li><div class="an-rl">${r.icon ? icon(r.icon) : ''}<span class="an-rt">${esc(r.label)}${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</span>
      <b>${share ? `${Math.round((r.value / total) * 100)}%` : r.right || Number(r.value).toLocaleString()}</b></div><span class="an-bar"><i style="width:${Math.max(2, (r.value / max) * 100)}%"></i></span></li>`).join('')}</ol>`
      : `<p class="muted small an-none">${esc(empty)}</p>`}</section>`;
}

// The chart: a smooth line with a soft fill, the period before as a dashed line.
function drawAnChart(el, d, metric) {
  const s = d.series;
  const val = (x) => (metric === 'conversion' ? (x.visits ? ((x.signups + x.sales) / x.visits) * 100 : 0) : x[metric]);
  const vals = s.map(val), prevVals = metric === 'visits' ? s.map((x) => x.prevVisits) : null;
  // Drawn at the real width, so labels stay crisp on phones and wide screens alike.
  const W = Math.max(300, Math.round(el.clientWidth || 1000)), H = W < 600 ? 190 : 250, L = W < 600 ? 34 : 44, R = 12, T = 14, B = 30;
  const top = Math.max(1, ...vals, ...(prevVals || [])) * 1.15;
  const nice = (v) => { const m = 10 ** Math.floor(Math.log10(v)); return Math.ceil(v / m) * m; };
  const yMax = metric === 'conversion' ? Math.max(5, Math.ceil(top / 5) * 5) : nice(top);
  const x = (i) => L + (s.length <= 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (s.length - 1));
  const y = (v) => T + (H - T - B) * (1 - v / yMax);
  // Catmull-Rom to Bézier, for a gentle curve that never overshoots much.
  const path = (vs) => vs.map((v, i) => {
    if (!i) return `M${x(0)},${y(v)}`;
    const p0 = vs[i - 2] ?? vs[i - 1], p1 = vs[i - 1], p3 = vs[i + 1] ?? v;
    const c1x = x(i - 1) + (x(i) - x(Math.max(0, i - 2))) / 6, c1y = y(p1) + (y(v) - y(p0)) / 6;
    const c2x = x(i) - (x(Math.min(vs.length - 1, i + 1)) - x(i - 1)) / 6, c2y = y(v) - (y(p3) - y(p1)) / 6;
    return `C${c1x},${Math.min(y(0), c1y)} ${c2x},${Math.min(y(0), c2y)} ${x(i)},${y(v)}`;
  }).join(' ');
  const fmtDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, d.unit === 'month' ? { month: 'short' } : { month: 'short', day: 'numeric' });
  const every = Math.max(1, Math.ceil(s.length / 7));
  const grid = [0, 0.5, 1].map((f) => { const v = yMax * f; return `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="an-gl"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" class="an-ax">${metric === 'conversion' ? `${Math.round(v)}%` : Math.round(v).toLocaleString()}</text>`; }).join('');
  const xs = s.map((p, i) => (i % every === 0 || i === s.length - 1 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="an-ax">${fmtDate(p.at)}</text>` : '')).join('');
  const word = { visits: 'visits', signups: 'sign-ups', sales: 'sales', conversion: '' }[metric];
  const hits = s.map((p, i) => `<g class="an-hit"><rect x="${x(i) - (W - L - R) / s.length / 2}" y="${T}" width="${(W - L - R) / s.length}" height="${H - T - B}"/><circle cx="${x(i)}" cy="${y(vals[i])}" r="4.5"/>
    <title>${fmtDate(p.at)}: ${metric === 'conversion' ? `${Math.round(vals[i] * 10) / 10}% converted` : `${vals[i].toLocaleString()} ${word}`}${prevVals ? ` (before: ${prevVals[i].toLocaleString()})` : ''}</title></g>`).join('');
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${esc(word || 'conversion')} over the period">
    <defs><linearGradient id="anFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--brand)" stop-opacity=".22"/><stop offset="1" stop-color="var(--brand)" stop-opacity="0"/></linearGradient></defs>
    ${grid}${xs}
    ${prevVals ? `<path d="${path(prevVals)}" class="an-prev"/>` : ''}
    <path d="${path(vals)} L${x(s.length - 1)},${y(0)} L${x(0)},${y(0)} Z" fill="url(#anFill)"/>
    <path d="${path(vals)}" class="an-line"/>${hits}</svg>`;
}
