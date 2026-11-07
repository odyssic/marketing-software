// Community: a members' community each business runs for its customers.
//
// - Members sign in through the customer area (/my/<business>, see courses.js):
//   same magic link, same cookie. The community lives at /my/<business>/community.
// - Who can join: anyone with an email, people who bought chosen products, or
//   members of chosen members areas. The owner can remove (block) people.
// - Spaces (channels) the owner creates; "only the host posts" makes a space
//   announcements-only. Posts have a title, text with the same simple marks as
//   emails, one picture and a link. Likes, comments, one level of replies, pins.
// - Events are posts with a date: members RSVP, get a reminder an hour before.
// - Emails: replies (batched, at most one an hour), a weekly digest for people
//   who haven't visited, event reminders. Each has a signed one-click stop link.
// - The owner manages it in the app (Flows > Community) and acts as the host
//   when they open the community while signed in to the app.
'use strict';
const express = require('express');
const { esc } = require('./render');
const { emailBodyHtml } = require('../public/js/emailformat.js');
const { sniff } = require('./uploads');
const crypto = require('node:crypto');

const HOUR = 3600e3;
const DAY = 864e5;
const RULES = ['open', 'buyers', 'members'];
const DEFAULT_SPACES = [['Announcements', 1], ['Introductions', 0], ['Wins', 0], ['Questions', 0]];
const RATE_LIMIT = 20; // posts + comments per member per 10 minutes
const PAGE = 20;
const COLORS = ['#e76f51', '#2a9d8f', '#d97706', '#264653', '#8e7dbe', '#3a86ff', '#ef476f', '#118ab2'];
const IMG_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const parseList = (s) => { try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v.map(Number).filter(Number.isInteger) : []; } catch { return []; } };
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const httpUrl = (v) => { const u = str(v, 1000); return /^https?:\/\/[^\s<>"]+$/i.test(u) ? u : ''; };
const brandOf = (c, acct) => [c?.brand_color, acct?.brand_color].find((x) => /^#[0-9a-f]{6}$/i.test(x || '')) || '#1B736D';
const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
const colorFor = (n) => COLORS[[...String(n || '')].reduce((a, ch) => a + ch.charCodeAt(0), 0) % COLORS.length];

function ago(d, now = new Date()) {
  const s = (now - new Date(d)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  const dt = new Date(d);
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC', ...(dt.getUTCFullYear() !== now.getUTCFullYear() ? { year: 'numeric' } : {}) });
}
// Event times: written in UTC on the server, shown in the reader's own time zone by the page script.
const whenText = (d) => new Date(d).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' });
const timeTag = (d, kind = 'full') => `<time datetime="${new Date(d).toISOString()}" data-t="${kind}">${esc(kind === 'mon' ? new Date(d).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
  : kind === 'day' ? String(new Date(d).getUTCDate()) : whenText(d))}</time>`;

// Member text: the same simple marks as emails, links open in a new tab and aren't vouched for.
const formatText = (text, color) => emailBodyHtml(text, { color }).replace(/<a href=/g, '<a rel="nofollow ugc noopener" target="_blank" href=');

const ICON = {
  heart: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.3-9.4C1.5 7.9 3.7 4.5 7.2 4.5c2 0 3.6 1.1 4.8 2.8 1.2-1.7 2.8-2.8 4.8-2.8 3.5 0 5.7 3.4 4.5 6.6-1.8 4.8-9.3 9.4-9.3 9.4z" fill="currentColor"/></svg>',
  chat: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4H6.5A2.5 2.5 0 0 1 4 13.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  pin: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M15 3l6 6-3 1-4 4 .5 4.5L13 20l-4-4-5 5-1-1 5-5-4-4 1.5-1.5L10 10l4-4z" fill="currentColor"/></svg>',
  hash: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M9 3L7 21M17 3l-2 18M4 8.5h17M3 15.5h17" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>',
  home: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  people: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="9" cy="8" r="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 4.8a3.4 3.4 0 0 1 0 6.4M18 14.7c2 .7 3.2 2.5 3.5 5.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  cal: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  book: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  photo: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="3" y="4.5" width="18" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="8.5" cy="9.5" r="1.8" fill="currentColor"/><path d="M4 18l5-5 4 4 3-3 4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  link: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  more: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/></svg>',
  video: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="2.5" y="6" width="13" height="12" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M15.5 10.5l6-3.5v10l-6-3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
};

class PageError extends Error { constructor(status, message) { super(message); this.status = status; } }

function registerCommunity(app, api, { getDb, HttpError, id, upsertContact, logEvent, messaging, members, courses, ownerViewing }) {
  const db = () => getDb();
  const base = () => members.base();
  const home = (acct) => `/my/${acct.handle}/community`;
  const getCommunity = (accountId) => db().get('SELECT * FROM communities WHERE account_id = ?', accountId);

  // ---------- Who is looking ----------
  async function eligible(comm, contactId) {
    if (comm.join_rule === 'open') return true;
    const ids = comm.join_rule === 'buyers' ? parseList(comm.join_products) : parseList(comm.join_areas);
    if (!ids.length) return false;
    const marks = ids.map(() => '?').join(',');
    return comm.join_rule === 'buyers'
      ? Boolean(await db().get(`SELECT 1 FROM orders WHERE account_id = ? AND contact_id = ? AND status = 'paid' AND product_id IN (${marks})`, comm.account_id, contactId, ...ids))
      : Boolean(await db().get(`SELECT 1 FROM member_access WHERE account_id = ? AND contact_id = ? AND revoked_at IS NULL AND funnel_id IN (${marks})`, comm.account_id, contactId, ...ids));
  }
  // Adds someone (once). Logs "community_join" so follow-ups can start on it.
  async function join(comm, contact) {
    const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || String(contact.email || '').split('@')[0] || 'Member';
    const m = await db().get(`INSERT INTO community_members (account_id, contact_id, name) VALUES (?, ?, ?)
      ON CONFLICT (account_id, contact_id) DO NOTHING RETURNING *`, comm.account_id, contact.id, name.slice(0, 60));
    if (m) await logEvent(db(), comm.account_id, { person_id: contact.id, type: 'community_join', source: '', meta: { note: `Joined ${comm.name}` } });
    return m || db().get('SELECT * FROM community_members WHERE account_id = ? AND contact_id = ?', comm.account_id, contact.id);
  }
  async function viewer(req, acct, comm) {
    if (await ownerViewing(req, { account_id: acct.id })) return { host: true, mid: 0, name: acct.name };
    const contact = await courses.signedInContact(req, acct);
    if (!contact) return { anon: true };
    let m = await db().get('SELECT * FROM community_members WHERE account_id = ? AND contact_id = ?', acct.id, contact.id);
    if (m?.status === 'blocked') return { contact, blocked: true };
    if (!m) {
      if (!(await eligible(comm, contact.id))) return { contact, notAllowed: true };
      m = await join(comm, contact);
    } else if (Date.now() - new Date(m.last_seen_at).getTime() > 5 * 60e3) {
      await db().run('UPDATE community_members SET last_seen_at = now() WHERE id = ?', m.id);
    }
    return { contact, member: m, mid: m.id, name: m.name };
  }

  // ---------- Signed links ----------
  const stopToken = (memberId, kind) => `${memberId}.${kind}.${members.sign(`cstop:${memberId}:${kind}`)}`;
  const stopLink = (acct, memberId, kind) => `${base()}/my/${acct.handle}/community/stop/${stopToken(memberId, kind)}`;

  // ---------- Page shell ----------
  async function sidebar(acct, comm, v, on) {
    const spaces = await db().all('SELECT id, name, owner_only FROM community_spaces WHERE account_id = ? AND deleted_at IS NULL ORDER BY position, id', acct.id);
    const upcoming = await db().all(`SELECT id, title, event_at FROM community_posts WHERE account_id = ? AND event_at > now() AND deleted_at IS NULL
      AND space_id IN (SELECT id FROM community_spaces WHERE account_id = ? AND deleted_at IS NULL) ORDER BY event_at LIMIT 3`, acct.id, acct.id);
    const h = home(acct);
    const item = (key, href, ic, label) => `<a href="${esc(href)}" class="cm-nav-i${on === key ? ' on' : ''}"${on === key ? ' aria-current="page"' : ''}>${ic}<span>${esc(label)}</span></a>`;
    const nav = `<nav class="cm-nav" aria-label="Community">${item('all', h, ICON.home, 'All posts')}
      <div class="cm-nav-h">Spaces</div>${spaces.map((s) => item(`s${s.id}`, `${h}/s/${s.id}`, ICON.hash, s.name)).join('')}
      <div class="cm-nav-h cm-nav-sep"></div>${item('events', `${h}/events`, ICON.cal, 'Events')}${item('people', `${h}/people`, ICON.people, 'Members')}
      <a href="/my/${acct.handle}" class="cm-nav-i">${ICON.book}<span>Your courses</span></a></nav>`;
    const up = upcoming.length ? `<section class="cm-up"><div class="cm-up-h">Upcoming</div>${upcoming.map((e) => `<a class="cm-up-i" href="${h}/p/${e.id}">
      <span class="cm-date"><b>${timeTag(e.event_at, 'mon')}</b><i>${timeTag(e.event_at, 'day')}</i></span><span><b>${esc(e.title || 'Event')}</b><small>${timeTag(e.event_at, 'short')}</small></span></a>`).join('')}</section>` : '';
    return { nav, up, spaces };
  }

  function shell(res, acct, comm, v, { title, nav = '', up = '', main, status = 200, wide = false }) {
    const brand = brandOf(comm, acct);
    const me = v?.host ? `<span class="cm-who"><span class="cm-hostpill">You’re the host</span></span>`
      : v?.member ? `<details class="cm-who cm-menu"><summary aria-label="Your menu">${avatar(v.member.name, v.member.photo_url, 'sm')}</summary><div class="cm-pop">
        <a href="${home(acct)}/people/${v.member.id}">Your profile</a><a href="${home(acct)}/me">Edit profile &amp; emails</a><a href="/my/${acct.handle}">Your courses &amp; orders</a><a href="/my/${acct.handle}/logout">Sign out</a></div></details>`
        : v?.contact ? `<a class="cm-who" href="/my/${acct.handle}/logout">Sign out</a>` : '';
    res.set('X-Robots-Tag', 'noindex').status(status).type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title ? `${title} · ` : '')}${esc(comm.name || acct.name)}</title><style>${CSS.replace(/BRAND/g, brand)}</style></head>
<body${nav ? ' class="has-nav"' : ''}><header class="cm-top"><div class="cm-top-in"><a class="cm-brand" href="${home(acct)}"><span class="cm-logo">${esc(initials(comm.name || acct.name))}</span><b>${esc(comm.name || acct.name)}</b></a>${me}</div></header>
${nav ? `<div class="cm-shell"><aside class="cm-side">${nav}${up}</aside><main class="cm-main${wide ? ' wide' : ''}">${main}</main></div>` : `<main class="cm-solo">${main}</main>`}
<script>${SCRIPT.replace('UPLOAD', `/my/${acct.handle}/community/upload`)}</script></body></html>`);
  }

  function avatar(name, photo, size = '') {
    return photo ? `<img class="cm-av ${size}" src="${esc(photo)}" alt="">`
      : `<span class="cm-av ${size}" style="background:${colorFor(name)}" aria-hidden="true">${esc(initials(name))}</span>`;
  }
  const hostAvatar = (acct, size = '') => `<span class="cm-av host ${size}" aria-hidden="true">${esc(initials(acct.name))}</span>`;
  const author = (acct, row, prefix = 'author') => (row.member_id
    ? { name: row[`${prefix}_name`] || 'Member', av: (s) => avatar(row[`${prefix}_name`], row[`${prefix}_photo`], s), href: `${home(acct)}/people/${row.member_id}`, host: false }
    : { name: acct.name, av: (s) => hostAvatar(acct, s), href: `${home(acct)}/people/host`, host: true });

  // ---------- Posts ----------
  const POST_SELECT = `SELECT p.*, s.name AS space_name, s.owner_only, m.name AS author_name, m.photo_url AS author_photo,
      (SELECT COUNT(*)::int FROM community_likes l WHERE l.post_id = p.id) AS likes,
      (SELECT COUNT(*)::int FROM community_comments c LEFT JOIN community_members cm ON cm.id = c.member_id WHERE c.post_id = p.id AND c.deleted_at IS NULL AND (c.member_id IS NULL OR cm.status = 'active')) AS comments,
      (SELECT COUNT(*)::int FROM community_rsvps r WHERE r.post_id = p.id) AS going,
      EXISTS (SELECT 1 FROM community_likes l WHERE l.post_id = p.id AND l.member_id = ?) AS liked,
      EXISTS (SELECT 1 FROM community_rsvps r WHERE r.post_id = p.id AND r.member_id = ?) AS rsvpd
    FROM community_posts p JOIN community_spaces s ON s.id = p.space_id LEFT JOIN community_members m ON m.id = p.member_id
    WHERE p.account_id = ? AND p.deleted_at IS NULL AND s.deleted_at IS NULL AND (p.member_id IS NULL OR m.status = 'active')`;
  const feed = (acct, v, where = '', args = [], { offset = 0, order = 'p.pinned DESC, p.created_at DESC', limit = PAGE + 1 } = {}) => db().all(`${POST_SELECT} ${where} ORDER BY ${order} LIMIT ${limit} OFFSET ${Number(offset) || 0}`, v.mid ?? -1, v.mid ?? -1, acct.id, ...args);
  const onePost = async (acct, v, postId) => (await feed(acct, v, 'AND p.id = ?', [id(postId)]))[0] || null;

  function eventBox(acct, p, v, back) {
    if (!p.event_at) return '';
    const past = new Date(p.event_at) < new Date();
    return `<div class="cm-event"><span class="cm-date big"><b>${timeTag(p.event_at, 'mon')}</b><i>${timeTag(p.event_at, 'day')}</i></span>
      <div class="cm-ev-main"><div class="cm-ev-when">${ICON.cal} ${timeTag(p.event_at)}</div>
        ${p.event_url ? `<div class="cm-ev-when">${ICON.video} <a href="${esc(p.event_url)}" target="_blank" rel="noopener nofollow">${esc(p.event_url.replace(/^https?:\/\//, '').slice(0, 48))}</a></div>` : ''}
        <div class="cm-ev-go">${p.going} going${past ? ' · This event has passed' : ''}</div></div>
      ${!past && v.member ? `<form method="post" action="${home(acct)}/p/${p.id}/rsvp"><input type="hidden" name="back" value="${esc(back)}"><button class="cm-btn ${p.rsvpd ? 'ghost' : ''}">${p.rsvpd ? '&#10003; You’re going' : 'RSVP'}</button></form>` : ''}</div>`;
  }

  function postMenu(acct, p, v, back) {
    const mine = v.host ? !p.member_id : v.mid && p.member_id === v.mid;
    const items = [
      mine ? `<a href="${home(acct)}/p/${p.id}/edit">Edit</a>` : '',
      v.host ? `<form method="post" action="${home(acct)}/p/${p.id}/pin"><input type="hidden" name="back" value="${esc(back)}"><button>${p.pinned ? 'Unpin' : 'Pin to top'}</button></form>` : '',
      mine || v.host ? `<form method="post" action="${home(acct)}/p/${p.id}/delete"><input type="hidden" name="back" value="${esc(back)}"><button class="danger">Delete</button></form>` : '',
    ].filter(Boolean);
    return items.length ? `<details class="cm-menu cm-more"><summary aria-label="Post options">${ICON.more}</summary><div class="cm-pop">${items.join('')}</div></details>` : '';
  }

  function postCard(acct, comm, p, v, { back, full = false } = {}) {
    const a = author(acct, p);
    const url = `${home(acct)}/p/${p.id}`;
    const color = brandOf(comm, acct);
    const long = !full && p.body.length > 600;
    const body = long ? `${p.body.slice(0, 560).replace(/\s+\S*$/, '')}…` : p.body;
    let host = ''; try { host = p.link_url ? new URL(p.link_url).hostname.replace(/^www\./, '') : ''; } catch { host = ''; }
    return `<article class="cm-post${p.pinned ? ' pinned' : ''}" id="p${p.id}">
      <header class="cm-ph"><a href="${esc(a.href)}">${a.av('')}</a><div class="cm-ph-t"><a class="cm-name" href="${esc(a.href)}">${esc(a.name)}</a>${a.host ? '<span class="cm-badge">Host</span>' : ''}
        <div class="cm-meta"><a href="${home(acct)}/s/${p.space_id}">${esc(p.space_name)}</a> · <a href="${url}">${esc(ago(p.created_at))}</a>${p.edited_at ? ' · edited' : ''}</div></div>
        ${p.pinned ? `<span class="cm-pinned">${ICON.pin} Pinned</span>` : ''}${postMenu(acct, p, v, back)}</header>
      ${p.title ? `<h2 class="cm-title">${full ? esc(p.title) : `<a href="${url}">${esc(p.title)}</a>`}</h2>` : ''}
      ${eventBox(acct, p, v, back)}
      ${body ? `<div class="cm-body">${formatText(body, color)}${long ? `<a class="cm-more-l" href="${url}">Read more</a>` : ''}</div>` : ''}
      ${p.image_url ? `${full ? '' : `<a href="${url}" tabindex="-1">`}<img class="cm-img" src="${esc(p.image_url)}" alt="" loading="lazy">${full ? '' : '</a>'}` : ''}
      ${p.link_url ? `<a class="cm-linkcard" href="${esc(p.link_url)}" target="_blank" rel="nofollow ugc noopener">${ICON.link}<span><b>${esc(host)}</b><small>${esc(p.link_url.slice(0, 90))}</small></span></a>` : ''}
      <footer class="cm-pf"><form method="post" action="${url}/like" class="cm-like-f"><input type="hidden" name="back" value="${esc(back)}">
        <button class="cm-act${p.liked ? ' liked' : ''}" aria-pressed="${p.liked ? 'true' : 'false'}" aria-label="Like"${v.mid === undefined ? ' disabled' : ''}>${ICON.heart}<span>${p.likes || ''}</span></button></form>
        <a class="cm-act" href="${url}#comments">${ICON.chat}<span>${p.comments ? `${p.comments} comment${p.comments === 1 ? '' : 's'}` : 'Comment'}</span></a></footer></article>`;
  }

  function composer(acct, comm, v, spaces, { spaceId = null, back }) {
    const canPost = spaces.filter((s) => v.host || !s.owner_only);
    if (!canPost.length || (spaceId && !canPost.some((s) => s.id === spaceId))) return '';
    const me = v.host ? hostAvatar(acct) : avatar(v.member.name, v.member.photo_url);
    const pick = spaceId ? `<input type="hidden" name="space_id" value="${spaceId}">`
      : `<select name="space_id" aria-label="Space" class="cm-sel">${canPost.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>`;
    return `<form class="cm-compose" method="post" action="${home(acct)}/posts" data-compose>
      <input type="hidden" name="back" value="${esc(back)}">${me}
      <div class="cm-compose-in"><input name="title" maxlength="200" placeholder="Title (optional)" class="cm-ctitle" aria-label="Title">
        <textarea name="body" rows="2" maxlength="10000" placeholder="Share something with the community…" aria-label="Your post" required></textarea>
        <input type="hidden" name="image_url" data-upurl><div class="cm-prev" data-upprev hidden></div>
        <input name="link_url" type="url" placeholder="https://… (a link to share)" class="cm-clink" aria-label="Link" data-linkin hidden>
        <div class="cm-cbar"><label class="cm-tool" title="Add a picture">${ICON.photo}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" data-up hidden><span>Photo</span></label>
          <button type="button" class="cm-tool" data-linkbtn title="Add a link">${ICON.link}<span>Link</span></button>${pick}<button class="cm-btn">Post</button></div></div></form>`;
  }

  // ---------- Error pages ----------
  const wrap = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (e) {
      if (!(e instanceof PageError) && !(e instanceof HttpError)) { console.error('community:', e); e.status = 500; e.message = 'Something went wrong. Please try again.'; }
      if (req.headers.accept?.includes('application/json')) return res.status(e.status || 500).json({ error: e.message });
      res.status(e.status || 500).type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Community</title>
        <div style="font:17px/1.5 system-ui,sans-serif;max-width:440px;margin:18vh auto;padding:0 20px;text-align:center;color:#1f2933"><p>${esc(e.message)}</p>
        <p><a href="javascript:history.back()" style="color:#1B736D">&larr; Go back</a></p></div>`);
    }
  };
  // Loads the business, its community and the viewer; returns null after answering if they can't see it.
  async function load(req, res, { needMember = true } = {}) {
    const acct = await courses.account(req.params.acct);
    const comm = acct && await getCommunity(acct.id);
    if (!comm) throw new PageError(404, 'There’s no community here.');
    const v = await viewer(req, acct, comm);
    if (needMember && !v.host && !v.member) { await gatePage(res, acct, comm, v); return null; }
    return { acct, comm, v };
  }
  async function gatePage(res, acct, comm, v, { sent = false } = {}) {
    const count = (await db().get("SELECT COUNT(*)::int AS n FROM community_members WHERE account_id = ? AND status = 'active'", acct.id)).n;
    let note = '';
    if (comm.join_rule === 'buyers') {
      const names = (await namesOf('products', parseList(comm.join_products), acct.id)).join(', ');
      note = `For people who bought ${esc(names || 'from us')}.`;
    } else if (comm.join_rule === 'members') {
      const names = (await namesOf('funnels', parseList(comm.join_areas), acct.id)).join(', ');
      note = `For members of ${esc(names || 'our members area')}.`;
    }
    const form = `<form method="post" action="${home(acct)}/join" class="cm-join">
      ${comm.join_rule === 'open' ? '<input name="name" autocomplete="name" placeholder="Your name" aria-label="Your name" maxlength="60">' : ''}
      <input type="email" name="email" required autocomplete="email" placeholder="you@example.com" aria-label="Your email">
      <button class="cm-btn wide">${comm.join_rule === 'open' ? 'Join the community' : 'Email me a sign-in link'}</button></form>
      <p class="cm-fine">No password. We email you a link that signs you in on this device.</p>`;
    const body = sent ? '<p class="cm-ok">Check your inbox: a link to come in is on its way (look in spam too, just in case).</p>'
      : v.blocked ? '<p class="cm-warn">You don’t have access to this community any more. If you think that’s a mistake, reply to any email from us.</p>'
        : v.notAllowed ? `<p class="cm-warn">You’re signed in as ${esc(v.contact.email)}, but this community is only open to some customers. ${note}</p>
          <p class="cm-fine"><a href="/my/${acct.handle}/logout">Sign in with a different email</a></p>` : `${note ? `<p class="cm-sub">${note}</p>` : ''}${form}`;
    shell(res, acct, comm, v, { title: 'Join', status: v.blocked || v.notAllowed ? 403 : sent ? 200 : 401, main: `<div class="cm-gate">
      ${comm.cover_url ? `<img class="cm-gate-cover" src="${esc(comm.cover_url)}" alt="">` : '<div class="cm-gate-cover blank"></div>'}
      <div class="cm-gate-in"><span class="cm-logo big">${esc(initials(comm.name))}</span><h1>${esc(comm.name)}</h1>
      <p class="cm-sub">${count} member${count === 1 ? '' : 's'} · Hosted by ${esc(acct.name)}</p>${body}</div></div>` });
  }
  const namesOf = async (table, ids, accountId) => (ids.length ? (await db().all(`SELECT name FROM ${table === 'products' ? 'products' : 'funnels'} WHERE account_id = ? AND id IN (${ids.map(() => '?').join(',')}) ORDER BY name`, accountId, ...ids)).map((r) => r.name) : []);

  const safeBack = (acct, b, fallback) => (typeof b === 'string' && b.startsWith(`${home(acct)}`) && !b.includes('//', 1) && b.length < 300 ? b : fallback);
  const form = express.urlencoded({ extended: false, limit: '64kb' });

  // ---------- Pages ----------
  async function feedPage(req, res, { spaceId = null } = {}) {
    const ctx = await load(req, res);
    if (!ctx) return;
    const { acct, comm, v } = ctx;
    const { nav, up, spaces } = await sidebar(acct, comm, v, spaceId ? `s${spaceId}` : 'all');
    const space = spaceId && spaces.find((s) => s.id === spaceId);
    if (spaceId && !space) throw new PageError(404, 'That space isn’t here any more.');
    const page = Math.max(1, Math.min(500, Number(req.query.page) || 1));
    const rows = await feed(acct, v, spaceId ? 'AND p.space_id = ?' : '', spaceId ? [spaceId] : [], { offset: (page - 1) * PAGE });
    const more = rows.length > PAGE;
    const back = `${req.path}${page > 1 ? `?page=${page}` : ''}`;
    const deleted = await undoBanner(acct, v, req.query);
    const welcome = !spaceId && page === 1 && comm.welcome ? `<article class="cm-post cm-welcome">${comm.cover_url ? `<img class="cm-cover" src="${esc(comm.cover_url)}" alt="">` : ''}
      <div class="cm-welcome-in"><div class="cm-ph">${hostAvatar(acct)}<div class="cm-ph-t"><span class="cm-name">${esc(acct.name)}</span><span class="cm-badge">Host</span><div class="cm-meta">Welcome</div></div></div>
      <div class="cm-body">${formatText(comm.welcome, brandOf(comm, acct))}</div></div></article>` : '';
    const head = space ? `<div class="cm-head"><h1>${ICON.hash} ${esc(space.name)}</h1><p class="cm-sub">${space.owner_only ? `Announcements from ${esc(acct.name)}. ${v.host ? 'Only you can post here.' : 'Only the host posts here, but you can comment.'}` : 'Anyone in the community can post here.'}</p></div>`
      : `<div class="cm-head"><h1>All posts</h1></div>`;
    shell(res, acct, comm, v, { title: space ? space.name : '', nav, up, main: `${deleted}${head}${up ? `<div class="cm-up-m">${up}</div>` : ''}${composer(acct, comm, v, spaces, { spaceId, back })}${welcome}
      ${rows.slice(0, PAGE).map((p) => postCard(acct, comm, p, v, { back })).join('') || `<div class="cm-empty"><b>No posts yet</b><p>${space && space.owner_only && !v.host ? 'Announcements will show up here.' : 'Be the first: say hello and tell everyone what brought you here.'}</p></div>`}
      ${more || page > 1 ? `<nav class="cm-pager">${page > 1 ? `<a href="?page=${page - 1}">&larr; Newer</a>` : '<span></span>'}${more ? `<a href="?page=${page + 1}">Older posts &rarr;</a>` : ''}</nav>` : ''}` });
  }
  async function undoBanner(acct, v, q) {
    if (/^\d{1,9}$/.test(String(q.deleted || ''))) {
      return `<div class="cm-banner">Post deleted. <form method="post" action="${home(acct)}/p/${Number(q.deleted)}/restore"><button>Undo</button></form></div>`;
    }
    if (/^\d{1,9}$/.test(String(q.deleted_c || ''))) {
      return `<div class="cm-banner">Comment deleted. <form method="post" action="${home(acct)}/c/${Number(q.deleted_c)}/restore"><button>Undo</button></form></div>`;
    }
    if (q.slow) return '<div class="cm-banner warn">You’re posting a lot. Take a breather and try again in a few minutes.</div>';
    return '';
  }

  app.get('/my/:acct/community', wrap((req, res) => feedPage(req, res)));
  app.get('/my/:acct/community/s/:space', wrap((req, res) => feedPage(req, res, { spaceId: id(req.params.space) })));

  app.get('/my/:acct/community/p/:post', wrap(async (req, res) => {
    const ctx = await load(req, res);
    if (!ctx) return;
    const { acct, comm, v } = ctx;
    const p = await onePost(acct, v, req.params.post);
    if (!p) throw new PageError(404, 'That post isn’t here any more.');
    const { nav, up } = await sidebar(acct, comm, v, `s${p.space_id}`);
    const back = `${home(acct)}/p/${p.id}`;
    const comments = await db().all(`SELECT c.*, m.name AS author_name, m.photo_url AS author_photo FROM community_comments c LEFT JOIN community_members m ON m.id = c.member_id
      WHERE c.post_id = ? AND c.account_id = ? AND c.deleted_at IS NULL AND (c.member_id IS NULL OR m.status = 'active') ORDER BY c.id`, p.id, acct.id);
    const top = comments.filter((c) => !c.parent_id);
    const kids = (cid) => comments.filter((c) => c.parent_id === cid);
    const color = brandOf(comm, acct);
    const me = v.host ? hostAvatar(acct, 'sm') : avatar(v.member.name, v.member.photo_url, 'sm');
    const cform = (parent) => `<form class="cm-cform" method="post" action="${back}/comments">${me}<input type="hidden" name="back" value="${back}">${parent ? `<input type="hidden" name="parent_id" value="${parent}">` : ''}
      <textarea name="body" rows="1" required maxlength="4000" placeholder="${parent ? 'Write a reply…' : 'Write a comment…'}" aria-label="${parent ? 'Your reply' : 'Your comment'}"></textarea><button class="cm-btn sm">${parent ? 'Reply' : 'Send'}</button></form>`;
    const one = (c, reply) => {
      const a = author(acct, c);
      const mine = v.host || (v.mid && c.member_id === v.mid);
      return `<div class="cm-c${reply ? ' reply' : ''}" id="c${c.id}"><a href="${esc(a.href)}">${a.av('sm')}</a><div class="cm-c-main">
        <div class="cm-bubble"><a class="cm-name" href="${esc(a.href)}">${esc(a.name)}</a>${a.host ? '<span class="cm-badge">Host</span>' : ''}<div class="cm-body">${formatText(c.body, color)}</div></div>
        <div class="cm-c-meta"><span>${esc(ago(c.created_at))}</span>${reply ? '' : `<button type="button" class="cm-link" data-reply="${c.id}">Reply</button>`}
        ${mine ? `<form method="post" action="${home(acct)}/c/${c.id}/delete"><input type="hidden" name="back" value="${back}"><button class="cm-link">Delete</button></form>` : ''}</div>
        ${reply ? '' : `${kids(c.id).map((k) => one(k, true)).join('')}<div class="cm-replyf" data-replyf="${c.id}" hidden>${cform(c.id)}</div>`}</div></div>`;
    };
    const deleted = await undoBanner(acct, v, req.query);
    shell(res, acct, comm, v, { title: p.title || 'Post', nav, up, main: `${deleted}<a class="cm-backl" href="${home(acct)}/s/${p.space_id}">&larr; ${esc(p.space_name)}</a>
      ${postCard(acct, comm, p, v, { back, full: true })}
      <section class="cm-comments" id="comments"><h2>${p.comments ? `${p.comments} comment${p.comments === 1 ? '' : 's'}` : 'Comments'}</h2>${cform(null)}
      ${top.map((c) => one(c, false)).join('')}</section>` });
  }));

  app.get('/my/:acct/community/p/:post/edit', wrap(async (req, res) => {
    const ctx = await load(req, res);
    if (!ctx) return;
    const { acct, comm, v } = ctx;
    const p = await ownPost(acct, v, req.params.post);
    const { nav, up } = await sidebar(acct, comm, v, `s${p.space_id}`);
    const isEvent = Boolean(p.event_at);
    shell(res, acct, comm, v, { title: 'Edit post', nav, up, main: `<a class="cm-backl" href="${home(acct)}/p/${p.id}">&larr; Back to the post</a>
      <form class="cm-card cm-form" method="post" action="${home(acct)}/p/${p.id}/edit"><h1>Edit ${isEvent ? 'event' : 'post'}</h1>
      <label>Title${isEvent ? '' : ' <small>optional</small>'}<input name="title" maxlength="200" value="${esc(p.title)}"${isEvent ? ' required' : ''}></label>
      ${isEvent ? `<label>Date and time<input type="datetime-local" name="event_at" required data-localdt="${new Date(p.event_at).toISOString()}"><input type="hidden" name="tz" data-tz></label>
        <label>Link to join <small>Zoom, Meet…</small><input name="event_url" type="url" value="${esc(p.event_url)}" placeholder="https://"></label>` : ''}
      <label>${isEvent ? 'Description' : 'Text'}<textarea name="body" rows="8" maxlength="10000"${isEvent ? '' : ' required'}>${esc(p.body)}</textarea></label>
      <label>Link <small>optional</small><input name="link_url" type="url" value="${esc(p.link_url)}" placeholder="https://"></label>
      <div class="cm-field">Picture <input type="hidden" name="image_url" value="${esc(p.image_url)}" data-upurl><div class="cm-prev" data-upprev ${p.image_url ? '' : 'hidden'}>${p.image_url ? `<img src="${esc(p.image_url)}" alt=""><button type="button" data-unpic>Remove</button>` : ''}</div>
        <label class="cm-tool">${ICON.photo}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" data-up hidden><span>${p.image_url ? 'Change picture' : 'Add a picture'}</span></label></div>
      <div class="cm-row"><button class="cm-btn">Save</button><a href="${home(acct)}/p/${p.id}">Cancel</a></div></form>` });
  }));

  app.get('/my/:acct/community/events', wrap(async (req, res) => {
    const ctx = await load(req, res);
    if (!ctx) return;
    const { acct, comm, v } = ctx;
    const { nav, up, spaces } = await sidebar(acct, comm, v, 'events');
    const back = `${home(acct)}/events`;
    const upcoming = await feed(acct, v, 'AND p.event_at IS NOT NULL AND p.event_at > now()', [], { order: 'p.event_at', limit: 50 });
    const past = await feed(acct, v, 'AND p.event_at IS NOT NULL AND p.event_at <= now()', [], { order: 'p.event_at DESC', limit: 10 });
    const newEvent = v.host ? `<details class="cm-card cm-newev"${upcoming.length ? '' : ' open'}><summary class="cm-btn">+ New event</summary>
      <form class="cm-form" method="post" action="${home(acct)}/posts"><input type="hidden" name="back" value="${back}"><input type="hidden" name="kind" value="event">
      <label>What’s it called?<input name="title" required maxlength="200" placeholder="e.g. Monthly Q&amp;A call"></label>
      <div class="cm-2"><label>Date and time<input type="datetime-local" name="event_at" required><input type="hidden" name="tz" data-tz></label>
      <label>Space<select name="space_id">${spaces.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label></div>
      <label>Link to join <small>Zoom, Meet…</small><input name="event_url" type="url" placeholder="https://zoom.us/j/…"></label>
      <label>Description<textarea name="body" rows="4" maxlength="10000" placeholder="What you’ll cover, who it’s for"></textarea></label>
      <p class="cm-fine">Everyone who RSVPs gets a reminder email an hour before.</p><button class="cm-btn">Post the event</button></form></details>` : '';
    shell(res, acct, comm, v, { title: 'Events', nav, up, main: `<div class="cm-head"><h1>Events</h1><p class="cm-sub">Live calls and meetups. RSVP and we’ll remind you an hour before.</p></div>${newEvent}
      ${upcoming.map((p) => postCard(acct, comm, p, v, { back })).join('') || `<div class="cm-empty"><b>No upcoming events</b><p>${v.host ? 'Post one above and members can RSVP.' : 'When the host plans one, it shows up here.'}</p></div>`}
      ${past.length ? `<h2 class="cm-h2">Past events</h2>${past.map((p) => postCard(acct, comm, p, v, { back })).join('')}` : ''}` });
  }));

  app.get('/my/:acct/community/people', wrap(async (req, res) => {
    const ctx = await load(req, res);
    if (!ctx) return;
    const { acct, comm, v } = ctx;
    const { nav, up } = await sidebar(acct, comm, v, 'people');
    const q = str(req.query.q, 60).toLowerCase();
    const list = await db().all(`SELECT id, name, bio, photo_url, joined_at FROM community_members WHERE account_id = ? AND status = 'active'
      ${q ? 'AND lower(name) LIKE ?' : ''} ORDER BY joined_at DESC LIMIT 300`, acct.id, ...(q ? [`%${q.replace(/[%_\\]/g, '')}%`] : []));
    const card = (href, av, name, sub, bio, host) => `<a class="cm-person" href="${esc(href)}">${av}<span class="cm-person-t"><b>${esc(name)}${host ? ' <span class="cm-badge">Host</span>' : ''}</b><small>${esc(sub)}</small>${bio ? `<span>${esc(bio.slice(0, 120))}</span>` : ''}</span></a>`;
    shell(res, acct, comm, v, { title: 'Members', nav, up, main: `<div class="cm-head"><h1>Members</h1><p class="cm-sub">Who’s here: ${list.length}${list.length === 300 ? '+' : ''} ${q ? 'found' : `member${list.length === 1 ? '' : 's'}`}</p></div>
      <form class="cm-search" role="search"><input name="q" value="${esc(q)}" placeholder="Search by name" aria-label="Search members"></form>
      <div class="cm-people">${q ? '' : card(`${home(acct)}/people/host`, hostAvatar(acct, 'lg'), acct.name, 'Host', '', true)}
      ${list.map((m) => card(`${home(acct)}/people/${m.id}`, avatar(m.name, m.photo_url, 'lg'), m.name, `Joined ${ago(m.joined_at)}`.replace('Joined just now', 'Just joined'), m.bio)).join('')}</div>` });
  }));

  app.get('/my/:acct/community/people/:member', wrap(async (req, res) => {
    const ctx = await load(req, res);
    if (!ctx) return;
    const { acct, comm, v } = ctx;
    const { nav, up } = await sidebar(acct, comm, v, 'people');
    const isHost = req.params.member === 'host';
    const m = isHost ? null : await db().get("SELECT * FROM community_members WHERE id = ? AND account_id = ? AND status = 'active'", id(req.params.member), acct.id);
    if (!isHost && !m) throw new PageError(404, 'That member isn’t here.');
    const back = req.path;
    const posts = await feed(acct, v, isHost ? 'AND p.member_id IS NULL' : 'AND p.member_id = ?', isHost ? [] : [m.id], { order: 'p.created_at DESC', limit: 30 });
    const mine = v.mid && m && v.mid === m.id;
    shell(res, acct, comm, v, { title: isHost ? acct.name : m.name, nav, up, main: `<section class="cm-card cm-profile">${isHost ? hostAvatar(acct, 'xl') : avatar(m.name, m.photo_url, 'xl')}
      <div><h1>${esc(isHost ? acct.name : m.name)}${isHost ? ' <span class="cm-badge">Host</span>' : ''}</h1>
      <p class="cm-sub">${isHost ? 'Hosts this community' : `Member since ${esc(new Date(m.joined_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }))}`} · ${posts.length} post${posts.length === 1 ? '' : 's'}</p>
      ${!isHost && m.bio ? `<p class="cm-bio">${esc(m.bio)}</p>` : ''}${mine ? `<a class="cm-btn ghost sm" href="${home(acct)}/me">Edit profile</a>` : ''}</div></section>
      <h2 class="cm-h2">Posts</h2>${posts.map((p) => postCard(acct, comm, p, v, { back })).join('') || '<div class="cm-empty"><p>No posts yet.</p></div>'}` });
  }));

  app.get('/my/:acct/community/me', wrap(async (req, res) => {
    const ctx = await load(req, res);
    if (!ctx) return;
    const { acct, comm, v } = ctx;
    if (v.host) return res.redirect(303, `${home(acct)}/people/host`);
    const m = v.member;
    const { nav, up } = await sidebar(acct, comm, v, '');
    const box = (name, on, label, hint) => `<label class="cm-check"><input type="checkbox" name="${name}" value="1"${on ? ' checked' : ''}><span><b>${label}</b><small>${hint}</small></span></label>`;
    shell(res, acct, comm, v, { title: 'Your profile', nav, up, main: `<form class="cm-card cm-form" method="post" action="${home(acct)}/me"><h1>Your profile</h1>
      ${req.query.saved ? '<p class="cm-ok">Saved.</p>' : ''}
      <div class="cm-field cm-photo-f"><span data-upprev>${avatar(m.name, m.photo_url, 'xl')}</span><input type="hidden" name="photo_url" value="${esc(m.photo_url)}" data-upurl data-avatar>
        <label class="cm-tool">${ICON.photo}<input type="file" accept="image/jpeg,image/png,image/webp" data-up hidden><span>${m.photo_url ? 'Change photo' : 'Add a photo'}</span></label>${m.photo_url ? '<button type="button" class="cm-link" data-unpic>Remove</button>' : ''}</div>
      <label>Name<input name="name" required maxlength="60" value="${esc(m.name)}"></label>
      <label>A few words about you <small>optional</small><textarea name="bio" rows="3" maxlength="300" placeholder="What you do, what you’re working on">${esc(m.bio)}</textarea></label>
      <h2 class="cm-h2">Emails</h2>
      ${box('notify_replies', m.notify_replies, 'Replies to my posts and comments', 'At most one email an hour')}
      ${box('notify_digest', m.notify_digest, 'Weekly highlights', 'Only when you haven’t visited for a week')}
      ${box('notify_events', m.notify_events, 'Event reminders', 'An hour before events you RSVP to')}
      <div class="cm-row"><button class="cm-btn">Save</button></div></form>` });
  }));

  // ---------- Actions ----------
  async function rateCheck(v) {
    if (v.host) return;
    const r = await db().get(`SELECT (SELECT COUNT(*)::int FROM community_posts WHERE member_id = ? AND created_at > now() - interval '10 minutes')
      + (SELECT COUNT(*)::int FROM community_comments WHERE member_id = ? AND created_at > now() - interval '10 minutes') AS n`, v.mid, v.mid);
    if (r.n >= RATE_LIMIT) throw new PageError(429, 'You’re posting a lot. Take a breather and try again in a few minutes.');
  }
  // A picture must be one uploaded to this business (stored as /u/<id>).
  async function cleanImage(acct, raw) {
    const m = String(raw || '').match(/\/u\/([A-Za-z0-9_-]{8,30}\.(?:jpg|png|webp|gif))$/);
    if (!m) return '';
    return (await db().get('SELECT 1 FROM uploads WHERE id = ? AND account_id = ?', m[1], acct.id)) ? `/u/${m[1]}` : '';
  }
  function eventTime(body) {
    const m = String(body.event_at || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!m) throw new PageError(400, 'Pick the date and time of the event.');
    const tz = Number.isFinite(Number(body.tz)) && body.tz !== '' ? Math.max(-840, Math.min(840, Number(body.tz))) : 0; // minutes, as the browser's getTimezoneOffset()
    const at = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) + tz * 60e3);
    if (Number.isNaN(at.getTime())) throw new PageError(400, 'Pick the date and time of the event.');
    return at;
  }
  async function ownPost(acct, v, postId) {
    const p = await db().get('SELECT * FROM community_posts WHERE id = ? AND account_id = ? AND deleted_at IS NULL', id(postId), acct.id);
    if (!p) throw new PageError(404, 'That post isn’t here any more.');
    if (v.host ? p.member_id !== null : p.member_id !== v.mid) throw new PageError(403, 'You can only change your own posts.');
    return p;
  }
  const postFields = async (acct, b, isEvent) => {
    const f = { title: str(b.title, 200), body: String(b.body ?? '').replace(/\r\n/g, '\n').trim().slice(0, 10000), link_url: httpUrl(b.link_url), image_url: await cleanImage(acct, b.image_url) };
    if (isEvent) { f.event_at = eventTime(b).toISOString(); f.event_url = httpUrl(b.event_url); if (!f.title) throw new PageError(400, 'Give the event a name.'); } else if (!f.body && !f.image_url && !f.title) throw new PageError(400, 'Write something first.');
    return f;
  };

  app.post('/my/:acct/community/posts', form, wrap(async (req, res) => {
    const ctx = await load(req, res);
    if (!ctx) return;
    const { acct, v } = ctx;
    const space = await db().get('SELECT * FROM community_spaces WHERE id = ? AND account_id = ? AND deleted_at IS NULL', id(req.body.space_id), acct.id);
    if (!space) throw new PageError(400, 'Pick a space to post in.');
    if (space.owner_only && !v.host) throw new PageError(403, `Only ${acct.name} posts in ${space.name}. You can comment on posts there.`);
    const isEvent = v.host && req.body.kind === 'event';
    await rateCheck(v);
    const f = await postFields(acct, req.body, isEvent);
    const p = await db().get(`INSERT INTO community_posts (account_id, space_id, member_id, title, body, image_url, link_url, event_at, event_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`, acct.id, space.id, v.host ? null : v.mid, f.title, f.body, f.image_url, f.link_url, f.event_at || null, f.event_url || '');
    res.redirect(303, isEvent ? `${home(acct)}/p/${p.id}` : `${safeBack(acct, req.body.back, home(acct)).split('?')[0]}#p${p.id}`);
  }));

  app.post('/my/:acct/community/p/:post/edit', form, wrap(async (req, res) => {
    const ctx = await load(req, res);
    if (!ctx) return;
    const { acct, v } = ctx;
    const p = await ownPost(acct, v, req.params.post);
    const f = await postFields(acct, req.body, Boolean(p.event_at));
    await db().run(`UPDATE community_posts SET title = ?, body = ?, image_url = ?, link_url = ?, event_at = COALESCE(?, event_at), event_url = ?, edited_at = now(),
      reminded_at = CASE WHEN ?::timestamptz IS NOT NULL AND ?::timestamptz <> event_at THEN NULL ELSE reminded_at END WHERE id = ? AND account_id = ?`,
    f.title, f.body, f.image_url, f.link_url, f.event_at || null, f.event_url ?? p.event_url, f.event_at || null, f.event_at || null, p.id, acct.id);
    res.redirect(303, `${home(acct)}/p/${p.id}`);
  }));

  // Delete: the author or the host. Undo restores it.
  app.post('/my/:acct/community/p/:post/delete', form, wrap(async (req, res) => {
    const ctx = await load(req, res);
    if (!ctx) return;
    const { acct, v } = ctx;
    const p = await db().get('SELECT * FROM community_posts WHERE id = ? AND account_id = ? AND deleted_at IS NULL', id(req.params.post), acct.id);
    if (!p) throw new PageError(404, 'That post isn’t here any more.');
    if (!v.host && p.member_id !== v.mid) throw new PageError(403, 'You can only delete your own posts.');
    await db().run('UPDATE community_posts SET deleted_at = now() WHERE id = ? AND account_id = ?', p.id, acct.id);
    const back = safeBack(acct, req.body.back, home(acct)).split('?')[0];
    res.redirect(303, `${back.startsWith(`${home(acct)}/p/${p.id}`) ? `${home(acct)}/s/${p.space_id}` : back}?deleted=${p.id}`);
  }));
  app.post('/my/:acct/community/p/:post/restore', form, wrap(async (req, res) => {
    const ctx = await load(req, res);
    if (!ctx) return;
    const { acct, v } = ctx;
    const p = await db().get('SELECT * FROM community_posts WHERE id = ? AND account_id = ?', id(req.params.post), acct.id);
    if (!p || (!v.host && p.member_id !== v.mid)) throw new PageError(404, 'That post can’t be brought back.');
    await db().run('UPDATE community_posts SET deleted_at = NULL WHERE id = ? AND account_id = ?', p.id, acct.id);
    res.redirect(303, `${home(acct)}/p/${p.id}`);
  }));
  app.post('/my/:acct/community/p/:post/pin', form, wrap(async (req, res) => {
    const ctx = await load(req, res);
    if (!ctx) return;
    const { acct, v } = ctx;
    if (!v.host) throw new PageError(403, 'Only the host can pin posts.');
    await db().run('UPDATE community_posts SET pinned = 1 - pinned WHERE id = ? AND account_id = ?', id(req.params.post), acct.id);
    res.redirect(303, safeBack(acct, req.body.back, home(acct)));
  }));

  app.post('/my/:acct/community/p/:post/like', form, wrap(async (req, res) => {
    const ctx = await load(req, res);
    if (!ctx) return;
    const { acct, v } = ctx;
    const p = await db().get('SELECT id FROM community_posts WHERE id = ? AND account_id = ? AND deleted_at IS NULL', id(req.params.post), acct.id);
    if (!p) throw new PageError(404, 'That post isn’t here any more.');
    const gone = await db().get('DELETE FROM community_likes WHERE post_id = ? AND member_id = ? RETURNING post_id', p.id, v.mid);
    if (!gone) await db().run('INSERT INTO community_likes (account_id, post_id, member_id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', acct.id, p.id, v.mid);
    const n = (await db().get('SELECT COUNT(*)::int AS n FROM community_likes WHERE post_id = ?', p.id)).n;
    if (req.headers.accept?.includes('application/json')) return res.json({ liked: !gone, likes: n });
    res.redirect(303, `${safeBack(acct, req.body.back, home(acct))}#p${p.id}`);
  }));

  app.post('/my/:acct/community/p/:post/rsvp', form, wrap(async (req, res) => {
    const ctx = await load(req, res);
    if (!ctx) return;
    const { acct, v } = ctx;
    if (!v.member) throw new PageError(400, 'Hosts don’t need to RSVP.');
    const p = await db().get('SELECT id FROM community_posts WHERE id = ? AND account_id = ? AND deleted_at IS NULL AND event_at > now()', id(req.params.post), acct.id);
    if (!p) throw new PageError(404, 'That event isn’t open for RSVPs.');
    const gone = await db().get('DELETE FROM community_rsvps WHERE post_id = ? AND member_id = ? RETURNING post_id', p.id, v.mid);
    if (!gone) await db().run('INSERT INTO community_rsvps (account_id, post_id, member_id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', acct.id, p.id, v.mid);
    res.redirect(303, `${safeBack(acct, req.body.back, home(acct))}#p${p.id}`);
  }));

  app.post('/my/:acct/community/p/:post/comments', form, wrap(async (req, res) => {
    const ctx = await load(req, res);
    if (!ctx) return;
    const { acct, v } = ctx;
    const p = await db().get('SELECT * FROM community_posts WHERE id = ? AND account_id = ? AND deleted_at IS NULL', id(req.params.post), acct.id);
    if (!p) throw new PageError(404, 'That post isn’t here any more.');
    const body = String(req.body.body ?? '').replace(/\r\n/g, '\n').trim().slice(0, 4000);
    if (!body) throw new PageError(400, 'Write something first.');
    let parent = null;
    if (req.body.parent_id) {
      parent = await db().get('SELECT * FROM community_comments WHERE id = ? AND post_id = ? AND account_id = ? AND deleted_at IS NULL', id(req.body.parent_id), p.id, acct.id);
      if (!parent) throw new PageError(404, 'That comment isn’t here any more.');
      if (parent.parent_id) parent = await db().get('SELECT * FROM community_comments WHERE id = ?', parent.parent_id); // one level of replies
    }
    await rateCheck(v);
    const c = await db().get('INSERT INTO community_comments (account_id, post_id, parent_id, member_id, body) VALUES (?, ?, ?, ?, ?) RETURNING id',
      acct.id, p.id, parent?.id || null, v.host ? null : v.mid, body);
    // Who hears about it: the post's author, and the author of the comment replied to (never yourself, never the host).
    const to = new Set([p.member_id, parent?.member_id].filter((x) => x && x !== v.mid));
    for (const mid of to) await db().run('INSERT INTO community_notices (account_id, member_id, comment_id) VALUES (?, ?, ?)', acct.id, mid, c.id);
    res.redirect(303, `${home(acct)}/p/${p.id}#c${c.id}`);
  }));
  app.post('/my/:acct/community/c/:comment/delete', form, wrap(async (req, res) => {
    const ctx = await load(req, res);
    if (!ctx) return;
    const { acct, v } = ctx;
    const c = await db().get('SELECT * FROM community_comments WHERE id = ? AND account_id = ? AND deleted_at IS NULL', id(req.params.comment), acct.id);
    if (!c) throw new PageError(404, 'That comment isn’t here any more.');
    if (!v.host && c.member_id !== v.mid) throw new PageError(403, 'You can only delete your own comments.');
    await db().run('UPDATE community_comments SET deleted_at = now() WHERE id = ? AND account_id = ?', c.id, acct.id);
    res.redirect(303, `${home(acct)}/p/${c.post_id}?deleted_c=${c.id}#comments`);
  }));
  app.post('/my/:acct/community/c/:comment/restore', form, wrap(async (req, res) => {
    const ctx = await load(req, res);
    if (!ctx) return;
    const { acct, v } = ctx;
    const c = await db().get('SELECT * FROM community_comments WHERE id = ? AND account_id = ?', id(req.params.comment), acct.id);
    if (!c || (!v.host && c.member_id !== v.mid)) throw new PageError(404, 'That comment can’t be brought back.');
    await db().run('UPDATE community_comments SET deleted_at = NULL WHERE id = ? AND account_id = ?', c.id, acct.id);
    res.redirect(303, `${home(acct)}/p/${c.post_id}#c${c.id}`);
  }));

  app.post('/my/:acct/community/me', form, wrap(async (req, res) => {
    const ctx = await load(req, res);
    if (!ctx) return;
    const { acct, v } = ctx;
    if (!v.member) throw new PageError(400, 'Hosts show as the business.');
    const name = str(req.body.name, 60);
    if (!name) throw new PageError(400, 'Add your name.');
    await db().run(`UPDATE community_members SET name = ?, bio = ?, photo_url = ?, notify_replies = ?, notify_digest = ?, notify_events = ? WHERE id = ? AND account_id = ?`,
      name, str(req.body.bio, 300), await cleanImage(acct, req.body.photo_url), req.body.notify_replies ? 1 : 0, req.body.notify_digest ? 1 : 0, req.body.notify_events ? 1 : 0, v.mid, acct.id);
    res.redirect(303, `${home(acct)}/me?saved=1`);
  }));

  // Pictures from members: images only, 4 MB at most (the page shrinks them first), 30 an hour.
  const uploadsBy = new Map();
  app.post('/my/:acct/community/upload', express.raw({ type: () => true, limit: 4 * 1024 * 1024 }), wrap(async (req, res) => {
    const ctx = await load(req, res, { needMember: false });
    const { acct, v } = ctx;
    if (!v.host && !v.member) throw new PageError(401, 'Sign in to add a picture.');
    const key = `${acct.id}:${v.mid}`;
    const hits = (uploadsBy.get(key) || []).filter((t) => t > Date.now() - HOUR);
    if (!v.host && hits.length >= 30) throw new PageError(429, 'That’s a lot of pictures. Try again in a while.');
    uploadsBy.set(key, [...hits, Date.now()]);
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const type = body.length ? sniff(body) : null;
    if (!IMG_TYPES[type]) throw new PageError(415, 'Use a JPG, PNG, WebP or GIF picture.');
    const fileId = `${crypto.randomBytes(12).toString('base64url')}.${IMG_TYPES[type]}`;
    await db().run('INSERT INTO uploads (id, account_id, content_type, size, data) VALUES (?, ?, ?, ?, ?)', fileId, acct.id, type, body.length, body);
    res.status(201).json({ url: `/u/${fileId}` });
  }));

  // Join (open communities) or get a sign-in link (everyone). Same answer either way.
  app.post('/my/:acct/community/join', form, wrap(async (req, res) => {
    const acct = await courses.account(req.params.acct);
    const comm = acct && await getCommunity(acct.id);
    if (!comm) throw new PageError(404, 'There’s no community here.');
    const email = str(req.body.email, 200).toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      let c = await db().get('SELECT * FROM contacts WHERE account_id = ? AND email = ?', acct.id, email);
      const m = c && await db().get('SELECT status FROM community_members WHERE account_id = ? AND contact_id = ?', acct.id, c.id);
      let ok = m ? m.status === 'active' : c ? await eligible(comm, c.id) : comm.join_rule === 'open';
      if (ok && !c) {
        try {
          const r = await upsertContact(db(), acct.id, { email, name: str(req.body.name, 60), tags: ['community'], source: 'manual', entry: `Asked to join ${comm.name}` });
          c = await db().get('SELECT * FROM contacts WHERE id = ? AND account_id = ?', r.id, acct.id);
        } catch { ok = false; }
      }
      const recent = c && await db().get("SELECT 1 FROM email_log WHERE contact_id = ? AND subject LIKE 'Your link to %' AND created_at > now() - interval '2 minutes'", c.id);
      if (ok && c && !recent) {
        const full = await db().get('SELECT * FROM accounts WHERE id = ?', acct.id);
        await messaging.sendTransactional({ account: full, to: c.email, contactId: c.id, subject: `Your link to ${comm.name}`,
          text: `Hi ${c.first_name || 'there'},\n\nHere’s your link to come into ${comm.name}:\n\n${courses.portalLink(acct, c.id, 7, 'community')}\n\nThe link works for 7 days and keeps you signed in on this device.\n\n${full.from_name || acct.name}` })
          .catch((e) => console.error('community link:', e.message));
      }
    }
    await gatePage(res, acct, comm, { anon: true }, { sent: true });
  }));

  // One-click "stop these emails" (signed, so only the person it was sent to can use it).
  app.get('/my/:acct/community/stop/:token', wrap(async (req, res) => {
    const acct = await courses.account(req.params.acct, { allowId: true });
    const comm = acct && await getCommunity(acct.id);
    if (!comm) throw new PageError(404, 'There’s no community here.');
    const [mid, kind, sig] = String(req.params.token).split('.');
    const col = { replies: 'notify_replies', digest: 'notify_digest', events: 'notify_events' }[kind];
    const expect = members.sign(`cstop:${mid}:${kind}`);
    if (!col || !sig || !members.same(sig, expect)) throw new PageError(400, 'This link isn’t valid.');
    const r = await db().get(`UPDATE community_members SET ${col} = 0 WHERE id = ? AND account_id = ? RETURNING id`, id(mid), acct.id);
    if (!r) throw new PageError(400, 'This link isn’t valid.');
    const what = { replies: 'reply emails', digest: 'weekly highlights', events: 'event reminders' }[kind];
    shell(res, acct, comm, null, { title: 'Emails stopped', main: `<div class="cm-card cm-narrow"><h1>Done</h1><p>You won’t get ${what} from ${esc(comm.name)} any more.</p>
      <p class="cm-fine">Changed your mind? Turn them back on in your profile: <a href="${home(acct)}/me">${esc(base())}${home(acct)}/me</a></p></div>` });
  }));

  // ---------- In the customer area (/my/<business>) ----------
  async function portalCard(acct, contact) {
    const comm = await getCommunity(acct.id);
    if (!comm) return '';
    const m = await db().get('SELECT status FROM community_members WHERE account_id = ? AND contact_id = ?', acct.id, contact.id);
    if (m?.status === 'blocked' || (!m && !(await eligible(comm, contact.id)))) return '';
    const n = (await db().get("SELECT COUNT(*)::int AS n FROM community_members WHERE account_id = ? AND status = 'active'", acct.id)).n;
    return `<h2>Community</h2><div class="grid"><a class="course" href="${home(acct)}"><b>${esc(comm.name)}</b><span class="m">${n} member${n === 1 ? '' : 's'} · ${m ? 'Catch up on what’s new' : 'You’re invited: come say hello'}</span><span class="go">Open &rarr;</span></a></div>`;
  }

  // A paid order for a product that opens the community: they're in, and get a link.
  async function onOrderPaid(order) {
    const comm = await getCommunity(order.account_id);
    if (!comm || comm.join_rule !== 'buyers') return;
    const o = await db().get('SELECT contact_id, product_id FROM orders WHERE id = ?', order.id);
    if (!o?.contact_id || !parseList(comm.join_products).includes(o.product_id)) return;
    const c = await db().get('SELECT * FROM contacts WHERE id = ? AND account_id = ?', o.contact_id, order.account_id);
    const before = await db().get('SELECT status FROM community_members WHERE account_id = ? AND contact_id = ?', order.account_id, c.id);
    if (before) return;
    await join(comm, c);
    const account = await db().get('SELECT * FROM accounts WHERE id = ?', order.account_id);
    await messaging.sendTransactional({ account, to: c.email, contactId: c.id, subject: `You’re in: ${comm.name}`,
      text: `Hi ${c.first_name || 'there'},\n\nYour purchase comes with ${comm.name}, our members’ community. Come in and say hello:\n\n${courses.portalLink({ id: account.id, handle: account.handle }, c.id, 7, 'community')}\n\nThe link works for 7 days and keeps you signed in on this device.\n\n${account.from_name || account.name}` });
  }

  // ---------- Emails (jobs) ----------
  async function sendReplyEmails(now) {
    let sent = 0;
    const hourAgo = new Date(now.getTime() - HOUR).toISOString();
    const due = await db().all(`SELECT DISTINCT n.member_id FROM community_notices n JOIN community_members m ON m.id = n.member_id
      WHERE n.sent_at IS NULL AND m.status = 'active' AND m.notify_replies = 1 AND (m.replies_emailed_at IS NULL OR m.replies_emailed_at <= ?)`, hourAgo);
    for (const { member_id: mid } of due) {
      const m = await db().get(`UPDATE community_members SET replies_emailed_at = ? WHERE id = ? AND (replies_emailed_at IS NULL OR replies_emailed_at <= ?) RETURNING *`, now.toISOString(), mid, hourAgo);
      if (!m) continue;
      const items = await db().all(`UPDATE community_notices SET sent_at = ? WHERE member_id = ? AND sent_at IS NULL RETURNING comment_id`, now.toISOString(), mid);
      const rows = items.length ? await db().all(`SELECT c.id, c.post_id, c.parent_id, c.body, a.name AS who, p.title, p.body AS post_body FROM community_comments c
        JOIN community_posts p ON p.id = c.post_id LEFT JOIN community_members a ON a.id = c.member_id
        WHERE c.id IN (${items.map(() => '?').join(',')}) AND c.deleted_at IS NULL AND p.deleted_at IS NULL ORDER BY c.id`, ...items.map((x) => x.comment_id)) : [];
      if (!rows.length) { await db().run('UPDATE community_members SET replies_emailed_at = NULL WHERE id = ? AND replies_emailed_at = ?', mid, now.toISOString()); continue; }
      const contact = await db().get('SELECT * FROM contacts WHERE id = ? AND account_id = ?', m.contact_id, m.account_id);
      const account = await db().get('SELECT * FROM accounts WHERE id = ?', m.account_id);
      const comm = await getCommunity(m.account_id);
      if (!contact?.email || !comm) continue;
      const acct = { id: account.id, handle: account.handle };
      const lines = rows.slice(0, 10).map((r) => `**${r.who || account.name}** ${r.parent_id ? 'replied to your comment' : 'commented'} on “${(r.title || r.post_body).slice(0, 60)}”:\n“${r.body.slice(0, 200)}${r.body.length > 200 ? '…' : ''}”`);
      await messaging.sendTransactional({ account, to: contact.email, contactId: contact.id,
        subject: rows.length === 1 ? `${rows[0].who || account.name} replied to you in ${comm.name}` : `${rows.length} new replies in ${comm.name}`,
        text: `Hi ${m.name.split(' ')[0] || 'there'},\n\n${lines.join('\n\n')}${rows.length > 10 ? `\n\nand ${rows.length - 10} more.` : ''}\n\n[See the conversation](${courses.portalLink(acct, contact.id, 7, `community/p/${rows[rows.length - 1].post_id}`)})\n\n--\nStop these emails: ${stopLink(acct, m.id, 'replies')}` })
        .then(() => { sent++; }).catch((e) => console.error('community replies:', e.message));
    }
    return sent;
  }

  async function sendDigests(now) {
    let sent = 0;
    const weekAgo = new Date(now.getTime() - 7 * DAY).toISOString();
    const due = await db().all(`SELECT m.* FROM community_members m JOIN contacts c ON c.id = m.contact_id
      WHERE m.status = 'active' AND m.notify_digest = 1 AND c.unsubscribed = 0 AND m.last_seen_at < ? AND (m.digest_sent_at IS NULL OR m.digest_sent_at < ?) LIMIT 2000`, weekAgo, weekAgo);
    const cache = new Map();
    for (const m of due) {
      const posts = await db().all(`SELECT p.id, p.title, p.body, a.name AS who,
          (SELECT COUNT(*) FROM community_likes l WHERE l.post_id = p.id) + 2 * (SELECT COUNT(*) FROM community_comments c WHERE c.post_id = p.id AND c.deleted_at IS NULL) AS score
        FROM community_posts p JOIN community_spaces s ON s.id = p.space_id LEFT JOIN community_members a ON a.id = p.member_id
        WHERE p.account_id = ? AND p.deleted_at IS NULL AND s.deleted_at IS NULL AND p.created_at > ? AND p.created_at > ? AND (p.member_id IS NULL OR a.status = 'active')
        ORDER BY score DESC, p.created_at DESC LIMIT 5`, m.account_id, weekAgo, new Date(m.last_seen_at).toISOString());
      if (!posts.length) continue;
      const claim = await db().get('UPDATE community_members SET digest_sent_at = ? WHERE id = ? AND (digest_sent_at IS NULL OR digest_sent_at < ?) RETURNING id', now.toISOString(), m.id, weekAgo);
      if (!claim) continue;
      if (!cache.has(m.account_id)) cache.set(m.account_id, { account: await db().get('SELECT * FROM accounts WHERE id = ?', m.account_id), comm: await getCommunity(m.account_id) });
      const { account, comm } = cache.get(m.account_id);
      const contact = await db().get('SELECT * FROM contacts WHERE id = ? AND account_id = ?', m.contact_id, m.account_id);
      const acct = { id: account.id, handle: account.handle };
      const list = posts.map((p) => `**${(p.title || p.body.split('\n')[0]).slice(0, 80)}**\n${p.who || account.name}${Number(p.score) ? ` · ${Number(p.score)} reactions` : ''}`).join('\n\n');
      await messaging.sendTransactional({ account, to: contact.email, contactId: contact.id, subject: `This week in ${comm.name}`,
        text: `Hi ${m.name.split(' ')[0] || 'there'},\n\nHere’s what people have been talking about in ${comm.name}:\n\n${list}\n\n[Join the conversation](${courses.portalLink(acct, contact.id, 7, 'community')})\n\n--\nStop these emails: ${stopLink(acct, m.id, 'digest')}` })
        .then(() => { sent++; }).catch((e) => console.error('community digest:', e.message));
    }
    return sent;
  }

  async function sendEventReminders(now) {
    let sent = 0;
    const events = await db().all(`SELECT p.* FROM community_posts p JOIN community_spaces s ON s.id = p.space_id WHERE p.event_at > ? AND p.event_at <= ?
      AND p.reminded_at IS NULL AND p.deleted_at IS NULL AND s.deleted_at IS NULL`, now.toISOString(), new Date(now.getTime() + HOUR).toISOString());
    for (const e of events) {
      const claim = await db().get('UPDATE community_posts SET reminded_at = ? WHERE id = ? AND reminded_at IS NULL RETURNING id', now.toISOString(), e.id);
      if (!claim) continue;
      const account = await db().get('SELECT * FROM accounts WHERE id = ?', e.account_id);
      const comm = await getCommunity(e.account_id);
      const acct = { id: account.id, handle: account.handle };
      const people = await db().all(`SELECT m.id, m.name, c.id AS contact_id, c.email FROM community_rsvps r JOIN community_members m ON m.id = r.member_id JOIN contacts c ON c.id = m.contact_id
        WHERE r.post_id = ? AND m.account_id = ? AND m.status = 'active' AND m.notify_events = 1`, e.id, e.account_id);
      const mins = Math.max(1, Math.round((new Date(e.event_at) - now) / 60e3));
      for (const p of people) {
        await messaging.sendTransactional({ account, to: p.email, contactId: p.contact_id, subject: `Starting soon: ${e.title}`,
          text: `Hi ${p.name.split(' ')[0] || 'there'},\n\n${e.title} starts in ${mins >= 55 ? 'about an hour' : `${mins} minutes`} (${whenText(e.event_at)}).${e.event_url ? `\n\n[Join here](${e.event_url})` : ''}\n\nDetails: ${courses.portalLink(acct, p.contact_id, 7, `community/p/${e.id}`)}\n\nSee you there,\n${account.from_name || account.name}\n\n--\nStop event reminders: ${stopLink(acct, p.id, 'events')}` })
          .then(() => { sent++; }).catch((err) => console.error('community event:', err.message));
      }
    }
    return sent;
  }

  async function runJobs(now = new Date()) {
    // Comms lacking: no community_* tables to read yet is fine (they're created with the schema).
    return { community_reply_emails: await sendReplyEmails(now), community_digests: await sendDigests(now), community_event_reminders: await sendEventReminders(now) };
  }

  // ---------- Owner API (Flows > Community) ----------
  const mine = async (req) => {
    const c = await getCommunity(req.accountId);
    if (!c) throw new HttpError(404, 'Start your community first');
    return c;
  };
  const communityOut = (c) => ({ ...c, join_products: parseList(c.join_products), join_areas: parseList(c.join_areas) });

  api.get('/community', async (req, res) => {
    const c = await getCommunity(req.accountId);
    const acct = await db().get('SELECT id, name, brand_color, handle FROM accounts WHERE id = ?', req.accountId);
    const url = `${base()}/my/${acct.handle || await require('./handles').handleOf(db(), req.accountId)}/community`;
    if (!c) return res.json({ community: null, url, account_name: acct.name, brand_default: brandOf(null, acct) });
    const week = new Date(Date.now() - 7 * DAY).toISOString();
    const [spaces, membersList, posts, products, areas, stats] = await Promise.all([
      db().all(`SELECT s.id, s.name, s.owner_only, s.position, (SELECT COUNT(*)::int FROM community_posts p WHERE p.space_id = s.id AND p.deleted_at IS NULL) AS posts
        FROM community_spaces s WHERE s.account_id = ? AND s.deleted_at IS NULL ORDER BY s.position, s.id`, req.accountId),
      db().all(`SELECT m.id, m.name, m.photo_url, m.status, m.joined_at, m.last_seen_at, c.email, c.id AS contact_id FROM community_members m JOIN contacts c ON c.id = m.contact_id
        WHERE m.account_id = ? AND m.status = 'active' ORDER BY m.joined_at DESC LIMIT 500`, req.accountId),
      db().all(`SELECT p.id, p.title, p.body, p.pinned, p.created_at, p.event_at, p.member_id, s.name AS space_name, m.name AS author_name,
          (SELECT COUNT(*)::int FROM community_likes l WHERE l.post_id = p.id) AS likes,
          (SELECT COUNT(*)::int FROM community_comments x WHERE x.post_id = p.id AND x.deleted_at IS NULL) AS comments
        FROM community_posts p JOIN community_spaces s ON s.id = p.space_id LEFT JOIN community_members m ON m.id = p.member_id
        WHERE p.account_id = ? AND p.deleted_at IS NULL AND s.deleted_at IS NULL ORDER BY p.pinned DESC, p.created_at DESC LIMIT 30`, req.accountId),
      db().all('SELECT id, name FROM products WHERE account_id = ? ORDER BY name', req.accountId),
      db().all("SELECT id, name FROM funnels WHERE account_id = ? AND kind = 'members' ORDER BY name", req.accountId),
      db().get(`SELECT (SELECT COUNT(*)::int FROM community_members WHERE account_id = ? AND status = 'active') AS members,
          (SELECT COUNT(*)::int FROM community_posts WHERE account_id = ? AND deleted_at IS NULL AND created_at > ?) AS posts_week,
          (SELECT COUNT(*)::int FROM community_members WHERE account_id = ? AND status = 'active' AND last_seen_at > ?) AS active_week`,
      req.accountId, req.accountId, week, req.accountId, week),
    ]);
    res.json({ community: communityOut(c), url, account_name: acct.name, brand_default: brandOf(null, acct), spaces, members: membersList, posts, products, areas, stats });
  });

  api.post('/community', async (req, res) => {
    const acct = await db().get('SELECT name FROM accounts WHERE id = ?', req.accountId);
    const made = await db().tx(async (t) => {
      const c = await t.get(`INSERT INTO communities (account_id, name, welcome) VALUES (?, ?, ?) ON CONFLICT (account_id) DO NOTHING RETURNING *`,
        req.accountId, str(req.body?.name, 80) || `${acct.name} Community`,
        `Welcome in! This is where we share wins, ask questions and help each other.\n\nStart by saying hello in **Introductions**: who you are and what you’re working on.`);
      if (!c) return null;
      let i = 0;
      for (const [name, ownerOnly] of DEFAULT_SPACES) await t.run('INSERT INTO community_spaces (account_id, name, owner_only, position) VALUES (?, ?, ?, ?)', req.accountId, name, ownerOnly, i++);
      return c;
    });
    if (!made) throw new HttpError(409, 'You already have a community');
    res.status(201).json(communityOut(made));
  });

  api.put('/community', async (req, res) => {
    const c = await mine(req);
    const b = req.body || {};
    const sets = [], vals = [];
    const set = (k, v) => { sets.push(`${k} = ?`); vals.push(v); };
    if ('name' in b) { const n = str(b.name, 80); if (!n) throw new HttpError(400, 'Give your community a name'); set('name', n); }
    if ('cover_url' in b) set('cover_url', await cleanImage({ id: req.accountId }, b.cover_url));
    if ('brand_color' in b) set('brand_color', /^#[0-9a-f]{6}$/i.test(b.brand_color || '') ? b.brand_color : '');
    if ('welcome' in b) set('welcome', String(b.welcome || '').slice(0, 5000));
    if ('join_rule' in b) { if (!RULES.includes(b.join_rule)) throw new HttpError(400, 'Pick who can join'); set('join_rule', b.join_rule); }
    const ids = async (list, table) => {
      const want = (Array.isArray(list) ? list : []).map(Number).filter(Number.isInteger).slice(0, 200);
      if (!want.length) return [];
      const where = table === 'products' ? 'SELECT id FROM products WHERE account_id = ?' : "SELECT id FROM funnels WHERE account_id = ? AND kind = 'members'";
      const own = new Set((await db().all(where, req.accountId)).map((r) => r.id));
      return want.filter((x) => own.has(x));
    };
    if ('join_products' in b) set('join_products', JSON.stringify(await ids(b.join_products, 'products')));
    if ('join_areas' in b) set('join_areas', JSON.stringify(await ids(b.join_areas, 'funnels')));
    const rule = b.join_rule || c.join_rule;
    if (rule === 'buyers' && 'join_products' in b && !JSON.parse(vals[sets.indexOf('join_products = ?')]).length) throw new HttpError(400, 'Pick at least one product');
    if (rule === 'members' && 'join_areas' in b && !JSON.parse(vals[sets.indexOf('join_areas = ?')]).length) throw new HttpError(400, 'Pick at least one members area');
    if (sets.length) await db().run(`UPDATE communities SET ${sets.join(', ')} WHERE id = ? AND account_id = ?`, ...vals, c.id, req.accountId);
    res.json(communityOut(await getCommunity(req.accountId)));
  });

  api.post('/community/spaces', async (req, res) => {
    await mine(req);
    const name = str(req.body?.name, 60);
    if (!name) throw new HttpError(400, 'Name the space, e.g. “Wins” or “Questions”');
    const pos = (await db().get('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM community_spaces WHERE account_id = ?', req.accountId)).n;
    res.status(201).json(await db().get('INSERT INTO community_spaces (account_id, name, owner_only, position) VALUES (?, ?, ?, ?) RETURNING id, name, owner_only, position',
      req.accountId, name, req.body?.owner_only ? 1 : 0, pos));
  });
  api.put('/community/spaces/order', async (req, res) => {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Number.isInteger).slice(0, 200);
    await db().tx(async (t) => { for (const [i, sid] of ids.entries()) await t.run('UPDATE community_spaces SET position = ? WHERE id = ? AND account_id = ?', i, sid, req.accountId); });
    res.json({ ok: true });
  });
  api.put('/community/spaces/:id', async (req, res) => {
    const sets = [], vals = [];
    if ('name' in (req.body || {})) { const n = str(req.body.name, 60); if (!n) throw new HttpError(400, 'Name the space'); sets.push('name = ?'); vals.push(n); }
    if ('owner_only' in (req.body || {})) { sets.push('owner_only = ?'); vals.push(req.body.owner_only ? 1 : 0); }
    if (!sets.length) throw new HttpError(400, 'Nothing to change');
    const r = await db().get(`UPDATE community_spaces SET ${sets.join(', ')} WHERE id = ? AND account_id = ? AND deleted_at IS NULL RETURNING id, name, owner_only`, ...vals, id(req.params.id), req.accountId);
    if (!r) throw new HttpError(404, 'Space not found');
    res.json(r);
  });
  api.delete('/community/spaces/:id', async (req, res) => {
    const r = await db().get('UPDATE community_spaces SET deleted_at = now() WHERE id = ? AND account_id = ? AND deleted_at IS NULL RETURNING id', id(req.params.id), req.accountId);
    if (!r) throw new HttpError(404, 'Space not found');
    res.json({ ok: true });
  });
  api.post('/community/spaces/:id/restore', async (req, res) => {
    await db().run('UPDATE community_spaces SET deleted_at = NULL WHERE id = ? AND account_id = ?', id(req.params.id), req.accountId);
    res.json({ ok: true });
  });
  api.put('/community/posts/:id/pin', async (req, res) => {
    const r = await db().get('UPDATE community_posts SET pinned = ? WHERE id = ? AND account_id = ? RETURNING id', req.body?.pinned ? 1 : 0, id(req.params.id), req.accountId);
    if (!r) throw new HttpError(404, 'Post not found');
    res.json({ ok: true });
  });
  for (const [path, table, label] of [['posts', 'community_posts', 'Post'], ['comments', 'community_comments', 'Comment']]) {
    api.delete(`/community/${path}/:id`, async (req, res) => {
      const r = await db().get(`UPDATE ${table} SET deleted_at = now() WHERE id = ? AND account_id = ? AND deleted_at IS NULL RETURNING id`, id(req.params.id), req.accountId);
      if (!r) throw new HttpError(404, `${label} not found`);
      res.json({ ok: true });
    });
    api.post(`/community/${path}/:id/restore`, async (req, res) => {
      await db().run(`UPDATE ${table} SET deleted_at = NULL WHERE id = ? AND account_id = ?`, id(req.params.id), req.accountId);
      res.json({ ok: true });
    });
  }
  // Remove someone: they're blocked from coming back (Undo lets them in again).
  api.delete('/community/members/:id', async (req, res) => {
    const r = await db().get("UPDATE community_members SET status = 'blocked' WHERE id = ? AND account_id = ? RETURNING id", id(req.params.id), req.accountId);
    if (!r) throw new HttpError(404, 'Member not found');
    res.json({ ok: true });
  });
  api.post('/community/members/:id/restore', async (req, res) => {
    await db().run("UPDATE community_members SET status = 'active' WHERE id = ? AND account_id = ?", id(req.params.id), req.accountId);
    res.json({ ok: true });
  });

  return { runJobs, onOrderPaid, portalCard, stopToken };
}

const SCRIPT = `(function(){
var $$=function(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s))};
$$('time[data-t]').forEach(function(t){var d=new Date(t.getAttribute('datetime'));if(isNaN(d))return;var k=t.dataset.t;
 t.textContent=k==='mon'?d.toLocaleString(undefined,{month:'short'}):k==='day'?String(d.getDate()):k==='short'?d.toLocaleString(undefined,{weekday:'short',hour:'numeric',minute:'2-digit'}):d.toLocaleString(undefined,{weekday:'long',month:'long',day:'numeric',hour:'numeric',minute:'2-digit'});});
$$('[data-tz]').forEach(function(i){i.value=String(new Date().getTimezoneOffset())});
$$('[data-localdt]').forEach(function(i){var d=new Date(i.dataset.localdt);var p=function(n){return String(n).padStart(2,'0')};i.value=d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+':'+p(d.getMinutes())});
$$('.cm-like-f').forEach(function(f){f.addEventListener('submit',function(e){e.preventDefault();var b=f.querySelector('button');if(b.disabled)return;b.disabled=true;
 fetch(f.action,{method:'POST',headers:{accept:'application/json','content-type':'application/x-www-form-urlencoded'},body:'back=',credentials:'same-origin'}).then(function(r){return r.json()}).then(function(j){if(j.error)throw 0;
 b.classList.toggle('liked',j.liked);b.setAttribute('aria-pressed',j.liked);b.querySelector('span').textContent=j.likes||'';if(j.liked){b.classList.add('pop');setTimeout(function(){b.classList.remove('pop')},400)}}).catch(function(){f.submit()}).then(function(){b.disabled=false})})});
$$('[data-reply]').forEach(function(b){b.onclick=function(){var w=document.querySelector('[data-replyf="'+b.dataset.reply+'"]');w.hidden=!w.hidden;if(!w.hidden)w.querySelector('textarea').focus()}});
$$('[data-linkbtn]').forEach(function(b){b.onclick=function(){var i=b.closest('form').querySelector('[data-linkin]');i.hidden=!i.hidden;if(!i.hidden)i.focus()}});
$$('textarea').forEach(function(t){var fit=function(){t.style.height='auto';t.style.height=Math.min(t.scrollHeight+2,480)+'px'};t.addEventListener('input',fit);if(t.value)fit()});
$$('[data-unpic]').forEach(function(b){b.onclick=function(){var f=b.closest('form');f.querySelector('[data-upurl]').value='';var p=f.querySelector('[data-upprev]');if(!f.querySelector('[data-avatar]')){p.hidden=true;p.innerHTML=''}else{p.innerHTML='<span class="cm-av xl" style="background:#94a3b8"></span>'}b.remove()}});
$$('[data-up]').forEach(function(inp){inp.onchange=function(){var file=inp.files[0];if(!file)return;var f=inp.closest('form');var lab=inp.closest('label').querySelector('span');var old=lab.textContent;lab.textContent='Uploading…';
 var shrink=file.type==='image/gif'?Promise.resolve(file):createImageBitmap(file).then(function(img){var s=Math.min(1,1600/Math.max(img.width,img.height));var c=document.createElement('canvas');c.width=Math.round(img.width*s);c.height=Math.round(img.height*s);c.getContext('2d').drawImage(img,0,0,c.width,c.height);
  return new Promise(function(r){c.toBlob(function(b){r(b&&b.size<file.size?b:file)},file.type==='image/png'?'image/webp':'image/jpeg',.85)})});
 shrink.then(function(blob){return fetch('UPLOAD',{method:'POST',body:blob,credentials:'same-origin',headers:{accept:'application/json'}})}).then(function(r){return r.json()}).then(function(j){if(!j.url)throw new Error(j.error||'Upload failed');
  f.querySelector('[data-upurl]').value=j.url;var p=f.querySelector('[data-upprev]');p.hidden=false;p.innerHTML=f.querySelector('[data-avatar]')?'<img class="cm-av xl" src="'+j.url+'" alt="">':'<img src="'+j.url+'" alt="">';lab.textContent=old})
 .catch(function(e){lab.textContent=old;alert(e.message||'That picture didn’t upload. Try another.')})}});
})();`;

const CSS = `*{box-sizing:border-box}
:root{--b:BRAND;--bs:color-mix(in srgb,BRAND 10%,#fff);--line:#e6e8ec;--muted:#6b7280;--text:#111827;--bg:#f5f6f8}
body{margin:0;font:15.5px/1.55 ui-sans-serif,-apple-system,system-ui,"Segoe UI",Roboto,sans-serif;color:var(--text);background:var(--bg);-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}button{font:inherit;color:inherit}h1,h2{letter-spacing:-.01em}
.cm-top{position:sticky;top:0;z-index:20;background:rgba(255,255,255,.92);backdrop-filter:saturate(1.6) blur(10px);border-bottom:1px solid var(--line)}
.cm-top-in{max-width:1120px;margin:0 auto;padding:0 16px;height:58px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.cm-brand{display:flex;align-items:center;gap:10px;min-width:0}.cm-brand b{font-size:1.02rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cm-logo{flex:none;width:34px;height:34px;border-radius:10px;background:var(--b);color:#fff;display:grid;place-items:center;font-weight:700;font-size:.85rem}
.cm-logo.big{position:relative;z-index:1;width:64px;height:64px;border-radius:18px;font-size:1.4rem;margin:-56px auto 12px;border:4px solid #fff;box-shadow:0 4px 14px rgba(0,0,0,.12)}
.cm-who{display:flex;align-items:center;color:var(--muted);font-size:.9rem}.cm-hostpill{background:var(--bs);color:var(--b);font-weight:600;padding:5px 11px;border-radius:99px;font-size:.82rem}
.cm-menu{position:relative}.cm-menu>summary{list-style:none;cursor:pointer;display:flex;align-items:center;border-radius:99px}.cm-menu>summary::-webkit-details-marker{display:none}
.cm-pop{position:absolute;right:0;top:calc(100% + 6px);background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:0 12px 32px rgba(17,24,39,.14);padding:6px;min-width:190px;z-index:30;display:flex;flex-direction:column}
.cm-pop a,.cm-pop button{display:block;width:100%;text-align:left;padding:9px 12px;border-radius:8px;background:none;border:0;cursor:pointer;color:var(--text);font-size:.92rem}.cm-pop a:hover,.cm-pop button:hover{background:var(--bg)}.cm-pop form{margin:0}.cm-pop .danger{color:#c0362c}
.cm-shell{max-width:1120px;margin:0 auto;padding:22px 16px 80px;display:grid;grid-template-columns:240px minmax(0,1fr);gap:28px;align-items:start}
.cm-side{position:sticky;top:80px;display:flex;flex-direction:column;gap:18px}
.cm-nav{display:flex;flex-direction:column;gap:2px}.cm-nav-h{font-size:.72rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);padding:14px 12px 6px}.cm-nav-sep{padding:6px 0;border-top:1px solid var(--line);margin:10px 12px 4px}
.cm-nav-i{display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:10px;color:#374151;font-weight:500}.cm-nav-i svg{flex:none;color:#9ca3af}.cm-nav-i:hover{background:#eceef2}
.cm-nav-i.on{background:var(--bs);color:var(--b);font-weight:600}.cm-nav-i.on svg{color:var(--b)}.cm-nav-i span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cm-up{background:#fff;border:1px solid var(--line);border-radius:16px;padding:14px}.cm-up-h{font-size:.72rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
.cm-up-i{display:flex;gap:10px;align-items:center;padding:7px 4px;border-radius:10px}.cm-up-i:hover{background:var(--bg)}.cm-up-i b{display:block;font-size:.9rem;line-height:1.3}.cm-up-i small{color:var(--muted);font-size:.8rem}
.cm-date{flex:none;width:42px;border-radius:10px;overflow:hidden;text-align:center;border:1px solid var(--line);background:#fff;line-height:1}
.cm-date b{display:block;background:var(--b);color:#fff;font-size:.62rem;text-transform:uppercase;letter-spacing:.06em;padding:3px 0}.cm-date i{display:block;font-style:normal;font-weight:700;font-size:1.05rem;padding:5px 0 6px}
.cm-date.big{width:58px}.cm-date.big b{font-size:.7rem;padding:4px 0}.cm-date.big i{font-size:1.5rem;padding:7px 0 8px}
.cm-main{min-width:0;max-width:680px;width:100%}.cm-solo{max-width:560px;margin:0 auto;padding:0 16px 60px}
.cm-head{margin:2px 0 16px}.cm-head h1{font-size:1.5rem;margin:0;display:flex;align-items:center;gap:6px}.cm-head h1 svg{width:22px;height:22px;color:var(--muted)}
.cm-sub{color:var(--muted);margin:4px 0 0}.cm-h2{font-size:1.05rem;margin:28px 0 12px}.cm-fine{color:var(--muted);font-size:.85rem}
.cm-card,.cm-post,.cm-compose,.cm-empty{background:#fff;border:1px solid var(--line);border-radius:18px;box-shadow:0 1px 2px rgba(17,24,39,.04)}
.cm-card{padding:22px}.cm-narrow{max-width:460px;margin:12vh auto 0}
.cm-post{padding:18px 20px 10px;margin-bottom:14px}.cm-post.pinned{border-color:color-mix(in srgb,BRAND 35%,#fff)}
.cm-ph{display:flex;align-items:center;gap:11px}.cm-ph-t{flex:1;min-width:0;line-height:1.3}.cm-name{font-weight:650}.cm-name:hover{text-decoration:underline}
.cm-meta{color:var(--muted);font-size:.84rem}.cm-meta a:hover{color:var(--text);text-decoration:underline}
.cm-badge{display:inline-block;margin-left:6px;background:var(--b);color:#fff;font-size:.66rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:2px 7px;border-radius:99px;vertical-align:2px}
.cm-pinned{display:inline-flex;align-items:center;gap:4px;color:var(--b);font-size:.78rem;font-weight:600;background:var(--bs);padding:3px 9px;border-radius:99px}
.cm-more>summary{width:34px;height:34px;justify-content:center;color:var(--muted)}.cm-more>summary:hover{background:var(--bg)}
.cm-title{font-size:1.18rem;margin:14px 0 2px;line-height:1.35}.cm-title a:hover{color:var(--b)}
.cm-body{margin-top:10px;overflow-wrap:anywhere}.cm-body p{margin:0 0 10px!important}.cm-body a{color:var(--b);text-decoration:underline}.cm-body img{max-width:100%;border-radius:12px}.cm-body h2{font-size:1.1rem!important}
.cm-more-l{color:var(--b);font-weight:600;font-size:.92rem}
.cm-img{display:block;width:100%;max-height:520px;object-fit:cover;border-radius:14px;margin:12px 0 4px;background:var(--bg)}
.cm-linkcard{display:flex;gap:12px;align-items:center;border:1px solid var(--line);border-radius:14px;padding:12px 14px;margin:12px 0 4px;color:var(--muted)}.cm-linkcard:hover{border-color:var(--b)}
.cm-linkcard span{min-width:0}.cm-linkcard b{display:block;color:var(--text);font-size:.92rem}.cm-linkcard small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:.8rem}
.cm-pf{display:flex;gap:4px;margin-top:8px;padding-top:6px;border-top:1px solid #f0f1f4}.cm-pf form{margin:0}
.cm-act{display:inline-flex;align-items:center;gap:7px;padding:8px 12px;border-radius:10px;background:none;border:0;cursor:pointer;color:var(--muted);font-size:.9rem;font-weight:500}.cm-act:hover{background:var(--bg);color:var(--text)}
.cm-act svg path{transition:transform .2s}.cm-act.liked{color:#e11d48}.cm-act:not(.liked) svg path[fill]{fill:none;stroke:currentColor;stroke-width:1.8}.cm-act.pop svg{animation:pop .35s ease}
@keyframes pop{50%{transform:scale(1.35)}}
.cm-av{flex:none;width:42px;height:42px;border-radius:50%;object-fit:cover;display:inline-grid;place-items:center;color:#fff;font-weight:650;font-size:.88rem;background:#94a3b8}
.cm-av.sm{width:34px;height:34px;font-size:.76rem}.cm-av.lg{width:56px;height:56px;font-size:1.05rem}.cm-av.xl{width:88px;height:88px;font-size:1.6rem}
.cm-av.host{background:var(--b);border-radius:12px}.cm-av.host.xl{border-radius:22px}
.cm-compose{display:flex;gap:12px;padding:16px 18px;margin-bottom:16px}.cm-compose-in{flex:1;min-width:0}
.cm-compose input,.cm-compose textarea,.cm-form input,.cm-form textarea,.cm-form select,.cm-search input,.cm-join input,.cm-cform textarea{width:100%;font:inherit;color:inherit;border:1px solid var(--line);border-radius:12px;padding:10px 12px;background:#fff;outline:none}
.cm-compose input:focus,.cm-compose textarea:focus,.cm-form input:focus,.cm-form textarea:focus,.cm-form select:focus,.cm-search input:focus,.cm-join input:focus,.cm-cform textarea:focus{border-color:var(--b);box-shadow:0 0 0 3px var(--bs)}
.cm-compose .cm-ctitle{border:0;padding:6px 2px;font-weight:650;font-size:1.02rem;box-shadow:none!important}
.cm-compose textarea{border:0;padding:4px 2px;resize:none;min-height:46px;box-shadow:none!important}
.cm-clink{margin-top:6px}.cm-cbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;border-top:1px solid #f0f1f4;padding-top:10px;margin-top:6px}
.cm-cbar .cm-btn{margin-left:auto}.cm-sel{font:inherit;font-size:.88rem;border:1px solid var(--line);border-radius:99px;padding:6px 10px;background:#fff;color:#374151;max-width:150px}
.cm-tool{display:inline-flex;align-items:center;gap:6px;padding:7px 10px;border-radius:10px;border:0;background:none;color:var(--muted);cursor:pointer;font-size:.88rem;font-weight:500}.cm-tool:hover{background:var(--bg);color:var(--text)}
.cm-prev{margin-top:8px;position:relative}.cm-prev img{max-width:100%;max-height:260px;border-radius:12px;display:block}.cm-prev button{position:absolute;top:8px;left:8px;background:rgba(17,24,39,.75);color:#fff;border:0;border-radius:8px;padding:4px 10px;cursor:pointer;font-size:.8rem}
.cm-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;background:var(--b);color:#fff;border:0;border-radius:12px;padding:10px 18px;font-weight:600;cursor:pointer;font-size:.95rem;white-space:nowrap}
.cm-btn:hover{filter:brightness(1.07)}.cm-btn.ghost{background:var(--bs);color:var(--b)}.cm-btn.sm{padding:8px 14px;font-size:.88rem}.cm-btn.wide{width:100%;padding:13px}
.cm-empty{padding:40px 24px;text-align:center;color:var(--muted)}.cm-empty b{color:var(--text);font-size:1.05rem}.cm-empty p{margin:6px 0 0}
.cm-welcome{padding:0;overflow:hidden}.cm-cover{display:block;width:100%;height:190px;object-fit:cover}.cm-welcome-in{padding:18px 20px 10px}
.cm-event{display:flex;gap:14px;align-items:center;background:var(--bs);border-radius:14px;padding:12px 14px;margin:12px 0 4px;flex-wrap:wrap}
.cm-ev-main{flex:1;min-width:180px}.cm-ev-when{display:flex;align-items:center;gap:7px;font-weight:600;font-size:.93rem}.cm-ev-when svg{color:var(--b);flex:none}.cm-ev-when a{color:var(--b);text-decoration:underline;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cm-ev-go{color:var(--muted);font-size:.85rem;margin-top:2px}.cm-event form{margin:0}
.cm-backl{display:inline-block;color:var(--muted);font-size:.9rem;margin:0 0 12px}.cm-backl:hover{color:var(--text)}
.cm-comments{background:#fff;border:1px solid var(--line);border-radius:18px;padding:18px 20px}.cm-comments h2{font-size:1rem;margin:0 0 14px}
.cm-cform{display:flex;gap:10px;align-items:flex-start;margin-bottom:16px}.cm-cform textarea{resize:none;border-radius:20px;padding:8px 14px;min-height:40px}.cm-cform .cm-btn{border-radius:99px}
.cm-c{display:flex;gap:10px;margin-bottom:12px}.cm-c-main{flex:1;min-width:0}.cm-bubble{background:#f3f4f6;border-radius:16px;padding:9px 14px;display:inline-block;max-width:100%}
.cm-bubble .cm-body{margin-top:2px}.cm-bubble .cm-body p:last-child{margin-bottom:0!important}.cm-c-meta{display:flex;gap:12px;align-items:center;font-size:.8rem;color:var(--muted);padding:3px 12px 0}.cm-c-meta form{margin:0}
.cm-link{background:none;border:0;padding:0;cursor:pointer;color:var(--muted);font-weight:600;font-size:.8rem}.cm-link:hover{color:var(--text);text-decoration:underline}
.cm-c.reply{margin-top:10px;margin-bottom:0}.cm-replyf{margin-top:10px}.cm-replyf .cm-cform{margin-bottom:0}
.cm-banner{display:flex;align-items:center;gap:10px;background:#111827;color:#fff;border-radius:12px;padding:10px 16px;margin-bottom:14px;font-size:.92rem}.cm-banner form{margin:0 0 0 auto}.cm-banner button{background:none;border:0;color:#a7f3d0;font-weight:700;cursor:pointer}
.cm-banner.warn{background:#fef3c7;color:#92400e}
.cm-ok{background:#ecfdf5;color:#065f46;border-radius:12px;padding:12px 14px}.cm-warn{background:#fef3c7;color:#92400e;border-radius:12px;padding:12px 14px}
.cm-form{display:flex;flex-direction:column;gap:14px}.cm-form h1{font-size:1.35rem;margin:0}.cm-form label,.cm-field{display:flex;flex-direction:column;gap:6px;font-weight:600;font-size:.92rem}.cm-form label small{color:var(--muted);font-weight:400}
.cm-form textarea{resize:vertical}.cm-row{display:flex;align-items:center;gap:16px}.cm-row a{color:var(--muted)}.cm-2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.cm-photo-f{flex-direction:row!important;align-items:center;gap:14px!important}
.cm-check{flex-direction:row!important;align-items:flex-start;gap:12px!important;font-weight:400!important}.cm-check input{width:18px;height:18px;margin-top:2px;accent-color:var(--b)}.cm-check b{display:block;font-weight:600}.cm-check small{color:var(--muted)}
.cm-newev{margin-bottom:16px;padding:16px}.cm-newev>summary{list-style:none;display:inline-flex}.cm-newev>summary::-webkit-details-marker{display:none}.cm-newev[open]>summary{margin-bottom:16px}
.cm-search{margin-bottom:14px}.cm-people{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
.cm-person{display:flex;gap:14px;align-items:center;background:#fff;border:1px solid var(--line);border-radius:16px;padding:14px 16px}.cm-person:hover{border-color:var(--b)}
.cm-person-t{min-width:0;display:flex;flex-direction:column}.cm-person-t small{color:var(--muted);font-size:.82rem}.cm-person-t span{font-size:.86rem;color:#374151;margin-top:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.cm-profile{display:flex;gap:20px;align-items:center}.cm-profile h1{margin:0;font-size:1.4rem}.cm-bio{margin:10px 0 12px}
.cm-pager{display:flex;justify-content:space-between;margin:10px 4px}.cm-pager a{color:var(--b);font-weight:600}
.cm-gate{background:#fff;border:1px solid var(--line);border-radius:22px;overflow:hidden;margin-top:28px;box-shadow:0 8px 30px rgba(17,24,39,.06)}
.cm-gate-cover{display:block;width:100%;height:170px;object-fit:cover}.cm-gate-cover.blank{background:linear-gradient(135deg,var(--b),color-mix(in srgb,BRAND 55%,#fff))}
.cm-gate-in{padding:0 28px 28px;text-align:center}.cm-gate h1{margin:0;font-size:1.55rem}.cm-join{display:flex;flex-direction:column;gap:10px;margin-top:20px}
.cm-up-m{display:none}
@media(max-width:860px){
 .cm-shell{display:block;padding:0 0 80px}
 .cm-side{position:sticky;top:58px;z-index:15;background:rgba(245,246,248,.94);backdrop-filter:blur(8px);border-bottom:1px solid var(--line);margin-bottom:14px}
 .cm-side .cm-up{display:none}
 .cm-nav{flex-direction:row;overflow-x:auto;gap:6px;padding:10px 16px;scrollbar-width:none}.cm-nav::-webkit-scrollbar{display:none}
 .cm-nav-h{display:none}.cm-nav-i{flex:none;background:#fff;border:1px solid var(--line);border-radius:99px;padding:6px 13px;font-size:.88rem}.cm-nav-i svg{width:14px;height:14px}
 .cm-nav-i.on{border-color:transparent}
 .cm-main{padding:0 12px}.cm-up-m{display:block;margin-bottom:14px}.cm-post{padding:16px 16px 8px;border-radius:16px}.cm-post.cm-welcome{padding:0}.cm-welcome-in{padding:14px 16px 6px}.cm-cover{height:140px}.cm-compose{padding:14px}
 .cm-compose>.cm-av{display:none}.cm-2{grid-template-columns:1fr}.cm-profile{flex-direction:column;text-align:center}
}
@media(max-width:420px){.cm-tool span{display:none}.cm-sel{max-width:120px}}`;

module.exports = { registerCommunity };
