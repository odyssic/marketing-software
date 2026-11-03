// The browser scripts share one global scope: a top-level name declared in two
// files stops the second file from loading. Run: node scripts/check-globals.js
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, '..', 'public', 'js');
const seen = new Map();
let bad = 0;
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
  for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/^(?:const|let|class|(?:async\s+)?function)\s+([A-Za-z_$][\w$]*)/gm)) {
    if (seen.has(m[1])) { console.error(`${m[1]} is declared in both ${seen.get(m[1])} and ${f}`); bad++; } else seen.set(m[1], f);
  }
}
if (bad) process.exit(1);
