const { createApp } = require('./src/app');

const port = Number(process.env.PORT) || 3000;
createApp().listen(port, () => {
  console.log(`FunnelFlow running at http://localhost:${port}`);
  if (!process.env.SMTP_HOST) console.log('Email is in dev mode: messages go to the Outbox instead of being delivered. Set SMTP_HOST to send for real.');
});
