'use strict';

// A round face for each person: their uploaded photo, else their public
// profile photo (Gravatar, if switched on in Settings), else their initials on
// a calm colour picked from their name.
const AV_COLORS = ['#1F7F78', '#2BA39A', '#3D6B73', '#5B7F6B', '#6B6F8F', '#8A6F5A'];
function avatarHtml(c, size = 44) {
  const name = (typeof fullName === 'function' ? fullName(c) : '') || c.email || '?';
  const initials = name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
  let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const bg = AV_COLORS[h % AV_COLORS.length];
  const img = c.photo_url || (state.me?.account?.gravatar !== 0 && c.avatar_hash ? `https://gravatar.com/avatar/${c.avatar_hash}?d=404&s=${size * 2}` : '');
  return `<span class="av-c" style="width:${size}px;height:${size}px;background:${bg};font-size:${Math.round(size * 0.38)}px" aria-hidden="true">${esc(initials)}${img ? `<img src="${esc(img)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>`;
}
