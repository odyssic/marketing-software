// Sends email through SMTP when SMTP_HOST is set. Otherwise runs in "dev mode":
// messages are recorded in the outbox (email_log) but not delivered, so the
// whole product works locally without an email provider.
let transport = null;

function getTransport() {
  if (!process.env.SMTP_HOST) return null;
  if (!transport) {
    const nodemailer = require('nodemailer');
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transport;
}

const isLive = () => Boolean(process.env.SMTP_HOST);

async function sendEmail({ from, to, subject, text, html }) {
  const t = getTransport();
  if (!t) return { status: 'logged' };
  await t.sendMail({ from, to, subject, text, ...(html ? { html } : {}) });
  return { status: 'sent' };
}

module.exports = { sendEmail, isLive };
