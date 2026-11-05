'use strict';

// ---------------- Business at a glance ----------------
// Headline numbers for a chosen timeframe (vs the one before), then three charts:
// revenue over time, new leads vs new customers, and revenue by source.
// Charts are plain SVG: thin marks, one axis, hover readouts, a table view.
const RANGE_UI = [['7d', '7 days'], ['30d', '30 days'], ['90d', '90 days'], ['12m', '12 months'], ['all', 'All time']];
const VIZ = { revenue: 'var(--brand)', prev: '#8a9296', leads: '#2a78d6', customers: '#eb6834' };
const metricsState = { moreOpen: (() => { try { return localStorage.getItem('dashMoreNumbers') === '1'; } catch { return false; } })(), range: (() => { try { return localStorage.getItem('dashRange') || '30d'; } catch { return '30d'; } })(), data: {} };

const fmtPct = (x, digits = 0) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(digits)}%`);
const shortMoney = (cents, cur) => {
  const v = cents / 100;
  if (Math.abs(v) >= 1e6) return `${money(0, cur).replace(/[\d.,\s]/g, '')}${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e4) return `${money(0, cur).replace(/[\d.,\s]/g, '')}${Math.round(v / 1e3)}k`;
  return money(Math.round(cents), cur);
};

async function renderMetrics() {
  const box = $('[data-metrics]');
  if (!box) return;
  const range = metricsState.range;
  if (box.dataset.loaded) box.style.opacity = '.55'; // refetch keeps the frame
  let m = metricsState.data[range];
  if (!m) {
    try { m = metricsState.data[range] = await api('GET', `/api/metrics?range=${range}`); } catch (e) { box.innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
  }
  if (!$('[data-metrics]')) return;
  box.style.opacity = '';
  box.dataset.loaded = '1';
  const cur = m.currency;
  const prevWord = range === 'all' ? '' : `vs prior ${RANGE_UI.find(([k]) => k === range)[1]}`;
  const delta = (now, before, { pts = false } = {}) => {
    if (range === 'all' || now === null || before === null || before === undefined) return `<span class="kd">${esc(prevWord)}</span>`;
    if (pts) {
      const d = Math.round((now - before) * 100);
      return `<span class="kd ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d > 0 ? '▲' : d < 0 ? '▼' : ''} ${d === 0 ? 'Same' : `${Math.abs(d)} pts`} ${esc(prevWord)}</span>`;
    }
    if (!before) return `<span class="kd ${now ? 'up' : ''}">${now ? '▲ New' : 'Same'} ${esc(prevWord)}</span>`;
    const d = Math.round(((now - before) / before) * 100);
    const size = d > 900 ? 'over 10×' : `${Math.abs(d)}%`;
    return `<span class="kd ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d > 0 ? '▲' : d < 0 ? '▼' : ''} ${d === 0 ? 'Same' : size} ${esc(prevWord)}</span>`;
  };
  const c = m.current, p = m.previous;
  const kpi = (label, value, sub, help) => `<div class="kpi" ${help ? `title="${esc(help)}"` : ''}><div class="kl">${label}</div><div class="kv">${value}</div>${sub}</div>`;
  box.innerHTML = `
    <div class="range-row" role="group" aria-label="Timeframe">${RANGE_UI.map(([k, l]) => `<button type="button" data-range="${k}" aria-pressed="${k === range}" class="${k === range ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${m.testOrders && !c.orders ? `<p class="muted small" style="margin:-4px 0 10px">${m.testOrders} test purchase${m.testOrders === 1 ? '' : 's'} in this period aren’t counted (no real money moved).</p>` : ''}
    <div class="kpis">
      ${kpi('Revenue', money(c.revenue, cur), delta(c.revenue, p.revenue), 'Money taken from paid orders and invoices')}
      ${kpi('Recurring per month', money(m.mrr, cur), `<span class="kd">${m.subscribers} active subscriber${m.subscribers === 1 ? '' : 's'}</span>`, 'Monthly plans, plus yearly plans divided by 12')}
      ${kpi('New customers', c.newCustomers, delta(c.newCustomers, p.newCustomers), 'People who bought for the first time')}
      ${kpi('New leads', c.leads, delta(c.leads, p.leads), 'New people added: sign-ups, inquiries, bookings, imports')}
    </div>
    <details class="kpi-more" ${metricsState.moreOpen ? 'open' : ''}><summary>More numbers</summary><div class="kpis">
      ${kpi('Leads who bought', fmtPct(c.conversion), delta(c.conversion, p.conversion, { pts: true }), 'Of the people who joined in this period, how many have bought')}
      ${kpi('Average order', c.aov === null ? '—' : money(Math.round(c.aov), cur), delta(c.aov, p.aov), 'Revenue ÷ number of orders')}
      ${kpi('Lifetime value', m.ltv === null ? '—' : money(Math.round(m.ltv), cur), '<span class="kd">per customer, all time</span>', 'Everything a customer has spent, on average')}
      ${kpi('Repeat customers', fmtPct(m.repeatRate), `<span class="kd">of ${m.customers} customer${m.customers === 1 ? '' : 's'}, all time</span>`, 'Customers who bought more than once')}
    </div></details>
    <div class="chart-grid">
      <section class="card chart wide"><header><h2>Revenue</h2>
        <div class="legend"><span><i class="lg-rect" style="background:${VIZ.revenue}"></i>This period</span>${range === 'all' ? '' : `<span><i class="lg-dash"></i>Previous period</span>`}</div></header>
        <div class="viz" data-viz="revenue"></div></section>
      <section class="card chart"><header><h2>New leads and new customers</h2>
        <div class="legend"><span><i class="lg-line" style="background:${VIZ.leads}"></i>Leads</span><span><i class="lg-line" style="background:${VIZ.customers}"></i>Customers</span></div></header>
        <div class="viz" data-viz="people"></div></section>
      <section class="card chart"><header><h2>Where revenue came from</h2></header>
        <div class="viz" data-viz="sources"></div></section>
    </div>
    <details class="viz-table"><summary>Show these numbers as a table</summary>${tableHtml(m)}</details>`;
  const km = $('.kpi-more', box); if (km) km.addEventListener('toggle', () => { metricsState.moreOpen = km.open; try { localStorage.setItem('dashMoreNumbers', km.open ? '1' : ''); } catch { /* optional */ } });
  revenueChart($('[data-viz=revenue]', box), m);
  peopleChart($('[data-viz=people]', box), m);
  sourcesChart($('[data-viz=sources]', box), m);
  $$('[data-range]', box).forEach((b) => { b.onclick = () => {
    metricsState.range = b.dataset.range;
    try { localStorage.setItem('dashRange', b.dataset.range); } catch { /* optional */ }
    renderMetrics();
  }; });
}

// "Nov 3", "Week of Oct 6", "Nov 2026"
function periodLabel(label, unit, long = false) {
  if (unit === 'month') { const d = new Date(`${label}-01T12:00:00Z`); return d.toLocaleDateString(undefined, { month: 'short', ...(long ? { year: 'numeric' } : {}), timeZone: 'UTC' }); }
  const d = new Date(`${label}T12:00:00Z`);
  const s = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return unit === 'week' && long ? `Week ending ${s}` : s;
}

function tableHtml(m) {
  return `<div class="table-wrap"><table><tr><th>${m.unit === 'month' ? 'Month' : m.unit === 'week' ? 'Week ending' : 'Day'}</th><th>Revenue</th>${m.range === 'all' ? '' : '<th>Previous period</th>'}<th>New leads</th><th>New customers</th></tr>
    ${m.series.map((s) => `<tr><td>${esc(periodLabel(s.label, m.unit, true))}</td><td>${money(s.revenue, m.currency)}</td>${m.range === 'all' ? '' : `<td>${money(s.prevRevenue, m.currency)}</td>`}<td>${s.leads}</td><td>${s.customers}</td></tr>`).join('')}</table></div>`;
}

// Shared chart frame: a y-scale with a few round gridlines, x labels at the ends and middle.
function frame(el, maxV, fmt, n) {
  const W = Math.max(280, el.clientWidth || 600), H = 220, L = 52, R = 12, T = 12, B = 26;
  const nice = (v) => { if (v <= 0) return 1; const e = 10 ** Math.floor(Math.log10(v)); const f = v / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e; };
  const top = nice(maxV * 1.08);
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const step = (W - L - R) / Math.max(1, n);
  const x = (i) => L + step * i + step / 2;
  const grid = [0, 0.5, 1].map((f) => `<line x1="${L}" x2="${W - R}" y1="${y(top * f)}" y2="${y(top * f)}" class="gl"/><text x="${L - 6}" y="${y(top * f) + 4}" class="ax" text-anchor="end">${esc(fmt(top * f))}</text>`).join('');
  return { W, H, L, R, T, B, y, x, step, grid };
}
function xLabels(f, m) {
  const n = m.series.length, idx = [...new Set([0, Math.floor((n - 1) / 2), n - 1])];
  return idx.map((i) => `<text x="${f.x(i)}" y="${f.H - 6}" class="ax" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${esc(periodLabel(m.series[i].label, m.unit))}</text>`).join('');
}
// One tooltip for every chart; values go in with textContent.
function tip(el, rows, title, x, y) {
  let t = $('.viz-tip', el.closest('.chart'));
  if (!t) { t = document.createElement('div'); t.className = 'viz-tip'; t.setAttribute('role', 'status'); el.closest('.chart').append(t); }
  t.replaceChildren();
  const h = document.createElement('div'); h.className = 'tt'; h.textContent = title; t.append(h);
  for (const [color, value, label, dashed] of rows) {
    const r = document.createElement('div'); r.className = 'tr';
    const k = document.createElement('i'); k.className = dashed ? 'tk dash' : 'tk'; if (!dashed) k.style.background = color;
    const v = document.createElement('b'); v.textContent = value;
    const l = document.createElement('span'); l.textContent = label;
    r.append(k, v, l); t.append(r);
  }
  t.hidden = false;
  const box = el.getBoundingClientRect(), host = el.closest('.chart').getBoundingClientRect();
  t.style.left = `${Math.min(box.left - host.left + x + 12, host.width - t.offsetWidth - 8)}px`;
  t.style.top = `${box.top - host.top + y}px`;
}
const hideTip = (el) => { const t = $('.viz-tip', el.closest('.chart')); if (t) t.hidden = true; };

function revenueChart(el, m) {
  const s = m.series, cur = m.currency, showPrev = m.range !== 'all';
  const maxV = Math.max(...s.map((d) => Math.max(d.revenue, showPrev ? d.prevRevenue : 0))) || 10000; // $100 scale until there are sales
  const f = frame(el, maxV, (v) => shortMoney(v, cur), s.length);
  const bw = Math.max(2, Math.min(28, f.step - 2)); // 2px gap between bars
  const bars = s.map((d, i) => {
    if (!d.revenue) return '';
    const x0 = f.x(i) - bw / 2, y0 = f.y(d.revenue), h = f.y(0) - y0, r = Math.min(4, bw / 2, h);
    return `<path d="M${x0},${f.y(0)} V${y0 + r} Q${x0},${y0} ${x0 + r},${y0} H${x0 + bw - r} Q${x0 + bw},${y0} ${x0 + bw},${y0 + r} V${f.y(0)} Z" fill="${VIZ.revenue}" class="bar" data-i="${i}"/>`;
  }).join('');
  const prev = showPrev ? `<polyline points="${s.map((d, i) => `${f.x(i)},${f.y(d.prevRevenue)}`).join(' ')}" fill="none" stroke="${VIZ.prev}" stroke-width="2" stroke-dasharray="5 4" stroke-linejoin="round"/>` : '';
  const hits = s.map((d, i) => `<rect x="${f.x(i) - f.step / 2}" y="${f.T}" width="${f.step}" height="${f.y(0) - f.T}" fill="transparent" data-hit="${i}" tabindex="-1"/>`).join('');
  const empty = !s.some((d) => d.revenue) ? `<text x="${(f.L + f.W - f.R) / 2}" y="${f.H / 2}" text-anchor="middle" class="ax empty">No sales in this period yet</text>` : '';
  el.innerHTML = `<svg viewBox="0 0 ${f.W} ${f.H}" width="100%" height="${f.H}" role="img" aria-label="Revenue per ${m.unit}">${f.grid}${bars}${prev}${xLabels(f, m)}${empty}<line class="xh" y1="${f.T}" y2="${f.y(0)}" hidden/>${hits}</svg>`;
  hover(el, f, (i) => [periodLabel(s[i].label, m.unit, true), [[VIZ.revenue, money(s[i].revenue, cur), 'This period'], ...(showPrev ? [[VIZ.prev, money(s[i].prevRevenue, cur), 'Previous period', true]] : [])]]);
}

function peopleChart(el, m) {
  const s = m.series;
  const maxV = Math.max(...s.map((d) => Math.max(d.leads, d.customers))) || 4;
  const f = frame(el, maxV, (v) => String(Math.round(v)), s.length);
  const line = (k, color) => `<polyline points="${s.map((d, i) => `${f.x(i)},${f.y(d[k])}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  el.innerHTML = `<svg viewBox="0 0 ${f.W} ${f.H}" width="100%" height="${f.H}" role="img" aria-label="New leads and new customers per ${m.unit}">${f.grid}
    ${line('leads', VIZ.leads)}${line('customers', VIZ.customers)}${xLabels(f, m)}<line class="xh" y1="${f.T}" y2="${f.y(0)}" hidden/>
    ${s.map((d, i) => `<rect x="${f.x(i) - f.step / 2}" y="${f.T}" width="${f.step}" height="${f.y(0) - f.T}" fill="transparent" data-hit="${i}"/>`).join('')}</svg>`;
  hover(el, f, (i) => [periodLabel(s[i].label, m.unit, true), [[VIZ.leads, String(s[i].leads), 'New leads'], [VIZ.customers, String(s[i].customers), 'New customers']]]);
}

function sourcesChart(el, m) {
  if (!m.sources.length) { el.innerHTML = '<p class="muted small" style="margin:8px 0">Once you have sales, this shows which channels brought the money: Instagram, Google, your email list, invoices…</p>'; return; }
  const max = Math.max(...m.sources.map((x) => x.cents));
  el.innerHTML = `<div class="src-bars">${m.sources.map((x) => `<div class="src-row" tabindex="0" title="${esc(x.name)}: ${esc(money(x.cents, m.currency))}">
    <span class="src-name">${esc(x.name)}</span><span class="src-track"><i style="width:${Math.max(2, (x.cents / max) * 100)}%;background:${VIZ.revenue}"></i></span><b>${esc(shortMoney(x.cents, m.currency))}</b></div>`).join('')}</div>`;
}

// Crosshair that snaps to the nearest period; same readout on keyboard focus.
function hover(el, f, read) {
  const svg = $('svg', el), xh = $('.xh', svg);
  const show = (i, evX) => {
    const [title, rows] = read(i);
    xh.setAttribute('x1', f.x(i)); xh.setAttribute('x2', f.x(i)); xh.hidden = false;
    $$('.bar', svg).forEach((b) => b.classList.toggle('lift', Number(b.dataset.i) === i));
    const scale = svg.getBoundingClientRect().width / f.W;
    tip(el, rows, title, (evX ?? f.x(i)) * scale, 8);
  };
  $$('[data-hit]', svg).forEach((h) => {
    h.addEventListener('pointermove', (e) => show(Number(h.dataset.hit), (e.clientX - svg.getBoundingClientRect().left) / (svg.getBoundingClientRect().width / f.W)));
  });
  svg.addEventListener('pointerleave', () => { xh.hidden = true; $$('.bar', svg).forEach((b) => b.classList.remove('lift')); hideTip(el); });
  // Keyboard: focus the chart and use the arrow keys.
  el.tabIndex = 0;
  let k = -1;
  el.onkeydown = (e) => {
    const n = $$('[data-hit]', svg).length;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { k = Math.max(0, Math.min(n - 1, k + (e.key === 'ArrowRight' ? 1 : -1))); show(k); e.preventDefault(); }
  };
  el.onblur = () => { xh.hidden = true; hideTip(el); k = -1; };
}

// Charts redraw at the new width when the window changes size.
addEventListener('resize', () => { clearTimeout(metricsState.rt); metricsState.rt = setTimeout(() => { if ($('[data-metrics]')) renderMetrics(); }, 200); });
