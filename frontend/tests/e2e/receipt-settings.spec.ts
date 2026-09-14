import { expect, test, type Page, type Route } from '@playwright/test';
import th from '../../i18n/messages/th.json';

/**
 * The three ตั้งค่า → ใบเสร็จ switches that used to save a value and change nothing: the shop logo,
 * cash rounding, and the language the receipt prints in.
 *
 * Each test reads the receipt the dialog actually built, which is the same markup the printer gets.
 */

const STORE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const SALE_ID = '55555555-5555-4555-8555-555555555555';
const DOC_NO = 'N6909-00042';

/** A 2×2 PNG: one white pixel, one mid-grey, two near-black. Thresholding must keep it 2 colours. */
const LOGO_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAF0lEQVQIW2P8//8/AzpgYkAD1BFgZGQEAFMHAwF8W3Q3AAAAAElFTkSuQmCC';

const session = {
  access_token: 'test-access',
  refresh_token: 'test-refresh',
  expires_at: '2099-01-01T00:00:00Z',
  user: { id: USER_ID, store_id: STORE_ID, username: 'owner', display_name: 'Owner', role: 'store_owner', locale: 'th', must_reset_password: false },
  store: { id: STORE_ID, code: 'S1', name: 'ร้านทดสอบ', name_en: 'Test Store', default_locale: 'th' },
  selected_store: { id: STORE_ID, code: 'S1', name: 'ร้านทดสอบ', name_en: 'Test Store', default_locale: 'th' },
};

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

interface Options {
  /** What the store settings say; merged over the defaults. */
  settings?: Record<string, unknown>;
  hasLogo?: boolean;
  /** Cash rounding the server applied to this bill (already inside net). */
  rounding?: string;
}

async function mockApi(page: Page, opts: Options = {}) {
  const gross = '12.99';
  const rounding = opts.rounding ?? '0.00';
  const net = (Number(gross) + Number(rounding)).toFixed(2);
  const logoHits = { count: 0 };

  const sale = {
    id: SALE_ID,
    store_id: STORE_ID,
    doc_no: DOC_NO,
    sold_at: '2026-09-14T03:15:00Z',
    cashier_id: USER_ID,
    cashier_name: 'Owner',
    gross,
    discount: '0.00',
    bill_discount: '0.00',
    vat: '0.00',
    rounding,
    net,
    tendered: net,
    change_amount: '0.00',
    status: 'completed',
    ar_status: 'none',
    ar_total: '0.00',
    ar_paid: '0.00',
    ar_balance: '0.00',
    lines: [
      {
        id: 'l1',
        sale_id: SALE_ID,
        line_no: 1,
        product_id: 'p1',
        sku: 'P001',
        description: 'กระเทียม แบ่งขาย',
        qty: '3',
        unit_price: '4.33',
        discount: '0.00',
        line_total: gross,
        is_free: false,
        unit_name: 'ถุง',
      },
    ],
    payments: [{ id: 'pay-1', sale_id: SALE_ID, method: 'cash', amount: net }],
  };

  await page.route('**/api/v1/**', (route) => json(route, { error: { code: 'NOT_FOUND', message: 'not found' } }, 404));
  await page.route('**/api/v1/store/settings', (route) => json(route, { require_shift: false, paper_width: 58, ...(opts.settings ?? {}) }));
  await page.route('**/api/v1/store', (route) =>
    json(route, { id: STORE_ID, code: 'S1', name: 'ร้านทดสอบ', name_en: 'Test Store', has_logo: Boolean(opts.hasLogo) }),
  );
  await page.route('**/api/v1/store/logo', (route) => {
    logoHits.count += 1;
    if (!opts.hasLogo) return json(route, { error: { code: 'NOT_FOUND', message: 'no logo' } }, 404);
    return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(LOGO_PNG, 'base64') });
  });
  // an open shift, or the POS greets the cashier with the open-shift dialog and swallows F7
  await page.route('**/api/v1/shifts/current', (route) =>
    json(route, {
      shift: {
        id: '66666666-6666-4666-8666-666666666666',
        store_id: STORE_ID,
        cashier_id: USER_ID,
        cashier_name: 'Owner',
        terminal: 'POS1',
        opened_at: '2026-09-14T01:00:00Z',
        opening_float: '500.00',
        cash_sales: '0.00',
        cash_in: '0.00',
        cash_out: '0.00',
        status: 'open',
      },
    }),
  );
  await page.route('**/api/v1/held-bills', (route) => json(route, []));
  await page.route('**/api/v1/products?*', (route) => json(route, { items: [], total: 0, page: 1, page_size: 30 }));
  await page.route('**/api/v1/sales?*', (route) => json(route, { items: [sale], total: 1, page: 1, page_size: 50 }));
  await page.route(`**/api/v1/sales/${SALE_ID}/receipt`, (route) =>
    json(route, {
      store: { id: STORE_ID, code: 'S1', name: 'ร้านทดสอบ', name_en: 'Test Store', address: '49 หมู่ 5', phone: '096-2322861', has_logo: Boolean(opts.hasLogo) },
      settings: { paper_width: 58, ...(opts.settings ?? {}) },
      sale,
      returns: null,
    }),
  );
  await page.route(`**/api/v1/sales/${SALE_ID}`, (route) => json(route, sale));
  return { logoHits, sale };
}

/** Opens the reprint dialog for the one mocked bill through the history drawer (F7). */
async function openReceipt(page: Page) {
  await page.goto('/pos');
  await page.getByTestId('scan-input').waitFor();
  await page.keyboard.press('F7');
  await page.getByRole('button', { name: th.pos.reprint, exact: true }).first().click({ timeout: 20_000 });
  const preview = page.getByTestId('receipt-preview');
  await preview.waitFor({ timeout: 15_000 });
  return preview;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((value) => {
    window.localStorage.setItem('pos.session', JSON.stringify(value));
    window.localStorage.setItem('pos.autoPrint', '0');
  }, session);
});

test('cash rounding shows on the bill as its own line, never folded into the total', async ({ page }) => {
  await mockApi(page, { settings: { rounding: 0.25 }, rounding: '0.01' });
  const preview = await openReceipt(page);

  await expect(preview).toContainText('ปัดเศษ');
  await expect(preview).toContainText('+0.01');
  // the line total is untouched and the payable figure is the rounded one
  await expect(preview).toContainText('12.99');
  await expect(preview).toContainText('13.00');
});

test('a bill that needed no rounding carries no rounding line', async ({ page }) => {
  await mockApi(page, { settings: { rounding: 0.25 } });
  const preview = await openReceipt(page);
  await expect(preview).not.toContainText('ปัดเศษ');
});

test('the shop logo is printed, reduced to the two colours a thermal head has', async ({ page }) => {
  await mockApi(page, { hasLogo: true, settings: { show_logo: true } });
  const preview = await openReceipt(page);

  const img = preview.locator('img.lg');
  await expect(img).toHaveCount(1);
  const src = await img.getAttribute('src');
  expect(src).toMatch(/^data:image\/png;base64,/); // embedded, or the print iframe would race the load

  // every pixel came out pure black or pure white — no grey for the printer to dither
  const shades = await page.evaluate(
    (dataUrl) =>
      new Promise<number[]>((resolve) => {
        const im = new Image();
        im.onload = () => {
          const c = document.createElement('canvas');
          c.width = im.naturalWidth;
          c.height = im.naturalHeight;
          const ctx = c.getContext('2d')!;
          ctx.drawImage(im, 0, 0);
          const px = ctx.getImageData(0, 0, c.width, c.height).data;
          const seen = new Set<number>();
          for (let i = 0; i < px.length; i += 4) seen.add(px[i]);
          resolve([...seen].sort((a, b) => a - b));
        };
        im.src = dataUrl;
      }),
    src as string,
  );
  expect(shades.every((v) => v === 0 || v === 255)).toBe(true);
});

test('a shop that turned the logo off gets no logo, and the image is never fetched', async ({ page }) => {
  const { logoHits } = await mockApi(page, { hasLogo: true, settings: { show_logo: false } });
  const preview = await openReceipt(page);
  await expect(preview.locator('img.lg')).toHaveCount(0);
  expect(logoHits.count).toBe(0);
});

test('the receipt prints in the language the shop chose, not the one on screen', async ({ page }) => {
  await mockApi(page, { settings: { receipt_locale: 'en' } });
  const preview = await openReceipt(page);

  // the screen is Thai — the POS toolbar proves it — while the paper came out English
  await expect(page.getByTestId('scan-input')).toBeVisible();
  await expect(preview).toContainText('Receipt');
  await expect(preview).toContainText('Cashier');
  await expect(preview).toContainText('Test Store'); // and the English shop name is used
  await expect(preview).not.toContainText('ใบเสร็จ');
});

test('with no language chosen the receipt follows the screen, as it always did', async ({ page }) => {
  await mockApi(page);
  const preview = await openReceipt(page);
  await expect(preview).toContainText('ใบเสร็จ');
  await expect(preview).toContainText('ร้านทดสอบ');
});
