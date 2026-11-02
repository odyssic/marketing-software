// Scheduled Netlify Function: runs the workflow queue every 5 minutes
// (advances waits, sends due emails). Same code path as server.js's timer.
import appModule from '../../src/app.js';

const app = appModule.createApp();

export default async () => {
  const r = await app.runJobs();
  return new Response(JSON.stringify(r), { headers: { 'content-type': 'application/json' } });
};

export const config = { schedule: '*/5 * * * *' };
