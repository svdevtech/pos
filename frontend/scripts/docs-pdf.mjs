/**
 * Renders a Markdown manual to a printable PDF (A4, Thai fonts, screenshots inline).
 *
 *   npm run docs:pdf                        # all manuals -> ../docs/pdf/*.pdf
 *   npm run docs:pdf -- FNB_USER_GUIDE.md   # just one
 *
 * The images are read from docs/images, so run `npm run docs:capture` first if they are stale.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const docs = resolve(here, '../../docs');
const out = resolve(docs, 'pdf');
const FILES = process.argv.slice(2).length ? process.argv.slice(2) : ['USER_GUIDE.md', 'FNB_USER_GUIDE.md'];

const css = `
@page { size: A4; margin: 16mm 14mm 18mm; }
:root { color-scheme: light; }
body { font-family: "Sarabun", "Noto Sans Thai", "Leelawadee UI", system-ui, sans-serif; font-size: 10.5pt; line-height: 1.6; color: #14202c; margin: 0; }
h1 { font-size: 22pt; line-height: 1.15; margin: 0 0 6pt; color: #0d1b2a; }
h2 { font-size: 15pt; margin: 20pt 0 6pt; padding-top: 6pt; border-top: 2px solid #1E88E5; color: #0d1b2a; break-after: avoid; }
h3 { font-size: 12pt; margin: 13pt 0 4pt; color: #1b3a57; break-after: avoid; }
p, li { orphans: 2; widows: 2; }
a { color: #1565c0; text-decoration: none; }
code { background: #eef2f6; padding: 1px 4px; border-radius: 3px; font-size: 9.5pt; }
pre { background: #eef2f6; padding: 8pt 10pt; border-radius: 6px; overflow-x: auto; font-size: 9.5pt; break-inside: avoid; }
table { border-collapse: collapse; width: 100%; margin: 8pt 0; font-size: 9.5pt; break-inside: avoid; }
th, td { border: 1px solid #c9d4de; padding: 4pt 6pt; text-align: left; vertical-align: top; }
th { background: #e8eef4; font-weight: 600; }
tr:nth-child(even) td { background: #f7fafc; }
blockquote { margin: 8pt 0; padding: 6pt 10pt; background: #f2f7fb; border-left: 3px solid #1E88E5; }
blockquote p { margin: 0; }
img { display: block; width: 100%; max-width: 165mm; margin: 8pt auto 4pt; border: 1px solid #c9d4de; border-radius: 4px; break-inside: avoid; }
hr { border: 0; border-top: 1px solid #dde4ea; margin: 14pt 0; }
ol, ul { padding-left: 18pt; }
`;

mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
for (const file of FILES) {
  const md = readFileSync(resolve(docs, file), 'utf8');
  const body = renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, md));
  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8">
<style>${css}</style></head><body>${body}</body></html>`;
  // written inside docs/ and opened as a file: a page built with setContent lives on
  // about:blank, and Chromium refuses to load file:// images from there
  const tmp = resolve(docs, `.pdf-${file}.html`);
  writeFileSync(tmp, html, 'utf8');
  await page.goto(pathToFileURL(tmp).href, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => [...document.images].every((i) => i.complete), null, { timeout: 60_000 });
  const name = `${file.replace(/\.md$/i, '').toLowerCase().replace(/_/g, '-')}.pdf`;
  await page.pdf({
    path: resolve(out, name),
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate:
      '<div style="width:100%;font-size:8pt;color:#6b7785;padding:0 14mm;display:flex;justify-content:space-between;font-family:sans-serif"><span>POS</span><span class="pageNumber"></span></div>',
    margin: { top: '16mm', bottom: '18mm', left: '14mm', right: '14mm' },
  });
  rmSync(tmp, { force: true });
  console.log('wrote', resolve(out, name));
}
await browser.close();
