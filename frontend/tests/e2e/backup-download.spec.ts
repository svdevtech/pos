import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Downloading a backup must reach the browser's download manager. The first implementation fetched
 * the ~80 MB archive into a Blob and clicked a synthetic `<a download>`: on iPad that silently did
 * nothing (Safari ignores the attribute, the click is outside the user gesture). It now asks the API
 * for a signed link and navigates to it, which the browser downloads itself — that is what this
 * test pins, on a desktop profile and on an iPad profile.
 */

const STORE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const FILE = 'pos-backup-S1-20260903-214437.zip';
const SIGNED = `/api/v1/download/backup?store=${STORE_ID}&name=${FILE}&t=1788448785.signature`;

const session = {
  access_token: 'test-access',
  refresh_token: 'test-refresh',
  expires_at: '2099-01-01T00:00:00Z',
  user: { id: USER_ID, store_id: STORE_ID, username: 'owner', display_name: 'Owner', role: 'store_owner', locale: 'th', must_reset_password: false },
  store: { id: STORE_ID, code: 'S1', name: 'ร้านทดสอบ', default_locale: 'th' },
  selected_store: { id: STORE_ID, code: 'S1', name: 'ร้านทดสอบ', default_locale: 'th' },
};

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function mockApi(page: Page): Promise<{ links: string[] }> {
  const links: string[] = [];
  await page.route('**/api/v1/**', (route) => json(route, { error: { code: 'NOT_FOUND', message: 'not found' } }, 404));
  await page.route('**/api/v1/store/settings', (route) => json(route, {}));
  await page.route('**/api/v1/store', (route) => json(route, { id: STORE_ID, code: 'S1', name: 'ร้านทดสอบ' }));
  await page.route('**/api/v1/store/data/jobs', (route) => json(route, []));
  await page.route('**/api/v1/store/data/legacy', (route) => json(route, null));
  await page.route('**/api/v1/store/data/backups', (route) => json(route, [{ name: FILE, size: 81_856_628, created_at: '2026-09-03T14:44:37Z' }]));
  await page.route('**/api/v1/store/data/backups/*/link', (route) => {
    links.push(route.request().url());
    return json(route, { url: SIGNED, expires_at: '2099-01-01T00:00:00Z' });
  });
  // the signed link itself: an attachment, exactly like the server sends
  await page.route('**/api/v1/download/backup**', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${FILE}"` },
      body: 'PKfake',
    }),
  );
  return { links };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((value) => window.localStorage.setItem('pos.session', JSON.stringify(value)), session);
});

for (const profile of [
  { name: 'desktop', viewport: { width: 1280, height: 900 } },
  { name: 'iPad', viewport: { width: 1024, height: 1366 }, isMobile: false, hasTouch: true },
]) {
  test(`the download button hands the file to the browser (${profile.name})`, async ({ page }) => {
    await page.setViewportSize(profile.viewport);
    const captured = await mockApi(page);
    await page.goto('/settings/data');

    await expect(page.getByTestId('backup-list')).toContainText(FILE);
    const row = page.locator('[data-testid="backup-list"] tbody tr').first();

    const download = page.waitForEvent('download', { timeout: 15_000 });
    await row.getByRole('button').first().click(); // the download icon
    const file = await download;

    expect(file.suggestedFilename()).toBe(FILE);
    await expect.poll(() => captured.links.length).toBe(1);
    expect(captured.links[0]).toContain(`${encodeURIComponent(FILE)}/link`);
    // the page must stay put: the attachment does not navigate away
    await expect(page.getByTestId('backup-list')).toBeVisible();
  });
}
