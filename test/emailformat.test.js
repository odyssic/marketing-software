// Email marks: pictures, buttons, headings, dividers, bold and links.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { emailBodyHtml, emailBodyText } = require('../public/js/emailformat.js');

const body = 'Hi Sam,\n\n## Big news\n\n![A red typewriter](https://cdn.x/t.jpg)\n\nWe have **seven** picks. [Read the guide](https://x.com/g) or see https://x.com/a.\n\n---\n\n[Get the guide](https://x.com/buy)';
const link = (u) => `https://t/c?u=${encodeURIComponent(u)}`;

test('HTML: each mark becomes the right element, links go through tracking', () => {
  const h = emailBodyHtml(body, { link, color: '#aa3366' });
  assert.match(h, /<h2[^>]*>Big news<\/h2>/);
  assert.match(h, /<img src="https:\/\/cdn.x\/t.jpg" alt="A red typewriter"/);
  assert.match(h, /<b>seven<\/b>/);
  assert.match(h, /<a href="https:\/\/t\/c\?u=https%3A%2F%2Fx.com%2Fg"[^>]*>Read the guide<\/a>/);
  assert.match(h, /<a href="https:\/\/t\/c\?u=https%3A%2F%2Fx.com%2Fa">https:\/\/x.com\/a<\/a>\./, 'a full stop after a link stays outside it');
  assert.match(h, /<hr/);
  assert.match(h, /background:#aa3366[\s\S]*Get the guide/);
});

test('HTML: nothing written can inject markup', () => {
  const h = emailBodyHtml('<script>alert(1)</script>\n\n![x" onerror="alert(1)](https://cdn.x/a.png)\n\n[<b>hi</b>](https://x.com)');
  assert.doesNotMatch(h, /<script/);
  assert.doesNotMatch(h, /" onerror="/);
  assert.doesNotMatch(h, /<b>hi<\/b>/);
});

test('plain text reads naturally', () => {
  const t = emailBodyText(body);
  assert.match(t, /BIG NEWS/);
  assert.match(t, /\[A red typewriter\]/);
  assert.match(t, /We have seven picks\. Read the guide \(https:\/\/x.com\/g\)/);
  assert.match(t, /Get the guide: https:\/\/x.com\/buy/);
});

test('email look: a letter is just the words; branded adds the logo band, a white card and the name', () => {
  const { emailFrame } = require('../public/js/emailformat.js');
  assert.equal(emailFrame('<p>Hi</p>'), '<p>Hi</p>');
  const b = emailFrame('<p>Hi</p>', { look: 'branded', logo: 'https://x.example/logo.png', name: 'Bloom & Co', color: '#336699' });
  assert.match(b, /background:#336699/);
  assert.match(b, /<img src="https:\/\/x\.example\/logo\.png" alt="Bloom &amp; Co"/);
  assert.match(b, /<p>Hi<\/p>/);
  assert.match(emailFrame('<p>Hi</p>', { look: 'branded', name: 'Nora' }), />Nora<\/span>/, 'the name when there is no logo');
  assert.match(emailFrame('x', { look: 'branded', color: 'red;evil' }), /background:#1F7F78/, 'only real colours');
});
