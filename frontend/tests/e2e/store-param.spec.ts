import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * `?store=CODE` in the till's desktop shortcut.
 *
 * The shop's machine should open straight at its own store, but an owner with two shops has to be
 * able to type the other code in without editing the shortcut — so the value is a default in an
 * editable field, and it survives the redirect the POS makes when nobody is signed in yet.
 */

const STORE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function mockApi(page: Page) {
  const logins: Array<{ store_code?: string; username?: string }> = [];
  await page.route('**/api/v1/**', (route) => json(route, { error: { code: 'NOT_FOUND', message: 'not found' } }, 404));
  await page.route('**/api/v1/auth/login', (route) => {
    const body = route.request().postDataJSON();
    logins.push(body);
    return json(route, {
      access_token: 'test-access',
      refresh_token: 'test-refresh',
      expires_at: '2099-01-01T00:00:00Z',
      user: { id: USER_ID, store_id: STORE_ID, username: body.username, display_name: 'Owner', role: 'store_owner', locale: 'th', must_reset_password: false },
      store: { id: STORE_ID, code: body.store_code, name: 'ร้านทดสอบ', default_locale: 'th' },
    });
  });
  await page.route('**/api/v1/store/settings', (route) => json(route, { require_shift: false }));
  await page.route('**/api/v1/store', (route) => json(route, { id: STORE_ID, code: 'BBR', name: 'ร้านทดสอบ' }));
  await page.route('**/api/v1/shifts/current', (route) => json(route, { shift: null }));
  await page.route('**/api/v1/held-bills', (route) => json(route, []));
  await page.route('**/api/v1/reports/**', (route) => json(route, { rows: [] }));
  return { logins };
}

test('the shortcut fills in the store code and puts the cursor on the username', async ({ page }) => {
  await mockApi(page);
  await page.goto('/login?store=bbr');

  // lower case in the shortcut still shows the code the way a store code is written
  await expect(page.getByTestId('store-code')).toHaveValue('BBR');
  await expect(page.getByText("ค่าเริ่มต้นของเครื่องนี้", { exact: false })).toBeVisible();
  await expect(page.getByLabel('ชื่อผู้ใช้')).toBeFocused();
});

test('the code survives the redirect the POS makes when nobody is signed in', async ({ page }) => {
  await mockApi(page);
  // this is what the desktop shortcut actually opens
  await page.goto('/pos?store=BBR');

  await expect(page).toHaveURL(/\/login\?/);
  await expect(page.getByTestId('store-code')).toHaveValue('BBR');
  // and it still knows where the cashier was heading
  expect(new URL(page.url()).searchParams.get('next')).toContain('/pos');
});

test('the device remembers the store, so a later visit without the parameter is still filled in', async ({ page }) => {
  await mockApi(page);
  await page.goto('/login?store=BBR');
  await expect(page.getByTestId('store-code')).toHaveValue('BBR');

  // e.g. opened from a bookmark, or after the session expired
  await page.goto('/login');
  await expect(page.getByTestId('store-code')).toHaveValue('BBR');
});

test('an owner can sign in to another store without touching the shortcut', async ({ page }) => {
  const captured = await mockApi(page);
  await page.goto('/login?store=BBR');
  await expect(page.getByTestId('store-code')).toHaveValue('BBR');

  const code = page.getByTestId('store-code');
  await code.fill('KAEN');
  await page.getByLabel('ชื่อผู้ใช้').fill('kaen-owner');
  await page.getByLabel('รหัสผ่าน').first().fill('secret');
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();

  await expect.poll(() => captured.logins.length, { timeout: 10_000 }).toBe(1);
  expect(captured.logins[0].store_code).toBe('KAEN');

  // the till's own default is untouched: typing a code by hand must not re-point the machine
  await page.evaluate(() => window.localStorage.removeItem('pos.session'));
  await page.goto('/login');
  await expect(page.getByTestId('store-code')).toHaveValue('BBR');
});
