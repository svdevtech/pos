// Copies the Markdown manuals from ../docs into content/help so they ship inside the web image
// (the Docker build context is the frontend folder only). Run: npm run docs:sync
import { copyFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
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
// screenshots referenced as images/<name>.png inside the manuals
const imgSrc = resolve(docs, 'images');
const imgOut = resolve(here, '../public/help/images');
let images = 0;
if (existsSync(imgSrc)) {
  mkdirSync(imgOut, { recursive: true });
  for (const f of readdirSync(imgSrc).filter((f) => /\.(png|jpe?g|webp|svg)$/i.test(f))) {
    copyFileSync(resolve(imgSrc, f), resolve(imgOut, f));
    images++;
  }
}
// the legacy extractor is offered for download on the "data & backups" page, so it must ship
// inside the web image too
const extractor = resolve(here, '../../tools/legacy-extract/extract.ps1');
let tools = 0;
if (existsSync(extractor)) {
  const toolOut = resolve(here, '../public/legacy');
  mkdirSync(toolOut, { recursive: true });
  copyFileSync(extractor, resolve(toolOut, 'extract.ps1'));
  tools++;
}
console.log(`synced ${copied} document(s), ${images} image(s), ${tools} tool(s)`);
