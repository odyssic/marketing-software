// Funnels on their own domains (e.g. shop.yourbusiness.com, added in Netlify as
// a domain alias). Requests to any host that isn't the app's own are handed to
// the app as /d/<host>/<path>, which serves that funnel's pages.
export default async (request, context) => {
  const url = new URL(request.url);
  const host = url.hostname.toLowerCase();
  const own = (Netlify.env.get('APP_HOSTS') || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  const publicUrl = Netlify.env.get('PUBLIC_URL');
  if (publicUrl) own.push(new URL(publicUrl).hostname.toLowerCase());
  if (host.endsWith('.netlify.app') || host === 'localhost' || own.includes(host)) return; // the app itself
  return context.rewrite(`/d/${host}${url.pathname}${url.search}`);
};

export const config = {
  path: '/*',
  // These already go to the app on every host (tracking, checkout, short links, pages by slug).
  excludedPath: ['/api/*', '/f/*', '/t/*', '/s/*', '/checkout/*', '/stripe/*', '/unsubscribe/*', '/auth/*', '/d/*', '/u/*', '/hooks/*', '/b/*', '/pay/*', '/m/*', '/dl/*', '/legal/*', '/blog/*', '/my/*', '/rv/*', '/chat/*', '/cal/*'],
};
