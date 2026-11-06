'use strict';

// ---------------- People with access (one business) ----------------
async function loadTeam() {
  const card = $('[data-team]');
  if (!card) return;
  let t;
  try { t = await api('GET', '/api/team'); } catch { card.innerHTML = '<h2>People with access</h2><p class="muted small">Couldn’t load.</p>'; return; }
  card.innerHTML = `<h2>People with access</h2>
    <p class="muted small">Invite a client or teammate to work on <b>${esc(state.me.account.name)}</b> only. They can edit pages, emails and people, but can’t invite others, delete the business or see your plan.</p>
    <div class="team-list">${t.members.map((m) => `<div class="team-row"><span class="av">${esc((m.name || m.email).slice(0, 1).toUpperCase())}</span>
      <span class="tm"><b>${esc(m.name)}${m.you ? ' <span class="muted small">(you)</span>' : ''}</b><span class="muted small">${esc(m.email)}</span></span>
      <span class="pill ${m.role === 'owner' ? 'ok' : ''}">${m.role === 'owner' ? 'Owner' : 'Member'}</span>
      ${t.canManage && !m.you && m.role !== 'owner' ? `<button type="button" class="btn sm" data-rmmember="${m.id}">Remove</button>` : ''}</div>`).join('')}
      ${t.invites.map((i) => `<div class="team-row pending"><span class="av">${icon('mail')}</span><span class="tm"><b>${esc(i.email)}</b><span class="muted small">Invited, waiting for them to join</span></span>
        <button type="button" class="btn sm" data-cancelinvite="${i.id}">Cancel</button></div>`).join('')}</div>
    ${t.canManage ? `<form class="team-invite" data-invite><input name="email" type="email" required placeholder="their@email.com" aria-label="Email to invite"><button class="btn primary">Invite</button></form><div class="err"></div><div data-invitelink></div>` : ''}`;
  const form = $('[data-invite]', card);
  if (form) form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api('POST', '/api/team/invites', { email: form.email.value });
      toast(`Invite sent to ${form.email.value}`);
      await loadTeam();
      if (r.devLink) $('[data-invitelink]', card).innerHTML = `<p class="hint">Dev mode (no email): <a href="${esc(r.devLink)}">invite link</a></p>`;
    } catch (err) { $('.err', card).textContent = err.message; }
  };
  $$('[data-cancelinvite]', card).forEach((b) => { b.onclick = async () => { await api('DELETE', `/api/team/invites/${b.dataset.cancelinvite}`); toast('Invite cancelled'); loadTeam(); }; });
  $$('[data-rmmember]', card).forEach((b) => { b.onclick = async () => {
    const m = t.members.find((x) => String(x.id) === b.dataset.rmmember);
    if (!await confirmBox(`Remove ${m.name}?`, `They’ll lose access to ${state.me.account.name} straight away. You can invite them again any time.`, 'Remove')) return;
    await api('DELETE', `/api/team/members/${m.id}`); toast(`${m.name} removed`); loadTeam();
  }; });
}

// Opening an invite link: join with a new password, or sign in first.
async function viewInvite(token) {
  let inv;
  try { inv = await api('GET', `/api/invites/${encodeURIComponent(token)}`); } catch (err) {
    app.innerHTML = `<div class="auth"><div class="card"><div class="logo">${LOGO_INK}</div><h1>Invite not found</h1><p class="muted">${esc(err.message)}</p><a class="btn primary" href="#/">Go to Rilly</a></div></div>`;
    return;
  }
  let me = null;
  // A quiet check: not being signed in is fine here (api() would jump to the sign-in screen).
  try { const r = await fetch('/api/me', { credentials: 'same-origin' }); if (r.ok) me = await r.json(); } catch { /* offline */ }
  const mine = me && me.user.email.toLowerCase() === inv.email;
  app.innerHTML = `<div class="auth"><form class="card">
    <div class="logo">${LOGO_INK}</div>
    <h1>Join ${esc(inv.business)}</h1>
    ${mine ? `<p class="muted">You’re signed in as ${esc(inv.email)}.</p>`
      : me ? `<p class="muted">This invite is for <b>${esc(inv.email)}</b>, but you’re signed in as ${esc(me.user.email)}. Sign out, then open the link again.</p>`
        : inv.hasAccount ? `<p class="muted">You already have a Rilly account as <b>${esc(inv.email)}</b>. Sign in, then open this link again.</p>`
          : `<p class="muted">You’ve been invited to work on ${esc(inv.business)} in Rilly. Choose a password to join.</p>
            <label class="f">Email<input value="${esc(inv.email)}" disabled></label>
            <label class="f">Your name<input name="name" required autocomplete="name"></label>
            <label class="f">Password <span class="hint">at least 8 characters</span><input name="password" type="password" required minlength="8" autocomplete="new-password"></label>`}
    <div class="err"></div>
    ${mine || (!me && !inv.hasAccount) ? `<button class="btn primary" style="width:100%;justify-content:center;padding:11px">Join ${esc(inv.business)}</button>`
      : me ? '<button type="button" class="btn primary" data-signout style="width:100%;justify-content:center">Sign out</button>'
        : '<button type="button" class="btn primary" data-signin style="width:100%;justify-content:center">Sign in</button>'}
  </form></div>`;
  const so = $('[data-signout]'); if (so) so.onclick = async () => { await api('POST', '/api/auth/logout'); state.me = null; viewInvite(token); };
  const si = $('[data-signin]'); if (si) si.onclick = () => { try { sessionStorage.setItem('rillyInvite', token); } catch { /* fine */ } renderAuth('password'); };
  $('form').onsubmit = async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(e.target));
    try {
      const r = await api('POST', `/api/invites/${encodeURIComponent(token)}/accept`, v);
      state.me = await api('GET', '/api/me');
      toast(`Welcome to ${r.business}`);
      location.hash = '#/'; route();
    } catch (err) { $('.err').textContent = err.message; }
  };
}
