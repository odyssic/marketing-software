// Page colours from a business's brand: one colour, or the two main colours of
// its logo. Buttons and links in the accent (darkened until white text reads on
// it), a deeper band for the top of the page, a near-white background with a hint
// of the brand, and near-black text. Kept in step with paletteFrom in public/js/editor.js.
'use strict';

const HEX = /^#[0-9a-f]{6}$/i;
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hexOf = (c) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const onWhite = (c) => 1.05 / (lum(c) + 0.05);
const readable = (c) => { for (let i = 0; i < 20 && onWhite(c) < 4.6; i++) c = mix(c, [0, 0, 0], 0.08); return c; };

// With two colours, the darker one becomes the band and the other the buttons
// (a navy and orange logo: a navy top, orange buttons).
function paletteFrom(hex, hex2 = '', name = 'My brand') {
  let a = rgb(HEX.test(hex || '') ? hex : '#1b736d');
  let band;
  if (HEX.test(hex2 || '') && hex2.toLowerCase() !== String(hex).toLowerCase()) {
    let b = rgb(hex2);
    if (lum(b) > lum(a)) [a, b] = [b, a];
    band = readable(b);
  }
  const accent = readable(a);
  band ||= mix(accent, [0, 0, 0], 0.22);
  return { name, bg: hexOf(mix(accent, [255, 255, 255], 0.97)), text: hexOf(mix(band, [8, 10, 12], 0.88)), accent: hexOf(accent), band: hexOf(band) };
}

// The palette on one page's settings and its coloured blocks.
function applyPalette(pal, settings, blocks) {
  Object.assign(settings, { background: pal.bg, textColor: pal.text, accent: pal.accent, palette: pal.name });
  for (const b of blocks || []) {
    if (b.type === 'hero') Object.assign(b, { background: pal.band, textColor: '#ffffff' });
    if (b.type === 'pricing' && b.buttonColor) b.buttonColor = pal.accent;
  }
}

module.exports = { paletteFrom, applyPalette, HEX };
