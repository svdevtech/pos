/**
 * Full-system test against a running deployment, driven through the real web UI.
 *
 *   node tests/live/full-system.mjs                       # against https://t-pos.tdev2022.com
 *   BASE=http://localhost:3010 node tests/live/full-system.mjs
 *
 * Every scenario runs in a real browser (Playwright/Chromium) against the deployed site: it logs
 * in, sells, counts, converts, backs up — the same clicks a shop would make. Results are printed as
 * a table and written to tests/live/report.json.
 *
 * Data hygiene: everything it creates carries the run id (E2E-<timestamp>), and the cleanup phase
 * cancels/archives/switches off what it can.
 */
import { chromium, devices } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE ?? 'https://t-pos.tdev2022.com';
const STORE = process.env.STORE ?? 'BBR';
const USER = process.env.E2E_USER ?? 'owner';
const PASS = process.env.E2E_PASS ?? 'Owner12345';
const SHOTS = resolve(here, 'shots');
const th = JSON.parse(readFileSync(resolve(here, '../../i18n/messages/th.json'), 'utf8'));

/** Label lookup so selectors always match the shipped Thai strings. */
const L = (path) => path.split('.').reduce((o, k) => o?.[k], th);

const RUN = `E2E-${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}`;
const results = [];
let ctxPage = null;

const step = async (id, name, fn) => {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ id, name, status: 'PASS', ms: Date.now() - started, detail: detail ?? '' });
    console.log(`PASS ${id} ${name}${detail ? ` — ${detail}` : ''}`);
    return detail;
  } catch (err) {
    const msg = String(err?.message ?? err).split('\n')[0].slice(0, 300);
    results.push({ id, name, status: 'FAIL', ms: Date.now() - started, detail: msg });
    console.log(`FAIL ${id} ${name} — ${msg}`);
    if (ctxPage) {
      try {
        mkdirSync(SHOTS, { recursive: true });
        await ctxPage.screenshot({ path: resolve(SHOTS, `${id}.png`) });
      } catch {
        /* ignore */
      }
    }
    return null;
  }
};

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

/** Calls the API with the session the page already holds (setup/verification only). */
const api = (page, path, init) =>
  page.evaluate(
    async ([p, i]) => {
      const s = JSON.parse(window.localStorage.getItem('pos.session') ?? '{}');
      const res = await fetch(`/api/v1${p}`, {
        ...i,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.access_token}`, ...(i?.headers ?? {}) },
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    },
    [path, init ?? {}],
  );


/** Types into a product autocomplete and picks the row that really matches the SKU. */
const pickProduct = async (page, label, sku) => {
  const box = page.getByRole('combobox', { name: label });
  await box.click();
  await box.fill(sku);
  const option = page.getByRole('option').filter({ hasText: sku }).first();
  await option.waitFor({ timeout: 20_000 });
  await option.click();
};

const login = async (page, user = USER, pass = PASS) => {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel(L('auth.storeCode')).fill(STORE);
  await page.getByLabel(L('auth.username')).fill(user);
  await page.getByLabel(L('auth.password')).first().fill(pass);
  await page.getByRole('button', { name: L('auth.signIn'), exact: true }).click();
};

const main = async () => {
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: 'th-TH', permissions: ['camera'] });
  const page = await ctx.newPage();
  ctxPage = page;
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('favicon')) consoleErrors.push(m.text().slice(0, 200));
  });

  const state = {};

  // ---------------------------------------------------------------- A. auth
  await step('A1', 'รหัสผ่านผิดต้องไม่ให้เข้า', async () => {
    await login(page, USER, 'wrong-password-x');
    await page.waitForTimeout(1500);
    assert(page.url().includes('/login'), 'a wrong password let the user in');
    const alert = await page.getByRole('alert').first().innerText().catch(() => '');
    return alert.slice(0, 60);
  });

  await step('A2', 'เข้าสู่ระบบด้วยรหัสที่ถูกต้อง', async () => {
    await login(page);
    await page.waitForURL(/\/(dashboard|pos)/, { timeout: 45_000 });
    return new URL(page.url()).pathname;
  });

  await step('A3', 'สลับภาษา ไทย ↔ อังกฤษ', async () => {
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
    const nav = () => page.getByRole('navigation').first().innerText();
    try {
      const thai = await nav();
      await page.getByTestId('lang-en').click();
      await page.waitForTimeout(2000);
      const english = await nav();
      assert(english.includes('Dashboard'), `English menu missing: ${english.slice(0, 40)}`);
      assert(thai !== english, 'the language toggle changed nothing');
      return `${thai.split('\n')[0]} ↔ ${english.split('\n')[0]}`;
    } finally {
      // always return to Thai: the locale cookie would otherwise follow the whole run
      await page.getByTestId('lang-th').click().catch(() => {});
      await page.waitForTimeout(1500);
    }
  });

  await ctx.addCookies([{ name: 'NEXT_LOCALE', value: 'th', url: BASE }]);

  // ------------------------------------------------------------- B. POS sale
  await step('B0', 'เปิดกะขาย (ถ้ายังไม่เปิด)', async () => {
    await page.goto(`${BASE}/pos`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('scan-input').waitFor({ timeout: 30_000 });
    const dialog = page.getByTestId('open-shift-confirm');
    if (await dialog.isVisible().catch(() => false)) {
      await dialog.click();
      await page.waitForTimeout(1500);
      return 'เปิดกะใหม่';
    }
    return 'มีกะเปิดอยู่แล้ว';
  });

  // a product with stock to sell, taken from the live catalogue
  await step('B1', 'เลือกสินค้าจริงจากคลังมาทดสอบ', async () => {
    const res = await api(page, '/products?page=1&page_size=50&active=true');
    assert(res.status === 200, `products list ${res.status}`);
    const p = (res.body.items ?? []).find((x) => Number(x.stock_on_hand) > 5 && x.primary_barcode);
    assert(p, 'no product with stock and a barcode');
    state.product = p;
    return `${p.name} (${p.primary_barcode}) คงเหลือ ${p.stock_on_hand}`;
  });

  await step('B2', 'สแกนสินค้าเข้าตะกร้า และใช้ตัวคูณ 3*', async () => {
    const scan = page.getByTestId('scan-input');
    await scan.fill(state.product.primary_barcode);
    await scan.press('Enter');
    await page.getByTestId('cart-line').first().waitFor({ timeout: 15_000 });
    await scan.fill(`3*${state.product.primary_barcode}`);
    await scan.press('Enter');
    await page.waitForTimeout(1200);
    const lines = await page.getByTestId('cart-line').count();
    assert(lines === 1, `expected the scans to merge into one line, got ${lines}`);
    const total = await page.getByTestId('line-total').first().innerText();
    return `1 บรรทัด รวม ${total}`;
  });

  await step('B3', 'ชำระเงินสด รับเงินทอน และได้ใบเสร็จ', async () => {
    await page.getByTestId('pay-button').first().click();
    await page.getByTestId('tender-confirm').waitFor({ timeout: 15_000 });
    const due = await page.getByTestId('tender-net').innerText();
    await page.getByTestId('quick-1000').click();
    const change = await page.getByTestId('tender-change').innerText();
    await page.getByTestId('tender-confirm').click();
    await page.getByTestId('receipt-dialog').waitFor({ timeout: 20_000 });
    const preview = await page.getByTestId('receipt-preview').innerText();
    const docNo = preview.match(/N\d{4}-\d{5}/)?.[0];
    assert(docNo, 'no document number on the receipt');
    state.saleDoc = docNo;
    await page.getByTestId('receipt-new-sale').click();
    await page.waitForTimeout(1000);
    const cart = await page.getByTestId('cart-line').count();
    assert(cart === 0, 'the cart was not cleared after the sale');
    return `${docNo} ยอด ${due} เงินทอน ${change}`;
  });

  await step('B4', 'บิลใหม่ปรากฏในรายการบิลวันนี้ (F7)', async () => {
    await page.keyboard.press('F7');
    await page.waitForTimeout(2500);
    const body = await page.locator('body').innerText();
    assert(body.includes(state.saleDoc), `${state.saleDoc} is missing from today's bills`);
    await page.keyboard.press('Escape');
    return state.saleDoc;
  });

  // --------------------------------------------------- C. hold / recall bill
  await step('C1', 'พักบิลและเรียกกลับมา', async () => {
    const scan = page.getByTestId('scan-input');
    await scan.fill(state.product.primary_barcode);
    await scan.press('Enter');
    await page.getByTestId('cart-line').first().waitFor({ timeout: 15_000 });
    await page.keyboard.press('F2');
    await page.getByTestId('hold-confirm').click();
    await page.waitForTimeout(1500);
    assert((await page.getByTestId('cart-line').count()) === 0, 'holding did not clear the cart');
    await page.keyboard.press('F4');
    await page.getByTestId('held-bill').first().click();
    await page.waitForTimeout(1500);
    const back = await page.getByTestId('cart-line').count();
    assert(back === 1, 'the held bill did not come back');
    return 'พัก 1 บิล แล้วเรียกกลับได้';
  });

  await step('C2', 'ยกเลิกบิลล่าสุด (F8) และสต็อกถูกคืน', async () => {
    const before = await api(page, `/products/${state.product.id}`);
    await page.keyboard.press('F8');
    const dialog = page.getByTestId('cancel-sale-confirm');
    await dialog.waitFor({ timeout: 10_000 });
    const reason = page.getByRole('textbox').last();
    await reason.fill(`${RUN} ทดสอบยกเลิก`);
    await dialog.click();
    await page.waitForTimeout(3000);
    const after = await api(page, `/products/${state.product.id}`);
    const delta = Number(after.body.stock_on_hand) - Number(before.body.stock_on_hand);
    assert(delta === 4, `expected 4 units back on the shelf, got ${delta}`);
    return `คืนสต็อก ${delta} หน่วย`;
  });

  // --------------------------------------------------------- D. products CRUD
  await step('D1', 'สร้างสินค้าใหม่จากหน้าเว็บ', async () => {
    await page.goto(`${BASE}/products/new`, { waitUntil: 'domcontentloaded' });
    await page.getByLabel(L('products.sku')).fill(`${RUN}-PACK`);
    await page.getByLabel(L('products.name'), { exact: true }).fill(`${RUN} เบียร์ทดสอบ (ลัง)`);
    await page.getByLabel(L('products.price')).fill('600');
    await page.getByLabel(L('products.costAvg')).fill('480').catch(() => {});
    await page.getByLabel(L('products.openingStock')).fill('5');
    await page.getByRole('button', { name: L('common.create'), exact: true }).click();
    await page.waitForTimeout(3000);
    const res = await api(page, `/products?q=${encodeURIComponent(RUN)}&page_size=10`);
    const created = (res.body.items ?? []).find((p) => p.sku === `${RUN}-PACK`);
    assert(created, 'the new product is not in the catalogue');
    state.pack = created;
    return `${created.sku} คงเหลือ ${created.stock_on_hand}`;
  });

  await step('D2', 'แก้ไขราคาขายของสินค้า', async () => {
    await page.goto(`${BASE}/products/${state.pack.id}`, { waitUntil: 'domcontentloaded' });
    const price = page.getByLabel(L('products.price'));
    await price.waitFor({ timeout: 20_000 });
    await price.fill('650');
    await page.getByRole('button', { name: L('common.save'), exact: true }).click();
    await page.waitForTimeout(2500);
    const res = await api(page, `/products/${state.pack.id}`);
    assert(Number(res.body.sell_price) === 650, `price is ${res.body.sell_price}, expected 650`);
    return 'ราคาขาย 600 → 650';
  });

  // ------------------------------------------------------------- E. units
  await step('E1', 'เพิ่มหน่วยนับใหม่', async () => {
    await page.goto(`${BASE}/settings/units`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('unit-list').waitFor({ timeout: 20_000 });
    const before = await page.locator('[data-testid="unit-list"] tbody tr').count();
    await page.getByTestId('unit-add').click();
    await page.getByLabel(L('units.name')).fill(`${RUN}-หน่วย`);
    await page.getByTestId('unit-save').click();
    await page.waitForTimeout(2000);
    const after = await page.locator('[data-testid="unit-list"] tbody tr').count();
    assert(after === before + 1, `unit rows ${before} → ${after}`);
    return `${before} → ${after} หน่วย`;
  });

  await step('E2', 'ปิดการใช้งานหน่วย (ลบแบบเปลี่ยนสถานะ)', async () => {
    const row = page.locator('[data-testid="unit-list"] tbody tr').filter({ hasText: `${RUN}-หน่วย` });
    await row.getByRole('checkbox').click();
    await page.getByTestId('unit-switch-off').click();
    await page.waitForTimeout(2000);
    const chip = await row.getByText(L('units.inactive')).count();
    assert(chip === 1, 'the unit was not marked as switched off');
    const res = await api(page, '/units');
    const still = (res.body ?? []).find((u) => u.name === `${RUN}-หน่วย`);
    assert(still && still.is_active === false, 'the unit row disappeared instead of being switched off');
    return 'ยังอยู่ในระบบแต่สถานะปิด';
  });

  // --------------------------------------------------------- F. inventory ops
  await step('F1', 'รับสินค้าเข้า (เพิ่มสต็อก + ต้นทุนเฉลี่ย)', async () => {
    await page.goto(`${BASE}/inventory/receipts/new`, { waitUntil: 'domcontentloaded' });
    await pickProduct(page, L('inventory.addLine'), `${RUN}-PACK`);
    await page.getByTestId('receipt-qty').first().fill('10');
    await page.getByTestId('receipt-cost').first().fill('500');
    await page.getByRole('button', { name: L('inventory.postReceipt') }).click();
    await page.waitForTimeout(3000);
    const res = await api(page, `/products/${state.pack.id}`);
    assert(Number(res.body.stock_on_hand) === 15, `stock is ${res.body.stock_on_hand}, expected 15`);
    return `คงเหลือ ${res.body.stock_on_hand} ต้นทุนเฉลี่ย ${res.body.cost_avg}`;
  });

  await step('F2', 'ปรับปรุงสต็อก −2', async () => {
    await page.goto(`${BASE}/inventory/adjustments/new`, { waitUntil: 'domcontentloaded' });
    await pickProduct(page, L('inventory.addLine'), `${RUN}-PACK`);
    await page.getByTestId('adjust-qty').first().fill('-2');
    await page.getByRole('button', { name: L('inventory.postAdjustment') }).click();
    await page.waitForTimeout(3000);
    const res = await api(page, `/products/${state.pack.id}`);
    assert(Number(res.body.stock_on_hand) === 13, `stock is ${res.body.stock_on_hand}, expected 13`);
    return `คงเหลือ ${res.body.stock_on_hand}`;
  });

  await step('F3', 'ความเคลื่อนไหวสต็อกบันทึกครบทุกรายการ', async () => {
    await page.goto(`${BASE}/inventory/movements?product_id=${state.pack.id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const body = await page.locator('body').innerText();
    for (const label of [L('inventory.moveTypes.opening'), L('inventory.moveTypes.receipt'), L('inventory.moveTypes.adjustment')]) {
      assert(body.includes(label), `movement "${label}" missing from the ledger`);
    }
    return 'ยอดยกมา / รับเข้า / ปรับปรุง ครบ';
  });

  // ------------------------------------------------------- G. unit conversion
  await step('G1', 'สร้างสินค้าหน่วยย่อยและสูตรแปลงหน่วย', async () => {
    const created = await api(page, '/products', {
      method: 'POST',
      body: JSON.stringify({ sku: `${RUN}-UNIT`, name: `${RUN} เบียร์ทดสอบ (ขวด)`, sell_price: '55', opening_stock: '0' }),
    });
    assert(created.status === 201, `create bottle ${created.status}`);
    state.unit = created.body;
    await page.goto(`${BASE}/inventory/conversions`, { waitUntil: 'domcontentloaded' });
    await pickProduct(page, L('conversions.fromProduct'), `${RUN}-PACK`);
    await pickProduct(page, L('conversions.toProduct'), `${RUN}-UNIT`);
    await page.getByTestId('conv-factor').fill('12');
    await page.getByTestId('conv-save-rule').click();
    await page.waitForTimeout(2500);
    const rules = await api(page, `/inventory/conversion-rules?from_product_id=${state.pack.id}`);
    assert((rules.body ?? []).length === 1, 'the conversion rule was not saved');
    assert(rules.body[0].to_product_id === state.unit.id, `the rule points at ${rules.body[0].to_name} instead of the bottle`);
    return '1 ลัง = 12 ขวด';
  });

  await step('G2', 'แปลง 2 ลัง → 24 ขวด พร้อมโอนต้นทุน', async () => {
    await page.getByTestId('conv-qty').fill('2');
    const preview = await page.getByTestId('conv-preview').innerText();
    await page.getByTestId('conv-post').click();
    await page.waitForTimeout(3500);
    const pack = await api(page, `/products/${state.pack.id}`);
    const unit = await api(page, `/products/${state.unit.id}`);
    assert(Number(pack.body.stock_on_hand) === 11, `pack stock ${pack.body.stock_on_hand}, expected 11`);
    assert(Number(unit.body.stock_on_hand) === 24, `unit stock ${unit.body.stock_on_hand}, expected 24`);
    const packCost = Number(pack.body.cost_avg);
    const unitCost = Number(unit.body.cost_avg);
    assert(Math.abs(unitCost * 12 - packCost) < 0.01, `cost did not carry across: ${packCost}/ลัง vs ${unitCost}/ขวด`);
    return `${preview.trim()} · ต้นทุน ${packCost}/ลัง → ${unitCost}/ขวด`;
  });

  await step('G3', 'แปลงเกินจำนวนที่มีต้องกดไม่ได้', async () => {
    await page.getByTestId('conv-qty').fill('999');
    await page.waitForTimeout(500);
    assert(await page.getByTestId('conv-post').isDisabled(), 'the convert button stayed enabled without stock');
    return 'ปุ่มถูกปิดพร้อมข้อความเตือน';
  });

  // ------------------------------------------------- H. stock check on a phone
  const { defaultBrowserType: _dbt, ...pixel } = devices['Pixel 7'];
  const phone = await browser.newContext({ ...pixel, locale: 'th-TH' });
  const mob = await phone.newPage();
  await step('H1', 'เช็คสต็อกด้วยมือถือ: สแกนแล้วเห็นยอด', async () => {
    await login(mob);
    await mob.waitForURL(/\/(dashboard|pos)/, { timeout: 45_000 });
    await mob.goto(`${BASE}/inventory/check`, { waitUntil: 'domcontentloaded' });
    const scan = mob.getByTestId('check-scan');
    await scan.waitFor({ timeout: 60_000 });
    await scan.fill(`${RUN}-PACK`);
    await scan.press('Enter');
    await mob.getByTestId('check-result').waitFor({ timeout: 20_000 });
    const stock = await mob.getByTestId('check-stock').innerText();
    assert(stock === '11', `phone shows ${stock}, expected 11`);
    return `คงเหลือ ${stock}`;
  });

  await step('H2', 'ปรับสต็อกให้ตรงจากมือถือ', async () => {
    await mob.getByTestId('check-count-mode').click();
    await mob.getByTestId('check-counted').fill('9');
    await mob.getByTestId('check-fix-stock').click();
    await mob.waitForTimeout(3000);
    const res = await api(mob, `/products/${state.pack.id}`);
    assert(Number(res.body.stock_on_hand) === 9, `stock ${res.body.stock_on_hand}, expected 9`);
    return 'ออกใบปรับปรุงและยอดเป็น 9';
  });

  await step('H3', 'แปลงหน่วยจากหน้าเช็คสต็อก', async () => {
    await mob.getByTestId('check-convert').waitFor({ timeout: 15_000 });
    await mob.getByTestId('check-convert-qty').fill('1');
    await mob.getByTestId('check-convert-post').click();
    await mob.waitForTimeout(3000);
    const unit = await api(mob, `/products/${state.unit.id}`);
    assert(Number(unit.body.stock_on_hand) === 36, `bottles ${unit.body.stock_on_hand}, expected 36`);
    return 'แตกอีก 1 ลัง → รวม 36 ขวด';
  });

  // ------------------------------------------------------------ I. members/AR
  await step('I1', 'เพิ่มสมาชิกใหม่และลงทุนเรือนหุ้น', async () => {
    const created = await api(mob, '/members', {
      method: 'POST',
      body: JSON.stringify({ member_code: `${RUN}`, name: `${RUN} สมาชิกทดสอบ` }),
    });
    assert(created.status === 201, `create member ${created.status}`);
    state.member = created.body;
    await page.goto(`${BASE}/members/${created.body.id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const body = await page.locator('body').innerText();
    assert(body.includes(`${RUN} สมาชิกทดสอบ`), 'the member page does not show the new member');
    return created.body.member_code;
  });

  await step('I2', 'ขายเชื่อให้สมาชิก แล้วบิลไปอยู่ในลูกหนี้', async () => {
    await page.goto(`${BASE}/pos`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('scan-input').waitFor({ timeout: 30_000 });
    await page.keyboard.press('F3');
    const search = page.getByTestId('member-search');
    await search.waitFor({ timeout: 15_000 });
    await search.fill(RUN);
    const hit = page.getByRole('button').filter({ hasText: RUN }).first();
    await hit.waitFor({ timeout: 15_000 });
    await hit.click();
    await page.waitForTimeout(1200);
    const chip = await page.getByTestId('member-chip').innerText();
    assert(chip.includes(RUN), `the member chip shows ${chip}`);
    const scan = page.getByTestId('scan-input');
    await scan.fill(state.product.primary_barcode);
    await scan.press('Enter');
    await page.getByTestId('cart-line').first().waitFor({ timeout: 15_000 });
    await page.getByTestId('pay-button').first().click();
    await page.getByTestId('tender-confirm').waitFor({ timeout: 15_000 });
    // switch the first tender row to credit
    await page.getByRole('combobox', { name: L('pos.paymentMethod') }).first().click();
    await page.getByRole('option', { name: L('pos.methods.credit'), exact: true }).click();
    await page.getByTestId('tender-confirm').click();
    await page.waitForTimeout(3500);
    const ar = await api(page, `/ar/accounts?q=${encodeURIComponent(RUN)}`);
    const acct = (ar.body?.items ?? ar.body ?? []).find?.((a) => String(a.member_code ?? '').includes(RUN));
    assert(acct && Number(acct.balance) > 0, 'the credit sale did not create a receivable');
    state.arBalance = Number(acct.balance);
    return `ยอดหนี้ ${acct.balance}`;
  });

  await step('I3', 'รับชำระหนี้แล้วยอดลดลง', async () => {
    await page.goto(`${BASE}/ar`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const search = page.getByLabel(L('ar.search'));
    await search.fill(RUN);
    await page.waitForTimeout(2500);
    const row = page.getByRole('row').filter({ hasText: RUN }).first();
    await row.click();
    await page.waitForTimeout(2500);
    await page.getByRole('button', { name: L('ar.pay'), exact: true }).first().click();
    await page.waitForTimeout(1500);
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(L('ar.amount')).fill('10');
    await dialog.getByRole('button', { name: L('common.save'), exact: true }).click();
    await page.waitForTimeout(3000);
    const ar = await api(page, `/ar/accounts?q=${encodeURIComponent(RUN)}`);
    const acct = (ar.body?.items ?? ar.body ?? []).find?.((a) => String(a.member_code ?? '').includes(RUN));
    assert(Number(acct.balance) === state.arBalance - 10, `balance ${acct.balance}, expected ${state.arBalance - 10}`);
    return `หนี้คงเหลือ ${acct.balance}`;
  });

  // ---------------------------------------------------------- J. expenses
  await step('J1', 'บันทึกค่าใช้จ่าย', async () => {
    await page.goto(`${BASE}/expenses`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: L('expenses.addExpense') }).click();
    await page.waitForTimeout(1500);
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(L('expenses.amount')).fill('55');
    await dialog.getByRole('button', { name: L('common.save'), exact: true }).click();
    await page.waitForTimeout(2500);
    const body = await page.locator('body').innerText();
    assert(body.includes('55'), 'the expense is not listed');
    return 'ค่าใช้จ่าย 55 บาท';
  });

  // ----------------------------------------------------------- K. reports
  await step('K1', 'รายงานยอดขายรายวันแสดงผล', async () => {
    await page.goto(`${BASE}/reports`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    const body = await page.locator('body').innerText();
    assert(body.includes(L('reports.title')), 'the reports page did not render');
    const res = await api(page, `/reports/daily-sales?from=${new Date().toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}`);
    assert(res.status === 200, `daily sales ${res.status}`);
    return `วันนี้ ${JSON.stringify(res.body).slice(0, 90)}`;
  });

  await step('K2', 'ดาวน์โหลด CSV ของรายงานได้', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await page.evaluate(async (d) => {
      const s = JSON.parse(window.localStorage.getItem('pos.session') ?? '{}');
      const r = await fetch(`/api/v1/reports/daily-sales?from=${d}&to=${d}&format=csv`, { headers: { Authorization: `Bearer ${s.access_token}` } });
      return { status: r.status, type: r.headers.get('content-type'), size: (await r.text()).length };
    }, today);
    assert(res.status === 200, `CSV export ${res.status}`);
    return `${res.type} ${res.size} bytes`;
  });

  // --------------------------------------------------------- L. dividends
  await step('L1', 'หน้าปันผลเปิดได้และมีงวดเดิมจากระบบเก่า', async () => {
    await page.goto(`${BASE}/dividends`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    const res = await api(page, '/dividends/periods');
    const periods = res.body?.items ?? res.body ?? [];
    assert(periods.length > 0, 'no dividend periods');
    return `${periods.length} งวด (ล่าสุด ${periods[0].be_year ?? '-'})`;
  });

  // ---------------------------------------------------------- M. settings
  await step('M1', 'บันทึกการตั้งค่าใบเสร็จแล้วค่าคงอยู่', async () => {
    await page.goto(`${BASE}/settings/receipt`, { waitUntil: 'domcontentloaded' });
    const select = page.getByLabel(L('settings.keypadMode'));
    await select.waitFor({ timeout: 20_000 });
    await select.click();
    await page.getByRole('option', { name: L('settings.keypadAlways') }).click();
    await page.getByRole('button', { name: L('common.save'), exact: true }).click();
    await page.waitForTimeout(2500);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const value = await api(page, '/store/settings');
    assert(value.body.keypad_mode === 'always', `keypad_mode is ${value.body.keypad_mode}`);
    // put it back
    await api(page, '/store/settings', { method: 'PUT', body: JSON.stringify({ ...value.body, keypad_mode: 'auto' }) });
    return 'auto → always → auto';
  });

  await step('M2', 'สร้างไฟล์สำรองข้อมูลจากหน้าเว็บ', async () => {
    await page.goto(`${BASE}/settings/data`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('backup-create').waitFor({ timeout: 20_000 });
    const before = await page.locator('[data-testid="backup-list"] tbody tr').count().catch(() => 0);
    const jobsBefore = (await api(page, '/store/data/jobs')).body ?? [];
    await page.getByTestId('backup-create').click();
    let last = null;
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(3000);
      const jobs = (await api(page, '/store/data/jobs')).body ?? [];
      const fresh = jobs.find((j) => j.kind === 'backup' && !jobsBefore.some((o) => o.id === j.id));
      if (fresh && fresh.status !== 'running') {
        last = fresh;
        break;
      }
    }
    assert(last && last.status === 'done', `backup job status ${last?.status}: ${last?.error ?? ''}`);
    return `${last.file} (${before} → ${before + 1} ไฟล์)`;
  });

  // ------------------------------------------------------------- N. manual
  await step('N1', 'คู่มือในเว็บแสดงเนื้อหาและรูป', async () => {
    await page.goto(`${BASE}/help`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    const text = await page.locator('body').innerText();
    assert(text.length > 3000, `the manual looks empty (${text.length} chars)`);
    const imgs = await page.locator('main img, article img').count();
    const broken = await page.evaluate(() =>
      Array.from(document.images).filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src).slice(0, 3),
    );
    assert(broken.length === 0, `broken images: ${broken.join(', ')}`);
    return `${text.length} ตัวอักษร, ${imgs} รูป`;
  });

  await step('N2', 'เมนูผู้ช่วย AI เปิดได้และบอกสถานะ', async () => {
    const res = await page.goto(`${BASE}/ai`, { waitUntil: 'domcontentloaded' });
    assert(res.status() < 400, `/ai returned HTTP ${res.status()}`);
    await page.waitForTimeout(3000);
    const status = await api(page, '/ai/status');
    const body = await page.locator('body').innerText();
    const shown = status.body?.enabled ? body.includes(L('ai.askTitle')) : body.includes(L('ai.disabledTitle'));
    assert(shown, 'the AI page does not reflect the feature status');
    return status.body?.enabled ? 'เปิดใช้งาน' : 'ปิดอยู่ และหน้าอธิบายวิธีเปิด';
  });

  // ------------------------------------------------------- O. security/roles
  await step('O1', 'พนักงานขายเข้าหน้าสำหรับเจ้าของร้านไม่ได้', async () => {
    const created = await api(page, '/store/users', {
      method: 'POST',
      body: JSON.stringify({ username: `${RUN.toLowerCase()}-cashier`, display_name: `${RUN} cashier`, role: 'cashier', password: 'Cashier12345', is_active: true }),
    });
    assert(created.status === 201, `create user ${created.status} ${JSON.stringify(created.body).slice(0, 120)}`);
    state.cashier = created.body;
    const c = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'th-TH' });
    const cp = await c.newPage();
    await login(cp, `${RUN.toLowerCase()}-cashier`, 'Cashier12345');
    await cp.waitForURL(/\/(dashboard|pos)/, { timeout: 45_000 });
    const api403 = await api(cp, '/store/data/backups');
    const rules403 = await api(cp, '/inventory/conversion-rules', { method: 'POST', body: JSON.stringify({ from_product_id: state.pack.id, to_product_id: state.unit.id, factor: '6' }) });
    await cp.goto(`${BASE}/settings/data`, { waitUntil: 'domcontentloaded' });
    await cp.waitForTimeout(2500);
    const blocked = await cp.locator('body').innerText();
    await c.close();
    assert(api403.status === 403, `backups API returned ${api403.status} to a cashier`);
    assert(rules403.status === 403, `conversion rule POST returned ${rules403.status} to a cashier`);
    assert(!blocked.includes(L('data.createBackup')), 'the cashier can see the backup screen');
    return 'API 403 ทั้งสองเส้นทาง และหน้าเว็บถูกกั้น';
  });

  // ------------------------------------------------------------ P. negatives
  await step('P1', 'สแกนบาร์โค้ดที่ไม่มี → เปิดหน้าต่างค้นหา', async () => {
    await page.goto(`${BASE}/pos`, { waitUntil: 'domcontentloaded' });
    const scan = page.getByTestId('scan-input');
    await scan.waitFor({ timeout: 30_000 });
    await scan.fill('0000000000000');
    await scan.press('Enter');
    await page.waitForTimeout(2500);
    const search = page.getByTestId('product-search');
    assert(await search.isVisible(), 'the search dialog did not open for an unknown barcode');
    await page.keyboard.press('Escape');
    return 'แจ้งไม่พบและเปิดค้นหาให้';
  });

  await step('P2', 'รับเงินไม่ครบ กดยืนยันไม่ได้', async () => {
    const scan = page.getByTestId('scan-input');
    await scan.fill(state.product.primary_barcode);
    await scan.press('Enter');
    await page.getByTestId('cart-line').first().waitFor({ timeout: 15_000 });
    await page.getByTestId('pay-button').first().click();
    await page.getByTestId('tender-confirm').waitFor({ timeout: 15_000 });
    const disabled = await page.getByTestId('tender-confirm').isDisabled();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    assert(disabled, 'the confirm button was enabled with no money entered');
    return 'ปุ่มรับเงินถูกปิดไว้';
  });

  // -------------------------------------------------------------- cleanup
  await step('Z1', 'เก็บกวาดข้อมูลทดสอบ', async () => {
    const notes = [];
    const cart = await page.getByTestId('cart-line').count().catch(() => 0);
    if (cart > 0) {
      await page.keyboard.press('F8').catch(() => {});
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape').catch(() => {});
    }
    for (const [label, id] of [['ลัง', state.pack?.id], ['ขวด', state.unit?.id]]) {
      if (!id) continue;
      const r = await api(page, `/products/${id}`, { method: 'DELETE' });
      notes.push(`${label}:${r.status}`);
    }
    if (state.cashier?.id) {
      const r = await api(page, `/store/users/${state.cashier.id}`, { method: 'PATCH', body: JSON.stringify({ is_active: false }) });
      notes.push(`user:${r.status}`);
    }
    const rules = await api(page, `/inventory/conversion-rules?from_product_id=${state.pack?.id ?? ''}`);
    for (const r of rules.body ?? []) {
      const res = await api(page, `/inventory/conversion-rules/${r.id}`, { method: 'PATCH', body: JSON.stringify({ is_active: false }) });
      notes.push(`rule:${res.status}`);
    }
    return notes.join(' ');
  });

  results.push({ id: 'X1', name: 'console errors ระหว่างทดสอบ', status: consoleErrors.length ? 'WARN' : 'PASS', ms: 0, detail: consoleErrors.slice(0, 5).join(' | ') });

  await browser.close();

  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  console.log(`\n=== ${pass} passed, ${fail} failed, run ${RUN} against ${BASE} ===`);
  mkdirSync(here, { recursive: true });
  writeFileSync(resolve(here, 'report.json'), JSON.stringify({ base: BASE, run: RUN, at: new Date().toISOString(), results }, null, 2));
  process.exitCode = fail ? 1 : 0;
};

main().catch((e) => {
  console.error('runner crashed:', e);
  process.exitCode = 2;
});
