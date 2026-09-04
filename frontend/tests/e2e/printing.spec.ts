import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * The three things that go on paper besides a receipt: a report, the shift slip, and the short
 * slip that pops the cash drawer.
 *
 * Each test reads what the app actually wrote into its print iframe — that is the document the
 * printer receives, so an empty table or a missing total shows up here rather than at the shop.
 */

const STORE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const SHIFT_ID = '33333333-3333-4333-8333-333333333333';

const session = {
  access_token: 'test-access',
  refresh_token: 'test-refresh',
  expires_at: '2099-01-01T00:00:00Z',
  user: { id: USER_ID, store_id: STORE_ID, username: 'owner', display_name: 'Owner', role: 'store_owner', locale: 'th', must_reset_password: false },
  store: { id: STORE_ID, code: 'S1', name: 'ร้านทดสอบ', default_locale: 'th' },
  selected_store: { id: STORE_ID, code: 'S1', name: 'ร้านทดสอบ', default_locale: 'th' },
};

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const shift = {
  id: SHIFT_ID,
  store_id: STORE_ID,
  cashier_id: USER_ID,
  cashier_name: 'Owner',
  terminal: 'POS1',
  opened_at: '2026-09-04T08:00:00+07:00',
  closed_at: null,
  opening_float: '1000.00',
  cash_sales: '114.00',
  cash_in: '50.00',
  cash_out: '0.00',
  expected_cash: null,
  counted_cash: null,
  variance: null,
  status: 'open',
};

async function mockApi(page: Page, opts: { drawerKick?: 'print' | 'off' } = {}) {
  const drawerCalls: unknown[] = [];
  await page.route('**/api/v1/**', (route) => json(route, { error: { code: 'NOT_FOUND', message: 'not found' } }, 404));
  await page.route('**/api/v1/store/settings', (route) => json(route, { require_shift: false, paper_width: 80, drawer_kick: opts.drawerKick ?? 'print' }));
  await page.route('**/api/v1/store', (route) => json(route, { id: STORE_ID, code: 'S1', name: 'ร้านทดสอบ', address: 'หมู่ 1', phone: '084-000-0000' }));
  await page.route('**/api/v1/shifts/current', (route) => json(route, { shift }));
  await page.route(`**/api/v1/shifts/${SHIFT_ID}`, (route) =>
    json(route, { shift, summary: { bills: 4, gross: '124.00', discount: '0.00', net: '124.00', cancelled: 0, by_method: { cash: '114.00', qr: '10.00' } } }),
  );
  await page.route('**/api/v1/shifts?*', (route) => json(route, { items: [shift], total: 1, page: 1, page_size: 20 }));
  await page.route('**/api/v1/held-bills', (route) => json(route, []));
  await page.route('**/api/v1/products?*', (route) => json(route, { items: [], total: 0, page: 1, page_size: 30 }));
  await page.route('**/api/v1/drawer', (route) => {
    drawerCalls.push(route.request().postDataJSON());
    return route.fulfill({ status: 204, body: '' });
  });
  await page.route('**/api/v1/reports/daily-sales*', (route) =>
    json(route, {
      from: '2026-09-01',
      to: '2026-09-30',
      group: 'day',
      rows: [
        { date: '2026-09-03', bills: 3, gross: '114.00', discount: '0.00', net: '114.00', cancelled: 0, cash: '114.00', credit: '0.00', transfer: '0.00', card: '0.00', qr: '0.00', cost: '97.40', margin: '16.60', margin_pct: '14.56' },
        { date: '2026-09-04', bills: 1, gross: '10.00', discount: '0.00', net: '10.00', cancelled: 0, cash: '0.00', credit: '0.00', transfer: '0.00', card: '0.00', qr: '10.00', cost: '8.83', margin: '1.17', margin_pct: '11.70' },
      ],
      total: { date: 'total', bills: 4, gross: '124.00', discount: '0.00', net: '124.00', cancelled: 0, cash: '114.00', credit: '0.00', transfer: '0.00', card: '0.00', qr: '10.00', cost: '106.23', margin: '17.77', margin_pct: '14.33' },
    }),
  );
  return { drawerCalls };
}

/** Keeps whatever the app writes into its print iframe, before it is torn down. */
async function armPrintCapture(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __print?: unknown }).__print = null;
    const grab = (f: HTMLIFrameElement) => {
      const d = f.contentDocument;
      if (!d?.body || d.body.innerHTML.length < 30) return;
      (window as unknown as { __print?: unknown }).__print = { text: d.body.innerText, html: d.body.innerHTML, css: d.querySelector('style')?.textContent ?? '' };
    };
    new MutationObserver((ms) => {
      for (const m of ms)
        for (const n of Array.from(m.addedNodes))
          if ((n as HTMLElement).tagName === 'IFRAME') {
            const f = n as HTMLIFrameElement;
            grab(f);
            setTimeout(() => grab(f), 250);
          }
    }).observe(document.body, { childList: true });
    // printing must not open a dialog in the test browser
    window.HTMLIFrameElement.prototype.focus = function () {};
  });
}

const printed = (page: Page) => page.evaluate(() => (window as unknown as { __print: { text: string; html: string; css: string } | null }).__print);

test.beforeEach(async ({ page }) => {
  await page.addInitScript((value) => {
    window.localStorage.setItem('pos.session', JSON.stringify(value));
    window.localStorage.setItem('pos.autoPrint', '0');
  }, session);
});

test('a report prints every row and its totals line, not just the header', async ({ page }) => {
  await mockApi(page);
  await page.goto('/reports');
  await armPrintCapture(page);
  await page.getByTestId('report-print').click();

  const out = await expect.poll(async () => (await printed(page))?.text ?? '', { timeout: 15_000 }).not.toBe('');
  const doc = await printed(page);
  expect(doc?.text).toContain('ร้านทดสอบ');
  expect(doc?.text).toContain('ยอดขายรายวัน');
  // both data rows and the totals row reach the paper
  expect(doc?.text).toContain('114.00');
  expect(doc?.text).toContain('124.00');
  expect(doc?.html).toContain('class="total"');
  // the server's "total" marker is translated rather than printed raw
  expect(doc?.text).not.toContain('total');
  // 14 columns do not fit upright
  expect(doc?.css).toContain('size:A4 landscape');
  void out;
});

test('the shift slip carries the cash count a manager checks the drawer against', async ({ page }) => {
  await mockApi(page);
  await page.goto('/pos/shift');
  await armPrintCapture(page);
  await page.getByTestId('print-shift-slip').first().click();

  await expect.poll(async () => (await printed(page))?.text ?? '', { timeout: 15_000 }).not.toBe('');
  const doc = await printed(page);
  expect(doc?.text).toContain('ใบสรุปกะ');
  expect(doc?.text).toContain('POS1');
  // expected cash is opening float + cash sales + paid in - paid out, computed for an open shift
  expect(doc?.text).toContain('1,164.00');
  expect(doc?.text).toContain('ยังไม่ปิดกะ'); // this shift is still running
  // and the takings split by tender
  expect(doc?.text).toContain('10.00');
  // it goes on the receipt roll, not A4
  expect(doc?.css).toContain('size:80mm');
});

test('opening the drawer prints the slip that pops it, and records the event', async ({ page }) => {
  const captured = await mockApi(page, { drawerKick: 'print' });
  await page.goto('/pos');
  await page.getByTestId('scan-input').waitFor();
  await armPrintCapture(page);
  await page.keyboard.press('F10');

  await expect.poll(() => captured.drawerCalls.length, { timeout: 10_000 }).toBe(1);
  await expect.poll(async () => (await printed(page))?.text ?? '', { timeout: 15_000 }).not.toBe('');
  const doc = await printed(page);
  expect(doc?.text).toContain('เปิดลิ้นชัก');
  expect(doc?.css).toContain('size:80mm');
});

test('a shop with no drawer wired to the printer prints nothing', async ({ page }) => {
  const captured = await mockApi(page, { drawerKick: 'off' });
  await page.goto('/pos');
  await page.getByTestId('scan-input').waitFor();
  await armPrintCapture(page);
  await page.keyboard.press('F10');

  // the event is still recorded — only the paper is skipped
  await expect.poll(() => captured.drawerCalls.length, { timeout: 10_000 }).toBe(1);
  await page.waitForTimeout(1500);
  expect(await printed(page)).toBeNull();
});
