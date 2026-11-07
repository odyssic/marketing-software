'use strict';

// ---------------- One email's report ----------------
async function viewEmailReport(bid) {
  const r = await api('GET', `/api/broadcasts/${bid}/report`);
  const t = r.totals;
  const pct = (n, d) => (d ? `${Math.round((n / d) * 1000) / 10}%` : '—');
  const filter = new URLSearchParams(location.hash.split('?')[1] || '').get('show') || '';
  const people = filter ? r.people.filter((p) => p.status === filter || (filter === 'opened' && p.status === 'clicked')) : r.people;
  const maxLink = Math.max(1, ...r.links.map((l) => l.clicks));
  shell('email', `
    <div class="head"><div><a href="#/email" class="small">← Email</a><h1>${esc(readableMerge(r.subject))}</h1>
      <div class="muted">${r.sent_at ? `Sent ${fmtDate(r.sent_at)}` : 'Not sent yet'}${r.status === 'testing' ? ' · subject test running' : ''}</div></div>
      <div class="row"><a class="btn" href="/api/broadcasts/${r.id}/report.csv">${icon('download')} Download (CSV)</a></div></div>
    <div class="er-kpis">
      ${[['Delivered', t.delivered, `of ${t.sent} sent`], ['Opened', pct(t.opened, t.delivered), `${t.opened} people`], ['Clicked', pct(t.clicked, t.delivered), `${t.clicked} people`],
        ['Unsubscribed', t.unsubscribed, 'within a week'], ['Bounced', t.bounced, t.failed ? `${t.failed} failed to send` : 'addresses that didn’t work']]
        .map(([l, v, s]) => `<div class="card er-kpi"><span class="muted small">${l}</span><b>${v}</b><span class="muted small">${s}</span></div>`).join('')}
    </div>
    ${r.ab ? `<section class="card er-ab"><h2>Subject test</h2>
      ${['a', 'b'].map((k) => { const v = r.ab[k]; const win = r.ab.winner === k; return `<div class="er-abrow ${win ? 'win' : ''}"><span class="pill ${win ? 'ok' : ''}">${k.toUpperCase()}${win ? ' · winner' : ''}</span>
        <b>${esc(readableMerge(v.subject))}</b><span>${pct(v.opened, v.sent)} opened</span><span class="muted small">${v.sent} sent · ${v.clicked} clicked</span></div>`; }).join('')}
 <p class="muted small">${r.ab.winner ? 'The winning subject went to everyone else.' : r.status === 'sent' ? (() => { const ra = r.ab.a.sent ? r.ab.a.opened / r.ab.a.sent : 0, rb = r.ab.b.sent ? r.ab.b.opened / r.ab.b.sent : 0; return ra === rb ? 'Your list was small, so each half got one subject. So far they’re level.' : `Your list was small, so each half got one subject. ${rb > ra ? 'B' : 'A'} is doing better.`; })() : r.ab.ends_at ? `The winner goes to everyone else ${new Date(r.ab.ends_at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.` : ''}</p></section>` : ''}
    <div class="er-cols">
      <section class="card"><h2>Links clicked</h2>
        ${r.links.length ? r.links.map((l) => `<div class="er-link"><a href="${esc(l.url)}" target="_blank" rel="noopener" title="${esc(l.url)}">${esc(l.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60))}</a>
          <span class="er-bar"><i style="width:${Math.round((l.clicks / maxLink) * 100)}%"></i></span><b>${l.clicks}</b><span class="muted small">${l.people} ${l.people === 1 ? 'person' : 'people'}</span></div>`).join('')
          : '<p class="muted small">No clicks yet.</p>'}</section>
      <section class="card"><h2>People</h2>
        <div class="seg er-filter">${[['', 'Everyone'], ['opened', 'Opened'], ['clicked', 'Clicked'], ['sent', 'Didn’t open'], ['bounced', 'Bounced']].map(([k, l]) => `<a href="#/email/report/${r.id}${k ? `?show=${k}` : ''}" class="${filter === k ? 'on' : ''}">${l}</a>`).join('')}</div>
        <div class="er-people">${people.slice(0, 300).map((p) => `<div class="er-person">${p.contact_id ? `<a href="#/people/${p.contact_id}">${esc(p.name || p.email)}</a>` : esc(p.name || p.email)}
          <span class="muted small">${p.name ? esc(p.email) : ''}</span><span class="pill ${p.status === 'clicked' || p.status === 'opened' ? 'ok' : p.status === 'bounced' || p.status === 'failed' ? 'warn' : ''}">${{ clicked: 'Clicked', opened: 'Opened', sent: 'Didn’t open', bounced: 'Bounced', failed: 'Failed' }[p.status]}</span></div>`).join('')
          || '<p class="muted small">Nobody here.</p>'}${people.length > 300 ? `<p class="muted small">And ${people.length - 300} more: download the CSV for everyone.</p>` : ''}</div>
        ${t.sent > t.opened ? `<a class="btn sm" href="#/email/new?segment=${encodeURIComponent(`bc_noopen:${r.id}`)}&from=${r.id}">${icon('refresh')} Resend to the ${t.delivered - t.opened} who didn’t open</a>` : ''}</section>
    </div>`);
}
