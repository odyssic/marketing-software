'use strict';

// ---------------- Campaigns (weekly moves) ----------------
// One move a week: why it was picked, who it's for, a draft in your voice,
// and nothing goes out until you press Approve & send.
async function viewCampaign(campaignId) {
  const c = await api('GET', `/api/campaigns/${campaignId}`);
  const sent = c.status === 'sent';
  const editable = !sent && c.status !== 'sending';
  shell('email', `
    <div class="head"><div><a href="#/email/campaigns" class="small">← Campaigns</a>
      <h1 style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">${esc(c.move.title || c.title || 'Campaign')}</h1>
      <div class="row" style="gap:6px;margin-top:4px">${leverPill(c.lever)}<span class="pill ${sent ? 'ok' : c.status === 'skipped' ? 'warn' : ''}">${esc(c.status)}</span>
        ${c.week ? `<span class="muted small">week of ${fmtDate(c.week)}</span>` : ''}</div></div></div>
    ${c.move.reason ? `<div class="card why"><b>Why this move:</b> ${esc(c.move.reason)}</div>` : ''}
    ${sent && c.stats ? `<div class="card" style="margin-top:14px"><h2>Results</h2>
      <div class="grid stats">${stat('Sent', c.stats.sent, 'emails')}${stat('Opened', c.stats.opened, c.stats.sent ? `${Math.round((c.stats.opened / c.stats.sent) * 100)}% of sent` : '')}
        ${stat('Clicked', c.stats.clicked, c.stats.sent ? `${Math.round((c.stats.clicked / c.stats.sent) * 100)}% of sent` : '')}${stat('Bought', c.stats.buyers, `${esc(c.stats.revenue)} within 14 days`)}</div>
      <p class="muted">${c.stats.sent ? `${c.stats.clicked} of every ${c.stats.sent} people clicked, and ${c.stats.buyers} bought.` : ''}</p></div>` : ''}
    <div class="grid two" style="margin-top:14px">
      <div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">The email</h2>
        ${editable ? `<button class="btn sm" data-draft>${c.draft_body ? '↻ Redraft' : '✍️ Draft it'}</button>` : ''}</div>
        ${c.aiLive ? '' : '<p class="hint" style="margin:8px 0 0">AI drafting isn’t connected, so drafts are fill-in-the-blank templates. Set ANTHROPIC_API_KEY on the server to draft in your voice.</p>'}
        <label class="f" style="margin-top:12px">Subject<input data-subject value="${esc(c.subject)}" ${editable ? '' : 'readonly'} placeholder="Press Draft it, or write your own"></label>
        <label class="f">Message<textarea data-body rows="14" ${editable ? '' : 'readonly'}>${esc(c.draft_body)}</textarea></label>
        <p class="hint">{{first_name|there}} becomes each person’s first name. An unsubscribe link is added automatically. Fill in any [bracketed] parts before sending.</p>
        ${editable ? `<div class="row"><button class="btn primary" data-send>Approve &amp; send to ${c.people.length}</button><button class="btn" data-skip>Skip this week</button><span class="saved" data-saved></span></div>` : ''}
      </div>
      <div class="card"><h2>Who gets it (${c.people.length})</h2>
        ${c.people.length ? c.people.map((p) => `<a class="li" href="#/people/${p.id}"><span>${esc(fullName(p) || p.email)}</span><span class="muted small">${esc(p.email)} ${stagePill(p.stage)}</span></a>`).join('')
          : '<p class="muted">Nobody matches this move.</p>'}</div>
    </div>`);
  if (!editable) return;
  let t;
  const save = () => { clearTimeout(t); $('[data-saved]').textContent = 'Saving…'; t = setTimeout(async () => {
    await api('PUT', `/api/campaigns/${c.id}`, { subject: $('[data-subject]').value, body: $('[data-body]').value });
    $('[data-saved]').textContent = 'Saved';
  }, 500); };
  $('[data-subject]').oninput = save;
  $('[data-body]').oninput = save;
  $('[data-draft]').onclick = async (e) => {
    const b = e.currentTarget;
    if ($('[data-body]').value.trim() && !confirm('Replace the current draft with a new one?')) return;
    b.disabled = true; b.textContent = 'Drafting…';
    try { const d = await api('POST', `/api/campaigns/${c.id}/draft`); toast(d.template ? 'Template draft ready. Fill in the brackets' : 'Draft ready, in your voice'); viewCampaign(c.id); } catch (err) { toast(err.message, true); b.disabled = false; b.textContent = '✍️ Draft it'; }
  };
  $('[data-send]').onclick = async () => {
    clearTimeout(t);
    await api('PUT', `/api/campaigns/${c.id}`, { subject: $('[data-subject]').value, body: $('[data-body]').value });
    if (/\[[^\]]+\]/.test($('[data-body]').value + $('[data-subject]').value) && !confirm('There are still [bracketed] placeholders in the email. Send anyway?')) return;
    if (!await modal('Send this email?', `<p>“${esc($('[data-subject]').value)}” goes to <b>${c.people.length}</b> ${c.people.length === 1 ? 'person' : 'people'} now. This can’t be undone.</p>`, { submit: 'Approve & send' })) return;
    try { const r = await api('POST', `/api/campaigns/${c.id}/send`); toast(`Sent to ${r.sent}${r.skipped ? ` (${r.skipped} skipped: unsubscribed or no email)` : ''}`); viewCampaign(c.id); } catch (err) { toast(err.message, true); }
  };
  $('[data-skip]').onclick = async () => { await api('POST', `/api/campaigns/${c.id}/skip`); toast('Skipped. A new move comes next Monday'); viewCampaign(c.id); };
}

const campaignsHtml = (items) => (items.length ? `<div class="card table-wrap"><table>
  <tr><th>Move</th><th>Lever</th><th>People</th><th>Status</th><th>When</th></tr>
  ${items.map((c) => `<tr class="click" data-go="#/campaigns/${c.id}"><td><strong>${esc(c.move.title || c.title || c.subject || 'Campaign')}</strong><div class="muted small">${esc(c.subject)}</div></td>
    <td>${leverPill(c.lever)}</td><td>${c.audience_count}</td><td><span class="pill ${c.status === 'sent' ? 'ok' : c.status === 'skipped' ? 'warn' : ''}">${esc(c.status)}</span></td>
    <td class="muted small">${fmtDate(c.sent_at || c.week || c.created_at)}</td></tr>`).join('')}</table></div>`
  : '<div class="card empty"><div class="big">🎯</div><h2>No campaigns yet</h2><p>Each week’s move from the dashboard shows up here.</p></div>');

// Called by the dashboard's "This week's move" tile.
function bindMoveTile(el, m) {
  if (!m) return;
  const draft = $('[data-draft]', el);
  if (draft) draft.onclick = async () => {
    draft.disabled = true; draft.textContent = 'Drafting…';
    try { await api('POST', `/api/campaigns/${m.campaign_id}/draft`); location.hash = `#/campaigns/${m.campaign_id}`; } catch (err) { toast(err.message, true); draft.disabled = false; draft.textContent = '✍️ Draft it'; }
  };
  const skip = $('[data-skipmove]', el);
  if (skip) skip.onclick = async () => {
    await api('POST', `/api/campaigns/${m.campaign_id}/skip`);
    delete dash.data[`move:${dash.lever}`];
    toast('Skipped. A new move comes next Monday');
    renderDashboard();
  };
}

// ---------------- Print & QR (the analog bridge) ----------------
async function viewPrint() {
  const [lists, links, camps] = await Promise.all([api('GET', '/api/print/lists'), api('GET', '/api/links'), api('GET', '/api/campaigns')]);
  shell('email', `
    <div class="head"><div><h1>Email</h1><div class="muted">Send newsletters and announcements to your contacts.</div></div></div>
    <div class="tabs"><a href="#/email">Broadcasts</a><a href="#/email/campaigns">Weekly moves</a><a href="#/email/repurpose">Repurpose</a><a href="#/email/print" class="active">Print &amp; QR</a><a href="#/email/outbox">Outbox</a></div>
    <div class="grid two">
      <div class="card"><h2>Print newsletter mailing list</h2>
        ${lists.length ? lists.map((l) => `<div class="li"><span><b>${esc(l.product)}</b><br><span class="muted small">${l.subscribers} print subscriber${l.subscribers === 1 ? '' : 's'}${l.missing_address ? ` · <span style="color:#a16207">${l.missing_address} missing an address (left off labels)</span>` : ''}</span></span>
          <span class="row"><a class="btn sm" href="/api/print/subscribers.csv?product=${encodeURIComponent(l.product)}">CSV</a>
          <a class="btn sm primary" href="/api/print/labels.pdf?product=${encodeURIComponent(l.product)}">Mailing labels (PDF)</a></span></div>`).join('')
          : '<p class="muted">No print subscribers yet. Import your mailing list (People → Import CSV → Newsletter subscribers, format Print) or add a print subscription on a person.</p>'}
        <p class="hint" style="margin-top:10px">Labels fit standard 30-per-sheet US Letter label paper (Avery 5160 and compatible). Print at 100% scale.</p></div>
      <div class="card"><h2>Short links &amp; QR codes</h2>
        <p class="muted small">Put a QR code or short link on a postcard, insert or flyer. Every scan and visit is counted${camps.length ? ', and can be tied to a campaign' : ''}.</p>
        <form class="row" data-newlink style="align-items:flex-end">
          <label class="f" style="flex:1;min-width:140px;margin:0">Name<input name="label" placeholder="e.g. Spring postcard"></label>
          <label class="f" style="flex:2;min-width:200px;margin:0">Goes to<input name="url" required placeholder="https://yourshop.com/page"></label>
          ${camps.length ? `<label class="f" style="margin:0">Campaign<select name="campaign_id"><option value="">None</option>${camps.map((c) => `<option value="${c.id}">${esc((c.move.title || c.title || c.subject).slice(0, 40))}</option>`).join('')}</select></label>` : ''}
          <button class="btn primary">Create</button></form>
        <div class="err" data-linkerr></div>
        ${links.map((l) => `<div class="qrrow"><img src="/api/links/${l.id}/qr.svg" alt="QR code for ${esc(l.label)}" width="76" height="76">
          <div style="flex:1;min-width:0"><b>${esc(l.label)}</b><div class="muted small" style="overflow-wrap:anywhere">${esc(l.short_url)} → ${esc(l.url)}</div>
            <div class="small">${l.scans} scan${l.scans === 1 ? '' : 's'} · ${l.visits} visit${l.visits === 1 ? '' : 's'}${l.campaign_title ? ` · ${esc(l.campaign_title)}` : ''}</div></div>
          <div class="row" style="flex-direction:column;align-items:stretch;gap:4px"><a class="btn sm" href="/api/links/${l.id}/qr.svg?download=1">Download QR</a>
            <button class="btn sm" data-copy="${esc(l.short_url)}">Copy link</button><button class="btn sm danger" data-dellink="${l.id}">Delete</button></div></div>`).join('')}
      </div>
    </div>`);
  bindCopy();
  $('[data-newlink]').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('POST', '/api/links', Object.fromEntries(new FormData(e.target))); toast('Link created'); viewPrint(); } catch (err) { $('[data-linkerr]').textContent = err.message; }
  };
  $$('[data-dellink]').forEach((b) => { b.onclick = async () => {
    if (await confirmBox('Delete this link?', 'Printed QR codes pointing to it will stop working.')) { await api('DELETE', `/api/links/${b.dataset.dellink}`); viewPrint(); }
  }; });
}

// ---------------- Repurpose ----------------
// One essay or episode → an email, a product listing, two social posts and show notes.
function viewRepurpose() {
  shell('email', `
    <div class="head"><div><h1>Email</h1><div class="muted">Send newsletters and announcements to your contacts.</div></div></div>
    <div class="tabs"><a href="#/email">Broadcasts</a><a href="#/email/campaigns">Weekly moves</a><a href="#/email/repurpose" class="active">Repurpose</a><a href="#/email/print">Print &amp; QR</a><a href="#/email/outbox">Outbox</a></div>
    <form class="card" data-rp>
      <h2>Turn one piece into five</h2>
      <p class="muted small">Paste an essay, a blog post or a podcast transcript. You’ll get drafts for an email, a product listing, two social posts and show notes, in your voice. ${state.me.aiLive ? '' : '<b>AI drafting isn’t connected</b>, so these will be templates built from your first lines.'}</p>
      <div class="row" style="margin-bottom:8px"><label class="check" style="margin:0"><input type="radio" name="kind" value="essay" checked> Essay or post</label>
        <label class="check" style="margin:0"><input type="radio" name="kind" value="episode"> Episode transcript</label></div>
      <textarea name="text" rows="10" required minlength="200" placeholder="Paste the full text here…"></textarea>
      <div class="err" data-rperr></div>
      <button class="btn primary">✍️ Make the drafts</button>
    </form>
    <div data-rpout></div>`);
  $('[data-rp]').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('button.primary', e.target);
    btn.disabled = true; btn.textContent = 'Writing…'; $('[data-rperr]').textContent = '';
    try {
      const r = await api('POST', '/api/repurpose', Object.fromEntries(new FormData(e.target)));
      const card = (title, body, extra = '') => `<div class="card rpcard"><div class="row" style="justify-content:space-between"><h2 style="margin:0">${title}</h2>
        <span class="row">${extra}<button class="btn sm" data-copytext>Copy</button></span></div><pre class="mail" style="max-height:none">${esc(body)}</pre></div>`;
      $('[data-rpout]').innerHTML = `${r.template ? '<div class="banner" style="margin-top:14px">These are templates. Fill in the [bracketed] parts, or connect AI drafting to write them in your voice.</div>' : ''}
        <div class="grid two" style="margin-top:14px">
        ${card('✉️ Email to subscribers', `Subject: ${r.email.subject}\n\n${r.email.body}`, '<button class="btn sm primary" data-tobroadcast>Make it a broadcast draft</button>')}
        ${card('🛍️ Product listing', `${r.product_listing.title}\n\n${r.product_listing.description}`)}
        ${r.social_posts.map((p, i) => card(`💬 Social post ${i + 1}`, p)).join('')}
        ${card('🎧 Show notes', r.show_notes)}</div>`;
      $$('[data-copytext]').forEach((b) => { b.onclick = async () => { await navigator.clipboard.writeText(b.closest('.card').querySelector('pre').textContent); toast('Copied'); }; });
      $('[data-tobroadcast]').onclick = async () => {
        await api('POST', '/api/broadcasts', { subject: r.email.subject, body: r.email.body, tag: '' });
        toast('Saved as a broadcast draft'); location.hash = '#/email';
      };
    } catch (err) { $('[data-rperr]').textContent = err.message; }
    btn.disabled = false; btn.textContent = '✍️ Make the drafts';
  };
}
