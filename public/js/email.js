'use strict';

// ---------------- Email ----------------
async function viewEmail(tab) {
  const outbox = tab === 'outbox', camps = tab === 'campaigns';
  const [items, tags, segs] = await Promise.all([api('GET', outbox ? '/api/outbox' : camps ? '/api/campaigns' : '/api/broadcasts'), api('GET', '/api/tags'), api('GET', '/api/segments').catch(() => [])]);
  SEG_LABELS = Object.fromEntries(segs.map((s) => [s.key, s.label]));
  shell('email', `
    <div class="head"><div><h1>Email</h1><div class="muted">Send newsletters and announcements to your contacts.</div></div>
      ${!outbox && !camps && !items.length ? '' : `<button class="btn primary" data-compose>${icon('plus')} New email</button>`}</div>
    ${state.me.emailLive ? '' : '<div class="banner"><b>Test mode:</b> no email service is connected, so emails are saved to the Outbox instead of being delivered.</div>'}
    <div class="tabs"><a href="#/email" class="${outbox || camps ? '' : 'active'}">Broadcasts</a><a href="#/email/campaigns" class="${camps ? 'active' : ''}">Weekly moves</a><a href="#/email/repurpose">Repurpose</a><a href="#/email/print">Print &amp; QR</a><a href="#/email/outbox" class="${outbox ? 'active' : ''}">Outbox</a></div>
    ${outbox ? outboxHtml(items) : camps ? campaignsHtml(items) : broadcastsHtml(items)}`);
  bindRowLinks();

  const compose = $('[data-compose]'); if (compose) compose.onclick = () => { location.hash = '#/email/new'; };
  $$('[data-send]').forEach((b) => { b.onclick = async () => {
    const bc = items.find((x) => x.id === Number(b.dataset.send));
    if (!await modal('Send broadcast?', `<p>“${esc(bc.subject)}” will go to <b>${bc.tag ? `contacts tagged “${esc(bc.tag)}”` : 'all subscribed contacts'}</b>. This can’t be undone.</p>`, { submit: 'Send now' })) return;
    b.disabled = true; b.textContent = 'Sending…';
    try { const r = await api('POST', `/api/broadcasts/${bc.id}/send`); toast(`Sent to ${r.sent} of ${r.total} contacts`); } catch (err) { toast(err.message, true); }
    viewEmail();
  }; });
  $$('[data-delb]').forEach((b) => { b.onclick = async () => {
    deleteWithUndo('Draft deleted', { url: `/api/broadcasts/${b.dataset.delb}`, hide: hideEl(b.closest('article.bc')) });
  }; });
  $$('[data-view]').forEach((r) => { r.onclick = () => {
    const m = items.find((x) => x.id === Number(r.dataset.view));
    modal(m.subject, `<p class="muted small">To ${esc(m.to_email)} · ${esc(m.status)}${m.error ? ` · ${esc(m.error)}` : ''}</p><pre class="mail">${esc(m.body)}</pre>`, { submit: 'Close' });
  }; });
}

let SEG_LABELS = {};
const readableMerge = (t) => String(t || '').replace(/\{\{\s*([a-z_]+)[^}]*\}\}/g, (_, k) => `[${k.replace(/_/g, ' ')}]`);
const rate = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '—');
const broadcastsHtml = (items) => (items.length ? `<div class="bc-list">${items.map((b) => `
  <article class="bc card">
    <a class="bc-main" href="#/email/${b.id}">
      <span class="pill ${b.status === 'sent' ? 'ok' : b.status === 'sending' || b.status === 'scheduled' ? '' : 'warn'}">${b.status === 'draft' ? 'Draft' : b.status === 'sent' ? 'Sent' : b.status === 'scheduled' ? `Scheduled · ${esc(new Date(b.scheduled_at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}` : 'Sending'}</span>
      <b class="bc-subj">${esc(readableMerge(b.subject))}</b>
      <span class="muted small bc-pre">${esc(readableMerge(b.preheader || b.body.replace(/\s+/g, ' ').slice(0, 110)))}</span>
      <span class="muted small">${b.segment ? `To segment “${esc(SEG_LABELS[b.segment] || b.segment)}”` : b.tag ? `To contacts tagged “${esc(b.tag)}”` : 'To everyone subscribed'}${b.sent_at ? ` · sent ${fmtDate(b.sent_at)}` : ` · edited ${fmtDate(b.created_at)}`}</span></a>
    ${b.status === 'sent' ? `<div class="bc-stats"><span><b>${b.sent_count}</b>sent</span><span><b>${rate(b.opened, b.sent_count)}</b>opened</span><span><b>${rate(b.clicked, b.sent_count)}</b>clicked</span>
        ${b.sent_count > b.opened ? `<a class="btn sm" href="#/email/new?segment=${encodeURIComponent(`bc_noopen:${b.id}`)}&from=${b.id}" title="Same email, new subject line, to people who didn’t open">${icon('refresh')} Resend to ${b.sent_count - b.opened} who didn’t open</a>` : ''}</div>`
      : `<div class="bc-actions"><a class="btn sm" href="#/email/${b.id}">Edit</a><button class="btn sm primary" data-send="${b.id}">Send</button>
        <button class="btn sm danger icon" data-delb="${b.id}" title="Delete draft" aria-label="Delete draft">${icon('trash')}</button></div>`}
  </article>`).join('')}</div>` : `<div class="card empty"><div class="big">${icon('mail')}</div><h2>No emails yet</h2><p>Start with one short note: some news, an offer or a useful tip. You’ll see a preview and can send yourself a test before it goes to anyone.</p>
    <a class="btn primary" href="#/email/new">${icon('plus')} New email</a></div>`);

const outboxHtml = (items) => (items.length ? `<div class="card table-wrap"><table>
  <tr><th>To</th><th>Subject</th><th>Status</th><th>When</th></tr>
  ${items.map((m) => `<tr class="click" data-view="${m.id}"><td>${esc(m.to_email)}</td><td>${esc(m.subject)}</td>
    <td><span class="pill ${m.status === 'failed' ? 'warn' : 'ok'}">${esc(m.status)}</span></td><td class="muted small">${fmtDate(m.created_at)}</td></tr>`).join('')}
  </table></div>` : '<div class="card empty"><div class="big">' + icon('inbox') + '</div><h2>Outbox is empty</h2><p>Every email you send is recorded here.</p></div>');

// Starting points: each a warm, short draft in the owner's own words to edit.
const EMAIL_STARTERS = [
  { key: 'note', icon: 'pencil', label: 'A quick note', subject: '', preheader: '', body: 'Hi {{first_name|there}},\n\n\n\n—\n{{sender}}' },
  { key: 'news', icon: 'inbox', label: 'News & updates', subject: 'What’s new at {{business}}', preheader: 'A few things I wanted you to know about',
    body: 'Hi {{first_name|there}},\n\nA quick update from me:\n\n• [The main news]\n• [Something else worth knowing]\n• [A small tip or story]\n\nThanks for being here.\n\n—\n{{sender}}' },
  { key: 'offer', icon: 'tag', label: 'Special offer', subject: '[The offer], this week only', preheader: 'Ends [day]. Here’s how to get it.',
    body: 'Hi {{first_name|there}},\n\nFor this week only, [the offer, in one sentence].\n\nIt’s a good fit if [who it’s for].\n\nGet it here: [link]\n\nIt ends on [day].\n\n—\n{{sender}}' },
  { key: 'event', icon: 'calendar', label: 'Invitation', subject: 'You’re invited: [event]', preheader: '[Date] at [place]. I’d love to see you there.',
    body: 'Hi {{first_name|there}},\n\nI’d love you to come to [event].\n\nWhen: [date and time]\nWhere: [place or link]\n\nSave your spot: [link]\n\n—\n{{sender}}' },
  { key: 'thanks', icon: 'sparkle', label: 'Thank you', subject: 'Thank you, {{first_name|friend}}', preheader: 'A short note from me',
    body: 'Hi {{first_name|there}},\n\nI just wanted to say thank you. [Why you’re grateful, in a sentence or two.]\n\nIf there’s ever anything I can help with, just reply.\n\n—\n{{sender}}' },
  { key: 'content', icon: 'page', label: 'New post or episode', subject: '[Title of the post or episode]', preheader: '[One line on why it’s worth reading]',
    body: 'Hi {{first_name|there}},\n\nI just published [what it is]: [title].\n\n[Two or three sentences on what’s in it and who it helps.]\n\nRead it here: [link]\n\n—\n{{sender}}' },
  { key: 'winback', icon: 'chat', label: 'We miss you', subject: 'It’s been a while, {{first_name|friend}}', preheader: 'Here’s what’s new since you last visited',
    body: 'Hi {{first_name|there}},\n\nIt’s been a little while, and I wanted to say hello.\n\nSince we last spoke: [what’s new].\n\nIf anything catches your eye, just reply.\n\n—\n{{sender}}' },
];

// ---------------- Email designer ----------------
// Write on the left, see it on the right exactly as readers will: the inbox
// line, then the opened email, on desktop or phone. Plain, personal emails
// land in inboxes more often, so the design stays simple on purpose.
async function viewCompose(bid) {
  const isNew = bid === 'new';
  const qs = new URLSearchParams(location.hash.split('?')[1] || '');
  const preset = qs.get('segment') || '';
  const orig = qs.get('from') ? await api('GET', `/api/broadcasts/${qs.get('from')}`).catch(() => null) : null;
  const [b, tags, people, segs] = await Promise.all([isNew ? Promise.resolve(orig ? { subject: '', preheader: orig.preheader, body: orig.body, tag: '', segment: preset, status: 'draft', resendOf: orig.subject } : { subject: '', preheader: '', body: 'Hi {{first_name|there}},\n\n', tag: '', segment: preset, status: 'draft' }) : api('GET', `/api/broadcasts/${bid}`),
    api('GET', '/api/tags'), api('GET', '/api/contacts').catch(() => []), api('GET', '/api/segments').catch(() => [])]);
  const groups = [...new Set(segs.map((s) => s.group))];
  const toVal = b.segment ? `seg:${b.segment}` : b.tag ? `tag:${b.tag}` : '';
  // Emailing one person: from ?to=<id> (People → Email them) or a saved draft.
  const personLabel = (c) => `${fullName(c) || c.email} <${c.email}>`;
  const oneId = Number((b.segment || '').match(/^person:(\d+)$/)?.[1] || qs.get('to') || 0);
  let onePerson = oneId ? people.find((c) => c.id === oneId) : null;
  const locked = !['draft', 'scheduled'].includes(b.status);
  const acct = state.me.account;
  const sigs = await loadSignatures();
  // New emails start with the default signature, if there is one.
  if (isNew && !orig && sigs.default) b.body = 'Hi {{first_name|there}},\n\n\n\n{{signature}}';
  const sample = people.find((p) => p.first_name) || { first_name: 'Alex', last_name: 'Reader', email: 'alex@example.com' };
  shell('email', `
    <div class="compose">
      <div class="cmp-bar"><a class="btn sm" href="#/email">${icon('chevronDown').replace('class="i ', 'class="i rot90 ')} Emails</a>
        <span class="muted small" data-state>${locked ? `Sent ${fmtDate(b.sent_at)} to ${b.sent_count}` : isNew ? 'New email' : 'Draft'}</span>
        ${locked ? '' : `<span class="cmp-actions"><button class="btn sm" data-test>${icon('mail')} Send me a test</button><button class="btn sm" data-save>Save draft</button><button class="btn sm primary" data-sendnow>Send…</button></span>`}</div>
      ${isNew && !b.resendOf ? `<div class="starters" data-starters><span class="muted small">Start from</span>${EMAIL_STARTERS.map((t) => `<button type="button" class="starter" data-starter="${t.key}">${icon(t.icon)} ${esc(t.label)}</button>`).join('')}</div>` : ''}
      ${b.status === 'scheduled' ? `<div class="banner cmp-sched">${icon('clock')} Scheduled for <b>${esc(new Date(b.scheduled_at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</b>. You can still edit it. <button type="button" class="btn sm" data-unsched>Cancel schedule</button></div>` : ''}
      <form class="cmp-form" data-form>
        <label class="f">To<select name="to" ${locked ? 'disabled' : ''}><option value="">Everyone subscribed</option>
          ${groups.map((g) => `<optgroup label="${esc(g)}">${segs.filter((s) => s.group === g).map((s) => `<option value="seg:${esc(s.key)}" ${toVal === `seg:${s.key}` ? 'selected' : ''}>${esc(s.label)} (${s.count})</option>`).join('')}</optgroup>`).join('')}
          ${tags.length ? `<optgroup label="Tags">${tags.map((t) => `<option value="tag:${esc(t.tag)}" ${toVal === `tag:${t.tag}` ? 'selected' : ''}>Tagged “${esc(t.tag)}” (${t.count})</option>`).join('')}</optgroup>` : ''}
          <optgroup label="One person">${onePerson ? `<option value="seg:person:${onePerson.id}" selected>${esc(personLabel(onePerson))}</option>` : ''}<option value="pick">Choose someone, or type an email…</option></optgroup></select>
          <span class="hint" data-count>Counting…</span></label>
        <div class="f one-person" data-onebox hidden><input data-onein list="one-people" placeholder="Start typing a name or email" autocomplete="off" aria-label="Who to email">
          <datalist id="one-people">${people.filter((c) => c.email && !c.unsubscribed).slice(0, 2000).map((c) => `<option value="${esc(c.email)}">${esc(fullName(c) || c.email)}</option>`).join('')}</datalist>
          <button type="button" class="btn sm primary" data-oneok>Use</button><button type="button" class="btn sm ghost" data-onecancel>Cancel</button></div>
        <div class="f"><span class="lbl-row">Subject <span class="hint" data-sublen></span>${locked ? '' : fieldSelect('subject')}</span><input name="subject" maxlength="300" value="${esc(b.subject)}" placeholder="${b.resendOf ? `A new angle on “${esc(b.resendOf)}”` : 'A short, specific promise'}" ${locked ? 'disabled' : ''}></div>
        <div class="f"><span class="lbl-row">Preview text <span class="hint">the grey line after the subject in the inbox</span>${locked ? '' : fieldSelect('preheader')}</span><input name="preheader" maxlength="200" value="${esc(b.preheader || '')}" placeholder="Adds context so more people open" ${locked ? 'disabled' : ''}></div>
        <div class="f">Message
          ${locked ? '' : `<div class="cmp-tools" role="toolbar" aria-label="Insert">
            ${fieldSelect('body')}
            <button type="button" data-link>${icon('link')} Link</button>
            <button type="button" data-sigmenu aria-haspopup="menu">${icon('pencil')} Signature</button></div>`}
          <textarea name="body" rows="18" ${locked ? 'disabled' : ''}>${esc(b.body)}</textarea>
          <span class="hint">Write like a note to one person. Type <b>{{</b> for fill-in fields like their first name. An unsubscribe link is added for you.</span></div>
      </form>
      <aside class="cmp-preview">
        <div class="seg cmp-device"><button type="button" class="on" data-dev="desktop">Desktop</button><button type="button" data-dev="phone">Phone</button></div>
        <div class="cmp-inbox"><span class="ib-dot"></span><div><b data-pfrom></b><div><b data-psubj></b> <span class="muted" data-ppre></span></div></div><span class="muted small">now</span></div>
        <div class="cmp-frame" data-frame><div class="cmp-mail">
          <div class="cmp-head"><b data-pfrom2></b><span class="muted small">to ${esc(sample.first_name)} &lt;${esc(sample.email)}&gt;</span></div>
          <h3 data-psubj2></h3><div data-pbody></div>
          <p class="cmp-foot">--<br>Unsubscribe</p></div></div>
        ${locked ? '' : '<div class="cmp-check card" data-check aria-live="polite"></div>'}
        <p class="hint">Preview uses ${people.find((p) => p.first_name) ? `${esc(sample.first_name)} from your contacts` : 'a sample reader'} for the name fields.</p>
      </aside>
    </div>`);

  const form = $('[data-form]');
  const toParts = () => { const [k, ...r] = form.to.value.split(':'); const v = r.join(':'); return { tag: k === 'tag' ? v : '', segment: k === 'seg' ? v : '' }; };
  const val = () => ({ subject: form.subject.value, preheader: form.preheader.value, body: form.body.value, ...toParts() });
  const merge = (t) => String(t || '').replace(/\{\{\s*(\w+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g, (m, k, fb) => {
    const v = { first_name: sample.first_name, last_name: sample.last_name, email: sample.email, business: acct.name, name: [sample.first_name, sample.last_name].filter(Boolean).join(' ') };
    return k in v ? v[k] || fb || ({ first_name: 'there', name: 'there' }[k] || '') : m;
  });
  const bodyHtml = (t) => esc(merge(t)).split(/\n{2,}/).filter((x) => x.trim()).map((para) => `<p>${para.replace(/\n/g, '<br>')
    .replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`)}</p>`).join('')
    // {{signature}} lines show the real signature, as readers will see it.
    .replace(/<p>\{\{\s*signature(?::([\w-]+))?\s*\}\}<\/p>/g, (m, id) => signatureHtml(pickSignature(sigs, id)) || '<p class="muted small">[No signature saved yet: Signature → New signature]</p>');
  const sender = acct.from_name || acct.name;
  let dirty = false;
  const render = () => {
    const v = val();
    $('[data-pfrom]').textContent = sender; $('[data-pfrom2]').textContent = sender;
    $('[data-psubj]').textContent = merge(v.subject) || '(no subject)'; $('[data-psubj2]').textContent = merge(v.subject) || '(no subject)';
    $('[data-ppre]').textContent = `– ${merge(v.preheader) || merge(v.body).replace(/\{\{\s*signature[^}]*\}\}/g, '').replace(/\s+/g, ' ').trim().slice(0, 90)}`;
    $('[data-pbody]').innerHTML = bodyHtml(v.body) || '<p class="muted">Your message appears here.</p>';
    const n = v.subject.length;
    $('[data-sublen]').textContent = n ? `${n} characters${n > 60 ? ' · may be cut off on phones' : ''}` : '';
  };
  const count = async () => {
    const { tag, segment } = toParts();
    const seg = segs.find((s) => s.key === segment);
    try { const r = await api('GET', `/api/broadcasts/audience?${new URLSearchParams({ tag, segment })}`); audienceN = r.count; if ($('[data-check]')) check(); $('[data-count]').textContent = `${r.count} ${r.count === 1 ? 'person' : 'people'} will get this${seg ? ` · ${seg.description}` : ''}`; }
    catch { $('[data-count]').textContent = ''; }
  };
  // Quick check before sending: plain questions, ticked as you go.
  let tested = false, audienceN = null;
  const check = () => {
    if (!$('[data-check]')) return { blocking: false };
    const v = val(), body = v.body.replace(/\{\{[^}]*\}\}/g, '').trim();
    const items = [
      [v.subject.trim() && v.subject.length <= 60, v.subject.trim() ? (v.subject.length <= 60 ? 'Subject is short enough for phones' : 'Subject may be cut off on phones (over 60 characters)') : 'Add a subject', !v.subject.trim()],
      [v.preheader.trim(), v.preheader.trim() ? 'Preview text set' : 'Add preview text (optional, but more people open)'],
      [/\{\{\s*(first_name|name)/.test(v.subject + v.body), /\{\{\s*(first_name|name)/.test(v.subject + v.body) ? 'Greets them by name' : 'Greet them by name (Insert field → First name)'],
      [!/\[[^\]]{2,}\]/.test(v.subject + v.body + v.preheader), /\[[^\]]{2,}\]/.test(v.subject + v.body + v.preheader) ? 'Fill in the [square brackets]' : 'No placeholders left', /\[[^\]]{2,}\]/.test(v.subject + v.body + v.preheader)],
      [/https?:\/\//.test(v.body), /https?:\/\//.test(v.body) ? 'Has a link to click' : 'No link (fine for a personal note)'],
      [audienceN > 0, audienceN === null ? 'Counting who gets it…' : audienceN ? `${audienceN} ${audienceN === 1 ? 'person' : 'people'} will get it` : 'Nobody is in this audience yet', audienceN === 0],
      [tested, tested ? 'Test sent to you' : 'Send yourself a test to see it on your phone'],
      [true, 'Unsubscribe link added for you'],
    ];
    $('[data-check]').innerHTML = `<b>Before you send</b>${items.map(([ok, text, bad]) => `<div class="ck ${ok ? 'ok' : bad ? 'bad' : 'meh'}">${icon(ok ? 'check' : bad ? 'alert' : 'info')}<span>${esc(text)}</span></div>`).join('')}`;
    const blocking = !body || !v.subject.trim() || /\[[^\]]{2,}\]/.test(v.subject + v.body + v.preheader) || audienceN === 0;
    const sendBtn = $('[data-sendnow]'); if (sendBtn) sendBtn.title = blocking ? 'Fix the items marked in the checklist first' : '';
    return { blocking };
  };
  render(); count().then(() => check()); check();
  form.addEventListener('input', check);
  $$('[data-starter]').forEach((btn) => { btn.onclick = () => {
    const t = EMAIL_STARTERS.find((x) => x.key === btn.dataset.starter);
    // Starters end with your saved signature when you have one, else your name.
    const fill = (x) => (sigs.default ? x.replace(/—\n\{\{sender\}\}/g, '{{signature}}') : x).replace(/\{\{sender\}\}/g, acct.from_name || acct.name);
    form.subject.value = fill(t.subject); form.preheader.value = fill(t.preheader); form.body.value = fill(t.body);
    $$('[data-starter]').forEach((x) => x.classList.toggle('on', x === btn));
    dirty = true; render(); check();
    const at = form.body.value.indexOf('['); form.body.focus(); if (at >= 0) form.body.setSelectionRange(at, form.body.value.indexOf(']', at) + 1);
  }; });
  form.addEventListener('input', () => { dirty = true; render(); });
  // "One person": pick a contact or type any email (a new address is added to People).
  const oneBox = $('[data-onebox]'), oneIn = $('[data-onein]');
  let lastTo = form.to.value;
  form.to.addEventListener('change', () => {
    if (form.to.value === 'pick') { oneBox.hidden = false; oneIn.focus(); form.to.value = lastTo; return; }
    lastTo = form.to.value;
  });
  const usePerson = async () => {
    const raw = oneIn.value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) { toast('Pick someone from the list or type a full email address', true); return; }
    let c = people.find((x) => (x.email || '').toLowerCase() === raw);
    if (!c) {
      const r = await api('POST', '/api/contacts', { email: raw, entry: 'Emailed directly' }).catch((e) => { toast(e.message, true); return null; });
      if (!r) return;
      c = { id: r.id, email: raw, first_name: '', last_name: '' }; people.push(c);
    }
    if (c.unsubscribed) { toast(`${c.email} has unsubscribed, so they can’t be emailed`, true); return; }
    $('[name=to] optgroup[label="One person"] option[value^="seg:person:"]')?.remove();
    const opt = document.createElement('option'); opt.value = `seg:person:${c.id}`; opt.textContent = personLabel(c);
    $('[name=to] optgroup[label="One person"]').prepend(opt);
    form.to.value = opt.value; lastTo = opt.value; oneBox.hidden = true; oneIn.value = '';
    dirty = true; count(); render();
  };
  $('[data-oneok]').onclick = usePerson;
  oneIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); usePerson(); } });
  $('[data-onecancel]').onclick = () => { oneBox.hidden = true; };
  form.to.addEventListener('change', count);
  $$('[data-dev]').forEach((btn) => { btn.onclick = () => {
    $$('[data-dev]').forEach((x) => x.classList.toggle('on', x === btn));
    $('[data-frame]').classList.toggle('phone', btn.dataset.dev === 'phone');
  }; });
  if (locked) return;

  const insert = (text) => {
    const ta = form.body, at = ta.selectionStart ?? ta.value.length;
    ta.value = ta.value.slice(0, at) + text + ta.value.slice(ta.selectionEnd ?? at);
    ta.focus(); ta.selectionStart = ta.selectionEnd = at + text.length;
    dirty = true; render();
  };
  $$('[data-ins]').forEach((btn) => { btn.onclick = () => insert(btn.dataset.ins); });
  $('[data-sigmenu]').onclick = (e) => signatureMenu(e.currentTarget, (t) => {
    // One signature per email: a new pick replaces the old line.
    // Signatures always go at the end, and one per email: a new pick replaces the old line.
    form.body.value = form.body.value.replace(/\n*\{\{\s*signature(?::[\w-]+)?\s*\}\}/g, '').replace(/\s+$/, '') + t;
    dirty = true; render();
    loadSignatures().then((s) => { sigs.list = s.list; sigs.default = s.default; render(); });
  });
  bindFieldInserts(form);
  $('[data-link]').onclick = async () => {
    const v = await modal('Add a link', `<label class="f">Words before the link <span class="hint">optional</span><input name="label" placeholder="e.g. Read the full guide"></label>
      <label class="f">Web address<input name="url" type="url" required placeholder="https://"></label>`, { submit: 'Add link' });
    if (v?.url) insert(`${v.label ? `${v.label}: ` : ''}${v.url}`);
  };

  let savedId = isNew ? null : Number(bid);
  const save = async () => {
    const v = val();
    if (!v.subject.trim() || !v.body.trim()) throw new Error('Write a subject and a message first');
    if (savedId) await api('PUT', `/api/broadcasts/${savedId}`, v);
    else { savedId = (await api('POST', '/api/broadcasts', v)).id; history.replaceState(null, '', `#/email/${savedId}`); }
    dirty = false; $('[data-state]').textContent = 'Draft saved';
  };
  $('[data-save]').onclick = async () => { try { await save(); toast('Draft saved'); } catch (err) { toast(err.message, true); } };
  $('[data-test]').onclick = async () => {
    try { const r = await api('POST', '/api/broadcasts/test', val()); tested = true; check(); toast(`Test sent to ${r.to}${r.status === 'logged' ? ' (test mode: see Outbox)' : ''}`); }
    catch (err) { toast(err.message, true); }
  };
  $('[data-sendnow]').onclick = async () => {
    try { await save(); } catch (err) { toast(err.message, true); return; }
    if (check().blocking) { toast('Fix the items marked in “Before you send” first', true); return; }
    const who = $('[data-count]').textContent.split(' · ')[0];
    const soon = new Date(Date.now() + 864e5); soon.setHours(9, 0, 0, 0);
    const local = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
    const v = await modal('Send this email', `<p>“${esc(form.subject.value)}”</p><p><b>${esc(who)}</b>.${tested ? '' : ' <span class="muted small">You haven’t sent yourself a test yet.</span>'}</p>
      <label class="check"><input type="radio" name="when" value="now" checked hidden><span class="pill-opt">Send now</span></label>
      <label class="check"><input type="radio" name="when" value="later" hidden><span class="pill-opt">Send later</span></label>
      <label class="f" data-later>When<input type="datetime-local" name="at" value="${local(soon)}" min="${local(new Date())}"></label>
      <p class="hint">Once it’s sent it can’t be unsent.</p>`, { submit: 'Confirm' });
    if (!v) return;
    try {
      if (v.when === 'later') {
        const r = await api('POST', `/api/broadcasts/${savedId}/schedule`, { at: new Date(v.at).toISOString() });
        toast(`Scheduled for ${new Date(r.scheduled_at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`);
      } else { const r = await api('POST', `/api/broadcasts/${savedId}/send`); toast(`Sent to ${r.sent} of ${r.total}`); }
      dirty = false; location.hash = '#/email';
    } catch (err) { toast(err.message, true); }
  };
  const un = $('[data-unsched]');
  if (un) un.onclick = async () => { await api('POST', `/api/broadcasts/${bid}/unschedule`); toast('Schedule cancelled. It’s a draft again'); viewCompose(bid); };
  // Leaving with unsaved changes asks first.
  window.onbeforeunload = () => (dirty ? true : undefined);
  const leave = () => { if (!location.hash.startsWith('#/email/')) { window.onbeforeunload = null; window.removeEventListener('hashchange', leave); } };
  window.addEventListener('hashchange', leave);
}
