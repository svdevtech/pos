import { expect, test, type Page, type Route } from '@playwright/test';
import { QR_CODE } from '../global-setup';

/**
 * Real decoding test: the browser's fake camera plays a video of an actual QR code (see
 * tests/fixtures/make-qr-video.mjs) and the app has to read it with the bundled ZXing decoder —
 * the same path an iPad takes, since Safari has no BarcodeDetector.
 *
 * It also pins the rescan rule: a symbol sitting in front of the lens decodes dozens of times a
 * second and must still be added to the cart exactly once.
 */

const STORE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ID = '33333333-3333-4333-8333-333333333333';

const session = {
  access_token: 'test-access',
  refresh_token: 'test-refresh',
  expires_at: '2099-01-01T00:00:00Z',
  user: { id: USER_ID, store_id: STORE_ID, username: 'cashier1', display_name: 'Cashier One', role: 'cashier', locale: 'th', must_reset_password: false },
  store: { id: STORE_ID, code: 'S1', name: 'ร้านทดสอบ', default_locale: 'th' },
  selected_store: { id: STORE_ID, code: 'S1', name: 'ร้านทดสอบ', default_locale: 'th' },
};

/** The QR content is registered as this product's barcode — QR labels are printed by some suppliers. */
const product = {
  id: PRODUCT_ID,
  sku: 'P-QR',
  name: 'สินค้าทดสอบ QR',
  sell_price: '25.00',
  stock_on_hand: '10',
  is_serial: false,
  is_active: true,
  is_archived: false,
  unit_name: 'ชิ้น',
  primary_barcode: QR_CODE,
  barcodes: [],
  price_tiers: {},
  stock_level: 'ok',
  scanned_barcode: QR_CODE,
  pack_qty: '1',
};

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function mockApi(page: Page): Promise<{ lookups: string[] }> {
  const lookups: string[] = [];
  await page.route('**/api/v1/**', (route) => json(route, { error: { code: 'NOT_FOUND', message: 'not found' } }, 404));
  await page.route('**/api/v1/store/settings', (route) => json(route, { require_shift: false }));
  await page.route('**/api/v1/store', (route) => json(route, { id: STORE_ID, code: 'S1', name: 'ร้านทดสอบ' }));
  await page.route('**/api/v1/shifts/current', (route) => json(route, { shift: { id: 'shift-1', status: 'open' } }));
  await page.route('**/api/v1/held-bills', (route) => json(route, []));
  await page.route('**/api/v1/products/by-barcode/*', (route) => {
    const code = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() ?? '');
    lookups.push(code);
    return code === QR_CODE ? json(route, product) : json(route, { error: { code: 'NOT_FOUND', message: 'no' } }, 404);
  });
  await page.route('**/api/v1/sales/quote', (route) =>
    json(route, { gross: '25.00', line_discount: '0.00', bill_discount: '0.00', net: '25.00', lines: [] }),
  );
  return { lookups };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((value) => {
    window.localStorage.setItem('pos.session', JSON.stringify(value));
    window.localStorage.setItem('pos.autoPrint', '0');
  }, session);
});

test('camera reads a QR code and adds it once while it stays in frame', async ({ page }) => {
  const captured = await mockApi(page);
  await page.goto('/pos');

  await page.getByTestId('scan-camera').click();
  await expect(page.getByTestId('camera-scan-view')).toBeVisible();

  await expect(page.getByTestId('cart-line')).toHaveCount(1, { timeout: 20_000 });
  await expect(page.getByTestId('camera-scan-log')).toContainText(product.name);
  await expect(page.getByTestId('camera-scan-error')).toHaveCount(0);
  expect(captured.lookups).toEqual([QR_CODE]);

  // the QR is still in front of the lens and keeps decoding — it must not pile up
  await page.waitForTimeout(4000);
  expect(captured.lookups).toEqual([QR_CODE]);
  await expect(page.getByTestId('cart-line')).toHaveCount(1);
});
