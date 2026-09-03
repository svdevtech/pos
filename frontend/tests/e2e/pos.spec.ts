import { devices, expect, test, type Page, type Route } from '@playwright/test';

/**
 * POS cashier flow: scan -> tender -> receipt, fully mocked at the network layer
 * (page.route on /api/v1/**), so no backend is needed.
 */

const STORE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ID = '33333333-3333-4333-8333-333333333333';
const SHIFT_ID = '44444444-4444-4444-8444-444444444444';
const SALE_ID = '55555555-5555-4555-8555-555555555555';
const BARCODE = '8850001234567';
const DOC_NO = 'N6909-00042';

const session = {
  access_token: 'test-access',
  refresh_token: 'test-refresh',
  expires_at: '2099-01-01T00:00:00Z',
  user: {
    id: USER_ID,
    store_id: STORE_ID,
    username: 'cashier1',
    display_name: 'Cashier One',
    role: 'cashier',
    locale: 'th',
    must_reset_password: false,
  },
  store: { id: STORE_ID, code: 'S1', name: 'ร้านทดสอบ', name_en: 'Test Store', default_locale: 'th' },
  selected_store: { id: STORE_ID, code: 'S1', name: 'ร้านทดสอบ', name_en: 'Test Store', default_locale: 'th' },
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

const openShift = {
  id: SHIFT_ID,
  store_id: STORE_ID,
  cashier_id: USER_ID,
  cashier_name: 'Cashier One',
  terminal: 'POS1',
  opened_at: '2026-09-03T01:00:00Z',
  opening_float: '500.00',
  cash_sales: '0.00',
  cash_in: '0.00',
  cash_out: '0.00',
  status: 'open',
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function apiError(route: Route, status: number, code: string, message: string) {
  return json(route, { error: { code, message } }, status);
}

interface Captured {
  quotes: unknown[];
  sales: unknown[];
}

/** Installs the mocked backend. Returns the captured request bodies for assertions. */
async function mockApi(page: Page): Promise<Captured> {
  const captured: Captured = { quotes: [], sales: [] };

  // Catch-all first (later registrations take precedence in Playwright).
  await page.route('**/api/v1/**', (route) => apiError(route, 404, 'NOT_FOUND', 'not found'));

  await page.route('**/api/v1/store/settings', (route) => json(route, { require_shift: false, allow_price_edit: false, paper_width: 80 }));
  await page.route('**/api/v1/store', (route) => json(route, { id: STORE_ID, code: 'S1', name: 'ร้านทดสอบ', name_en: 'Test Store' }));
  await page.route('**/api/v1/shifts/current', (route) => json(route, { shift: openShift }));
  await page.route('**/api/v1/held-bills', (route) => json(route, []));
  await page.route('**/api/v1/auth/logout', (route) => route.fulfill({ status: 204 }));

  await page.route('**/api/v1/products/by-barcode/*', (route) => {
    const url = new URL(route.request().url());
    const code = decodeURIComponent(url.pathname.split('/').pop() ?? '');
    if (code === BARCODE) return json(route, product);
    return apiError(route, 404, 'NOT_FOUND', `ไม่พบบาร์โค้ด ${code}`);
  });

  await page.route('**/api/v1/products?*', (route) => json(route, { items: [product], total: 1, page: 1, page_size: 30 }));

  await page.route('**/api/v1/sales/quote', (route) => {
    const body = route.request().postDataJSON() as { lines: Array<{ product_id: string; qty: number; discount: number; is_free: boolean }> };
    captured.quotes.push(body);
    const lines = body.lines.map((l) => {
      const gross = l.qty * 25;
      const total = l.is_free ? 0 : Math.max(0, gross - l.discount);
      return {
        product_id: l.product_id,
        description: product.name,
        qty: String(l.qty),
        unit_price: '25.00',
        discount: String(l.discount),
        promo_discount: '0',
        line_total: total.toFixed(2),
        is_free: l.is_free,
      };
    });
    const gross = lines.reduce((s, l) => s + Number(l.qty) * 25, 0);
    const net = lines.reduce((s, l) => s + Number(l.line_total), 0);
    return json(route, { gross: gross.toFixed(2), line_discount: (gross - net).toFixed(2), bill_discount: '0.00', net: net.toFixed(2), lines });
  });

  await page.route('**/api/v1/sales', (route) => {
    if (route.request().method() !== 'POST') return json(route, { items: [], total: 0, page: 1, page_size: 50 });
    const body = route.request().postDataJSON() as {
      lines: Array<{ product_id: string; qty: number }>;
      payments: Array<{ method: string; amount: number }>;
    };
    captured.sales.push(body);
    const qty = body.lines.reduce((s, l) => s + l.qty, 0);
    const net = qty * 25;
    const cash = body.payments.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amount, 0);
    const sale = {
      id: SALE_ID,
      store_id: STORE_ID,
      doc_no: DOC_NO,
      sold_at: '2026-09-03T03:15:00Z',
      cashier_id: USER_ID,
      cashier_name: 'Cashier One',
      shift_id: SHIFT_ID,
      gross: net.toFixed(2),
      discount: '0.00',
      bill_discount: '0.00',
      vat: '0.00',
      net: net.toFixed(2),
      tendered: cash.toFixed(2),
      change_amount: (cash - net).toFixed(2),
      status: 'completed',
      ar_status: 'none',
      ar_total: '0.00',
      ar_paid: '0.00',
      ar_balance: '0.00',
      lines: body.lines.map((l, i) => ({
        id: `line-${i}`,
        sale_id: SALE_ID,
        line_no: i + 1,
        product_id: l.product_id,
        sku: product.sku,
        description: product.name,
        qty: String(l.qty),
        unit_price: '25.00',
        discount: '0.00',
        line_total: (l.qty * 25).toFixed(2),
        is_free: false,
        unit_name: product.unit_name,
      })),
      payments: body.payments.map((p, i) => ({ id: `pay-${i}`, sale_id: SALE_ID, method: p.method, amount: p.amount.toFixed(2) })),
    };
    // The receipt endpoint echoes the created sale.
    void page.route(`**/api/v1/sales/${SALE_ID}/receipt`, (r) =>
      json(r, {
        store: { id: STORE_ID, code: 'S1', name: 'ร้านทดสอบ', name_en: 'Test Store', address: '1 ถนนทดสอบ', phone: '02-000-0000', receipt_footer: 'ขอบคุณที่ใช้บริการ' },
        settings: { paper_width: 80 },
        sale,
        returns: null,
      }),
    );
    void page.route(`**/api/v1/sales/${SALE_ID}`, (r) => json(r, sale));
    return json(route, sale, 201);
  });

  return captured;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, JSON.stringify(value));
      // Do not trigger window.print() from the hidden iframe during tests.
      window.localStorage.setItem('pos.autoPrint', '0');
      window.localStorage.setItem('pos.terminal', 'POS1');
    },
    { key: 'pos.session', value: session },
  );
});

test.describe('POS cashier screen', () => {
  test('scan -> tender (cash) -> receipt -> new sale', async ({ page }) => {
    const captured = await mockApi(page);

    await page.goto('/pos');
    const scan = page.getByTestId('scan-input');
    await expect(scan).toBeVisible();
    await expect(scan).toBeFocused();

    // Scan one unit, then "2*" prefix to add two more (merges into the same line).
    await scan.fill(BARCODE);
    await scan.press('Enter');
    await expect(page.getByTestId('cart-line')).toHaveCount(1);
    await expect(page.getByTestId('line-total')).toHaveText('25');

    await scan.fill(`2*${BARCODE}`);
    await scan.press('Enter');
    await expect(page.getByTestId('cart-line')).toHaveCount(1);
    await expect(page.getByTestId('line-total')).toHaveText('75');

    // Server quote drives the totals card.
    await expect.poll(() => captured.quotes.length).toBeGreaterThan(0);
    await expect(page.getByTestId('totals')).toContainText('฿ 75.00');

    // F9 opens the tender dialog.
    await page.keyboard.press('F9');
    await expect(page.getByTestId('tender-net')).toHaveText('฿ 75.00');
    await expect(page.getByTestId('tender-confirm')).toBeDisabled();

    // +100 cash -> change 25.
    await page.getByTestId('quick-100').click();
    await expect(page.getByTestId('tender-amount-cash')).toHaveValue('100');
    await expect(page.getByTestId('tender-change')).toHaveText('฿ 25.00');
    await expect(page.getByTestId('tender-confirm')).toBeEnabled();
    await page.getByTestId('tender-confirm').click();

    // POST /sales payload matches the backend contract.
    await expect.poll(() => captured.sales.length).toBe(1);
    const body = captured.sales[0] as {
      lines: Array<{ product_id: string; qty: number; discount: number; is_free: boolean; unit_price?: number }>;
      payments: Array<{ method: string; amount: number }>;
      bill_discount: number;
      bill_discount_pct: number;
      terminal?: string;
      held_bill_id?: string;
    };
    expect(body.lines).toEqual([{ product_id: PRODUCT_ID, qty: 3, discount: 0, is_free: false }]);
    expect(body.payments).toEqual([{ method: 'cash', amount: 100 }]);
    expect(body.bill_discount).toBe(0);
    expect(body.bill_discount_pct).toBe(0);
    expect(body.terminal).toBe('POS1');
    expect(body.held_bill_id).toBeUndefined();

    // Receipt dialog shows change and the printable preview.
    const receipt = page.getByTestId('receipt-dialog');
    await expect(receipt).toBeVisible();
    await expect(page.getByTestId('receipt-change')).toHaveText('฿ 25.00');
    await expect(page.getByTestId('receipt-preview')).toContainText(DOC_NO);
    await expect(page.getByTestId('receipt-preview')).toContainText('ขอบคุณที่ใช้บริการ');

    // Enter / "new sale" closes the receipt and the cart is empty again.
    await page.getByTestId('receipt-new-sale').click();
    await expect(receipt).toBeHidden();
    await expect(page.getByTestId('cart-line')).toHaveCount(0);
    await expect(page.getByTestId('scan-input')).toBeFocused();
  });

  test('unknown barcode falls back to the product search dialog', async ({ page }) => {
    await mockApi(page);
    await page.goto('/pos');

    const scan = page.getByTestId('scan-input');
    await scan.fill('0000000000000');
    await scan.press('Enter');

    const search = page.getByTestId('product-search');
    await expect(search).toBeVisible();
    await expect(search).toHaveValue('0000000000000');

    // Picking a result from the search adds it to the cart.
    await search.fill('น้ำ');
    await page.getByTestId('product-result').first().click();
    await expect(page.getByTestId('cart-line')).toHaveCount(1);
  });

  test('hold bill posts the cart and clears the screen', async ({ page }) => {
    await mockApi(page);
    let held: unknown = null;
    await page.route('**/api/v1/held-bills', (route) => {
      if (route.request().method() === 'POST') {
        held = route.request().postDataJSON();
        return json(route, { id: 'held-1', cashier_id: USER_ID, label: 'x', cart: held, created_at: '2026-09-03T03:00:00Z', expires_at: '2026-09-04T03:00:00Z' }, 201);
      }
      return json(route, []);
    });

    await page.goto('/pos');
    const scan = page.getByTestId('scan-input');
    await scan.fill(BARCODE);
    await scan.press('Enter');
    await expect(page.getByTestId('cart-line')).toHaveCount(1);

    await page.keyboard.press('F2');
    await page.getByTestId('hold-confirm').click();
    await expect.poll(() => held).not.toBeNull();
    const body = held as { label: string; cart: { version: number; lines: Array<{ product_id: string; qty: number }> } };
    expect(body.cart.version).toBe(1);
    expect(body.cart.lines[0]).toMatchObject({ product_id: PRODUCT_ID, qty: 1 });
    await expect(page.getByTestId('cart-line')).toHaveCount(0);
  });
});

/**
 * Tablets get an in-dialog numeric keypad instead of the OS keyboard, which would otherwise
 * cover most of the payment dialog on an iPad.
 */
test.describe('POS payment dialog on a tablet', () => {
  // keep the chromium browser from the project config; take only the device traits
  const { defaultBrowserType: _browser, userAgent: _ua, ...ipad } = devices['iPad (gen 7)'];
  test.use({ ...ipad, locale: 'th-TH' });

  test('numeric keypad replaces the on-screen keyboard', async ({ page }) => {
    const captured = await mockApi(page);
    await page.goto('/pos');

    const scan = page.getByTestId('scan-input');
    await scan.fill(BARCODE);
    await scan.press('Enter');
    await expect(page.getByTestId('cart-line')).toHaveCount(1);

    // the sticky bottom bar and the sidebar both carry the button; click the visible one
    await page.locator('[data-testid="pay-button"]:visible').first().click();

    // The amount field must not request the OS keyboard.
    const amount = page.getByTestId('tender-amount-cash');
    await expect(amount).toHaveAttribute('inputmode', 'none');
    await expect(amount).toHaveAttribute('readonly', '');

    // Typing happens through the keypad: 5 0 -> 50, backspace -> 5, C -> empty.
    await page.getByTestId('keypad-5').click();
    await page.getByTestId('keypad-0').click();
    await expect(amount).toHaveValue('50');
    await expect(page.getByTestId('tender-change')).toHaveText('฿ 25.00');

    await page.getByTestId('keypad-back').click();
    await expect(amount).toHaveValue('5');
    await page.getByTestId('keypad-clear').click();
    await expect(amount).toHaveValue('');
    await expect(page.getByTestId('tender-confirm')).toBeDisabled();

    await page.getByTestId('keypad-1').click();
    await page.getByTestId('keypad-00').click();
    await expect(amount).toHaveValue('100');
    await page.getByTestId('tender-confirm').click();

    await expect.poll(() => captured.sales.length).toBe(1);
    const body = captured.sales[0] as { payments: Array<{ method: string; amount: number }> };
    expect(body.payments).toEqual([{ method: 'cash', amount: 100 }]);
  });
});
