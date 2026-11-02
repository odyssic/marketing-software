const { createApp } = require('./src/app');
const { NAME } = require('./src/brand');

const port = Number(process.env.PORT) || 3000;
const app = createApp();
app.listen(port, () => {
  console.log(`${NAME} running at http://localhost:${port}`);
  if (!process.env.SMTP_HOST) console.log('Email is in dev mode: messages go to the Outbox instead of being delivered. Set SMTP_HOST to send for real.');
});

// Workflow runner: advances waits, sends due emails. Every minute.
setInterval(() => app.runJobs().catch((e) => console.error('jobs:', e.message)), 60e3).unref();
