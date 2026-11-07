// Rilly's own emails (digest, sign-in links, reminders) in one calm layout:
// logo, a heading, short paragraphs, at most one button. Table-based with
// inline styles so it renders the same in Gmail, Outlook and Apple Mail.
// Email clients don't show SVG, so the logo is the PNG icon.
const TEAL = '#1F7F78', INK = '#14282B', MUTED = '#5B6B70', LINE = '#E3E9E8', BG = '#F4F7F6';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Blocks: { p: text } | { h: text } | { button: [label, url] } | { rows: [[label, value, note?, percent?]] } | { list: [[text, url?]] } | { html } (trusted)
function block(b) {
  if (b.html) return b.html;
  if (b.h) return `<h2 style="margin:26px 0 10px;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:${MUTED};font-weight:700">${esc(b.h)}</h2>`;
  if (b.p) return `<p style="margin:0 0 14px;font-size:16px;line-height:1.55;color:${INK}">${esc(b.p).replace(/\n/g, '<br>')}</p>`;
  if (b.small) return `<p style="margin:0 0 12px;font-size:14px;line-height:1.5;color:${MUTED}">${esc(b.small)}</p>`;
  if (b.button) {
    const [label, url] = b.button;
    return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 18px"><tr><td style="border-radius:10px;background:${TEAL}">
      <a href="${esc(url)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px">${esc(label)}</a></td></tr></table>`;
  }
  if (b.rows) {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 8px">${b.rows.map(([label, value, note, pct]) => `
      <tr><td style="padding:10px 0;border-top:1px solid ${LINE};font-size:15px;color:${INK};font-weight:600;width:34%">${esc(label)}${note ? `<div style="font-weight:400;font-size:12px;color:${TEAL}">${esc(note)}</div>` : ''}</td>
        ${b.rows.some((r) => r.length >= 4) ? `<td style="padding:10px 0;border-top:1px solid ${LINE};width:36%">${pct === null || pct === undefined ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:${LINE};border-radius:99px;height:8px;line-height:8px;font-size:0">&nbsp;</td></tr></table>`
          : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:${LINE};border-radius:99px;height:8px;line-height:8px;font-size:0"><div style="width:${Math.max(3, Math.min(100, pct))}%;background:${TEAL};height:8px;border-radius:99px"></div></td></tr></table>`}</td>` : ''}
        <td align="right" style="padding:10px 0 10px 12px;border-top:1px solid ${LINE};font-size:14px;color:${MUTED}">${esc(value)}</td></tr>`).join('')}</table>`;
  }
  if (b.list) return `<ul style="margin:0 0 14px;padding-left:18px;font-size:15px;line-height:1.6;color:${INK}">${b.list.map(([text, url]) => `<li>${url ? `<a href="${esc(url)}" style="color:${TEAL}">${esc(text)}</a>` : esc(text)}</li>`).join('')}</ul>`;
  return '';
}

function rillyEmail({ base, title, preheader = '', blocks = [], footer = '', brand = null }) {
  const color = /^#[0-9a-f]{6}$/i.test(brand?.color || '') ? brand.color : null;
  const head = brand && (brand.logo || brand.name)
    ? `<tr><td style="padding:0 4px 16px">${brand.logo ? `<img src="${esc(brand.logo)}" height="32" alt="${esc(brand.name || '')}" style="vertical-align:middle;border:0;max-width:200px;height:32px;width:auto">` : ''}${brand.name && !brand.logo ? `<span style="font-size:20px;font-weight:800;letter-spacing:-.02em;color:${INK}">${esc(brand.name)}</span>` : ''}</td></tr>`
    : null;
  const html = rillyEmailInner({ base, title, preheader, blocks, footer, head, signoff: brand?.name ? '' : 'Rilly · Simple Marketing.' });
  return color ? html.split(TEAL).join(color) : html;
}
function rillyEmailInner({ base, title, preheader, blocks, footer, head, signoff }) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="light"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG}"><tr><td align="center" style="padding:28px 14px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
    ${head || `<tr><td style="padding:0 4px 16px"><a href="${esc(base)}/#/" style="text-decoration:none;color:${INK}">
      <img src="${esc(base)}/icons/icon-192.png" width="28" height="28" alt="" style="vertical-align:middle;border-radius:7px;border:0">
      <span style="vertical-align:middle;font-size:20px;font-weight:800;letter-spacing:-.02em;color:${INK};padding-left:6px">rilly</span></a></td></tr>`}
    <tr><td style="background:#ffffff;border:1px solid ${LINE};border-radius:16px;padding:28px 28px 16px">
      <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${INK}">${esc(title)}</h1>
      ${blocks.map(block).join('\n')}
    </td></tr>
    <tr><td style="padding:16px 6px;font-size:12px;line-height:1.5;color:${MUTED}">${esc(footer)}${footer && signoff ? '<br>' : ''}${signoff}</td></tr>
  </table>
</td></tr></table></body></html>`;
}

// The same content as plain text, for the text/plain part of the email.
function rillyText({ title, blocks = [], footer = '' }) {
  const out = [title, ''];
  for (const b of blocks) {
    if (b.h) out.push('', b.h.toUpperCase());
    else if (b.p || b.small) out.push(b.p || b.small, '');
    else if (b.button) out.push(`${b.button[0]}: ${b.button[1]}`, '');
    else if (b.rows) out.push(...b.rows.map(([l, v, n]) => `${l.padEnd(12)} ${v}${n ? `  (${n})` : ''}`), '');
    else if (b.list) out.push(...b.list.map(([t, u]) => `• ${t}${u ? ` ${u}` : ''}`), '');
  }
  if (footer) out.push('', footer);
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { rillyEmail, rillyText, esc };
