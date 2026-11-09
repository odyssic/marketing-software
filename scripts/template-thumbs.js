// Makes the template pictures shown in the "New page" and "New website" pickers.
// Run after changing a template: node scripts/template-thumbs.js
// Writes public/img/tpl/<key>.jpg (pages) and public/img/tpl/site-<key>.jpg (websites).
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { TEMPLATES } = require('../src/templates');
const { SITE_TEMPLATES } = require('../src/sites');
const { renderPage } = require('../src/render');

const out = path.join(__dirname, '..', 'public', 'img', 'tpl');
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  // Rendered at desktop size, then shrunk: the picker shows the top of the page.
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 0.5 });
  const shoot = async (file, st, site) => {
    await page.setContent(renderPage({ title: st.name, blocks: st.blocks, settings: st.settings, business: 'Your business', site }), { waitUntil: 'load' });
    await page.screenshot({ path: path.join(out, file), type: 'jpeg', quality: 78, clip: { x: 0, y: 0, width: 1280, height: 880 } });
  };
  for (const [key, t] of Object.entries(TEMPLATES)) {
    if (key === 'blank') continue;
    await shoot(`${key}.jpg`, t.steps()[0]);
  }
  for (const [key, t] of Object.entries(SITE_TEMPLATES)) {
    const steps = t.steps();
    const site = { name: 'Your business', home: '#', links: steps.map((s, i) => ({ href: '#', label: s.name, active: i === 0 })) };
    await shoot(`site-${key}.jpg`, steps[0], site);
  }
  await browser.close();
  console.log('Template pictures written to', out);
})();
