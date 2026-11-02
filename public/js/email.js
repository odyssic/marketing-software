'use strict';

// ---------------- Email ----------------
async function viewEmail(tab) {
  const outbox = tab === 'outbox', camps = tab === 'campaigns';
  const [items, tags] = await Promise.all([api('GET', outbox ? '/api/outbox' : camps ? '/api/campaigns' : '/api/broadcasts'), api('GET', '/api/tags')]);
  shell('email', `
    <div class="head"><div><h1>Email</h1><div class="muted">Send newsletters and announcements to your contacts.</div></div>
      <button class="btn primary" data-compose>+ New broadcast</button></div>
    ${state.me.emailLive ? '' : '<div class="banner"><b>Dev mode:</b> no email provider is connected, so emails are saved to the Outbox instead of being delivered. Add SMTP settings on the server to send for real.</div>'}
    <div class="tabs"><a href="#/email" class="${outbox || camps ? '' : 'active'}">Broadcasts</a><a href="#/email/campaigns" class="${camps ? 'active' : ''}">Weekly moves</a><a href="#/email/repurpose">Repurpose</a><a href="#/email/print">Print &amp; QR</a><a href="#/email/outbox" class="${outbox ? 'active' : ''}">Outbox</a></div>
    ${outbox ? outboxHtml(items) : camps ? campaignsHtml(items) : broadcastsHtml(items)}`);
  bindRowLinks();

  $('[data-compose]').onclick = async () => {
    const r = await modal('New broadcast', `
      <label class="f">Send to<select name="tag"><option value="">All subscribed contacts</option>
        ${tags.map((t) => `<option value="${esc(t.tag)}">Contacts tagged “${esc(t.tag)}” (${t.count})</option>`).join('')}</select></label>
      <label class="f">Subject<input name="subject" required placeholder="A quick update for you, {{first_name}}"></label>
      <label class="f">Message<textarea name="body" rows="9" required placeholder="Hi {{first_name}},&#10;&#10;…"></textarea></label>
      <p class="hint">Personalise with {{first_name}}, {{last_name}} or {{email}}. An unsubscribe link is added automatically.</p>`,
    { submit: 'Save draft', onSubmit: (v) => api('POST', '/api/broadcasts', v) });
    if (r) { toast('Draft saved. Review it, then click Send.'); viewEmail(); }
  };
  $$('[data-send]').forEach((b) => { b.onclick = async () => {
    const bc = items.find((x) => x.id === Number(b.dataset.send));
    if (!await modal('Send broadcast?', `<p>“${esc(bc.subject)}” will go to <b>${bc.tag ? `contacts tagged “${esc(bc.tag)}”` : 'all subscribed contacts'}</b>. This can’t be undone.</p>`, { submit: 'Send now' })) return;
    b.disabled = true; b.textContent = 'Sending…';
    try { const r = await api('POST', `/api/broadcasts/${bc.id}/send`); toast(`Sent to ${r.sent} of ${r.total} contacts`); } catch (err) { toast(err.message, true); }
    viewEmail();
  }; });
  $$('[data-delb]').forEach((b) => { b.onclick = async () => {
    if (await confirmBox('Delete draft?', 'This draft will be removed.')) { await api('DELETE', `/api/broadcasts/${b.dataset.delb}`); viewEmail(); }
  }; });
  $$('[data-view]').forEach((r) => { r.onclick = () => {
    const m = items.find((x) => x.id === Number(r.dataset.view));
    modal(m.subject, `<p class="muted small">To ${esc(m.to_email)} · ${esc(m.status)}${m.error ? ` · ${esc(m.error)}` : ''}</p><pre class="mail">${esc(m.body)}</pre>`, { submit: 'Close' });
  }; });
}

const broadcastsHtml = (items) => (items.length ? `<div class="card table-wrap"><table>
  <tr><th>Subject</th><th>Audience</th><th>Status</th><th>Sent</th><th></th></tr>
  ${items.map((b) => `<tr><td><strong>${esc(b.subject)}</strong><div class="muted small">${esc(b.body.slice(0, 80))}</div></td>
    <td>${b.tag ? `<span class="tag">${esc(b.tag)}</span>` : 'Everyone'}</td>
    <td><span class="pill ${b.status === 'sent' ? 'ok' : ''}">${esc(b.status)}</span></td>
    <td>${b.status === 'sent' ? `${b.sent_count} · ${fmtDate(b.sent_at)}` : '—'}</td>
    <td style="text-align:right;white-space:nowrap">${b.status === 'draft' ? `<button class="btn sm primary" data-send="${b.id}">Send</button>
      <button class="btn sm danger icon" data-delb="${b.id}" title="Delete draft">✕</button>` : ''}</td></tr>`).join('')}
  </table></div>` : `<div class="card empty"><div class="big">✉️</div><h2>No broadcasts yet</h2><p>Write your first email to your list.</p></div>`);

const outboxHtml = (items) => (items.length ? `<div class="card table-wrap"><table>
  <tr><th>To</th><th>Subject</th><th>Status</th><th>When</th></tr>
  ${items.map((m) => `<tr class="click" data-view="${m.id}"><td>${esc(m.to_email)}</td><td>${esc(m.subject)}</td>
    <td><span class="pill ${m.status === 'failed' ? 'warn' : 'ok'}">${esc(m.status)}</span></td><td class="muted small">${fmtDate(m.created_at)}</td></tr>`).join('')}
  </table></div>` : '<div class="card empty"><div class="big">📭</div><h2>Outbox is empty</h2><p>Every email you send is recorded here.</p></div>');
