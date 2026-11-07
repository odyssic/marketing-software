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
