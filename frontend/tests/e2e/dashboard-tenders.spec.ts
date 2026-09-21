import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * The dashboard used to show only cash and credit, so a day's transfers and QR takings were
 * invisible until someone opened the shift screen. Every tender now has its own tile.
 */

const STORE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

const session = {
  access_token: 'test-access',
  refresh_token: 'test-refresh',
  expires_at: '2099-01-01T00:00:00Z',
  user: { id: USER_ID, store_id: STORE_ID, username: 'owner', display_name: 'Owner', role: 'store_owner', locale: 'th', must_reset_password: false },
  store: { id: STORE_ID, code: 'S1', name: 'ร้านทดสอบ', default_locale: 'th' },
  selected_store: { id: STORE_ID, code: 'S1', name: 'ร้านทดสอบ', default_locale: 'th' },
};

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function mockApi(page: Page, opts: { dashboard?: boolean; card?: string; transfer?: string; ar?: Record<string, string> } = {}) {
  await page.route('**/api/v1/**', (route) => json(route, { error: { code: 'NOT_FOUND', message: 'not found' } }, 404));
  await page.route('**/api/v1/store/settings', (route) => json(route, { require_shift: false, paper_width: 80 }));
  await page.route('**/api/v1/store', (route) => json(route, { id: STORE_ID, code: 'S1', name: 'ร้านทดสอบ' }));
  await page.route('**/api/v1/shifts/current', (route) => json(route, { shift: null }));

  if (opts.dashboard === false) {
    // the older deployment without /reports/dashboard: the page falls back to the sales summary
    await page.route('**/api/v1/reports/dashboard*', (route) => json(route, { error: { code: 'NOT_FOUND', message: 'gone' } }, 404));
    await page.route('**/api/v1/sales/summary*', (route) =>
      json(route, {
        bills: 48,
        gross: '1789.00',
        discount: '0.00',
        net: '1789.00',
        cancelled: 0,
        by_method: { cash: '1542.00', transfer: '247.00', gwallet: '670.20', thaiplus: '1002.80', welfare: '315.00' },
      }),
    );
    return;
  }
  await page.route('**/api/v1/reports/dashboard*', (route) =>
    json(route, {
      date: '2026-09-14',
      today: {
        bills: 48,
        net: '1789.00',
        cash: '1542.00',
        transfer: opts.transfer ?? '247.00',
        qr: '120.50',
        card: opts.card ?? '0.00',
        gwallet: '670.20',
        thaiplus: '1002.80',
        welfare: '315.00',
        credit: '80.00',
        avg_bill: '37.27',
        cancelled: 0,
        ...(opts.ar ? { ar: opts.ar } : {}),
      },
      month_to_date_net: '25000.00',
      month_to_date_bills: 600,
      low_stock_count: 3,
      ar_outstanding_total: '26715.00',
      open_shift: null,
      top_products: [],
      hourly: [],
    }),
  );
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((value) => window.localStorage.setItem('pos.session', JSON.stringify(value)), session);
});

test('every tender the shop took today has its own figure on the dashboard', async ({ page }) => {
  await mockApi(page);
  await page.goto('/dashboard');
  await expect(page.getByText('฿ 1,542.00').first()).toBeVisible({ timeout: 20_000 });
  // the two that never reach the drawer, which is the whole point of showing them
  await expect(page.getByText('฿ 247.00').first()).toBeVisible();
  await expect(page.getByText('฿ 120.50').first()).toBeVisible();
  await expect(page.getByText('฿ 80.00').first()).toBeVisible();
  await expect(page.getByText('เงินโอนวันนี้').first()).toBeVisible();
  // the three state welfare rails the shop used to tally by hand
  await expect(page.getByText('฿ 670.20').first()).toBeVisible();
  await expect(page.getByText('฿ 1,002.80').first()).toBeVisible();
  await expect(page.getByText('฿ 315.00').first()).toBeVisible();
  await expect(page.getByText('จีวอลเล็ตวันนี้').first()).toBeVisible();
  await expect(page.getByText('ไทยพลัสวันนี้').first()).toBeVisible();
  await expect(page.getByText('บัตรสวัสดิการวันนี้').first()).toBeVisible();
});

test('a tender with nothing in it today still shows, so a zero can be trusted', async ({ page }) => {
  await mockApi(page, { card: '0.00' });
  await page.goto('/dashboard');
  await expect(page.getByText('฿ 120.50').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('บัตรวันนี้').first()).toBeVisible();
  await expect(page.getByText('฿ 0.00').first()).toBeVisible();
});

test('a shop on an older server still gets its transfers from the summary fallback', async ({ page }) => {
  await mockApi(page, { dashboard: false });
  await page.goto('/dashboard');
  await expect(page.getByText('฿ 1,542.00').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('฿ 247.00').first()).toBeVisible();
  await expect(page.getByText('฿ 1,002.80').first()).toBeVisible();
});

// บ้านแก่นใต้, 21 Sep: four bills paid by transfer (฿572) and four tabs paid off by transfer (฿540).
// The bank got ฿1,112; the tile used to say ฿572.
test('a tab paid off by transfer is counted in the transfers of the day, and says so', async ({ page }) => {
  await mockApi(page, { transfer: '572.00', ar: { cash: '0', transfer: '540.00', qr: '0', total: '540.00' } });
  await page.goto('/dashboard');
  await expect(page.getByText('฿ 1,112.00').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('รวมรับชำระหนี้ ฿ 540.00').first()).toBeVisible();
  // the credit tile says how much came back in today
  await expect(page.getByText('รับชำระหนี้วันนี้ ฿ 540.00').first()).toBeVisible();
  // and the day's sales are still the day's sales
  await expect(page.getByText('฿ 1,789.00').first()).toBeVisible();
});
