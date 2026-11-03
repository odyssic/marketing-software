const test = require('node:test');
const assert = require('node:assert');
const { sniff } = require('../src/uploads');

test('photo uploads only accept real pictures', () => {
  assert.strictEqual(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), 'image/jpeg');
  assert.strictEqual(sniff(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), 'image/png');
  assert.strictEqual(sniff(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1')), 'image/webp');
  assert.strictEqual(sniff(Buffer.from('GIF89a', 'latin1')), 'image/gif');
  assert.strictEqual(sniff(Buffer.from('%PDF-1.7\n', 'latin1')), 'application/pdf');
  assert.strictEqual(sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), null);
  assert.strictEqual(sniff(Buffer.from('<html>')), null);
});
