import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * The product picker must never offer a row that does not match what is typed. A slow search used
 * to leave the previous product on screen, so a quick tap (a phone user's habit) selected the wrong
 * item — a live conversion was once posted against the wrong product because of it.
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

const product = (id: string, sku: string, name: string) => ({
  id,
  sku,
  name,
  sell_price: '10.00',
  cost_avg: '5.00',
  cost_last: '5.00',
  stock_on_hand: '10',
  min_level1: '0',
  min_level2: '0',
  is_serial: false,
  is_active: true,
  is_archived: false,
  unit_name: 'ชิ้น',
  barcodes: [],
  price_tiers: {},
  stock_level: 'ok',
});

const NOODLE = product('aaaaaaaa-1111-4111-8111-111111111111', 'NOODLE', 'มาม่าต้มยำ');
const BEER = product('bbbbbbbb-2222-4222-8222-222222222222', 'BEER-CRATE', 'เบียร์ (ลัง)');

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function mockApi(page: Page, slowFor: string) {
  await page.route('**/api/v1/**', (route) => json(route, { error: { code: 'NOT_FOUND', message: 'not found' } }, 404));
  await page.route('**/api/v1/store/settings', (route) => json(route, {}));
  await page.route('**/api/v1/store', (route) => json(route, { id: STORE_ID, code: 'S1', name: 'ร้านทดสอบ' }));
  await page.route('**/api/v1/inventory/conversion-rules*', (route) => json(route, []));
  await page.route('**/api/v1/inventory/conversions*', (route) => json(route, { items: [], total: 0, page: 1, page_size: 20 }));
  await page.route('**/api/v1/products?*', async (route) => {
    const q = new URL(route.request().url()).searchParams.get('q') ?? '';
    const items = q === '' ? [NOODLE, BEER] : [NOODLE, BEER].filter((p) => `${p.sku} ${p.name}`.toLowerCase().includes(q.toLowerCase()));
    if (q.includes(slowFor)) await new Promise((r) => setTimeout(r, 2500)); // a slow answer
    return json(route, { items, total: items.length, page: 1, page_size: 20 });
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((value) => window.localStorage.setItem('pos.session', JSON.stringify(value)), session);
});

test('a slow search never leaves the previous product selectable', async ({ page }) => {
  await mockApi(page, 'BEER');
  await page.goto('/inventory/conversions');

  const box = page.getByRole('combobox', { name: 'สินค้าต้นทาง (หน่วยใหญ่)' });
  await box.click();
  await expect(page.getByRole('option').first()).toBeVisible(); // the default list

  // type something whose answer is slow, then look straight away: nothing from the previous
  // search may still be sitting there (a retrying assertion would hide exactly this bug)
  await box.fill('BEER-CRATE');
  await page.waitForTimeout(400);
  const stale = await page.getByRole('option').allInnerTexts();
  expect(stale.filter((o) => o.includes('มาม่า'))).toEqual([]);

  // and once the answer lands, only the matching product is offered
  await expect(page.getByRole('option', { name: /เบียร์/ })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('option')).toHaveCount(1);
});
