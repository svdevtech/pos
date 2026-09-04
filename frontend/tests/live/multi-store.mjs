/**
 * Multi-tenant test on a running deployment: create a second store through the admin screens, use
 * it like a real shop, and prove the two stores cannot see or disturb each other.
 *
 *   node tests/live/multi-store.mjs                  # https://t-pos.tdev2022.com
 *   BASE=http://100.122.174.19:3010 ADMIN_PASS=... node tests/live/multi-store.mjs
 *
 * Everything it writes lives in the new store (or is tagged with the run id), so the original shop
 * is only ever read.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE ?? 'https://t-pos.tdev2022.com';
const ADMIN_USER = process.env.ADMIN_USER ?? 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS ?? '';
const HOME_STORE = process.env.STORE ?? 'BBR';
const HOME_USER = process.env.E2E_USER ?? 'owner';
const HOME_PASS = process.env.E2E_PASS ?? 'Owner12345';

const NEW_STORE = {
  code: process.env.NEW_STORE_CODE ?? 'KAEN',
  name: 'ร้านค้าชุมชนบ้านแก่น',
  name_en: 'Ban Kaen Community Store',
  owner_username: process.env.NEW_STORE_OWNER ?? 'kaen-owner',
  owner_password: process.env.NEW_STORE_PASS ?? 'Kaen@2569pos',
  owner_name: 'เจ้าของร้านบ้านแก่น',
};

const th = JSON.parse(readFileSync(resolve(here, '../../i18n/messages/th.json'), 'utf8'));
const L = (p) => p.split('.').reduce((o, k) => o?.[k], th);
const RUN = `KAEN-${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}`;
const results = [];
let shotPage = null;

const step = async (id, name, fn) => {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ id, name, status: 'PASS', ms: Date.now() - t0, detail: detail ?? '' });
    console.log(`PASS ${id} ${name}${detail ? ` — ${detail}` : ''}`);
    return detail;
  } catch (err) {
    const msg = String(err?.message ?? err).split('\n')[0].slice(0, 300);
    results.push({ id, name, status: 'FAIL', ms: Date.now() - t0, detail: msg });
    console.log(`FAIL ${id} ${name} — ${msg}`);
    if (shotPage) {
      try {
        mkdirSync(resolve(here, 'shots'), { recursive: true });
        await shotPage.screenshot({ path: resolve(here, 'shots', `${id}.png`) });
      } catch {
        /* ignore */
      }
    }
    return null;
  }
};

/** The shop's calendar day (Asia/Bangkok), which is what the reports are keyed on. */
const today = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

/** API call carrying the page's session; `storeId` overrides the tenant header (used for the attack tests). */
const api = (page, path, init, storeId) =>
  page.evaluate(
    async ([p, i, sid]) => {
      const s = JSON.parse(window.localStorage.getItem('pos.session') ?? '{}');
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${s.access_token}`, ...(i?.headers ?? {}) };
      // the app sends the selected store for a platform admin; mirror that unless a store is forced
      const selected = s.selected_store?.id ?? s.store?.id;
      if (sid) headers['X-Store-Id'] = sid;
      else if (s.user?.role === 'platform_admin' && selected) headers['X-Store-Id'] = selected;
      const res = await fetch(`/api/v1${p}`, { ...i, headers });
      const text = await res.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      return { status: res.status, body };
    },
    [path, init ?? {}, storeId ?? null],
  );

const login = async (page, { store, user, pass, platformAdmin = false }) => {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  if (platformAdmin) {
    await page.getByLabel(L('auth.platformAdmin')).check();
  } else {
    await page.getByLabel(L('auth.storeCode')).fill(store);
  }
  await page.getByLabel(L('auth.username')).fill(user);
  await page.getByLabel(L('auth.password')).first().fill(pass);
  await page.getByRole('button', { name: L('auth.signIn'), exact: true }).click();
  await page.waitForURL(/\/(dashboard|pos|admin)/, { timeout: 60_000 });
};

const main = async () => {
  assert(ADMIN_PASS, 'ADMIN_PASS is required (the platform admin password)');
  const browser = await chromium.launch();
  const state = {};

  // ---------------------------------------------------------------- home shop, before
  const homeCtx = await browser.newContext({ viewport: { width: 1400, height: 950 }, locale: 'th-TH' });
  const home = await homeCtx.newPage();
  shotPage = home;
  await step('S0', 'อ่านสถานะร้านเดิมไว้เปรียบเทียบ', async () => {
    await login(home, { store: HOME_STORE, user: HOME_USER, pass: HOME_PASS });
    const products = await api(home, '/products?page=1&page_size=1');
    const sales = await api(home, `/sales?from=${today()}&to=${today()}&page_size=1`);
    const members = await api(home, '/members?page=1&page_size=1');
    state.home = {
      storeId: (await api(home, '/store')).body.id,
      products: products.body.total,
      salesToday: sales.body.total,
      members: members.body.total,
      sampleProduct: (await api(home, '/products?page=1&page_size=5')).body.items?.[0],
    };
    return `สินค้า ${state.home.products} · สมาชิก ${state.home.members} · บิลวันนี้ ${state.home.salesToday}`;
  });

  // ---------------------------------------------------------------- create the store
  const adminCtx = await browser.newContext({ viewport: { width: 1400, height: 950 }, locale: 'th-TH' });
  const admin = await adminCtx.newPage();
  await step('S1', `ผู้ดูแลแพลตฟอร์มสร้างร้าน "${NEW_STORE.name}"`, async () => {
    shotPage = admin;
    await login(admin, { user: ADMIN_USER, pass: ADMIN_PASS, platformAdmin: true });
    assert(admin.url().includes('/admin'), `admin landed on ${admin.url()}`);

    const existing = await api(admin, '/admin/stores');
    const already = (existing.body?.items ?? existing.body ?? []).find((s) => s.code === NEW_STORE.code);
    if (already) {
      state.newStoreId = already.id;
      return `มีอยู่แล้ว (${already.code}) — ใช้ร้านเดิมทดสอบต่อ`;
    }

    await admin.getByRole('button', { name: L('admin.addStore') }).click();
    const dialog = admin.getByRole('dialog');
    await dialog.getByLabel(L('admin.storeCode')).fill(NEW_STORE.code);
    await dialog.getByLabel(L('admin.storeName'), { exact: true }).fill(NEW_STORE.name);
    await dialog.getByLabel(L('admin.storeNameEn')).fill(NEW_STORE.name_en);
    await dialog.getByLabel(L('admin.ownerUsername')).fill(NEW_STORE.owner_username);
    await dialog.getByLabel(L('admin.ownerPassword')).fill(NEW_STORE.owner_password);
    await dialog.getByLabel(L('admin.ownerName')).fill(NEW_STORE.owner_name);
    await dialog.getByRole('button', { name: L('common.create'), exact: true }).click();
    await admin.waitForTimeout(3000);

    const after = await api(admin, '/admin/stores');
    const created = (after.body?.items ?? after.body ?? []).find((s) => s.code === NEW_STORE.code);
    assert(created, 'the new store is not in the list');
    state.newStoreId = created.id;
    return `${created.code} · ${created.name}`;
  });

  await step('S2', 'ร้านใหม่ปรากฏในรายการร้านของผู้ดูแล', async () => {
    await admin.goto(`${BASE}/admin/stores`, { waitUntil: 'domcontentloaded' });
    await admin.waitForTimeout(2500);
    const text = await admin.locator('body').innerText();
    assert(text.includes(NEW_STORE.name), 'the store name is missing from the admin list');
    assert(text.includes(HOME_STORE), 'the original store disappeared from the list');
    return 'เห็นทั้งสองร้าน';
  });

  // ---------------------------------------------------------------- use the new store
  const shopCtx = await browser.newContext({ viewport: { width: 1400, height: 950 }, locale: 'th-TH' });
  const shop = await shopCtx.newPage();
  await step('S3', 'เจ้าของร้านใหม่เข้าสู่ระบบด้วยรหัสร้านของตัวเอง', async () => {
    shotPage = shop;
    await login(shop, { store: NEW_STORE.code, user: NEW_STORE.owner_username, pass: NEW_STORE.owner_password });
    const me = await api(shop, '/store');
    assert(me.body.code === NEW_STORE.code, `logged into ${me.body.code}`);
    state.shopStoreId = me.body.id;
    return `${me.body.code} · ${me.body.name}`;
  });

  await step('S4', 'ร้านใหม่เริ่มต้นว่างเปล่า ไม่เห็นข้อมูลร้านเดิม', async () => {
    const products = await api(shop, '/products?page=1&page_size=5');
    const members = await api(shop, '/members?page=1&page_size=5');
    const sales = await api(shop, '/sales?page=1&page_size=5');
    assert(products.body.total === 0, `the new store already has ${products.body.total} products`);
    assert(members.body.total <= 1, `the new store has ${members.body.total} members (only walk-in is expected)`);
    assert(sales.body.total === 0, `the new store has ${sales.body.total} sales`);
    return `สินค้า 0 · สมาชิก ${members.body.total} (ลูกค้าทั่วไป) · บิล 0`;
  });

  await step('S5', 'บาร์โค้ดของร้านเดิมสแกนในร้านใหม่ไม่เจอ', async () => {
    const code = state.home.sampleProduct?.primary_barcode;
    assert(code, 'no sample barcode from the home store');
    const res = await api(shop, `/products/by-barcode/${encodeURIComponent(code)}`);
    assert(res.status === 404, `scanning the other store's barcode returned ${res.status}`);
    return `${code} → 404 ตามที่ควรเป็น`;
  });

  await step('S6', 'เปิดสินค้าของร้านเดิมด้วย id ตรงๆ ไม่ได้', async () => {
    const id = state.home.sampleProduct?.id;
    const res = await api(shop, `/products/${id}`);
    assert(res.status === 404, `direct id access returned ${res.status}`);
    return 'ตอบ 404 (ไม่รั่วข้อมูล)';
  });

  await step('S7', 'ปลอม X-Store-Id เป็นร้านอื่นไม่สำเร็จ', async () => {
    const res = await api(shop, '/products?page=1&page_size=5', undefined, state.home.storeId);
    // a store user's token is bound to its own store: the header must not widen it
    assert(res.status !== 200 || res.body.total === 0, `the header exposed ${res.body?.total} products of the other store`);
    return res.status === 200 ? 'ยังเห็นแค่ข้อมูลร้านตัวเอง (0 รายการ)' : `ถูกปฏิเสธ (${res.status})`;
  });

  await step('S8', 'สร้างสินค้าและขายจริงในร้านใหม่', async () => {
    const created = await api(shop, '/products', {
      method: 'POST',
      body: JSON.stringify({ sku: `${RUN}-P1`, name: 'น้ำดื่มบ้านแก่น 600 มล.', sell_price: '10', opening_stock: '50' }),
    });
    assert(created.status === 201, `create product ${created.status}`);
    state.shopProduct = created.body;
    state.shopBarcode = `999${Date.now()}`.slice(0, 13); // digits only: that is what a scanner sends
    await api(shop, `/products/${created.body.id}/barcodes`, {
      method: 'POST',
      body: JSON.stringify({ barcode: state.shopBarcode, is_primary: true }),
    });

    // a brand-new store has no shift and the store setting requires one before selling; the shift
    // screens themselves are covered by the main suite, so open one directly as setup
    const shiftNow = await api(shop, '/shifts/current');
    if (!shiftNow.body?.shift) {
      const opened = await api(shop, '/shifts/open', { method: 'POST', body: JSON.stringify({ terminal: 'POS1', opening_float: 500 }) });
      assert(opened.status === 201, `open shift ${opened.status}`);
    }

    await shop.goto(`${BASE}/pos`, { waitUntil: 'domcontentloaded' });
    await shop.getByTestId('scan-input').waitFor({ timeout: 30_000 });
    const stillClosed = shop.getByTestId('open-shift-confirm');
    if (await stillClosed.isVisible().catch(() => false)) {
      await stillClosed.click();
      await shop.waitForTimeout(1500);
    }
    const scan = shop.getByTestId('scan-input');
    await scan.fill(state.shopBarcode);
    await scan.press('Enter');
    await shop.getByTestId('cart-line').first().waitFor({ timeout: 20_000 }).catch(async () => {
      const seen = (await shop.locator('body').innerText()).replace(/\n+/g, ' | ').slice(0, 200);
      throw new Error(`the scan did not reach the cart — screen said: ${seen}`);
    });
    await shop.getByTestId('pay-button').first().click();
    await shop.getByTestId('tender-confirm').waitFor({ timeout: 15_000 });
    await shop.getByTestId('quick-100').click();
    await shop.getByTestId('tender-confirm').click();
    await shop.getByTestId('receipt-dialog').waitFor({ timeout: 25_000 });
    const preview = await shop.getByTestId('receipt-preview').innerText();
    const doc = preview.match(/N\d{4}-\d{5}/)?.[0];
    assert(doc, 'no document number on the receipt');
    state.shopDoc = doc;
    await shop.getByTestId('receipt-new-sale').click();
    return `${doc} · ขายน้ำดื่ม 1 ขวด`;
  });

  await step('S9', 'เลขที่บิลของร้านใหม่เริ่มนับของตัวเอง (ไม่ต่อจากร้านเดิม)', async () => {
    assert(state.shopDoc.endsWith('-00001'), `the first bill is ${state.shopDoc}`);
    const homeSales = await api(home, '/sales?page=1&page_size=50');
    const clash = (homeSales.body.items ?? []).some((s) => s.doc_no === state.shopDoc);
    assert(!clash, 'the two stores produced the same document number in the same list');
    return `${state.shopDoc} — เริ่มที่ 00001 ของร้านเอง`;
  });

  await step('S10', 'รหัสสมาชิกซ้ำข้ามร้านได้ (unique เฉพาะภายในร้าน)', async () => {
    const homeMember = await api(home, '/members?page=1&page_size=1');
    const code = homeMember.body.items?.[0]?.member_code;
    assert(code, 'no member in the home store');
    const created = await api(shop, '/members', { method: 'POST', body: JSON.stringify({ member_code: code, name: `สมาชิกบ้านแก่น ${code}` }) });
    assert(created.status === 201, `reusing member code ${code} in another store returned ${created.status}`);
    state.shopMember = created.body;
    const homeStill = await api(home, `/members?q=${encodeURIComponent(code)}&page_size=5`);
    const homeNames = (homeStill.body.items ?? []).map((m) => m.name);
    assert(!homeNames.some((n) => n.includes('บ้านแก่น')), 'the new store member leaked into the old store');
    return `ใช้รหัส ${code} ได้ทั้งสองร้านโดยไม่ปนกัน`;
  });

  await step('S11', 'ยอดขาย/รายงานของแต่ละร้านแยกกัน', async () => {
    const shopReport = await api(shop, `/reports/daily-sales?from=${today()}&to=${today()}`);
    const homeReport = await api(home, `/reports/daily-sales?from=${today()}&to=${today()}`);
    const shopBills = shopReport.body.rows?.[0]?.bills ?? 0;
    const homeBills = homeReport.body.rows?.[0]?.bills ?? 0;
    assert(Number(shopBills) === 1, `the new store reports ${shopBills} bills, expected 1`);
    assert(Number(homeBills) !== 1 || homeBills === 1, 'sanity');
    const shopSales = await api(shop, `/sales?page=1&page_size=50`);
    assert(shopSales.body.total === 1, `the new store lists ${shopSales.body.total} sales`);
    return `ร้านใหม่ ${shopBills} บิล · ร้านเดิม ${homeBills} บิล (แยกกัน)`;
  });

  await step('S12', 'สต็อกและมูลค่าคลังของร้านใหม่นับเฉพาะของตัวเอง', async () => {
    const val = await api(shop, '/inventory/valuation');
    const units = Number(val.body.total_units ?? val.body.units ?? 0);
    assert(units === 49, `the new store's stock is ${units} units, expected 49 after selling one`);
    const moves = await api(shop, '/inventory/movements?page=1&page_size=20');
    assert(moves.body.total === 2, `movements = ${moves.body.total}, expected opening + sale`);
    return `คงเหลือ ${units} หน่วย · ความเคลื่อนไหว ${moves.body.total} รายการ`;
  });

  await step('S13', 'ร้านเดิมไม่ถูกกระทบเลย', async () => {
    const products = await api(home, '/products?page=1&page_size=1');
    const members = await api(home, '/members?page=1&page_size=1');
    assert(products.body.total === state.home.products, `home products ${state.home.products} → ${products.body.total}`);
    assert(members.body.total === state.home.members, `home members ${state.home.members} → ${members.body.total}`);
    const shopProduct = await api(home, `/products/${state.shopProduct.id}`);
    assert(shopProduct.status === 404, `the home store can read the new store's product (${shopProduct.status})`);
    return `สินค้า ${products.body.total} · สมาชิก ${members.body.total} เท่าเดิม และเปิดสินค้าร้านใหม่ไม่ได้`;
  });

  await step('S14', 'สำรองข้อมูลของร้านใหม่มีเฉพาะข้อมูลร้านนั้น', async () => {
    const started = await api(shop, '/store/data/backups', { method: 'POST' });
    assert(started.status === 201, `start backup ${started.status}`);
    let job = null;
    for (let i = 0; i < 40; i++) {
      await shop.waitForTimeout(2000);
      const jobs = await api(shop, '/store/data/jobs');
      job = (jobs.body ?? []).find((j) => j.id === started.body.id);
      if (job && job.status !== 'running') break;
    }
    assert(job?.status === 'done', `backup ended as ${job?.status}: ${job?.error ?? ''}`);
    const counts = job.report?.counts ?? {};
    assert(counts.sales === 1, `the backup holds ${counts.sales} sales`);
    assert(counts.products === 1, `the backup holds ${counts.products} products`);
    assert(job.report?.store_code === NEW_STORE.code, `the backup says store ${job.report?.store_code}`);
    return `${job.file} · สินค้า ${counts.products} · บิล ${counts.sales} · สมาชิก ${counts.members}`;
  });

  await step('S15', 'ผู้ช่วย AI ของร้านใหม่ตอบจากข้อมูลร้านตัวเองเท่านั้น', async () => {
    const status = await api(shop, '/ai/status');
    if (!status.body?.enabled) return 'ข้าม (AI ปิดอยู่)';
    const res = await api(shop, '/ai/query', { method: 'POST', body: JSON.stringify({ question: 'วันนี้ขายได้กี่บิล', explain: false }) });
    assert(res.status === 200, `ai query ${res.status}`);
    const flat = JSON.stringify(res.body.rows);
    assert(res.body.row_count >= 1, 'the assistant returned nothing');
    assert(!/2[0-9]{4,}/.test(flat), `the answer looks like it counted the other store: ${flat.slice(0, 60)}`);
    return `ตอบ ${flat.slice(0, 40)} (ไม่ใช่ยอดของร้านเดิม)`;
  });

  await step('S16', 'ผู้ดูแลสลับเข้าไปดูได้ทั้งสองร้านอย่างถูกต้อง', async () => {
    shotPage = admin;
    await admin.goto(`${BASE}/admin/stores`, { waitUntil: 'domcontentloaded' });
    await admin.waitForTimeout(2500);
    const row = admin.getByRole('row').filter({ hasText: NEW_STORE.code }).first();
    await row.getByRole('button', { name: L('admin.enterStore') }).click();
    await admin.waitForURL(/\/dashboard/, { timeout: 30_000 });
    await admin.waitForTimeout(3000);
    const asNew = await api(admin, '/products?page=1&page_size=1');
    assert(asNew.body.total === 1, `admin inside the new store sees ${asNew.body.total} products`);
    const store = await api(admin, '/store');
    assert(store.body.code === NEW_STORE.code, `admin is inside ${store.body.code}`);
    return `เข้าร้าน ${store.body.code} เห็นสินค้า ${asNew.body.total} รายการ`;
  });

  await step('S17', 'ขายสินค้าของร้านอื่นด้วย id ตรงๆ ไม่สำเร็จ', async () => {
    // the nastiest cross-tenant attempt: post a sale in store B that references store A's product
    const res = await api(shop, '/sales', {
      method: 'POST',
      body: JSON.stringify({
        lines: [{ product_id: state.home.sampleProduct.id, qty: 1, discount: 0, is_free: false }],
        payments: [{ method: 'cash', amount: 1000 }],
        bill_discount: 0,
        bill_discount_pct: 0,
      }),
    });
    assert(res.status >= 400, `the sale was accepted (${res.status}) using another store's product`);
    const homeProduct = await api(home, `/products/${state.home.sampleProduct.id}`);
    assert(homeProduct.status === 200, 'could not re-read the home product');
    assert(
      Number(homeProduct.body.stock_on_hand) === Number(state.home.sampleProduct.stock_on_hand),
      `the other store's stock moved: ${state.home.sampleProduct.stock_on_hand} → ${homeProduct.body.stock_on_hand}`,
    );
    return `ถูกปฏิเสธ (${res.status}) และสต็อกร้านเดิมไม่ขยับ`;
  });

  await step('S18', 'ไฟล์สำรองข้อมูลของแต่ละร้านแยกกัน', async () => {
    const shopFiles = await api(shop, '/store/data/backups');
    const homeFiles = await api(home, '/store/data/backups');
    const shopNames = (shopFiles.body ?? []).map((f) => f.name);
    const homeNames = (homeFiles.body ?? []).map((f) => f.name);
    assert(shopNames.every((n) => n.includes(NEW_STORE.code)), `the new store lists ${shopNames.join(', ')}`);
    assert(homeNames.every((n) => !n.includes(NEW_STORE.code)), 'a new-store backup showed up in the old store');
    assert(!shopNames.some((n) => homeNames.includes(n)), 'the two stores share a backup file');
    return `ร้านใหม่ ${shopNames.length} ไฟล์ · ร้านเดิม ${homeNames.length} ไฟล์ ไม่ปนกัน`;
  });

  await step('S19', 'ร้านเดิมเปิดบิลของร้านใหม่ไม่ได้', async () => {
    const sale = (await api(shop, '/sales?page=1&page_size=1')).body.items[0];
    const res = await api(home, `/sales/${sale.id}`);
    assert(res.status === 404, `the old store could read the new store's bill (${res.status})`);
    const receipt = await api(home, `/sales/${sale.id}/receipt`);
    assert(receipt.status === 404, `the old store could print the new store's receipt (${receipt.status})`);
    return `บิล ${sale.doc_no} → 404 ทั้งรายละเอียดและใบเสร็จ`;
  });

  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  console.log(`\n=== ${pass} passed, ${fail} failed · store ${NEW_STORE.code} on ${BASE} ===`);
  writeFileSync(resolve(here, 'multi-store-report.json'), JSON.stringify({ base: BASE, store: NEW_STORE.code, at: new Date().toISOString(), results }, null, 2));
  await browser.close();
  process.exitCode = fail ? 1 : 0;
};

main().catch((e) => {
  console.error('runner crashed:', e);
  process.exitCode = 2;
});
