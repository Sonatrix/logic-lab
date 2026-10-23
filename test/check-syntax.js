'use strict';
// Cheap lint: every script must parse. (No dependencies; swap in ESLint if you adopt a toolchain.)
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const files = fs.readdirSync(root).filter(f => f.endsWith('.js'));
let bad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', path.join(root, f)], { encoding: 'utf8' });
  if (r.status !== 0) { bad++; console.error(`FAIL ${f}\n${r.stderr}`); } else console.log(`ok   ${f}`);
}
process.exit(bad ? 1 : 0);
