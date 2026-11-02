'use strict';

// ---------------- Dashboard ----------------
// A calm grid of tiles, one saved layout per lever. Editing controls only
// appear in Customize mode; drag uses pointer events so it works on touch.
const LEVER_UI = {
  all: { label: 'All four', color: '#111827' },
  lead: { label: 'Lead gen', color: '#0ea5e9' },
  conversion: { label: 'Conversion', color: '#8b5cf6' },
  upsell: { label: 'Upsell', color: '#f59e0b' },
  continuity: { label: 'Continuity', color: '#10b981' },
};
const dash = { lever: localStorage.getItem('dashLever') || 'all', customize: false, layouts: {}, catalog: [], data: {}, levers: null };

async function viewDashboard() {
  const keys = Object.keys(LEVER_UI);
  // All five layouts load up front, so switching levers is instant.
  const [levers, ...layouts] = await Promise.all([api('GET', '/api/levers'), ...keys.map((k) => api('GET', `/api/layouts/${k}`))]);
  dash.levers = levers;
  keys.forEach((k, i) => { dash.layouts[k] = layouts[i].tiles; });
  dash.catalog = layouts[0].catalog;
  dash.data = {};
  dash.customize = false;
  if (!LEVER_UI[dash.lever]) dash.lever = 'all';
  renderDashboard();
}

function renderDashboard() {
  const lv = dash.lever, tiles = dash.layouts[lv];
  const focus = dash.levers.focus;
  const meta = (id) => dash.catalog.find((t) => t.id === id);
  shell('', `
    <div class="head"><div><h1>Hi ${esc(state.me.user.name.split(' ')[0])} 👋</h1>
      <div class="muted">${esc(state.me.account.name)} · focus this week: <b style="color:${LEVER_UI[focus].color}">${esc(LEVER_UI[focus].label)}</b>${dash.levers.pinned ? ' (pinned)' : ''}</div></div>
      <button class="btn ${dash.customize ? 'primary' : ''}" data-customize>${dash.customize ? 'Done' : '⚙ Customize'}</button></div>
    <div class="leverbar" role="tablist">${Object.entries(LEVER_UI).map(([k, l]) => `<button role="tab" aria-selected="${k === lv}" data-lever="${k}" style="--c:${l.color}" class="${k === lv ? 'on' : ''}"><i class="dot"></i>
      ${k !== 'all' && dash.levers.levers[k]?.score !== null && dash.levers.levers[k]?.score !== undefined ? `<span class="sc">${dash.levers.levers[k].score}</span>` : ''}${esc(l.label)}${k === focus ? ' <span class="focus-dot" title="Focus here">●</span>' : ''}</button>`).join('')}</div>
    ${dash.customize ? `<div class="tray"><span class="muted small">Hidden tiles:</span>
      ${tiles.filter((t) => t.hidden).map((t) => `<button class="chip" data-restore="${t.tile_id}">＋ ${esc(meta(t.tile_id)?.title || t.tile_id)}</button>`).join('') || '<span class="muted small">none. Hide a tile with ✕ to park it here.</span>'}</div>` : ''}
    <div class="tiles ${dash.customize ? 'editing' : ''}" style="--lever:${lv === 'all' ? 'var(--brand)' : LEVER_UI[lv].color}">
      ${tiles.filter((t) => !t.hidden).map((t) => `<section class="tile ${t.width}" data-tile="${t.tile_id}">
        <header><h2>${esc(meta(t.tile_id)?.title || t.tile_id)}</h2>
          ${dash.customize ? `<div class="tctl"><button class="handle" title="Drag to move" aria-label="Drag to move">⠿</button>
            <button data-width title="Change width">${t.width === 'full' ? '½' : '↔'}</button><button data-hide title="Hide">✕</button></div>` : ''}</header>
        <div class="tbody"><div class="skeleton"></div></div></section>`).join('')}
    </div>`);

  $$('[data-lever]').forEach((b) => { b.onclick = () => switchLever(b.dataset.lever); });
  $('[data-customize]').onclick = async () => {
    if (dash.customize) {
      // Save on Done.
      const r = await api('PUT', `/api/layouts/${lv}`, { tiles: dash.layouts[lv] });
      dash.layouts[lv] = r.tiles;
      toast('Layout saved');
    }
    dash.customize = !dash.customize;
    renderDashboard();
  };
  if (dash.customize) bindCustomize();
  fillTiles();
}

function switchLever(k) {
  if (dash.customize) { toast('Press Done to save this layout first'); return; }
  dash.lever = k;
  localStorage.setItem('dashLever', k);
  renderDashboard();
}

async function fillTiles() {
  const lv = dash.lever;
  const visible = dash.layouts[lv].filter((t) => !t.hidden).map((t) => t.tile_id);
  const key = (id) => (id === 'move' ? `move:${lv}` : id);
  const missing = visible.filter((id) => !(key(id) in dash.data));
  if (missing.length) {
    const got = await api('GET', `/api/tiles?lever=${lv}&ids=${missing.join(',')}`);
    for (const [id, v] of Object.entries(got)) dash.data[key(id)] = v;
  }
  if (dash.lever !== lv) return;
  for (const id of visible) {
    const el = $(`[data-tile="${id}"] .tbody`);
    if (el) { el.innerHTML = renderTile(id, dash.data[key(id)]); bindTile(id, el); }
  }
}

// ---- Tile renderers: one big number with a change line, a small bar set, or the flow strip.
const bigNumber = (d) => `<div class="big-n">${esc(d.value)}</div>
  ${d.sub ? `<div class="muted small">${esc(d.sub)}</div>` : ''}
  ${d.change ? `<div class="chg ${d.change.dir}">${d.change.dir === 'up' ? '▲' : d.change.dir === 'down' ? '▼' : '■'} ${esc(d.change.text)}</div>` : ''}`;
const columnBars = (bars) => {
  const max = Math.max(1, ...bars.map((b) => b.n));
  return `<div class="cbars">${bars.map((b) => `<div title="${esc(b.label)}: ${esc(b.value ?? String(b.n))}" style="height:${Math.max(4, (b.n / max) * 100)}%"></div>`).join('')}</div>`;
};
const rowBars = (bars) => {
  const max = Math.max(1, ...bars.map((b) => b.n));
  return `<div class="rbars">${bars.map((b) => `<${b.href ? `a href="${esc(b.href)}"` : 'div'} class="rb"><span class="l">${esc(b.label)}</span>
    <span class="track"><span style="width:${(b.n / max) * 100}%"></span></span><span class="v">${esc(b.value ?? String(b.n))}</span></${b.href ? 'a' : 'div'}>`).join('')}</div>`;
};
const FLOW = [['audience', 'Audience'], ['lead', 'Leads'], ['customer', 'Customers'], ['regular', 'Regulars']];
const FLOW_ARROWS = [['lead', 'audience', 'lead'], ['conversion', 'lead', 'customer'], ['continuity', 'customer', 'regular']];
function flowStrip(counts, lever) {
  const on = (stage) => lever === 'all' || (lever === 'upsell' ? stage === 'customer' : FLOW_ARROWS.some(([l, a, b]) => l === lever && (stage === a || stage === b)));
  return `<div class="flow">${FLOW.map(([k, l], i) => {
    const arrow = FLOW_ARROWS[i - 1];
    return `${arrow ? `<div class="farrow ${lever === 'all' || lever === arrow[0] ? 'on' : ''}" style="--c:${LEVER_UI[arrow[0]].color}"><span>${esc(LEVER_UI[arrow[0]].label)}</span>→</div>` : ''}
      <div class="fstage ${k} ${on(k) ? 'on' : 'dim'}"><b>${counts[k]}</b>${l}${k === 'customer' ? `<span class="loop ${lever === 'all' || lever === 'upsell' ? 'on' : ''}" title="Upsell happens within an order">↻ Upsell</span>` : ''}</div>`;
  }).join('')}</div>`;
}

function renderTile(id, t) {
  if (!t) return '<div class="skeleton"></div>';
  const d = t.data;
  if (t.error) return `<p class="muted">${esc(t.error)}</p>`;
  if (id === 'health') return healthTile(d);
  if (!d) return `<p class="empty-line">${esc(t.empty_state)}</p>`;
  switch (id) {
    case 'move': return moveTile(d);
    case 'flow': return flowStrip(d, dash.lever);
    case 'revenue': case 'listens': case 'signups': return `<div class="nb"><div>${bigNumber(d)}</div>${d.bars ? columnBars(d.bars) : ''}</div>`;
    case 'subscribers': case 'pipeline': return `<div class="nb"><div>${bigNumber(d)}</div>${d.bars ? rowBars(d.bars) : '<div></div>'}</div>`;
    case 'inquiries': return `${bigNumber({ ...d, change: null })}<div class="${d.warn ? 'warnline' : ''}"></div>
      ${d.people.map((p) => `<a class="li" href="#/people/${p.id}"><span>${esc(p.name)}</span><span class="pill ${p.days >= 14 ? 'warn' : ''}">${p.days}d waiting</span></a>`).join('')}`;
    case 'sources': return `<div class="seg" data-seg><button class="on" data-mode="first">First source</button><button data-mode="last">Last touch</button></div>
      <div data-bars>${rowBars(d.first)}</div>`;
    case 'funnels': return rowBars(d.bars);
    default: return `<pre>${esc(JSON.stringify(d))}</pre>`;
  }
}

function healthTile(d) {
  if (!d) return '';
  const levers = d.levers;
  return `<div class="health">${['lead', 'conversion', 'upsell', 'continuity'].map((k) => {
    const l = levers[k];
    return `<button class="hcard ${k === d.focus ? 'focus' : ''}" data-golever="${k}" style="--c:${LEVER_UI[k].color}">
      <div class="row" style="justify-content:space-between"><b>${esc(l.label)}</b>${k === d.focus ? '<span class="badge">Focus here</span>' : ''}</div>
      <div class="hbar"><span style="width:${l.score ?? 0}%"></span></div>
      <div class="row" style="justify-content:space-between"><span class="score">${l.score ?? '—'}<small>/100</small></span><span class="muted small">${esc(l.valueLabel)}</span></div>
      <div class="muted small">${esc(l.score === null ? 'Not enough data yet' : l.metric)}${l.changeLabel ? ` · ${esc(l.changeLabel)}` : ''}</div></button>`;
  }).join('')}</div>`;
}

function moveTile(m) {
  return `<div class="move" style="--c:${LEVER_UI[m.lever]?.color || 'var(--brand)'}">
    <div class="ml"><span class="lever-tag">${esc(LEVER_UI[m.lever]?.label || m.lever)}</span>
      <h3>${esc(m.title)}</h3><p class="muted">${esc(m.reason)}</p>
      ${m.count ? `<p class="small"><b>${m.count}</b> ${m.count === 1 ? 'person' : 'people'}: ${m.people.slice(0, 5).map((p) => `<a href="#/people/${p.id}">${esc(p.name)}</a>`).join(', ')}${m.count > 5 ? ` and ${m.count - 5} more` : ''}</p>` : ''}</div>
    <div class="mr">${m.status === 'proposed' ? '<button class="btn primary" data-draft>✍️ Draft it</button><button class="btn sm" data-skipmove>Skip this week</button>'
      : m.status === 'draft' ? `<a class="btn primary" href="#/campaigns/${m.campaign_id}">Review draft</a><button class="btn sm" data-skipmove>Skip this week</button>`
        : m.status === 'sent' ? `<a class="btn" href="#/campaigns/${m.campaign_id}">✓ Sent · view results</a>`
          : m.status === 'skipped' ? '<span class="muted small">Skipped this week. A new move comes Monday.</span>' : ''}</div></div>`;
}

function bindTile(id, el) {
  if (id === 'health') $$('[data-golever]', el).forEach((b) => { b.onclick = () => switchLever(b.dataset.golever); });
  if (id === 'sources') {
    const d = dash.data.sources.data;
    $$('[data-mode]', el).forEach((b) => { b.onclick = () => {
      $$('[data-mode]', el).forEach((x) => x.classList.toggle('on', x === b));
      $('[data-bars]', el).innerHTML = rowBars(d[b.dataset.mode]);
    }; });
  }
  if (id === 'move' && typeof bindMoveTile === 'function') bindMoveTile(el, dash.data[`move:${dash.lever}`]?.data);
}

function bindCustomize() {
  const lv = dash.lever;
  const grid = $('.tiles');
  const layout = () => dash.layouts[lv];
  const syncOrder = () => {
    const shown = $$('.tile', grid).map((t) => t.dataset.tile);
    const hidden = layout().filter((t) => t.hidden);
    dash.layouts[lv] = [...shown.map((id) => layout().find((t) => t.tile_id === id)), ...hidden].map((t, i) => ({ ...t, order: i }));
  };
  $$('[data-restore]').forEach((b) => { b.onclick = () => {
    // Restored tiles keep their width and settings.
    dash.layouts[lv] = layout().map((t) => (t.tile_id === b.dataset.restore ? { ...t, hidden: false } : t));
    renderDashboard();
  }; });
  $$('.tile', grid).forEach((tile) => {
    const tid = tile.dataset.tile;
    $('[data-hide]', tile).onclick = () => { syncOrder(); dash.layouts[lv] = layout().map((t) => (t.tile_id === tid ? { ...t, hidden: true } : t)); renderDashboard(); };
    $('[data-width]', tile).onclick = () => { syncOrder(); dash.layouts[lv] = layout().map((t) => (t.tile_id === tid ? { ...t, width: t.width === 'full' ? 'half' : 'full' } : t)); renderDashboard(); };
    $('.handle', tile).addEventListener('pointerdown', (e) => {
      e.preventDefault();
      tile.classList.add('dragging');
      const move = (ev) => {
        const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.tile');
        if (!over || over === tile || over.parentNode !== grid) return;
        const all = $$('.tile', grid);
        // Tiles swap places as the pointer crosses them.
        if (all.indexOf(tile) < all.indexOf(over)) over.after(tile); else over.before(tile);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        tile.classList.remove('dragging');
        syncOrder();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up, { once: true });
      window.addEventListener('pointercancel', up, { once: true });
    });
  });
}

const stat = (label, value, sub) => `<div class="card stat"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
const bindRowLinks = () => $$('[data-go]').forEach((r) => { r.onclick = () => { location.hash = r.dataset.go; }; });
