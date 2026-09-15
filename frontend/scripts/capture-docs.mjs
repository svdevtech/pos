/**
 * Captures the screenshots used by docs/USER_GUIDE.md from the running app.
 *
 *   npm run dev                       # in another terminal (or point BASE at a deployed instance)
 *   npm run docs:capture              # writes ../docs/images/*.png
 *   npm run docs:sync                 # copies manuals + images into content/help and public/help
 *
 * Env: BASE (default http://localhost:3010), STORE, USER, PASS, FNB_STORE (default DEMO).
 * Only screens without personal data are captured (no member lists, no dividend statements),
 * and every shop name is replaced by a demo one — the manuals are public.
 */
import { chromium, devices } from 'playwright';
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
// the restaurant / café side (docs/FNB_USER_GUIDE.md)
const FNB_STORE = process.env.FNB_STORE ?? 'DEMO';
const FNB_NAME = process.env.FNB_STORE_NAME ?? 'ร้านอาหาร·กาแฟตัวอย่าง';
const FNB_NAME_EN = process.env.FNB_STORE_NAME_EN ?? 'Demo Restaurant & Café';

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

/**
 * Puts the café into a known state before the screenshots: one table mid-service, one table
 * just seated, one table whose food is ready, a couple of counter orders (one of them paid and
 * waiting at the hatch, so the queue screen shows both columns), a booking, someone on the
 * waitlist and a happy hour that is running right now. Everything already on the floor is
 * voided first, so a re-run always produces the same picture.
 */
const seedFnb = async (page) => {
  const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return page.evaluate(
    async ({ from, to }) => {
      const s = JSON.parse(window.localStorage.getItem('pos.session') ?? '{}');
      if (!s.access_token) return 'no session';
      const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${s.access_token}` };
      const api = async (m, p, body) => {
        const r = await fetch(`/api/v1${p}`, { method: m, headers: h, body: body ? JSON.stringify(body) : undefined });
        const t = await r.text();
        return t ? JSON.parse(t) : null;
      };
      // a clean floor
      for (const o of await api('GET', '/fnb/orders?open=1')) await api('POST', `/fnb/orders/${o.id}/status`, { status: 'void' });

      const menu = await api('GET', '/fnb/menu');
      const byName = (n) => menu.items.find((i) => i.name.includes(n));
      const latte = byName('ลาเต้');
      const padthai = byName('ผัดไทย');
      const fries = byName('เฟรนช์ฟรายส์');
      const kaprao = byName('กะเพรา');
      const cake = byName('เค้ก');
      const shot = menu.modifier_groups.flatMap((g) => g.modifiers).find((m) => m.name.includes('ช็อต'));
      const oat = menu.modifier_groups.flatMap((g) => g.modifiers).find((m) => m.name.includes('โอ๊ต'));
      const groupById = Object.fromEntries(menu.modifier_groups.map((g) => [g.id, g]));
      // a group that insists on a choice (size, hot/iced) gets its default, like the till would
      const line = (item, qty = 1, mods = [], note) => {
        const picked = mods.filter(Boolean);
        for (const gid of item.modifier_group_ids ?? []) {
          const g = groupById[gid];
          if (!g || g.min_select < 1 || picked.some((m) => m.group_id === gid)) continue;
          const def = g.modifiers.find((m) => m.is_default) ?? g.modifiers[0];
          if (def) picked.push(def);
        }
        return { menu_item_id: item.id, qty, modifier_ids: picked.map((m) => m.id), note };
      };
      const must = (r, what) => {
        if (!r?.items) throw new Error(`${what}: ${JSON.stringify(r).slice(0, 200)}`);
        return r;
      };

      // table 5: a full table in service
      must(await api('POST', '/fnb/orders', { channel: 'dine_in', table_code: '5', guests: 4, lines: [line(latte, 2, [oat]), line(padthai), line(kaprao, 1, [], 'เผ็ดมาก')] }), 'table 5');
      // table 2: food is ready on the pass
      const t2 = must(await api('POST', '/fnb/orders', { channel: 'dine_in', table_code: '2', guests: 2, lines: [line(fries), line(cake)] }), 'table 2');
      for (const it of t2.items) await api('POST', `/fnb/orders/${t2.id}/items/${it.id}/status`, { status: 'ready' });
      // table 7: seated, nothing ordered yet
      await api('POST', '/fnb/orders', { channel: 'dine_in', table_code: '7', guests: 2, open_table: true, lines: [] });
      // the counter: one order still to pay, one paid and being made, one ready to collect
      must(await api('POST', '/fnb/orders', { channel: 'takeaway', lines: [line(latte, 1, [shot]), line(cake)] }), 'takeaway');
      const q1 = must(await api('POST', '/fnb/orders', { channel: 'counter', lines: [line(padthai), line(fries)] }), 'queue 1');
      await api('POST', '/fnb/checkout', { order_ids: [q1.id], payments: [{ method: 'cash', amount: 200 }] });
      const q2 = must(await api('POST', '/fnb/orders', { channel: 'counter', lines: [line(latte, 2)] }), 'queue 2');
      await api('POST', '/fnb/checkout', { order_ids: [q2.id], payments: [{ method: 'qr', amount: 110 }] });
      for (const it of q2.items) await api('POST', `/fnb/orders/${q2.id}/items/${it.id}/status`, { status: 'ready' });

      // the book: one reservation tonight, one party waiting
      const today = new Date();
      const at = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 18, 30);
      const book = await api('GET', '/fnb/reservations');
      if (book.filter((r) => r.status === 'booked' || r.status === 'waiting').length < 2) {
        await api('PUT', '/fnb/reservations', { kind: 'reservation', name: 'คุณสมชาย (ตัวอย่าง)', phone: '08X-XXX-XXXX', party_size: 4, at: at.toISOString(), note: 'ริมหน้าต่าง' });
        await api('PUT', '/fnb/reservations', { kind: 'waitlist', name: 'ลูกค้า walk-in', party_size: 2, at: new Date().toISOString() });
      }

      // a happy hour that is on right now, so the tiles and the bill show it
      const promos = await api('GET', '/fnb/menu/promos?all=1');
      const coffee = menu.categories.find((c) => c.name.includes('กาแฟ'));
      await api('PUT', '/fnb/menu/promos', {
        id: promos.find((p) => p.name === 'Happy hour')?.id,
        name: 'Happy hour', kind: 'percent', value: '20', category_id: coffee.id,
        days: [0, 1, 2, 3, 4, 5, 6], start_time: from, end_time: to, is_active: true, sort: 0,
      });
      return 'ok';
    },
    { from: hhmm(new Date(Date.now() - 3600e3)), to: hhmm(new Date(Date.now() + 3600e3)) },
  );
};

/** Screenshots what the app sent to the printer instead of printing it (see printHtml). */
const shotPrint = async (ctx, page, name, trigger, width = 300) => {
  await page.evaluate(() => {
    window.__docPrints = [];
    const orig = document.createElement.bind(document);
    document.createElement = (tag, ...rest) => {
      const el = orig(tag, ...rest);
      if (tag === 'iframe') window.__docPrints.push(el);
      return el;
    };
  });
  await trigger();
  await page.waitForFunction(() => window.__docPrints?.some((f) => f.contentDocument?.body?.innerHTML), null, { timeout: 10_000 });
  const html = await page.evaluate(() => {
    const f = window.__docPrints.find((x) => x.contentDocument?.body?.innerHTML);
    return f.contentDocument.documentElement.outerHTML;
  });
  const slip = await ctx.newPage();
  await slip.setViewportSize({ width, height: 460 });
  await slip.setContent(html.replace('</head>', '<style>body{background:#fff;margin:0}.rc{margin:0 auto}</style></head>'));
  await slip.waitForTimeout(400);
  await slip.screenshot({ path: resolve(outDir, `${name}.png`), fullPage: true });
  await slip.close();
  console.log('captured', `${name}.png`);
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

  // ======================================================================
  // restaurant / café (docs/FNB_USER_GUIDE.md)
  // ======================================================================
  const fnb = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'th-TH' });
  await fnb.addInitScript(() => {
    window.print = () => {};
  });
  await fnb.route('**/api/v1/store', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const res = await route.fetch();
    let body = await res.text();
    try {
      const json = JSON.parse(body);
      json.name = FNB_NAME;
      json.name_en = FNB_NAME_EN;
      body = JSON.stringify(json);
    } catch {
      /* not JSON */
    }
    await route.fulfill({ status: res.status(), contentType: 'application/json', body });
  });
  const fp = await fnb.newPage();
  await fp.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await fp.getByLabel(/รหัสร้าน|Store code/).fill(FNB_STORE);
  await fp.getByLabel(/ชื่อผู้ใช้|Username/).fill(USER);
  await fp.getByLabel(/รหัสผ่าน|Password/).first().fill(PASS);
  await fp.getByRole('button', { name: /เข้าสู่ระบบ|Sign in/ }).click();
  await fp.waitForURL(/\/(dashboard|pos)/, { timeout: 30_000 });
  await fp.waitForLoadState('networkidle');
  console.log('fnb seed:', await seedFnb(fp));
  await fp.evaluate(
    ({ name, nameEn }) => {
      const raw = window.localStorage.getItem('pos.session');
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s.store) {
        s.store.name = name;
        s.store.name_en = nameEn;
      }
      window.localStorage.setItem('pos.session', JSON.stringify(s));
      // this device prints the tickets of every station that wants paper
      window.localStorage.removeItem('fnb.printStations');
    },
    { name: FNB_NAME, nameEn: FNB_NAME_EN },
  );

  // ---- counter -------------------------------------------------------------
  await fp.goto(`${BASE}/fnb/order`, { waitUntil: 'domcontentloaded' });
  await fp.waitForSelector('[data-testid="channel"]');
  await fp.waitForTimeout(1500);
  await shot(fp, 'fnb-order');

  // an item with options opens the dialog
  const withOptions = fp.locator('[data-testid^="tile-"]').first();
  await withOptions.click();
  await fp.waitForSelector('[role="dialog"]');
  await fp.waitForTimeout(900);
  await shot(fp, 'fnb-order-options');
  await fp.getByRole('button', { name: /เพิ่ม|Add/ }).last().click();
  await fp.waitForTimeout(800);
  await shot(fp, 'fnb-order-cart');
  // and the payment screen an order goes through
  await fp.getByTestId('send-order').click();
  await fp.waitForSelector('[data-testid="tender-net"]', { timeout: 20_000 });
  await fp.waitForTimeout(900);
  await shot(fp, 'fnb-tender');
  await fp.keyboard.press('Escape');
  await fp.waitForTimeout(600);

  // ---- kitchen -------------------------------------------------------------
  await fp.goto(`${BASE}/fnb/kitchen`, { waitUntil: 'domcontentloaded' });
  await fp.waitForSelector('[data-testid="ticket"]', { timeout: 20_000 });
  await fp.waitForTimeout(1200);
  await shot(fp, 'fnb-kitchen');
  await fp.getByTestId('kds-printer').click();
  await fp.waitForSelector('[data-testid^="print-station-"]');
  await fp.waitForTimeout(700);
  await shot(fp, 'fnb-kitchen-printer');
  await fp.getByRole('button', { name: /เสร็จ|Done/ }).last().click();
  await fp.waitForTimeout(500);
  // the paper ticket itself, straight from the print job
  await shotPrint(fnb, fp, 'fnb-kitchen-ticket', async () => {
    await fp.locator('[data-testid="ticket-print"]').first().click();
  });

  // ---- floor ---------------------------------------------------------------
  await fp.goto(`${BASE}/fnb/floor`, { waitUntil: 'domcontentloaded' });
  await fp.waitForSelector('[data-testid="view-toggle"]');
  await fp.waitForTimeout(2500);
  await shot(fp, 'fnb-floor-3d');
  await fp.getByRole('button', { name: /^2D$/ }).click();
  await fp.waitForSelector('[data-testid="floor-2d"]');
  await fp.waitForTimeout(1000);
  await shot(fp, 'fnb-floor-2d');
  // the panel of a table in service
  const busy = fp.locator('[data-testid^="table-"][data-status="waiting"], [data-testid^="table-"][data-status="ready"]').first();
  // a table whose food is ready pulses, so Playwright never calls it "stable"
  await busy.click({ force: true });
  await fp.waitForSelector('[data-testid="table-panel"]');
  await fp.waitForTimeout(900);
  await shot(fp, 'fnb-floor-panel');
  await fp.getByTestId('table-move').click();
  await fp.waitForSelector('[data-testid="move-dialog"]');
  await fp.waitForTimeout(700);
  await shot(fp, 'fnb-floor-move');
  await fp.keyboard.press('Escape');
  await fp.waitForTimeout(500);
  if (await fp.getByTestId('table-split').count()) {
    await fp.getByTestId('table-split').click();
    await fp.waitForSelector('[data-testid="split-dialog"]');
    await fp.locator('[data-testid^="split-item-"]').first().click();
    await fp.waitForTimeout(700);
    await shot(fp, 'fnb-floor-split');
    await fp.keyboard.press('Escape');
    await fp.waitForTimeout(500);
  }
  await fp.keyboard.press('Escape');

  // ---- queue screen, QR page and the slip ----------------------------------
  await fp.goto(`${BASE}/fnb/queue`, { waitUntil: 'domcontentloaded' });
  await fp.waitForTimeout(1800);
  await shot(fp, 'fnb-queue');

  await fp.goto(`${BASE}/fnb/tables`, { waitUntil: 'domcontentloaded' });
  await fp.waitForSelector('[data-testid^="table-card-"]');
  await fp.waitForTimeout(1500);
  await shot(fp, 'fnb-tables');
  await shotPrint(fnb, fp, 'fnb-qr-slip', async () => {
    await fp.locator('[data-testid^="table-print-"]').first().click();
  });

  // ---- reservations --------------------------------------------------------
  await fp.goto(`${BASE}/fnb/reservations`, { waitUntil: 'domcontentloaded' });
  await fp.waitForSelector('[data-testid="res-add"]');
  await fp.waitForTimeout(1200);
  await shot(fp, 'fnb-reservations');

  // ---- reports -------------------------------------------------------------
  await fp.goto(`${BASE}/fnb/reports`, { waitUntil: 'domcontentloaded' });
  await fp.waitForSelector('[data-testid="rep-tabs"]');
  await fp.waitForTimeout(2000);
  await shot(fp, 'fnb-reports-menu');
  await fp.getByTestId('rep-tab-ingredients').click();
  await fp.waitForTimeout(1600);
  await shot(fp, 'fnb-reports-ingredients');
  await fp.getByTestId('rep-tab-hours').click();
  await fp.waitForTimeout(1600);
  await shot(fp, 'fnb-reports-hours');

  // ---- settings ------------------------------------------------------------
  await fp.goto(`${BASE}/fnb/settings`, { waitUntil: 'domcontentloaded' });
  await fp.waitForSelector('[data-testid="cfg-tabs"]');
  await fp.waitForTimeout(1600);
  await shot(fp, 'fnb-settings-menu');
  await fp.locator('[data-testid^="cfg-edit-item-"]').first().click();
  await fp.waitForSelector('[data-testid="recipe-line"]');
  await fp.waitForTimeout(900);
  await shot(fp, 'fnb-settings-item');
  await fp.keyboard.press('Escape');
  await fp.waitForTimeout(600);
  for (const [tab, name] of [
    ['modifiers', 'fnb-settings-modifiers'],
    ['promos', 'fnb-settings-promos'],
    ['stations', 'fnb-settings-stations'],
    ['floor', 'fnb-settings-floor'],
    ['shop', 'fnb-settings-shop'],
  ]) {
    await fp.getByTestId(`cfg-tab-${tab}`).click();
    await fp.waitForTimeout(1600);
    await shot(fp, name);
  }

  // ---- what the customer sees: the tablet on the table and a phone ---------
  const tokens = await fp.evaluate(async () => {
    const s = JSON.parse(window.localStorage.getItem('pos.session') ?? '{}');
    const r = await fetch('/api/v1/fnb/tables', { headers: { Authorization: `Bearer ${s.access_token}` } });
    return r.json();
  });
  const table5 = tokens.find((t) => t.table_code === '5') ?? tokens[0];
  if (table5) {
    const kiosk = await fnb.newPage();
    await kiosk.setViewportSize({ width: 1024, height: 768 });
    await kiosk.goto(`${BASE}/t/${table5.kiosk_token}`, { waitUntil: 'domcontentloaded' });
    await kiosk.waitForTimeout(2000);
    await shot(kiosk, 'fnb-kiosk');
    await kiosk.close();

    const phoneCtx = await browser.newContext({ ...devices['Pixel 5'], locale: 'th-TH', deviceScaleFactor: 1 });
    await phoneCtx.route('**/api/v1/public/fnb/t/**', async (route) => {
      // the table's event stream never ends: fetching it here would hang the route handler
      if (route.request().url().includes('/stream')) return route.fallback();
      const res = await route.fetch();
      let body = await res.text();
      try {
        const json = JSON.parse(body);
        if (json?.store_name) json.store_name = FNB_NAME;
        body = JSON.stringify(json);
      } catch {
        /* not JSON */
      }
      await route.fulfill({ status: res.status(), contentType: 'application/json', body });
    });
    const phone = await phoneCtx.newPage();
    await phone.goto(`${BASE}/t/${table5.token}`, { waitUntil: 'domcontentloaded' });
    await phone.waitForTimeout(2000);
    await shot(phone, 'fnb-phone');
    await phoneCtx.close();
  }

  // ---- head office ---------------------------------------------------------
  await fp.close();
  await fnb.close();

  // ---- tablet portrait (the POS is used on iPads) --------------------------
  // a real touch device so the in-dialog numeric keypad (shown only on coarse pointers) is captured
  const tablet = await browser.newContext({ ...devices['iPad (gen 7)'], deviceScaleFactor: 1, locale: 'th-TH' });
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
