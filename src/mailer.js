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

// Who an email is from. Everything goes out through the one verified sending
// address (SMTP_FROM, e.g. hello@mail.getrilly.com) so it passes SPF/DKIM,
// but shows the business's own name, and replies go to the business owner.
const addressOf = (s) => (String(s || '').match(/<([^>]+)>/)?.[1] || String(s || '')).trim();
const quoted = (name) => `"${String(name || '').replace(/["\\\r\n]/g, '').slice(0, 80)}"`;
function senderFor({ name, replyTo } = {}) {
  const verified = addressOf(process.env.SMTP_FROM);
  if (!verified) return { from: replyTo ? `${quoted(name)} <${replyTo}>` : 'no-reply@localhost' };
  const out = { from: name ? `${quoted(name)} <${verified}>` : process.env.SMTP_FROM };
  if (replyTo && replyTo.toLowerCase() !== verified.toLowerCase()) out.replyTo = replyTo;
  return out;
}

async function sendEmail({ from, replyTo, to, subject, text, html, headers, attachments }) {
  const t = getTransport();
  if (!t) return { status: 'logged' };
  await t.sendMail({ from, to, subject, text, ...(replyTo ? { replyTo } : {}), ...(html ? { html } : {}), ...(headers ? { headers } : {}), ...(attachments ? { attachments } : {}) });
  return { status: 'sent' };
}

module.exports = { sendEmail, senderFor, isLive };
