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
// the manual is public: never show a real shop's name in the screenshots
const DEMO_NAME = process.env.DEMO_STORE_NAME ?? 'ร้านค้าสหกรณ์ตัวอย่าง';
const DEMO_NAME_EN = process.env.DEMO_STORE_NAME_EN ?? 'Demo Co-op Store';

/** The header reads the store from the saved session; settings pages read GET /store. */
const maskStoreName = async (ctx) => {
  await ctx.route('**/api/v1/store', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const res = await route.fetch();
    let body = await res.text();
    try {
      const json = JSON.parse(body);
      json.name = DEMO_NAME;
      json.name_en = DEMO_NAME_EN;
      json.address = 'เลขที่ 1 หมู่ 1 ตำบลตัวอย่าง อำเภอตัวอย่าง จังหวัดตัวอย่าง';
      json.phone = '0X-XXX-XXXX';
      body = JSON.stringify(json);
    } catch {
      /* not JSON - pass through */
    }
    await route.fulfill({ status: res.status(), contentType: 'application/json', body });
  });
};

/** Renames the store inside the stored session so the app bar shows the demo name. */
const maskSession = async (page) => {
  await page.evaluate(
    ({ name, nameEn }) => {
      const raw = window.localStorage.getItem('pos.session');
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s.store) {
        s.store.name = name;
        s.store.name_en = nameEn;
      }
      window.localStorage.setItem('pos.session', JSON.stringify(s));
    },
    { name: DEMO_NAME, nameEn: DEMO_NAME_EN },
  );
  await page.reload({ waitUntil: 'networkidle' });
};


/** Opens a shift and, when the day is still empty, posts a few small cash sales so the
 *  dashboard/POS screenshots show realistic numbers instead of zeros. */
const seedDay = async (page, barcodes) => {
  await page.evaluate(async (codes) => {
    const s = JSON.parse(window.localStorage.getItem('pos.session') ?? '{}');
    if (!s.access_token) return;
    const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${s.access_token}` };
    const shift = await fetch('/api/v1/shifts/current', { headers: h }).then((r) => r.json()).catch(() => null);
    if (!shift?.shift) {
      await fetch('/api/v1/shifts/open', { method: 'POST', headers: h, body: JSON.stringify({ terminal: 'POS1', opening_float: 1000 }) });
    }
    const today = new Date().toISOString().slice(0, 10);
    const summary = await fetch(`/api/v1/sales/summary?from=${today}&to=${today}`, { headers: h }).then((r) => r.json()).catch(() => null);
    if (summary && Number(summary.bills) > 0) return;
    const products = [];
    for (const code of codes) {
      const p = await fetch(`/api/v1/products/by-barcode/${code}`, { headers: h }).then((r) => (r.ok ? r.json() : null));
      if (p) products.push(p);
    }
    if (!products.length) return;
    for (const qty of [1, 2, 3]) {
      const lines = products.map((p) => ({ product_id: p.id, qty, discount: 0, is_free: false }));
      const net = products.reduce((sum, p) => sum + Number(p.sell_price) * qty, 0);
      await fetch('/api/v1/sales', {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ lines, payments: [{ method: 'cash', amount: Math.ceil(net / 20) * 20 }] }),
      });
    }
  }, barcodes);
};

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
  await maskStoreName(ctx);
  await seedDay(page, BARCODES);
  await maskSession(page);

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
  await maskStoreName(tablet);
  await maskSession(tp);
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
