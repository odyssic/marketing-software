// Lead source tracking. The first time someone lands on a page we remember
// where they came from (ad/campaign tags if the link had them, otherwise the
// site that sent them, otherwise "direct") in a first-party cookie. That
// source is attached to their page views, to them when they sign up, book or
// buy, and to their orders, so every person and sale has a "came from".
const COOKIE = 'rl_src';
const MAX_AGE = 90 * 864e5;

// Known sites by domain, so "l.facebook.com" and "fb" both read as Facebook.
const SITES = [
  [/(^|\.)(facebook|fb)\.(com|me)$|^fb$|^facebook$/, 'Facebook'], [/(^|\.)instagram\.com$|^ig$|^instagram$/, 'Instagram'],
  [/(^|\.)google\./, 'Google'], [/(^|\.)bing\.com$/, 'Bing'], [/(^|\.)duckduckgo\.com$/, 'DuckDuckGo'], [/(^|\.)yahoo\./, 'Yahoo'],
  [/(^|\.)youtube\.com$|^youtu\.be$|^youtube$/, 'YouTube'], [/(^|\.)(t\.co|twitter\.com|x\.com)$|^twitter$|^x$/, 'X (Twitter)'],
  [/(^|\.)linkedin\.com$|^lnkd\.in$|^linkedin$/, 'LinkedIn'], [/(^|\.)pinterest\./, 'Pinterest'], [/(^|\.)tiktok\.com$|^tiktok$/, 'TikTok'],
  [/(^|\.)reddit\.com$/, 'Reddit'], [/(^|\.)threads\.net$/, 'Threads'], [/^(newsletter|email|mailchimp|kit|convertkit)$/, 'Email'],
  [/(^|\.)etsy\.com$/, 'Etsy'], [/^(qr|print|flyer|postcard)$/, 'Print & QR'],
];
const nice = (s) => {
  const v = String(s || '').trim().toLowerCase().replace(/^www\./, '');
  for (const [re, label] of SITES) if (re.test(v)) return label;
  return v ? v.replace(/^./, (c) => c.toUpperCase()).slice(0, 60) : '';
};

// From a landing request: tags in the URL first, then the referring site.
function classify({ query = {}, referrer = '', ownHosts = [] }) {
  const utm = (k) => String(query[`utm_${k}`] || '').trim().slice(0, 80);
  let host = '';
  try { host = referrer ? new URL(referrer).hostname.toLowerCase() : ''; } catch { /* ignore */ }
  if (host && ownHosts.some((h) => host === h || host.endsWith(`.${h}`))) host = ''; // moving between your own pages
  const source = nice(utm('source') || query.ref || query.src) || nice(host) || 'Direct';
  return { source, medium: utm('medium'), campaign: utm('campaign'), referrer: host, at: new Date().toISOString() };
}

const read = (cookies) => {
  try { const v = JSON.parse(Buffer.from(String(cookies[COOKIE] || ''), 'base64url').toString('utf8')); return v && v.source ? v : null; } catch { return null; }
};
// Keeps the first source (first touch); a link with new campaign tags replaces it.
function remember(req, res, cookies, ownHosts) {
  const have = read(cookies);
  const tagged = Object.keys(req.query || {}).some((k) => k.startsWith('utm_') || k === 'ref' || k === 'src');
  if (have && !tagged) return have;
  const now = classify({ query: req.query || {}, referrer: req.get('referer') || '', ownHosts });
  if (have && now.source === 'Direct') return have;
  res.cookie(COOKIE, Buffer.from(JSON.stringify(now)).toString('base64url'), { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: MAX_AGE });
  return now;
}
const label = (a) => (a ? [a.source, a.campaign && `“${a.campaign}”`].filter(Boolean).join(' · ') : '');

module.exports = { classify, read, remember, label, nice, COOKIE };
