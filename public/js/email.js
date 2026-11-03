'use strict';

// ---------------- Email ----------------
async function viewEmail(tab) {
  const outbox = tab === 'outbox', camps = tab === 'campaigns';
  const [items, tags, segs] = await Promise.all([api('GET', outbox ? '/api/outbox' : camps ? '/api/campaigns' : '/api/broadcasts'), api('GET', '/api/tags'), api('GET', '/api/segments').catch(() => [])]);
  SEG_LABELS = Object.fromEntries(segs.map((s) => [s.key, s.label]));
  shell('email', `
    <div class="head"><div><h1>Email</h1><div class="muted">Send newsletters and announcements to your contacts.</div></div>
      <button class="btn primary" data-compose>${icon('plus')} New email</button></div>
    ${state.me.emailLive ? '' : '<div class="banner"><b>Test mode:</b> no email service is connected, so emails are saved to the Outbox instead of being delivered.</div>'}
    <div class="tabs"><a href="#/email" class="${outbox || camps ? '' : 'active'}">Broadcasts</a><a href="#/email/campaigns" class="${camps ? 'active' : ''}">Weekly moves</a><a href="#/email/repurpose">Repurpose</a><a href="#/email/print">Print &amp; QR</a><a href="#/email/outbox" class="${outbox ? 'active' : ''}">Outbox</a></div>
    ${outbox ? outboxHtml(items) : camps ? campaignsHtml(items) : broadcastsHtml(items)}`);
  bindRowLinks();

  $('[data-compose]').onclick = () => { location.hash = '#/email/new'; };
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

let SEG_LABELS = {};
const readableMerge = (t) => String(t || '').replace(/\{\{\s*([a-z_]+)[^}]*\}\}/g, (_, k) => `[${k.replace(/_/g, ' ')}]`);
const rate = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '—');
const broadcastsHtml = (items) => (items.length ? `<div class="bc-list">${items.map((b) => `
  <article class="bc card">
    <a class="bc-main" href="#/email/${b.id}">
      <span class="pill ${b.status === 'sent' ? 'ok' : b.status === 'sending' ? '' : 'warn'}">${b.status === 'draft' ? 'Draft' : b.status === 'sent' ? 'Sent' : 'Sending'}</span>
      <b class="bc-subj">${esc(readableMerge(b.subject))}</b>
      <span class="muted small bc-pre">${esc(readableMerge(b.preheader || b.body.replace(/\s+/g, ' ').slice(0, 110)))}</span>
      <span class="muted small">${b.segment ? `To segment “${esc(SEG_LABELS[b.segment] || b.segment)}”` : b.tag ? `To contacts tagged “${esc(b.tag)}”` : 'To everyone subscribed'}${b.sent_at ? ` · sent ${fmtDate(b.sent_at)}` : ` · edited ${fmtDate(b.created_at)}`}</span></a>
    ${b.status === 'sent' ? `<div class="bc-stats"><span><b>${b.sent_count}</b>sent</span><span><b>${rate(b.opened, b.sent_count)}</b>opened</span><span><b>${rate(b.clicked, b.sent_count)}</b>clicked</span></div>`
      : `<div class="bc-actions"><a class="btn sm" href="#/email/${b.id}">Edit</a><button class="btn sm primary" data-send="${b.id}">Send</button>
        <button class="btn sm danger icon" data-delb="${b.id}" title="Delete draft" aria-label="Delete draft">${icon('trash')}</button></div>`}
  </article>`).join('')}</div>` : `<div class="card empty"><div class="big">${icon('mail')}</div><h2>No emails yet</h2><p>Write your first email to your list.</p>
    <a class="btn primary" href="#/email/new">${icon('plus')} New email</a></div>`);

const outboxHtml = (items) => (items.length ? `<div class="card table-wrap"><table>
  <tr><th>To</th><th>Subject</th><th>Status</th><th>When</th></tr>
  ${items.map((m) => `<tr class="click" data-view="${m.id}"><td>${esc(m.to_email)}</td><td>${esc(m.subject)}</td>
    <td><span class="pill ${m.status === 'failed' ? 'warn' : 'ok'}">${esc(m.status)}</span></td><td class="muted small">${fmtDate(m.created_at)}</td></tr>`).join('')}
  </table></div>` : '<div class="card empty"><div class="big">' + icon('inbox') + '</div><h2>Outbox is empty</h2><p>Every email you send is recorded here.</p></div>');

// ---------------- Email designer ----------------
// Write on the left, see it on the right exactly as readers will: the inbox
// line, then the opened email, on desktop or phone. Plain, personal emails
// land in inboxes more often, so the design stays simple on purpose.
async function viewCompose(bid) {
  const isNew = bid === 'new';
  const preset = new URLSearchParams(location.hash.split('?')[1] || '').get('segment') || '';
  const [b, tags, people, segs] = await Promise.all([isNew ? Promise.resolve({ subject: '', preheader: '', body: 'Hi {{first_name|there}},\n\n', tag: '', segment: preset, status: 'draft' }) : api('GET', `/api/broadcasts/${bid}`),
    api('GET', '/api/tags'), api('GET', '/api/contacts').catch(() => []), api('GET', '/api/segments').catch(() => [])]);
  const groups = [...new Set(segs.map((s) => s.group))];
  const toVal = b.segment ? `seg:${b.segment}` : b.tag ? `tag:${b.tag}` : '';
  const locked = b.status !== 'draft';
  const acct = state.me.account;
  const sample = people.find((p) => p.first_name) || { first_name: 'Alex', last_name: 'Reader', email: 'alex@example.com' };
  shell('email', `
    <div class="compose">
      <div class="cmp-bar"><a class="btn sm" href="#/email">${icon('chevronDown').replace('class="i ', 'class="i rot90 ')} Emails</a>
        <span class="muted small" data-state>${locked ? `Sent ${fmtDate(b.sent_at)} to ${b.sent_count}` : isNew ? 'New email' : 'Draft'}</span>
        ${locked ? '' : `<span class="cmp-actions"><button class="btn sm" data-test>${icon('mail')} Send me a test</button><button class="btn sm" data-save>Save draft</button><button class="btn sm primary" data-sendnow>Send…</button></span>`}</div>
      <form class="cmp-form" data-form>
        <label class="f">To<select name="to" ${locked ? 'disabled' : ''}><option value="">Everyone subscribed</option>
          ${groups.map((g) => `<optgroup label="${esc(g)}">${segs.filter((s) => s.group === g).map((s) => `<option value="seg:${esc(s.key)}" ${toVal === `seg:${s.key}` ? 'selected' : ''}>${esc(s.label)} (${s.count})</option>`).join('')}</optgroup>`).join('')}
          ${tags.length ? `<optgroup label="Tags">${tags.map((t) => `<option value="tag:${esc(t.tag)}" ${toVal === `tag:${t.tag}` ? 'selected' : ''}>Tagged “${esc(t.tag)}” (${t.count})</option>`).join('')}</optgroup>` : ''}</select>
          <span class="hint" data-count>Counting…</span></label>
        <div class="f"><span class="lbl-row">Subject <span class="hint" data-sublen></span>${locked ? '' : fieldSelect('subject')}</span><input name="subject" maxlength="300" value="${esc(b.subject)}" placeholder="A short, specific promise" ${locked ? 'disabled' : ''}></div>
        <div class="f"><span class="lbl-row">Preview text <span class="hint">the grey line after the subject in the inbox</span>${locked ? '' : fieldSelect('preheader')}</span><input name="preheader" maxlength="200" value="${esc(b.preheader || '')}" placeholder="Adds context so more people open" ${locked ? 'disabled' : ''}></div>
        <div class="f">Message
          ${locked ? '' : `<div class="cmp-tools" role="toolbar" aria-label="Insert">
            ${fieldSelect('body')}
            <button type="button" data-link>${icon('link')} Link</button>
            <button type="button" data-ins="\n\n—\n${esc(acct.from_name || acct.name)}">Sign-off</button></div>`}
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
    .replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`)}</p>`).join('');
  const sender = acct.from_name || acct.name;
  let dirty = false;
  const render = () => {
    const v = val();
    $('[data-pfrom]').textContent = sender; $('[data-pfrom2]').textContent = sender;
    $('[data-psubj]').textContent = merge(v.subject) || '(no subject)'; $('[data-psubj2]').textContent = merge(v.subject) || '(no subject)';
    $('[data-ppre]').textContent = `– ${merge(v.preheader) || merge(v.body).replace(/\s+/g, ' ').slice(0, 90)}`;
    $('[data-pbody]').innerHTML = bodyHtml(v.body) || '<p class="muted">Your message appears here.</p>';
    const n = v.subject.length;
    $('[data-sublen]').textContent = n ? `${n} characters${n > 60 ? ' · may be cut off on phones' : ''}` : '';
  };
  const count = async () => {
    const { tag, segment } = toParts();
    const seg = segs.find((s) => s.key === segment);
    try { const r = await api('GET', `/api/broadcasts/audience?${new URLSearchParams({ tag, segment })}`); $('[data-count]').textContent = `${r.count} ${r.count === 1 ? 'person' : 'people'} will get this${seg ? ` · ${seg.description}` : ''}`; }
    catch { $('[data-count]').textContent = ''; }
  };
  render(); count();
  form.addEventListener('input', () => { dirty = true; render(); });
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
    try { const r = await api('POST', '/api/broadcasts/test', val()); toast(`Test sent to ${r.to}${r.status === 'logged' ? ' (test mode: see Outbox)' : ''}`); }
    catch (err) { toast(err.message, true); }
  };
  $('[data-sendnow]').onclick = async () => {
    try { await save(); } catch (err) { toast(err.message, true); return; }
    const who = $('[data-count]').textContent;
    if (!await modal('Send this email?', `<p>“${esc(form.subject.value)}”</p><p><b>${esc(who)}</b>. This can’t be undone.</p>
      <p class="muted small">Tip: send yourself a test first to check it on your phone.</p>`, { submit: 'Send now' })) return;
    try { const r = await api('POST', `/api/broadcasts/${savedId}/send`); toast(`Sent to ${r.sent} of ${r.total}`); location.hash = '#/email'; }
    catch (err) { toast(err.message, true); }
  };
  // Leaving with unsaved changes asks first.
  window.onbeforeunload = () => (dirty ? true : undefined);
  const leave = () => { if (!location.hash.startsWith('#/email/')) { window.onbeforeunload = null; window.removeEventListener('hashchange', leave); } };
  window.addEventListener('hashchange', leave);
}
