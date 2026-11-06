// Every browser script must parse: one typo blanks the whole app.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('every script in public/js parses', () => {
  const dir = path.join(__dirname, '..', 'public', 'js');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    assert.doesNotThrow(() => new vm.Script(fs.readFileSync(path.join(dir, f), 'utf8'), { filename: f }), `${f} has a syntax error`);
  }
});
