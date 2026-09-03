/**
 * Captures the screenshots used by docs/USER_GUIDE.md from the running app.
 *
 *   npm run dev                       # in another terminal (or point BASE at a deployed instance)
 *   npm run docs:capture              # writes ../docs/images/*.png
 *   npm run docs:sync                 # copies manuals + images into content/help and public/help
 *
 * Env: BASE (default http://localhost:3010), STORE, USER, PASS.
 * Only screens without personal data are captured (no member lists, no dividend statements).
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../../docs/images');
const BASE = process.env.BASE ?? 'http://localhost:3010';
const STORE = process.env.STORE ?? 'BBR';
const USER = process.env.USER_NAME ?? 'owner';
const PASS = process.env.PASS ?? 'Owner12345';
const BARCODES = ['8851123212021', '8850987101175'];

mkdirSync(outDir, { recursive: true });

const shot = async (page, name, opts = {}) => {
  await page.waitForTimeout(700);
  await page.screenshot({ path: resolve(outDir, `${name}.png`), ...opts });
  console.log('captured', `${name}.png`);
};

const run = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'th-TH' });
  const page = await ctx.newPage();

  // capture the default state (print enabled) but never open a real print dialog
  await ctx.addInitScript(() => {
    window.print = () => {};
  });

  // ---- login ---------------------------------------------------------------
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await shot(page, 'login');

  await page.getByLabel(/รหัสร้าน|Store code/).fill(STORE);
  await page.getByLabel(/ชื่อผู้ใช้|Username/).fill(USER);
  await page.getByLabel(/รหัสผ่าน|Password/).first().fill(PASS);
  await page.getByRole('button', { name: /เข้าสู่ระบบ|Sign in/ }).click();
  await page.waitForURL(/\/(dashboard|pos)/, { timeout: 30_000 });
  await page.waitForLoadState('networkidle');

  // ---- dashboard -----------------------------------------------------------
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
  await shot(page, 'dashboard');

  // ---- POS: empty, with a cart, and the payment dialog ----------------------
  await page.goto(`${BASE}/pos`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await shot(page, 'pos-empty');

  const scan = page.getByPlaceholder(/สแกนบาร์โค้ด|Scan/);
  for (const code of BARCODES) {
    await scan.click();
    await scan.fill(code);
    await scan.press('Enter');
    await page.waitForTimeout(1200);
  }
  await shot(page, 'pos-cart');

  await page.keyboard.press('F9');
  await page.waitForTimeout(1200);
  await shot(page, 'pos-tender');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // ---- catalogue / inventory / reports / manual ----------------------------
  for (const [path, name] of [
    ['/products', 'products'],
    ['/inventory', 'inventory'],
    ['/reports', 'reports'],
    ['/dividends', 'dividends'],
    ['/settings/receipt', 'settings-receipt'],
    ['/help', 'help'],
  ]) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await shot(page, name);
  }

  // ---- tablet portrait (the POS is used on iPads) --------------------------
  const tablet = await browser.newContext({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1, locale: 'th-TH' });
  await tablet.addInitScript(() => {
    window.print = () => {};
  });
  const tp = await tablet.newPage();
  await tp.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await tp.getByLabel(/รหัสร้าน|Store code/).fill(STORE);
  await tp.getByLabel(/ชื่อผู้ใช้|Username/).fill(USER);
  await tp.getByLabel(/รหัสผ่าน|Password/).first().fill(PASS);
  await tp.getByRole('button', { name: /เข้าสู่ระบบ|Sign in/ }).click();
  await tp.waitForURL(/\/(dashboard|pos)/, { timeout: 30_000 });
  await tp.goto(`${BASE}/pos`, { waitUntil: 'networkidle' });
  await tp.waitForTimeout(1200);
  const tscan = tp.getByPlaceholder(/สแกนบาร์โค้ด|Scan/);
  await tscan.click();
  await tscan.fill(BARCODES[0]);
  await tscan.press('Enter');
  await tp.waitForTimeout(1200);
  await tp.keyboard.press('F9');
  await tp.waitForTimeout(1200);
  await shot(tp, 'pos-tender-tablet');

  await browser.close();
  console.log('screenshots written to', outDir);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
