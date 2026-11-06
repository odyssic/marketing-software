// Custom HTML, custom CSS and tracking pixels on public pages.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderPage } = require('../src/render');

test('custom HTML runs sealed off from the page', () => {
  const html = renderPage({ title: 'T', blocks: [{ type: 'html', code: '<script>fetch("/api/me")</script><b>Widget</b>' }] });
  const frame = html.match(/<iframe[^>]*data-html[^>]*>/)[0];
  assert.match(frame, /sandbox="allow-scripts/);
  assert.doesNotMatch(frame, /allow-same-origin/, 'never the page’s own origin');
  assert.doesNotMatch(html.replace(/srcdoc="[^"]*"/, ''), /fetch\("\/api\/me"\)/, 'the code only lives inside the frame');
});

test('pixels from IDs, Tag Manager only on the business’s own domain, never in the editor preview', () => {
  const code = { meta: '1234567890', ga4: 'G-ABC1234', tiktok: 'CABCDEFGHIJK12', gtm: 'GTM-ABC123' };
  const onRilly = renderPage({ title: 'T', blocks: [], code });
  assert.match(onRilly, /fbq\('init','1234567890'\)/);
  assert.match(onRilly, /gtag\/js\?id=G-ABC1234/);
  assert.match(onRilly, /ttq\.load\('CABCDEFGHIJK12'\)/);
  assert.doesNotMatch(onRilly, /GTM-ABC123/);
  assert.match(renderPage({ title: 'T', blocks: [], code, ownDomain: true }), /GTM-ABC123/);
  assert.doesNotMatch(renderPage({ title: 'T', blocks: [], code, preview: true }), /fbq|gtag|ttq/);
  // Anything that isn't a well-formed ID is ignored.
  assert.doesNotMatch(renderPage({ title: 'T', blocks: [], code: { meta: "1');alert(1);//" } }), /alert/);
});

test('custom CSS for the business and the page, unable to break out', () => {
  const html = renderPage({ title: 'T', blocks: [], settings: { customCss: 'h1{color:red}</style><script>x</script>' }, code: { css: '@import url(evil.css); p{margin:0}' } });
  assert.match(html, /<style data-site-css> p\{margin:0\}<\/style>/);
  assert.match(html, /<style data-page-css>h1\{color:red\}><script>x<\/script><\/style>/);
  assert.equal((html.match(/<\/style>/g) || []).length, 3, 'no extra closing tags from user CSS');
});
