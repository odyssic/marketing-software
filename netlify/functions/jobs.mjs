// Scheduled Netlify Function: runs the workflow queue every 5 minutes
// (advances waits, sends due emails). Same code path as server.js's timer.
import { createRequire } from 'node:module';

// Loaded with require (not import) so Netlify's bundler traces the app's
// dependencies and ships node_modules alongside it.
const require = createRequire(import.meta.url);
const appModule = require('../../src/app.js');

const app = appModule.createApp();

export default async () => {
  const r = await app.runJobs();
  return new Response(JSON.stringify(r), { headers: { 'content-type': 'application/json' } });
};

export const config = { schedule: '*/5 * * * *' };
