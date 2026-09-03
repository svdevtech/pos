#!/usr/bin/env node
// Verifies that every messages file has exactly the same set of keys.
// Exits 1 when any key is missing or extra relative to the default locale (th).
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'i18n', 'messages');
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();

function flatten(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out.push(key);
  }
  return out;
}

const sets = new Map();
for (const f of files) {
  const json = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  sets.set(basename(f, '.json'), new Set(flatten(json)));
}

const base = sets.get('th') ?? sets.values().next().value;
const baseName = sets.has('th') ? 'th' : files[0];
let failed = false;

for (const [name, set] of sets) {
  if (name === baseName) continue;
  const missing = [...base].filter((k) => !set.has(k));
  const extra = [...set].filter((k) => !base.has(k));
  if (missing.length || extra.length) {
    failed = true;
    console.error(`i18n parity failed for "${name}" vs "${baseName}":`);
    for (const k of missing) console.error(`  missing: ${k}`);
    for (const k of extra) console.error(`  extra:   ${k}`);
  }
}

if (failed) process.exit(1);
console.log(`i18n ok: ${files.join(', ')} (${base.size} keys each)`);
