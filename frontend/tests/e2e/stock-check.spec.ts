import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Phone stock check: scan an item, see what the system thinks is on the shelf, and (for managers)
 * write the counted quantity into a stock take.
 */

const STORE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ID = '33333333-3333-4333-8333-333333333333';
const TAKE_ID = '44444444-4444-4444-8444-444444444444';
const BARCODE = '8850001234567';

const session = {
  access_token: 'test-access',
  refresh_token: 'test-refresh',
  expires_at: '2099-01-01T00:00:00Z',
  user: { id: USER_ID, store_id: STORE_ID, username: 'owner', display_name: 'Owner', role: 'store_owner', locale: 'th', must_reset_password: false },
  store: { id: STORE_ID, code: 'S1', name: 'ร้านทดสอบ', default_locale: 'th' },
  selected_store: { id: STORE_ID, code: 'S1', name: 'ร้านทดสอบ', default_locale: 'th' },
};

const product = {
  id: PRODUCT_ID,
  sku: 'P001',
  name: 'น้ำดื่ม 600ml',
  sell_price: '10.00',
  cost_avg: '6.50',
  cost_last: '6.50',
  stock_on_hand: '24',
  min_level1: '6',
  min_level2: '0',
  is_serial: false,
  is_active: true,
  is_archived: false,
  unit_name: 'ขวด',
  category_name: 'เครื่องดื่ม',
  primary_barcode: BARCODE,
  barcodes: [],
  price_tiers: {},
  stock_level: 'ok',
  scanned_barcode: BARCODE,
  pack_qty: '1',
};

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

interface Captured {
  takes: unknown[];
  counts: unknown[];
}

async function mockApi(page: Page, opts: { openTake?: boolean } = {}): Promise<Captured> {
  const captured: Captured = { takes: [], counts: [] };
  const take = { id: TAKE_ID, doc_no: 'ST6909-00001', status: 'open', started_at: '2026-09-03T02:00:00Z', line_count: 0 };

  await page.route('**/api/v1/**', (route) => json(route, { error: { code: 'NOT_FOUND', message: 'not found' } }, 404));
  await page.route('**/api/v1/store/settings', (route) => json(route, {}));
  await page.route('**/api/v1/store', (route) => json(route, { id: STORE_ID, code: 'S1', name: 'ร้านทดสอบ' }));
  await page.route('**/api/v1/products/by-barcode/*', (route) => {
    const code = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() ?? '');
    return code === BARCODE ? json(route, product) : json(route, { error: { code: 'BARCODE_NOT_FOUND', message: 'ไม่พบบาร์โค้ด' } }, 404);
  });
  await page.route(`**/api/v1/products/${PRODUCT_ID}`, (route) => json(route, product));
  await page.route('**/api/v1/inventory/stock-takes?*', (route) =>
    json(route, { items: opts.openTake ? [take] : [], total: opts.openTake ? 1 : 0, page: 1, page_size: 20 }),
  );
  await page.route('**/api/v1/inventory/stock-takes', (route) => {
    captured.takes.push(route.request().postDataJSON());
    return json(route, take, 201);
  });
  await page.route(`**/api/v1/inventory/stock-takes/${TAKE_ID}/lines`, (route) => {
    captured.counts.push(route.request().postDataJSON());
    return json(route, { ...take, line_count: 1, lines: [] });
  });
  return captured;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((value) => window.localStorage.setItem('pos.session', JSON.stringify(value)), session);
});

test.describe('stock check', () => {
  test('scanning shows what the system has on hand', async ({ page }) => {
    await mockApi(page);
    await page.goto('/inventory/check');

    const scan = page.getByTestId('check-scan');
    await scan.fill(BARCODE);
    await scan.press('Enter');

    await expect(page.getByTestId('check-stock')).toHaveText('24');
    const card = page.getByTestId('check-result');
    await expect(card).toContainText(product.name);
    await expect(card).toContainText('เครื่องดื่ม');
    await expect(card).toContainText('฿ 6.50'); // average cost
    await expect(card).toContainText('฿ 156.00'); // 24 x 6.50 stock value
  });

  test('an unknown barcode says so instead of showing a stale item', async ({ page }) => {
    await mockApi(page);
    await page.goto('/inventory/check');

    const scan = page.getByTestId('check-scan');
    await scan.fill('0000000000000');
    await scan.press('Enter');

    await expect(page.getByRole('alert').first()).toContainText('0000000000000');
    await expect(page.getByTestId('check-result')).toHaveCount(0);
  });

  test('counting writes the scanned item into an open stock take', async ({ page }) => {
    const captured = await mockApi(page, { openTake: true });
    await page.goto('/inventory/check');

    const scan = page.getByTestId('check-scan');
    await scan.fill(BARCODE);
    await scan.press('Enter');
    await expect(page.getByTestId('check-stock')).toHaveText('24');

    await page.getByTestId('check-count-mode').click();
    await page.getByTestId('check-counted').fill('20');
    await expect(page.getByText('ต่างจากระบบ 4 (ขาด)')).toBeVisible();

    await page.getByTestId('check-save-count').click();
    await expect.poll(() => captured.counts.length).toBe(1);
    expect(captured.counts[0]).toEqual([{ product_id: PRODUCT_ID, counted_qty: '20.000', note: '' }]);
  });

  test('a new sheet started from the phone begins empty', async ({ page }) => {
    const captured = await mockApi(page);
    await page.goto('/inventory/check');

    await page.getByTestId('check-count-mode').click();
    await page.getByRole('button', { name: 'เปิดใบนับใหม่' }).click();

    await expect.poll(() => captured.takes.length).toBe(1);
    // empty = only the items actually scanned end up on the sheet, not all 6,600 products
    expect(captured.takes[0]).toMatchObject({ empty: true });
  });
});
