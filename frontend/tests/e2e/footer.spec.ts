import { expect, test, type Page, type Route } from '@playwright/test';

/** The ownership line has to be on every surface: login, back office, POS and the member portal. */

const STORE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const COPYRIGHT = /Copyright © \d{4} by T-RAG AI Team/;

const session = {
  access_token: 'test-access',
  refresh_token: 'test-refresh',
  expires_at: '2099-01-01T00:00:00Z',
  user: { id: USER_ID, store_id: STORE_ID, username: 'owner', display_name: 'Owner', role: 'store_owner', locale: 'th', must_reset_password: false },
  store: { id: STORE_ID, code: 'S1', name: 'ร้านทดสอบ', default_locale: 'th' },
  selected_store: { id: STORE_ID, code: 'S1', name: 'ร้านทดสอบ', default_locale: 'th' },
};

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function mockApi(page: Page) {
  await page.route('**/api/v1/**', (route) => json(route, { error: { code: 'NOT_FOUND', message: 'not found' } }, 404));
  await page.route('**/api/v1/store/settings', (route) => json(route, { require_shift: false }));
  await page.route('**/api/v1/store', (route) => json(route, { id: STORE_ID, code: 'S1', name: 'ร้านทดสอบ' }));
  await page.route('**/api/v1/shifts/current', (route) => json(route, { shift: { id: 's1', status: 'open' } }));
  await page.route('**/api/v1/held-bills', (route) => json(route, []));
  await page.route('**/api/v1/products?*', (route) => json(route, { items: [], total: 0, page: 1, page_size: 30 }));
  await page.route('**/api/v1/reports/**', (route) => json(route, { rows: [] }));
}

test('the copyright shows on the login page before anyone signs in', async ({ page }) => {
  await mockApi(page);
  await page.goto('/login');
  await expect(page.getByRole('contentinfo')).toContainText(COPYRIGHT);
});

// a tall tablet in portrait is where a bottom-pinned footer used to fall off the screen
test('the login copyright is on screen on a tall tablet without scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 1366 });
  await mockApi(page);
  await page.goto('/login');
  const footer = page.getByRole('contentinfo');
  await expect(footer).toBeInViewport();
  const gap = await page.evaluate(() => {
    const card = document.querySelector('form')?.closest('div');
    const foot = document.querySelector('footer');
    if (!card || !foot) return -1;
    return foot.getBoundingClientRect().top - card.getBoundingClientRect().bottom;
  });
  // it sits just under the sign-in card, not stranded at the bottom of the window
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThan(200);
});

test.describe('signed in', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((value) => window.localStorage.setItem('pos.session', JSON.stringify(value)), session);
  });

  for (const path of ['/dashboard', '/products', '/settings', '/pos']) {
    test(`the copyright shows on ${path}`, async ({ page }) => {
      await mockApi(page);
      await page.goto(path);
      const footer = page.getByRole('contentinfo');
      await expect(footer).toContainText(COPYRIGHT);
      // it must not cover the working area
      const box = await footer.boundingBox();
      expect(box?.height ?? 0).toBeLessThan(60);
    });
  }

  test('the POS keeps its footer visible without scrolling', async ({ page }) => {
    await mockApi(page);
    await page.goto('/pos');
    const footer = page.getByRole('contentinfo');
    await expect(footer).toBeInViewport();
  });

  test('the menu carries the line too, so a long page shows it without scrolling', async ({ page }) => {
    await mockApi(page);
    await page.goto('/dashboard');
    const inMenu = page.getByRole('navigation').getByText(COPYRIGHT);
    await expect(inMenu).toBeVisible();
    await expect(inMenu).toBeInViewport();
  });

  // a long page on a tablet, where the menu is hidden: the line lives at the end of the page and
  // must be reachable by scrolling (the login and POS ones are always on screen — checked above)
  test('a long page keeps the line at the end where scrolling reaches it', async ({ page }) => {
    await page.setViewportSize({ width: 810, height: 700 });
    await mockApi(page);
    await page.goto('/dashboard');
    const footer = page.getByRole('contentinfo');
    await expect(footer).toContainText(COPYRIGHT);
    await footer.scrollIntoViewIfNeeded();
    await expect(footer).toBeInViewport();
  });
});
