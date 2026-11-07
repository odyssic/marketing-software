'use strict';

// ---------------- Email formatting ----------------
// Emails are written as plain text with a few simple marks, each on its own line:
//   ![description](https://…image)   a picture
//   [Button words](https://…)        a button
//   ## A heading                     a heading
//   ---                              a divider
// and inside any paragraph: **bold**, [words](https://…) links, and bare https:// links.
// Shared by the server (what's sent) and the browser (the preview), so they match.
(function (root) {
  const escE = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const URL_RE = /https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/;
  const IMG = /^!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)$/;
  const BTN = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/;
  const HEAD = /^#{1,3}\s+(.+)$/;

  // One paragraph's inline marks: links (with tracking) and bold.
  function inline(p, link) {
    const keep = [];
    const hold = (html) => { keep.push(html); return `\u0000${keep.length - 1}\u0000`; };
    let t = p.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, words, url) => hold(`<a href="${escE(link(url))}" style="color:inherit">${escE(words)}</a>`));
    t = t.replace(new RegExp(URL_RE.source, 'g'), (url) => hold(`<a href="${escE(link(url))}">${escE(url)}</a>`));
    t = escE(t).replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
    return t.replace(/\u0000(\d+)\u0000/g, (m, i) => keep[Number(i)]);
  }

  function emailBodyHtml(text, { link = (u) => u, color = '#1b736d' } = {}) {
    const c = /^#[0-9a-f]{6}$/i.test(color) ? color : '#1b736d';
    return String(text || '').split(/\n{2,}/).map((raw) => raw.trim()).filter(Boolean).map((p) => {
      let m;
      if ((m = p.match(IMG))) return `<p style="margin:0 0 16px"><img src="${escE(m[2])}" alt="${escE(m[1])}" style="display:block;max-width:100%;height:auto;border-radius:8px;border:0"></p>`;
      if ((m = p.match(BTN))) {
        return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 18px"><tr><td style="border-radius:8px;background:${c}">
          <a href="${escE(link(m[2]))}" style="display:inline-block;padding:12px 22px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">${escE(m[1])}</a></td></tr></table>`;
      }
      if (/^-{3,}$/.test(p)) return '<hr style="border:0;border-top:1px solid #e5e7eb;margin:22px 0">';
      if (!p.includes('\n') && (m = p.match(HEAD))) return `<h2 style="margin:22px 0 10px;font-size:20px;line-height:1.3">${inline(m[1], link)}</h2>`;
      return `<p style="margin:0 0 14px">${inline(p, link)}</p>`;
    }).join('');
  }

  // The same email as plain text (the text/plain part).
  function emailBodyText(text) {
    return String(text || '').split(/\n{2,}/).map((raw) => {
      const p = raw.trim();
      let m;
      if ((m = p.match(IMG))) return m[1] ? `[${m[1]}]` : '';
      if ((m = p.match(BTN))) return `${m[1]}: ${m[2]}`;
      if (/^-{3,}$/.test(p)) return '----------';
      if ((m = p.match(HEAD))) return m[1].toUpperCase();
      return p.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)').replace(/\*\*([^*\n]+)\*\*/g, '$1');
    }).filter((x) => x !== '').join('\n\n');
  }

  root.emailBodyHtml = emailBodyHtml;
  root.emailBodyText = emailBodyText;
  if (typeof module !== 'undefined') module.exports = { emailBodyHtml, emailBodyText };
})(typeof window !== 'undefined' ? window : globalThis);
