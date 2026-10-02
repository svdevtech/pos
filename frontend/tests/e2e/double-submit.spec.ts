import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * บ้านแก่นใต้, 2 Oct 2026: bills N6910-00282 and N6910-00283 were the same ฿495 cart, posted
 * 17 ms apart. The server logged two POST /sales (rid …104169, …104170) and the page then fetched
 * two receipts, so the browser sent the cart twice from one confirm.
 *
 * The till is mocked at the network layer, with the sale answering in 43 ms as the live server did.
 * What matters is only how many POST /sales leave the page for one action at the confirm button.
 */

const STORE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ID = '33333333-3333-4333-8333-333333333333';
const SALE_ID = '55555555-5555-4555-8555-555555555555';
const BARCODE = '8850001234567';

const session = {
  access_token: 'test-access',
  refresh_token: 'test-refresh',
  expires_at: '2099-01-01T00:00:00Z',
  user: { id: USER_ID, store_id: STORE_ID, username: 'cashier1', display_name: 'Cashier One', role: 'cashier', locale: 'th', must_reset_password: false },
  store: { id: STORE_ID, code: 'S1', name: 'ร้านทดสอบ', default_locale: 'th' },
  selected_store: { id: STORE_ID, code: 'S1', name: 'ร้านทดสอบ', default_locale: 'th' },
};

const product = {
  id: PRODUCT_ID,
  sku: 'P001',
  name: 'น้ำดื่ม 600ml',
  name_en: 'Drinking water 600ml',
  sell_price: '25.00',
  stock_on_hand: '120',
  is_serial: false,
  is_active: true,
  is_archived: false,
  unit_name: 'ขวด',
  primary_barcode: BARCODE,
  barcodes: [],
  price_tiers: {},
  stock_level: 'ok',
  scanned_barcode: BARCODE,
  pack_qty: '1',
};

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** Mocks the till and counts the sales posted. */
async function mockTill(page: Page): Promise<{ sales: number[] }> {
  const sales: number[] = [];
  await page.route('**/api/v1/**', (route) => json(route, { error: { code: 'NOT_FOUND', message: 'not found' } }, 404));
  await page.route('**/api/v1/store/settings', (route) => json(route, { require_shift: false, allow_price_edit: false, paper_width: 80 }));
  await page.route('**/api/v1/store', (route) => json(route, { id: STORE_ID, code: 'S1', name: 'ร้านทดสอบ' }));
  await page.route('**/api/v1/shifts/current', (route) =>
    json(route, { shift: { id: '44444444-4444-4444-8444-444444444444', store_id: STORE_ID, cashier_id: USER_ID, cashier_name: 'Cashier One', terminal: 'POS1', opened_at: '2026-10-02T01:00:00Z', opening_float: '500.00', cash_sales: '0.00', cash_in: '0.00', cash_out: '0.00', status: 'open' } }),
  );
  await page.route('**/api/v1/held-bills', (route) => json(route, []));
  await page.route('**/api/v1/products/by-barcode/*', (route) => json(route, product));
  await page.route('**/api/v1/sales/quote', (route) =>
    json(route, { gross: '25.00', line_discount: '0.00', bill_discount: '0.00', net: '25.00', lines: [{ product_id: PRODUCT_ID, sku: 'P001', description: product.name, qty: 1, unit_price: '25.00', discount: '0.00', line_total: '25.00', is_free: false }] }),
  );
  await page.route('**/api/v1/sales', async (route) => {
    if (route.request().method() !== 'POST') return json(route, { items: [], total: 0, page: 1, page_size: 50 });
    sales.push(Date.now());
    // the live server answered in 43 ms; the second request left well inside that window
    await new Promise((r) => setTimeout(r, 43));
    const sale = { id: SALE_ID, doc_no: 'N6910-00282', status: 'completed', net: '25.00', change_amount: '0.00', sold_at: new Date().toISOString(), lines: [], payments: [] };
    void page.route(`**/api/v1/sales/${SALE_ID}/receipt`, (r) => json(r, { sale, store: { name: 'ร้านทดสอบ' }, lines: [] }));
    void page.route(`**/api/v1/sales/${SALE_ID}`, (r) => json(r, sale));
    return json(route, sale, 201);
  });
  return { sales };
}

async function cartWithOneLine(page: Page) {
  await page.goto('/pos');
  const scan = page.getByTestId('scan-input');
  await expect(scan).toBeVisible();
  await scan.fill(BARCODE);
  await scan.press('Enter');
  await expect(page.getByTestId('cart-line')).toHaveCount(1);
  await page.keyboard.press('F9');
  await expect(page.getByTestId('tender-net')).toBeVisible();
  await page.getByTestId('quick-100').click();
  await expect(page.getByTestId('tender-confirm')).toBeEnabled();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, JSON.stringify(value));
      window.localStorage.setItem('pos.autoPrint', '0');
      window.localStorage.setItem('pos.terminal', 'POS1');
    },
    { key: 'pos.session', value: session },
  );
});

test('one Enter on the focused confirm button posts the sale once', async ({ page }) => {
  const captured = await mockTill(page);
  await cartWithOneLine(page);
  await page.getByTestId('tender-confirm').focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
  expect(captured.sales.length).toBe(1);
});

test('a bouncing mouse switch (two clicks 17 ms apart) must not post the sale twice', async ({ page }) => {
  const captured = await mockTill(page);
  await cartWithOneLine(page);
  const box = (await page.getByTestId('tender-confirm').boundingBox())!;
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(17);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(2000);
  expect(captured.sales.length).toBe(1);
});

// The till at the shop is a slow PC. When the two clicks land before React has re-rendered the
// button into its "saving" state, the guard in TenderDialog.confirm still reads busy === false.
test('a slow till must not post the sale twice when the switch bounces', async ({ page, context }) => {
  const cdp = await context.newCDPSession(page);
  const captured = await mockTill(page);
  await cartWithOneLine(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 20 });
  const box = (await page.getByTestId('tender-confirm').boundingBox())!;
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(17);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(6000);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  expect(captured.sales.length).toBe(1);
});

test('two quick Enters must not post the sale twice', async ({ page }) => {
  const captured = await mockTill(page);
  await cartWithOneLine(page);
  await page.getByTestId('tender-confirm').focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(17);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
  expect(captured.sales.length).toBe(1);
});
