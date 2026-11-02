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
