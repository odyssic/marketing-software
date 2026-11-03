const { test } = require('node:test');
const assert = require('node:assert/strict');

test('each business sends as itself through the one verified address; replies reach the owner', () => {
  process.env.SMTP_FROM = 'Rilly <hello@mail.getrilly.com>';
  const { senderFor } = require('../src/mailer');
  assert.deepEqual(senderFor({ name: 'Classic "Typewriter"\r\nBcc: x@evil.com', replyTo: 'owner@example.com' }),
    { from: '"Classic TypewriterBcc: x@evil.com" <hello@mail.getrilly.com>', replyTo: 'owner@example.com' });
  assert.deepEqual(senderFor({ name: 'Rilly' }), { from: '"Rilly" <hello@mail.getrilly.com>' });
  assert.deepEqual(senderFor({ name: 'Shop', replyTo: 'HELLO@mail.getrilly.com' }), { from: '"Shop" <hello@mail.getrilly.com>' });
  delete process.env.SMTP_FROM;
  assert.deepEqual(senderFor({ name: 'Shop', replyTo: 'owner@example.com' }), { from: '"Shop" <owner@example.com>' });
});
