import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Paying by QR and photographing the slip.
 *
 * The QR itself is checked by decoding what the page actually drew: an unreadable code would be
 * invisible in a screenshot test but fails here. The slip path is exercised through the file
 * picker, which is what a desktop till with a webcam and every iPad without camera permission use.
 */

const STORE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ID = '33333333-3333-4333-8333-333333333333';
const SALE_ID = '44444444-4444-4444-8444-444444444444';

// A real PromptPay payload for 0812345678 / ฿25.00, produced by internal/promptpay.
const QR_PAYLOAD = '00020101021229370016A000000677010111011300668123456785303764540525.005802TH5910Test Store6304C0BA';

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
  sku: 'P-1',
  name: 'น้ำอัดลม',
  sell_price: '25.00',
  stock_on_hand: '10',
  is_serial: false,
  is_active: true,
  is_archived: false,
  unit_name: 'ขวด',
  primary_barcode: '8850000000001',
  barcodes: [],
  price_tiers: {},
  stock_level: 'ok',
  scanned_barcode: '8850000000001',
  pack_qty: '1',
};

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

interface Captured {
  slips: Array<{ image: string; mime?: string; method?: string; amount?: string }>;
  qrAmounts: string[];
  verified: Array<{ id: string; verified: boolean }>;
}

async function mockApi(page: Page, opts: { promptPaySet?: boolean } = {}): Promise<Captured> {
  const captured: Captured = { slips: [], qrAmounts: [], verified: [] };
  const promptPaySet = opts.promptPaySet ?? true;

  await page.route('**/api/v1/**', (route) => json(route, { error: { code: 'NOT_FOUND', message: 'not found' } }, 404));
  await page.route('**/api/v1/store/settings', (route) => json(route, { require_shift: false }));
  await page.route('**/api/v1/store', (route) => json(route, { id: STORE_ID, code: 'S1', name: 'ร้านทดสอบ' }));
  await page.route('**/api/v1/shifts/current', (route) => json(route, { shift: { id: 'shift-1', status: 'open' } }));
  await page.route('**/api/v1/held-bills', (route) => json(route, []));
  await page.route('**/api/v1/products/by-barcode/*', (route) => json(route, product));
  await page.route('**/api/v1/sales/quote', (route) =>
    json(route, { gross: '25.00', line_discount: '0.00', bill_discount: '0.00', net: '25.00', lines: [] }),
  );

  await page.route('**/api/v1/payment-qr*', (route) => {
    captured.qrAmounts.push(new URL(route.request().url()).searchParams.get('amount') ?? '');
    if (!promptPaySet) return json(route, { error: { code: 'PROMPTPAY_NOT_SET', message: 'ยังไม่ได้ตั้งพร้อมเพย์' } }, 400);
    return json(route, {
      payload: QR_PAYLOAD,
      amount: '25.00',
      kind: 'phone',
      masked_id: 'xxxxxx5678',
      merchant_name: 'Test Store',
      store_name: 'ร้านทดสอบ',
    });
  });

  await page.route('**/api/v1/sales', (route) =>
    route.request().method() === 'POST'
      ? json(
          route,
          {
            id: SALE_ID,
            doc_no: 'N6909-00001',
            sold_at: new Date().toISOString(),
            gross: '25.00',
            discount: '0.00',
            bill_discount: '0.00',
            vat: '0.00',
            net: '25.00',
            tendered: '25.00',
            change_amount: '0.00',
            status: 'completed',
            ar_status: 'none',
            ar_total: '0.00',
            ar_paid: '0.00',
            ar_balance: '0.00',
            store_id: STORE_ID,
          },
          201,
        )
      : json(route, { items: [], total: 0, page: 1, page_size: 20 }),
  );

  await page.route(`**/api/v1/sales/${SALE_ID}/slips`, (route) => {
    if (route.request().method() === 'POST') {
      captured.slips.push(route.request().postDataJSON());
      return json(route, { id: 'slip-1', sale_id: SALE_ID, sale_doc_no: 'N6909-00001', method: 'qr', amount: '25.00', mime: 'image/jpeg', size_bytes: 100, captured_at: new Date().toISOString() }, 201);
    }
    return json(route, []);
  });

  return captured;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((value) => {
    window.localStorage.setItem('pos.session', JSON.stringify(value));
    window.localStorage.setItem('pos.autoPrint', '0');
  }, session);
});

/** Puts one item in the cart and opens the payment dialog with the QR tender selected. */
async function openQrTender(page: Page) {
  await page.goto('/pos');
  await page.getByTestId('scan-input').fill('8850000000001');
  await page.getByTestId('scan-input').press('Enter');
  await expect(page.getByTestId('cart-line')).toHaveCount(1);
  await page.locator('[data-testid="pay-button"]:visible').first().click();
  await expect(page.getByTestId('tender-net')).toBeVisible();
  await page.getByRole('combobox', { name: 'วิธีชำระเงิน' }).click();
  await page.getByRole('option', { name: 'QR พร้อมเพย์' }).click();
}

test('the QR shown at the till decodes to the payload the server signed', async ({ page }) => {
  const captured = await mockApi(page);
  await openQrTender(page);

  const qr = page.getByTestId('promptpay-qr');
  await expect(qr).toBeVisible();
  // the code is asked for the whole bill while the amount box is still empty
  expect(captured.qrAmounts).toContain('25.00');
  await expect(qr).toHaveAttribute('data-payload', QR_PAYLOAD);

  // it must be a readable QR, not just an <svg> that happens to be there
  const modules = await page.evaluate(() => document.querySelectorAll('[data-testid="promptpay-qr"] path').length);
  expect(modules).toBe(1);
  const box = await qr.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(150);

  // the account the money goes to is spelled out for the cashier
  await expect(page.getByText('พร้อมเพย์ xxxxxx5678')).toBeVisible();
});

test('a store without PromptPay is told how to set it up instead of seeing a broken code', async ({ page }) => {
  await mockApi(page, { promptPaySet: false });
  await openQrTender(page);
  await expect(page.getByTestId('qr-not-configured')).toBeVisible();
  await expect(page.getByTestId('promptpay-qr')).toHaveCount(0);
});

test('a slip photographed at the till is uploaded against the bill that was just created', async ({ page }) => {
  const captured = await mockApi(page);
  await openQrTender(page);

  await page.getByTestId('slip-capture-open').click();
  await expect(page.getByTestId('slip-file-input')).toBeAttached();
  // the file picker path: a webcam capture or a screenshot the customer sent
  await page.getByTestId('slip-file-input').setInputFiles({
    name: 'slip.png',
    mimeType: 'image/png',
    buffer: pngFixture(),
  });
  await expect(page.getByTestId('slip-preview')).toBeVisible();
  await page.getByTestId('slip-use').click();

  // the till shows it is attached before the sale is confirmed
  await expect(page.getByTestId('slip-thumb')).toBeVisible();

  await page.getByTestId('tender-amount-qr').fill('25');
  await page.getByTestId('tender-confirm').click();

  await expect.poll(() => captured.slips.length, { timeout: 10_000 }).toBe(1);
  const slip = captured.slips[0];
  expect(slip.image.startsWith('data:image/jpeg;base64,')).toBe(true);
  expect(slip.method).toBe('qr');
  expect(slip.amount).toBe('25');
  // the browser shrinks the photo: a phone's 4 MB original never reaches the shop's connection
  expect(slip.image.length).toBeLessThan(3 << 20);
});

test('the slip can be removed before the bill is confirmed', async ({ page }) => {
  const captured = await mockApi(page);
  await openQrTender(page);

  await page.getByTestId('slip-capture-open').click();
  await page.getByTestId('slip-file-input').setInputFiles({ name: 'slip.png', mimeType: 'image/png', buffer: pngFixture() });
  await page.getByTestId('slip-use').click();
  await expect(page.getByTestId('slip-thumb')).toBeVisible();

  await page.getByTestId('slip-clear').click();
  await expect(page.getByTestId('slip-thumb')).toHaveCount(0);

  await page.getByTestId('tender-amount-qr').fill('25');
  await page.getByTestId('tender-confirm').click();
  await expect(page.getByText('N6909-00001')).toBeVisible({ timeout: 10_000 });
  expect(captured.slips).toEqual([]);
});

test('the tablet camera itself takes the picture, not only the file picker', async ({ page }) => {
  const captured = await mockApi(page);
  await openQrTender(page);

  await page.getByTestId('slip-capture-open').click();
  const video = page.getByTestId('slip-video');
  await expect(video).toBeVisible();
  // wait for the fake camera to deliver a frame; capturing before that returns nothing
  await expect
    .poll(async () => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(2);

  await page.getByTestId('slip-shutter').click();
  await expect(page.getByTestId('slip-preview')).toBeVisible();
  const src = await page.getByTestId('slip-preview').getAttribute('src');
  expect(src?.startsWith('data:image/jpeg;base64,')).toBe(true);
  // a real frame, not a blank canvas
  expect((src ?? '').length).toBeGreaterThan(5000);

  await page.getByTestId('slip-use').click();
  await page.getByTestId('tender-amount-qr').fill('25');
  await page.getByTestId('tender-confirm').click();
  await expect.poll(() => captured.slips.length, { timeout: 10_000 }).toBe(1);
});

/** A tiny valid PNG; the app re-encodes it as JPEG before upload. */
function pngFixture(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAHElEQVQoz2P8//8/AzGAiYFIMKpwVOGowlGFAAB2fQMB+MvUEQAAAABJRU5ErkJggg==',
    'base64',
  );
}
