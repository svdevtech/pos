// Copies the Markdown manuals from ../docs into content/help so they ship inside the web image
// (the Docker build context is the frontend folder only). Run: npm run docs:sync
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const docs = resolve(here, '../../docs');
const out = resolve(here, '../content/help');
const FILES = [
  ['USER_GUIDE.md', 'user-guide.md'],
  ['DIVIDEND_MATH.md', 'dividend-math.md'],
];

mkdirSync(out, { recursive: true });
let copied = 0;
for (const [src, dst] of FILES) {
  const from = resolve(docs, src);
  if (!existsSync(from)) {
    console.error(`missing ${from}`);
    process.exitCode = 1;
    continue;
  }
  copyFileSync(from, resolve(out, dst));
  console.log(`${src} -> content/help/${dst}`);
  copied++;
}
console.log(`synced ${copied} document(s)`);
