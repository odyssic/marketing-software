'use strict';

// Email signatures: a few polished layouts built from simple details (name,
// title, phone, website, photo or logo, social links). The same code renders
// the editor preview in the browser and the real email on the server, so what
// you see is what they get. Email-safe HTML: tables and inline styles only.
const SIG_STYLES = [
  ['classic', 'Classic'], ['photo', 'With photo'], ['card', 'Card'], ['minimal', 'Minimal'],
];
const SIG_SOCIAL = [['website', 'Website'], ['instagram', 'Instagram'], ['facebook', 'Facebook'], ['linkedin', 'LinkedIn'], ['tiktok', 'TikTok'], ['youtube', 'YouTube'], ['x', 'X']];

function sigEsc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
// Only http(s) links and images; anything else is dropped.
function sigUrl(u, base = '') {
  const s = String(u || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('/')) return `${base}${s}`;
  if (/^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(s)) return `https://${s}`; // "mysite.com"
  return '';
}
function sigLinks(sig, base) {
  return SIG_SOCIAL.map(([k, label]) => [label, sigUrl(sig[k], base)]).filter(([, u]) => u);
}

// The HTML signature. `base` turns uploaded-photo paths (/u/...) into full links.
function signatureHtml(sig, base = '') {
  if (!sig) return '';
  const c = /^#[0-9a-f]{6}$/i.test(sig.color || '') ? sig.color : '#1b736d';
  const name = sigEsc(sig.name), title = sigEsc([sig.title, sig.company].filter(Boolean).join(', '));
  const phone = sig.phone ? `<a href="tel:${sigEsc(String(sig.phone).replace(/[^+\d]/g, ''))}" style="color:#4b5563;text-decoration:none;white-space:nowrap">${sigEsc(sig.phone)}</a>` : '';
  const email = sig.email ? `<a href="mailto:${sigEsc(sig.email)}" style="color:#4b5563;text-decoration:none;white-space:nowrap">${sigEsc(sig.email)}</a>` : '';
  const links = sigLinks(sig, base).map(([l, u]) => `<a href="${sigEsc(u)}" style="color:${c};text-decoration:none;font-weight:600">${l === 'Website' ? sigEsc(u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')) : l}</a>`).join('<span style="color:#cbd5e1">&nbsp;·&nbsp;</span>');
  const contact = [phone, email].filter(Boolean).join('<span style="color:#cbd5e1">&nbsp;·&nbsp;</span>');
  const img = sigUrl(sig.photo, base);
  const font = 'font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;';
  const line = (html, extra = '') => (html ? `<div style="font-size:13px;line-height:1.5;color:#4b5563;${extra}">${html}</div>` : '');
  const quote = sig.tagline ? line(`<i>${sigEsc(sig.tagline)}</i>`, 'margin-top:6px;color:#6b7280') : '';
  switch (sig.style) {
    case 'minimal':
      return `<div style="${font}margin-top:8px"><div style="font-size:14px;color:#111827">— <b>${name}</b>${title ? `<span style="color:#6b7280">, ${title}</span>` : ''}</div>${line([contact, links].filter(Boolean).join('<span style="color:#cbd5e1">&nbsp;·&nbsp;</span>'))}</div>`;
    case 'photo':
      return `<table role="presentation" cellpadding="0" cellspacing="0" style="${font}margin-top:8px;border-collapse:collapse"><tr>
        ${img ? `<td style="vertical-align:top;padding-right:14px"><img src="${sigEsc(img)}" width="72" height="72" alt="${name}" style="display:block;width:72px;height:72px;border-radius:50%;object-fit:cover;border:2px solid ${c}"></td>` : ''}
        <td style="vertical-align:top;border-left:3px solid ${c};padding-left:14px">
          <div style="font-size:16px;font-weight:700;color:#111827">${name}</div>${title ? line(title) : ''}${line(contact, 'margin-top:4px')}${line(links, 'margin-top:2px')}${quote}</td></tr></table>`;
    case 'card':
      return `<table role="presentation" cellpadding="0" cellspacing="0" style="${font}margin-top:8px;border-collapse:separate;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden"><tr>
        <td style="background:${c};width:6px;font-size:0">&nbsp;</td>
        <td style="padding:14px 16px">
          ${img ? `<img src="${sigEsc(img)}" height="40" alt="" style="display:block;height:40px;max-width:160px;margin-bottom:8px">` : ''}
          <div style="font-size:16px;font-weight:700;color:#111827">${name}</div>${title ? line(title, `color:${c};font-weight:600`) : ''}${line(contact, 'margin-top:6px')}${line(links, 'margin-top:2px')}${quote}</td></tr></table>`;
    default: // classic
      return `<div style="${font}margin-top:8px"><div style="font-size:16px;font-weight:700;color:#111827">${name}</div>${title ? line(title) : ''}
        <div style="height:2px;width:48px;background:${c};margin:8px 0;font-size:0">&nbsp;</div>${line(contact)}${line(links, 'margin-top:2px')}${quote}</div>`;
  }
}

// The plain-text version, for email apps that don't show HTML.
function signatureText(sig, base = '') {
  if (!sig) return '';
  return ['—', sig.name, [sig.title, sig.company].filter(Boolean).join(', '), [sig.phone, sig.email].filter(Boolean).join(' · '),
    ...sigLinks(sig, base).map(([l, u]) => (l === 'Website' ? u : `${l}: ${u}`)), sig.tagline].filter(Boolean).join('\n');
}

// {{signature}} uses the default; {{signature:ID}} a particular one.
const SIG_TOKEN = /\{\{\s*signature(?::([\w-]+))?\s*\}\}/g;
function pickSignature(store, id) {
  const list = (store && store.list) || [];
  return list.find((s) => s.id === id) || list.find((s) => s.id === (store && store.default)) || list[0] || null;
}

if (typeof module !== 'undefined') module.exports = { signatureHtml, signatureText, pickSignature, SIG_TOKEN, SIG_STYLES, SIG_SOCIAL, sigUrl };
