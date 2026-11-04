'use strict';

// ---------------- Inbox ----------------
// Every conversation in one place: texts, missed calls, email replies and
// inquiry forms. Pick a person, read the thread, answer by text or email.
const CH_ICON = { sms: 'chat', email: 'mail', call: 'phone', form: 'note' };
const CH_WORD = { sms: 'Text', email: 'Email', call: 'Call', form: 'Form' };
const ago = (t) => {
  const s = (Date.now() - new Date(t)) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
// +15550123456 → (555) 012-3456; other countries stay as they are.
const fmtPhone = (p) => { const m = String(p || '').match(/^\+1(\d{3})(\d{3})(\d{4})$/); return m ? `(${m[1]}) ${m[2]}-${m[3]}` : String(p || ''); };
// Why a text didn't arrive, in plain words (Twilio error codes).
const SMS_WHY = {
  30034: 'carriers block texts until your number is registered for business texting (Twilio → Messaging → A2P 10DLC)',
  30032: 'your toll-free number needs verifying before it can text',
  30007: 'the carrier filtered it as possible spam',
  30003: 'their phone is off or out of service',
  30005: 'that number doesn’t exist or can’t get texts',
  30006: 'that number is a landline or can’t get texts',
  30004: 'they’ve blocked texts from this number',
  21610: 'they replied STOP to this number',
  21608: 'on a Twilio trial you can only text numbers you’ve verified',
};
const smsStatus = (st) => {
  const [s, code] = String(st || '').split(':');
  if (s === 'logged') return ' · test mode, not sent';
  if (s === 'delivered') return ' · delivered';
  if (s === 'failed' || s === 'undelivered') return ` · didn’t deliver${SMS_WHY[code] ? `: ${SMS_WHY[code]}` : code ? ` (error ${code})` : ''}`;
  return '';
};
const whoOf = (c) => [c.first_name, c.last_name].filter(Boolean).join(' ') || fmtPhone(c.phone) || c.email || 'Someone';

async function viewInbox(contactId) {
  const { conversations, texting } = await api('GET', '/api/inbox');
  const open = contactId && /^\d+$/.test(contactId) ? Number(contactId) : null;
  shell('inbox', `
    <div class="head"><div><h1>Inbox</h1><div class="muted">Texts, missed calls, email replies and form inquiries, all in one place.</div></div></div>
    ${texting.live && texting.number ? '' : `<div class="banner">${texting.number ? '<b>Test mode:</b> texts are saved here but not sent until texting is switched on.' : '<b>Texting isn’t set up yet.</b> Email replies and form inquiries still land here.'} <a href="#/settings">Set up texting and calls</a></div>`}
    ${conversations.length ? `<div class="inbox ${open ? 'has-thread' : ''}">
      <div class="ib-list-wrap"><div class="card ib-list" role="list">${conversations.map((c) => `
        <a role="listitem" class="ib-conv ${c.id === open ? 'on' : ''} ${c.unread ? 'unread' : ''}" href="#/inbox/${c.id}">
          ${avatarHtml(c, 36)}
          <span style="min-width:0"><span class="nm">${esc(whoOf(c))}</span><br><span class="pv">${c.direction === 'out' ? 'You: ' : ''}${esc(String(c.body).slice(0, 80))}</span></span>
          <span class="when">${ago(c.created_at)}<span class="ch-ico" title="${CH_WORD[c.channel]}">${icon(CH_ICON[c.channel] || 'chat')}</span></span></a>`).join('')}</div></div>
      <section class="card ib-thread" data-thread>${open ? '<div class="ib-msgs"><div class="skeleton"></div></div>' : '<div class="ib-msgs" style="justify-content:center;align-items:center"><p class="muted">Pick a conversation.</p></div>'}</section>
    </div>` : `<div class="card empty"><div class="big">${icon('chat')}</div><h2>No conversations yet</h2>
      <p>When someone texts your Rilly number, calls and you miss it, replies to an email you sent from here, or sends an inquiry form, it shows up here, ready to answer.</p>
      <a class="btn primary" href="#/settings">Set up texting and calls</a></div>`}`);
  if (open) await renderThread(open, texting);
}

async function renderThread(contactId, texting) {
  const box = $('[data-thread]');
  let data;
  try { data = await api('GET', `/api/inbox/${contactId}`); } catch (e) { box.innerHTML = `<p class="muted" style="padding:16px">${esc(e.message)}</p>`; return; }
  refreshUnread();
  $(`.ib-conv[href="#/inbox/${contactId}"]`)?.classList.remove('unread');
  const c = data.contact;
  const canText = Boolean(c.phone) && !c.sms_opt_out;
  const canEmail = Boolean(c.email) && !c.unsubscribed;
  // Answer the way they reached you: a text gets a text, everything else an email (when possible).
  const lastIn = [...data.messages].reverse().find((m) => m.direction === 'in');
  let channel = (lastIn?.channel === 'sms' || lastIn?.channel === 'call') && canText ? 'sms' : canEmail ? 'email' : canText ? 'sms' : '';
  const time = (t) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const bubble = (m) => (m.channel === 'call'
    ? `<div class="ib-m event">${icon('phone')} ${esc(m.body)} · ${time(m.created_at)}</div>`
    : `<div class="ib-m ${m.direction}">${m.subject && m.channel === 'email' ? `<span class="subj">${esc(m.subject)}</span>` : ''}${esc(m.body)}
        <span class="meta">${CH_WORD[m.channel]} · ${time(m.created_at)}${m.channel === 'sms' ? smsStatus(m.status) : ''}</span></div>`);
  box.innerHTML = `
    <div class="ib-head"><a class="btn sm ghost" href="#/inbox" aria-label="Back to all conversations">${icon('arrowRight')}</a>${avatarHtml(c, 40)}
      <div class="who"><b>${esc(whoOf(c))}</b><div class="muted small">${[fmtPhone(c.phone), c.email].filter(Boolean).map(esc).join(' · ')}${c.sms_opt_out ? ' · replied STOP to texts' : ''}</div></div>
      <a class="btn sm" href="#/people/${c.id}">Their record</a></div>
    <div class="ib-msgs" data-msgs>${data.messages.map(bubble).join('')}</div>
    <form class="ib-reply" data-reply>
      ${channel ? `<textarea name="body" required placeholder="Write a reply…" aria-label="Reply"></textarea>
      <div class="row"><div class="seg" role="group" aria-label="Reply by">
        <button type="button" data-ch="sms" aria-pressed="${channel === 'sms'}" ${canText ? '' : 'disabled title="No mobile number, or they replied STOP"'}>${icon('chat')} Text</button>
        <button type="button" data-ch="email" aria-pressed="${channel === 'email'}" ${canEmail ? '' : 'disabled title="No email address, or they unsubscribed"'}>${icon('mail')} Email</button></div>
        <span class="muted small" data-count></span><button class="btn primary">Send</button></div>`
    : '<p class="muted small">There’s no way to reach them from here: no mobile number or email (or they opted out).</p>'}
    </form>`;
  const msgs = $('[data-msgs]');
  msgs.scrollTop = msgs.scrollHeight;
  $('.ib-head [href="#/inbox"] svg')?.style.setProperty('transform', 'scaleX(-1)');
  const form = $('[data-reply]');
  const ta = $('textarea', form);
  if (!ta) return;
  const count = () => { $('[data-count]').textContent = channel === 'sms' ? `${ta.value.length}/160${ta.value.length > 160 ? ` (${Math.ceil(ta.value.length / 153)} texts)` : ''}` : ''; };
  ta.oninput = count;
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) form.requestSubmit(); });
  $$('[data-ch]', form).forEach((b) => { b.onclick = () => { channel = b.dataset.ch; $$('[data-ch]', form).forEach((x) => x.setAttribute('aria-pressed', x === b)); count(); ta.focus(); }; });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('button.primary', form);
    btn.disabled = true;
    try {
      const r = await api('POST', `/api/inbox/${contactId}/reply`, { channel, body: ta.value });
      toast(r.status === 'logged' ? 'Saved (test mode: not sent)' : channel === 'sms' ? 'Text sent' : 'Email sent');
      await renderThread(contactId, texting);
    } catch (err) { toast(err.message, true); btn.disabled = false; }
  };
  count();
  if (matchMedia('(min-width: 861px)').matches) ta.focus();
}
