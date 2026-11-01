// Runs the Express app as a Netlify Function. The dashboard's static files
// (public/) are served by Netlify's CDN; the paths in `config` come here.
//
// The app listens on a private local port inside the function and each
// request is forwarded to it, so Express runs exactly as it does locally.
import http from 'node:http';
import appModule from '../../src/app.js';

const server = http.createServer(appModule.createApp());
const port = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

export default async (req, context) => {
  const url = new URL(req.url);
  const headers = new Headers(req.headers);
  headers.set('x-forwarded-host', url.host);
  headers.set('x-forwarded-proto', url.protocol.slice(0, -1));
  if (context?.ip) headers.set('x-forwarded-for', context.ip);
  const res = await fetch(`http://127.0.0.1:${port}${url.pathname}${url.search}`, {
    method: req.method,
    headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : await req.arrayBuffer(),
    redirect: 'manual',
  });
  return new Response(res.body, { status: res.status, headers: res.headers });
};

export const config = {
  path: ['/api/*', '/f/*', '/checkout/*', '/stripe/*', '/unsubscribe/*', '/auth/*', '/s/*', '/t/*'],
};
