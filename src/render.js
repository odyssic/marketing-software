// Turns a step's block list into a standalone HTML page. Used both for the
// public funnel pages and the live preview inside the page builder.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const color = (c, fallback) => (/^#[0-9a-f]{3,8}$/i.test(c || '') ? c : fallback);
const align = (a) => (['left', 'center', 'right'].includes(a) ? a : 'center');
const safeUrl = (u) => (/^(https?:\/\/|\/|#)/i.test(u || '') ? u : '#');
const multiline = (s) => esc(s).replace(/\n/g, '<br>');

function youtubeEmbed(url) {
  const m = String(url || '').match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/);
  return m ? `https://www.youtube-nocookie.com/embed/${m[1]}` : null;
}

function renderBlock(b, ctx) {
  const a = align(b.align);
  switch (b.type) {
    case 'heading': {
      const tag = b.size === 'small' ? 'h3' : b.size === 'medium' ? 'h2' : 'h1';
      return `<${tag} style="text-align:${a}">${multiline(b.text)}</${tag}>`;
    }
    case 'text':
      return `<p class="txt" style="text-align:${a}">${multiline(b.text)}</p>`;
    case 'image':
      return b.url ? `<div style="text-align:${a}"><img src="${esc(safeUrl(b.url))}" alt="${esc(b.alt)}"></div>` : '';
    case 'button': {
      const href = b.url === '#next' || !b.url ? ctx.nextUrl : safeUrl(b.url);
      return `<div style="text-align:${a}"><a class="btn" href="${esc(href)}">${esc(b.label || 'Continue')}</a></div>`;
    }
    case 'video': {
      const src = youtubeEmbed(b.url);
      return src ? `<div class="video"><iframe src="${src}" allowfullscreen loading="lazy" title="Video"></iframe></div>` : '';
    }
    case 'form': {
      const fields = [
        b.collectName ? '<input name="first_name" placeholder="First name" autocomplete="given-name">' : '',
        '<input name="email" type="email" placeholder="Your email address" required autocomplete="email">',
        b.collectPhone ? '<input name="phone" type="tel" placeholder="Phone number" autocomplete="tel">' : '',
      ].join('');
      const disabled = ctx.preview ? ' onsubmit="event.preventDefault();alert(\'Forms are disabled in preview\')"' : '';
      return `<form class="optin" method="post" action="${esc(ctx.formAction)}"${disabled}>
        <input type="hidden" name="block" value="${esc(b.id)}">
        <input name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
        ${fields}<button class="btn" type="submit">${esc(b.buttonLabel || 'Get access')}</button></form>`;
    }
    case 'spacer':
      return `<div style="height:${Math.min(Math.max(Number(b.height) || 40, 0), 400)}px"></div>`;
    case 'divider':
      return '<hr>';
    default:
      return '';
  }
}

function renderPage({ title, blocks, settings = {}, nextUrl = '#', formAction = '#', preview = false }) {
  const bg = color(settings.background, '#ffffff');
  const fg = color(settings.textColor, '#1f2937');
  const accent = color(settings.accent, '#4f46e5');
  const width = Math.min(Math.max(Number(settings.width) || 720, 360), 1200);
  const ctx = { nextUrl, formAction, preview };
  const body = (blocks || []).map((b) => renderBlock(b, ctx)).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(settings.seoTitle || title)}</title>
${settings.seoDescription ? `<meta name="description" content="${esc(settings.seoDescription)}">` : ''}
<style>
*{box-sizing:border-box}body{margin:0;background:${bg};color:${fg};font:17px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:${width}px;margin:0 auto;padding:48px 20px}
h1{font-size:2.4rem;line-height:1.15;margin:.4em 0}h2{font-size:1.8rem;line-height:1.2;margin:.5em 0}h3{font-size:1.3rem;margin:.5em 0}
.txt{margin:.8em 0}img{max-width:100%;height:auto;border-radius:10px}
.btn{display:inline-block;background:${accent};color:#fff;border:0;padding:15px 30px;border-radius:10px;font:600 1.05rem system-ui,sans-serif;text-decoration:none;cursor:pointer}
.btn:hover{filter:brightness(1.1)}
.optin{display:flex;flex-direction:column;gap:10px;max-width:440px;margin:20px auto}
.optin input{padding:14px 16px;border:1px solid #d1d5db;border-radius:10px;font-size:1rem}
.optin .btn{width:100%}.hp{position:absolute;left:-9999px}
.video{position:relative;padding-top:56.25%;margin:20px 0}.video iframe{position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:10px}
hr{border:0;border-top:1px solid rgba(0,0,0,.12);margin:28px 0}
</style></head><body><main>
${body || '<p style="text-align:center;opacity:.5">This page is empty. Add blocks in the editor.</p>'}
</main></body></html>`;
}

module.exports = { renderPage, esc };
