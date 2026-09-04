import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Money that arrives against a debt, and slips that arrive before anyone knows what they pay for.
 *
 * Two flows the till screen does not cover: receiving a credit payment by QR (the receivables
 * screen must show the same code the POS does), and photographing a slip from a phone transfer and
 * matching it to the right record afterwards.
 */

const STORE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const MEMBER_ID = '55555555-5555-4555-8555-555555555555';
const PAYMENT_ID = '66666666-6666-4666-8666-666666666666';
const SLIP_ID = '77777777-7777-4777-8777-777777777777';

const QR_PAYLOAD = '00020101021229370016A000000677010111011300668123456785303764540625.005802TH5910Test Store6304C0BA';

const session = {
  access_token: 'test-access',
  refresh_token: 'test-refresh',
  expires_at: '2099-01-01T00:00:00Z',
  user: { id: USER_ID, store_id: STORE_ID, username: 'owner', display_name: 'Owner', role: 'store_owner', locale: 'th', must_reset_password: false },
  store: { id: STORE_ID, code: 'S1', name: 'ร้านทดสอบ', default_locale: 'th' },
  selected_store: { id: STORE_ID, code: 'S1', name: 'ร้านทดสอบ', default_locale: 'th' },
};

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const account = {
  member_id: MEMBER_ID,
  member_code: '130',
  member_name: 'นางปนัดดา เกตุประเสริฐ',
  open_bills: 3,
  balance: '7324.00',
  oldest_due: '2022-10-28T00:00:00Z',
  last_paid_at: '2023-02-18T00:00:00Z',
};

const looseSlip = {
  id: SLIP_ID,
  ref_type: 'unassigned',
  method: 'transfer',
  amount: '25.00',
  mime: 'image/jpeg',
  size_bytes: 4096,
  captured_at: new Date().toISOString(),
  captured_by_name: 'Owner',
};

interface Captured {
  payments: Array<Record<string, unknown>>;
  arSlips: Array<Record<string, unknown>>;
  looseSlips: Array<Record<string, unknown>>;
  assigns: Array<{ id: string; body: Record<string, unknown> }>;
  candidateQueries: string[];
}

async function mockApi(page: Page, opts: { slips?: unknown[] } = {}): Promise<Captured> {
  const captured: Captured = { payments: [], arSlips: [], looseSlips: [], assigns: [], candidateQueries: [] };

  await page.route('**/api/v1/**', (route) => json(route, { error: { code: 'NOT_FOUND', message: 'not found' } }, 404));
  await page.route('**/api/v1/store/settings', (route) => json(route, { require_shift: false }));
  await page.route('**/api/v1/store', (route) => json(route, { id: STORE_ID, code: 'S1', name: 'ร้านทดสอบ' }));
  await page.route('**/api/v1/shifts/current', (route) => json(route, { shift: null }));

  await page.route('**/api/v1/payment-qr*', (route) =>
    json(route, { payload: QR_PAYLOAD, amount: '25.00', kind: 'phone', masked_id: 'xxxxxx5678', merchant_name: 'Test Store', store_name: 'ร้านทดสอบ' }),
  );

  await page.route('**/api/v1/ar/accounts*', (route) => json(route, { items: [account], total: 1, page: 1, page_size: 50 }));
  await page.route(`**/api/v1/ar/members/${MEMBER_ID}/bills`, (route) =>
    json(route, { bills: [{ id: 'bill-1', doc_no: 'N6510-05606', sold_at: '2022-10-28T00:00:00Z', net: '70.00', status: 'completed', ar_status: 'unpaid', ar_total: '70.00', ar_paid: '0.00', ar_balance: '70.00' }], balance: '7324.00' }),
  );
  await page.route('**/api/v1/ar/payments', (route) => {
    if (route.request().method() !== 'POST') return json(route, { items: [], total: 0, page: 1, page_size: 50 });
    captured.payments.push(route.request().postDataJSON());
    return json(route, [{ id: PAYMENT_ID, doc_no: 'RC6909-00004', member_id: MEMBER_ID, amount: '25.00', method: 'qr', paid_at: new Date().toISOString(), bill_total: '70.00', balance_before: '70.00', balance_after: '45.00' }], 201);
  });
  await page.route(`**/api/v1/ar/payments/${PAYMENT_ID}/slips`, (route) => {
    if (route.request().method() === 'POST') {
      captured.arSlips.push(route.request().postDataJSON());
      return json(route, { id: SLIP_ID, ref_type: 'ar_payment', ref_doc_no: 'RC6909-00004', method: 'transfer', amount: '25.00', mime: 'image/jpeg', size_bytes: 4096, captured_at: new Date().toISOString() }, 201);
    }
    return json(route, []);
  });

  // the slip queues
  await page.route('**/api/v1/slips?*', (route) => {
    const scope = new URL(route.request().url()).searchParams.get('scope') ?? 'pending';
    const items = (opts.slips ?? []) as unknown[];
    return json(route, { items: scope === 'unassigned' ? items.filter((s) => (s as { ref_type: string }).ref_type === 'unassigned') : items, total: items.length, page: 1, page_size: 20 });
  });
  await page.route('**/api/v1/slips', (route) => {
    if (route.request().method() !== 'POST') return json(route, { items: [], total: 0, page: 1, page_size: 20 });
    captured.looseSlips.push(route.request().postDataJSON());
    return json(route, looseSlip, 201);
  });
  await page.route('**/api/v1/slips/candidates*', (route) => {
    captured.candidateQueries.push(new URL(route.request().url()).searchParams.get('amount') ?? '');
    return json(route, [
      { ref_type: 'ar_payment', ref_id: PAYMENT_ID, doc_no: 'RC6909-00004', amount: '25.00', at: new Date().toISOString(), member_name: 'นางปนัดดา เกตุประเสริฐ', method: 'qr', has_slip: false },
      { ref_type: 'sale', ref_id: 'sale-9', doc_no: 'N6909-00014', amount: '900.00', at: new Date().toISOString(), member_name: '', method: 'transfer', has_slip: true },
    ]);
  });
  await page.route(`**/api/v1/slips/${SLIP_ID}/assign`, (route) => {
    captured.assigns.push({ id: SLIP_ID, body: route.request().postDataJSON() });
    return json(route, { ...looseSlip, ref_type: 'ar_payment', ref_doc_no: 'RC6909-00004' });
  });
  await page.route('**/api/v1/slips/*/image', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(PNG_B64, 'base64') }));

  return captured;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((value) => window.localStorage.setItem('pos.session', JSON.stringify(value)), session);
});

test('a debt paid by QR shows the code and files the slip against the receipt', async ({ page }) => {
  const captured = await mockApi(page);
  await page.goto('/ar');

  await page.getByRole('button', { name: 'รับชำระเงิน' }).nth(1).click();
  await page.getByLabel('ยอดชำระ').fill('25');
  await page.getByRole('combobox', { name: 'วิธีชำระ' }).click();
  await page.getByRole('option', { name: 'QR พร้อมเพย์' }).click();

  // the receivables screen shows the same PromptPay code the till does
  const qr = page.getByTestId('promptpay-qr');
  await expect(qr).toBeVisible();
  await expect(qr).toHaveAttribute('data-payload', QR_PAYLOAD);

  await page.getByTestId('ar-slip-capture-open').click();
  await page.getByTestId('slip-file-input').setInputFiles({ name: 'slip.png', mimeType: 'image/png', buffer: Buffer.from(PNG_B64, 'base64') });
  await expect(page.getByTestId('slip-preview')).toBeVisible();
  await page.getByTestId('slip-use').click();
  await expect(page.getByTestId('ar-slip-thumb')).toBeVisible();

  await page.getByRole('button', { name: 'รับชำระเงิน', exact: true }).last().click();

  await expect.poll(() => captured.payments.length, { timeout: 10_000 }).toBe(1);
  expect(captured.payments[0].method).toBe('qr');
  // the photo is uploaded only after the receipt exists, and against that receipt
  await expect.poll(() => captured.arSlips.length, { timeout: 10_000 }).toBe(1);
  expect(String(captured.arSlips[0].image).startsWith('data:image/jpeg;base64,')).toBe(true);
});

test('a slip photographed from a phone transfer is matched to the right record', async ({ page }) => {
  const captured = await mockApi(page, { slips: [looseSlip] });
  await page.goto('/slips');

  // the loose slip is on the "not matched" queue, and cannot be confirmed until it points at something
  await page.getByTestId('tab-unassigned').click();
  const card = page.getByTestId('pending-slip').first();
  await expect(card).toHaveAttribute('data-ref-type', 'unassigned');
  await expect(card.getByTestId('pending-slip-verify')).toHaveCount(0);

  await card.getByTestId('slip-match-open').click();
  // its own amount seeds the search, so the right record is offered first
  await expect.poll(() => captured.candidateQueries).toContain('25.00');
  const candidates = page.getByTestId('slip-candidate');
  await expect(candidates.first()).toContainText('RC6909-00004');
  await expect(candidates.nth(1)).toContainText('มีสลิปแล้ว'); // already has one — still offered, but flagged

  await candidates.first().click();
  await expect.poll(() => captured.assigns.length, { timeout: 10_000 }).toBe(1);
  expect(captured.assigns[0].body).toEqual({ ar_payment_id: PAYMENT_ID });
});

test('photographing a slip from the menu goes straight into matching it', async ({ page }) => {
  const captured = await mockApi(page, { slips: [] });
  await page.goto('/slips');

  await page.getByTestId('slip-new-photo').click();
  await page.getByTestId('slip-file-input').setInputFiles({ name: 'slip.png', mimeType: 'image/png', buffer: Buffer.from(PNG_B64, 'base64') });
  await page.getByTestId('slip-use').click();

  await expect.poll(() => captured.looseSlips.length, { timeout: 10_000 }).toBe(1);
  // the match dialog opens on the slip that was just saved — one job, not two
  await expect(page.getByTestId('slip-candidate').first()).toBeVisible();
});

/** A tiny valid PNG. */
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAHElEQVQoz2P8//8/AzGAiYFIMKpwVOGowlGFAAB2fQMB+MvUEQAAAABJRU5ErkJggg==';
