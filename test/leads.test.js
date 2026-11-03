const { test } = require('node:test');
const assert = require('node:assert/strict');
const { plainLeads } = require('../src/ai');

test('without the AI, pasted text yields only the emails that are really there', () => {
  const found = plainLeads('Ann Lee <ann@example.com>\nBob Smith, bob@example.org, (512) 555-0100\nnoreply@shop.com\nreach me: carla@example.io\nAnn again ann@example.com');
  assert.deepEqual(found.map((p) => p.email), ['ann@example.com', 'bob@example.org', 'carla@example.io']);
  assert.equal(found[0].first_name, 'Ann'); assert.equal(found[0].last_name, 'Lee');
  assert.equal(found[1].phone, '(512) 555-0100');
  assert.equal(found[2].first_name, ''); // no name invented
});
