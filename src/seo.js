// Search and AI-search basics for every page: a title and description written
// for people searching (by AI when it's connected, from the page's own words
// when it isn't), a clean address, and the structured data, sitemap, robots and
// llms.txt files that search engines and AI assistants read.
const { z } = require('zod');
const ai = require('./ai');

const STOP = new Set('a an and are as at be by for from get how i in is it its my of on or our the this to we what with you your yours free new now'.split(' '));
const clean = (s) => String(s || '').replace(/\{\{[^}]*\}\}/g, '').replace(/\[[^\]]*\]/g, '').replace(/[*#>_`]/g, '').replace(/\s+/g, ' ').trim();
const cut = (s, n) => { const t = clean(s); if (t.length <= n) return t; const c = t.slice(0, n - 1); return `${c.slice(0, Math.max(c.lastIndexOf(' '), n - 20)).replace(/[,;:.\s-]+$/, '')}…`; };
const slugify = (s) => clean(s).toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w)).slice(0, 5).join('-').slice(0, 60);

// The words on a page, most important first.
function pageWords(blocks = []) {
  const head = [], body = [];
  for (const b of blocks) {
    if (b.type === 'hero') { head.push(b.text); body.push(b.subtext); }
    else if (b.type === 'heading') head.push(b.text);
    else if (b.type === 'text') body.push(b.text);
    else if (b.type === 'bullets') body.push(b.title, b.items);
    else if (b.type === 'cards') body.push(String(b.items || '').replace(/\|/g, ':'));
    else if (b.type === 'offer') body.push(b.title, String(b.items || '').replace(/\|[^\n]*/g, ''));
    else if (b.type === 'pricing') body.push(b.featuresTitle, b.features);
  }
  // Sentences joined without doubled full stops.
  const join = (parts) => parts.map(clean).filter(Boolean).map((t) => (/[.!?…:]$/.test(t) ? t : `${t}.`)).join(' ');
  return { headline: clean(head.find(Boolean) || ''), text: join(body), all: join([...head, ...body]) };
}

// Without AI: a title from the headline and business, a description from the first sentences.
function ruleBased({ business, pageName, blocks, isHome }) {
  const w = pageWords(blocks);
  const main = w.headline || pageName;
  // The business name goes on the end when it fits; a long headline stands alone.
  const withName = `${main} | ${business}`;
  const title = isHome ? cut(`${business}: ${main}`, 60) : main.toLowerCase().includes(business.toLowerCase()) || withName.length > 60 ? cut(main, 60) : withName;
  const desc = w.text || w.headline;
  const description = cut(desc.length < 70 ? `${desc}${desc ? ' ' : ''}${business}.` : desc, 158);
  return { title, description, slug: slugify(isHome ? 'home' : main) || slugify(pageName) || 'page', summary: cut(desc, 220) };
}

const SeoDraft = z.object({ title: z.string(), description: z.string(), slug: z.string(), summary: z.string() });

async function suggest({ account, business, pageName, blocks, isHome, kind }) {
  const base = ruleBased({ business, pageName, blocks, isHome });
  if (!ai.isLive()) return { ...base, by: 'rules' };
  const w = pageWords(blocks);
  try {
    const out = await ai.structured({
      account, effort: 'low',
      system: 'You write search metadata for small-business web pages so they rank in Google and are quoted accurately by AI assistants (ChatGPT, Perplexity, Google AI Overviews). Be specific and factual, use only what the page says, name the business, use the words a customer would search for, no hype, no clickbait, no emoji, no quotation marks around the whole thing.',
      prompt: `Business: ${business}\nPage name: ${pageName}\nKind: ${isHome ? 'home page' : kind === 'website' ? 'website page' : 'landing page'}\n\n<page>\n${w.all.slice(0, 4000)}\n</page>\n\nReturn: title (50-60 characters, the main thing first, the business name at the end unless it's the home page), description (140-158 characters, what the visitor gets and who it's for, ending with a reason to click), slug (2-5 lowercase words with hyphens, the main search words, no stop words${isHome ? '; for the home page use "home"' : ''}), summary (one or two plain sentences an AI assistant could quote to answer "what is this page about").`,
      schema: SeoDraft,
    });
    return { title: cut(out.title, 62), description: cut(out.description, 160), slug: slugify(out.slug) || base.slug, summary: cut(out.summary, 300), by: 'ai' };
  } catch { return { ...base, by: 'rules' }; }
}

// Structured data (JSON-LD) for a page: the page itself, and the business behind it.
function jsonLd({ business, url, title, description, blocks, image, logo }) {
  const info = blocks.find((b) => b.type === 'info') || {};
  const local = info.address || info.phone;
  const org = { '@type': local ? 'LocalBusiness' : 'Organization', name: business, url: url ? new URL(url).origin : undefined,
    ...(logo ? { logo } : {}), ...(info.address ? { address: info.address } : {}), ...(info.phone ? { telephone: info.phone } : {}),
    ...(info.email ? { email: info.email } : {}), ...(info.hours ? { openingHours: info.hours } : {}) };
  const page = { '@type': 'WebPage', name: title, description, ...(url ? { url } : {}), ...(image ? { primaryImageOfPage: image } : {}), publisher: { '@type': org['@type'], name: business } };
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': [page, org] }).replace(/</g, '\\u003c');
}

// The first picture on a page, for social previews.
const firstImage = (blocks) => (blocks.find((b) => b.type === 'image' && /^https?:\/\//.test(b.url || ''))?.url) || (blocks.find((b) => b.type === 'hero' && /^https?:\/\//.test(b.image || ''))?.image) || '';

module.exports = { suggest, ruleBased, pageWords, slugify, jsonLd, firstImage, cut };
