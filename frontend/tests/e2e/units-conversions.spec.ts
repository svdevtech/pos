import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Units are never deleted (only switched off, so old documents keep their unit), and packs are
 * broken into loose units through a conversion document.
 */

const STORE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const CRATE_ID = '33333333-3333-4333-8333-333333333333';
const BOTTLE_ID = '44444444-4444-4444-8444-444444444444';

const session = {
  access_token: 'test-access',
  refresh_token: 'test-refresh',
  expires_at: '2099-01-01T00:00:00Z',
  user: { id: USER_ID, store_id: STORE_ID, username: 'owner', display_name: 'Owner', role: 'store_owner', locale: 'th', must_reset_password: false },
  store: { id: STORE_ID, code: 'S1', name: 'ร้านทดสอบ', default_locale: 'th' },
  selected_store: { id: STORE_ID, code: 'S1', name: 'ร้านทดสอบ', default_locale: 'th' },
};

const units = [
  { id: 'u1', name: 'ขวด', name_en: 'bottle', is_active: true, product_count: 12 },
  { id: 'u2', name: 'ลัง', name_en: 'crate', is_active: true, product_count: 3 },
  { id: 'u3', name: 'โหล', name_en: 'dozen', is_active: false, product_count: 0 },
];

const crate = {
  id: CRATE_ID, sku: 'BEER-CRATE', name: 'เบียร์ (ลัง)', sell_price: '600', cost_avg: '480', cost_last: '480',
  stock_on_hand: '5', min_level1: '0', min_level2: '0', is_serial: false, is_active: true, is_archived: false,
  unit_name: 'ลัง', barcodes: [], price_tiers: {}, stock_level: 'ok',
};
const bottle = { ...crate, id: BOTTLE_ID, sku: 'BEER-BOTTLE', name: 'เบียร์ (ขวด)', sell_price: '55', cost_avg: '40', stock_on_hand: '0', unit_name: 'ขวด' };

const rule = {
  id: 'r1', from_product_id: CRATE_ID, from_name: crate.name, from_unit: 'ลัง', from_stock: '5',
  to_product_id: BOTTLE_ID, to_name: bottle.name, to_unit: 'ขวด', to_stock: '0',
  factor: '12', is_active: true,
};

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

interface Captured {
  unitPosts: unknown[];
  unitPatches: unknown[];
  conversions: unknown[];
  rules: unknown[];
}

async function mockApi(page: Page): Promise<Captured> {
  const captured: Captured = { unitPosts: [], unitPatches: [], conversions: [], rules: [] };
  await page.route('**/api/v1/**', (route) => json(route, { error: { code: 'NOT_FOUND', message: 'not found' } }, 404));
  await page.route('**/api/v1/store/settings', (route) => json(route, {}));
  await page.route('**/api/v1/store', (route) => json(route, { id: STORE_ID, code: 'S1', name: 'ร้านทดสอบ' }));
  await page.route('**/api/v1/units', (route) => {
    if (route.request().method() === 'POST') {
      captured.unitPosts.push(route.request().postDataJSON());
      return json(route, { id: 'u4', name: 'ถุง', is_active: true, product_count: 0 }, 201);
    }
    return json(route, units);
  });
  await page.route('**/api/v1/units/*', (route) => {
    captured.unitPatches.push({ url: route.request().url(), body: route.request().postDataJSON() });
    return json(route, { ...units[1], is_active: false });
  });
  await page.route('**/api/v1/products?*', (route) => json(route, { items: [crate, bottle], total: 2, page: 1, page_size: 20 }));
  await page.route('**/api/v1/inventory/conversion-rules*', (route) => {
    if (route.request().method() === 'POST') {
      captured.rules.push(route.request().postDataJSON());
      return json(route, rule, 201);
    }
    return json(route, [rule]);
  });
  await page.route('**/api/v1/inventory/conversions*', (route) => {
    if (route.request().method() === 'POST') {
      captured.conversions.push(route.request().postDataJSON());
      return json(route, { id: 'cv1', doc_no: 'CV6909-00003', from_qty: '2', to_qty: '24', factor: '12', unit_cost: '40', total_cost: '960', to_unit: 'ขวด', converted_at: '2026-09-03T11:00:00Z' }, 201);
    }
    return json(route, { items: [], total: 0, page: 1, page_size: 20 });
  });
  return captured;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((value) => window.localStorage.setItem('pos.session', JSON.stringify(value)), session);
});

test.describe('units', () => {
  test('a new unit is added and an existing one is switched off, never deleted', async ({ page }) => {
    const captured = await mockApi(page);
    await page.goto('/settings/units');

    const rows = page.locator('[data-testid="unit-list"] tbody tr');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(2)).toContainText('ปิดใช้งาน'); // the inactive one is still listed

    await page.getByTestId('unit-add').click();
    await page.getByTestId('unit-name').fill('ถุง');
    await page.getByTestId('unit-save').click();
    await expect.poll(() => captured.unitPosts.length).toBe(1);
    expect(captured.unitPosts[0]).toMatchObject({ name: 'ถุง' });

    // switching off asks first, then PATCHes is_active - there is no delete call
    await rows.nth(0).getByRole('checkbox').click();
    await page.getByTestId('unit-switch-off').click();
    await expect.poll(() => captured.unitPatches.length).toBe(1);
    expect(captured.unitPatches[0]).toMatchObject({ body: { is_active: false } });
  });
});

test.describe('unit conversion', () => {
  test('a saved rule fills the factor in and the conversion posts what was previewed', async ({ page }) => {
    const captured = await mockApi(page);
    await page.goto('/inventory/conversions');

    await expect(page.getByTestId('conv-rules')).toContainText('เบียร์ (ลัง)');

    await page.getByLabel('สินค้าต้นทาง (หน่วยใหญ่)').fill('เบียร์');
    await page.getByRole('option').first().click();
    await page.getByLabel('สินค้าปลายทาง (หน่วยย่อย)').fill('เบียร์');
    await page.getByRole('option').first().click();

    // 2 crates against the saved factor of 12
    await page.getByTestId('conv-qty').fill('2');
    await expect(page.getByTestId('conv-preview')).toContainText('24');

    await page.getByTestId('conv-post').click();
    await expect.poll(() => captured.conversions.length).toBe(1);
    expect(captured.conversions[0]).toMatchObject({ from_product_id: CRATE_ID, to_product_id: BOTTLE_ID, from_qty: '2' });
  });

  test('the convert button stays disabled when the source has too little stock', async ({ page }) => {
    await mockApi(page);
    await page.goto('/inventory/conversions');

    await page.getByLabel('สินค้าต้นทาง (หน่วยใหญ่)').fill('เบียร์');
    await page.getByRole('option').first().click();
    await page.getByLabel('สินค้าปลายทาง (หน่วยย่อย)').fill('เบียร์');
    await page.getByRole('option').first().click();

    await page.getByTestId('conv-qty').fill('99'); // only 5 crates on hand
    await expect(page.getByText('สต็อกต้นทางไม่พอ')).toBeVisible();
    await expect(page.getByTestId('conv-post')).toBeDisabled();
  });
});
