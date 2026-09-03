import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Owner-only data screen: backup, restore and legacy import. The jobs themselves are backend work,
 * so this spec mocks the API and checks the parts that protect the store: the destructive actions
 * are gated behind an explicit confirmation, and a running job locks the buttons.
 */

const STORE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

const session = {
  access_token: 'test-access',
  refresh_token: 'test-refresh',
  expires_at: '2099-01-01T00:00:00Z',
  user: {
    id: USER_ID,
    store_id: STORE_ID,
    username: 'owner',
    display_name: 'Owner',
    role: 'store_owner',
    locale: 'th',
    must_reset_password: false,
  },
  store: { id: STORE_ID, code: 'S1', name: 'ร้านทดสอบ', name_en: 'Test Store', default_locale: 'th' },
  selected_store: { id: STORE_ID, code: 'S1', name: 'ร้านทดสอบ', name_en: 'Test Store', default_locale: 'th' },
};

const backupFile = { name: 'pos-backup-S1-20260903-120000.zip', size: 4096, created_at: '2026-09-03T05:00:00Z' };

const dump = {
  uploaded_at: '2026-09-03T06:00:00Z',
  source_sha256: 'abc123',
  tables: { buymain: 231774, buydetails: 585778, product: 6285 },
  file_name: 'dump.zip',
  size_bytes: 17143774,
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

interface Captured {
  restores: unknown[];
  imports: unknown[];
  backups: number;
}

async function mockApi(page: Page, opts: { running?: boolean } = {}): Promise<Captured> {
  const captured: Captured = { restores: [], imports: [], backups: 0 };
  const jobs = opts.running
    ? [{ id: 'job-1', store_id: STORE_ID, kind: 'backup', status: 'running', step: 'sales', progress: 42, started_at: '2026-09-03T06:10:00Z' }]
    : [];

  await page.route('**/api/v1/**', (route) => json(route, { error: { code: 'NOT_FOUND', message: 'not found' } }, 404));
  await page.route('**/api/v1/store/settings', (route) => json(route, {}));
  await page.route('**/api/v1/store', (route) => json(route, { id: STORE_ID, code: 'S1', name: 'ร้านทดสอบ' }));
  await page.route('**/api/v1/store/data/jobs', (route) => json(route, jobs));
  await page.route('**/api/v1/store/data/backups', (route) => {
    if (route.request().method() === 'POST') {
      captured.backups += 1;
      return json(route, { id: 'job-2', store_id: STORE_ID, kind: 'backup', status: 'running', started_at: '2026-09-03T06:20:00Z' }, 201);
    }
    return json(route, [backupFile]);
  });
  await page.route('**/api/v1/store/data/legacy', (route) => json(route, dump));
  await page.route('**/api/v1/store/data/restore', (route) => {
    captured.restores.push(route.request().postDataJSON());
    return json(route, { id: 'job-3', store_id: STORE_ID, kind: 'restore', status: 'running', started_at: '2026-09-03T06:30:00Z' }, 201);
  });
  await page.route('**/api/v1/store/data/legacy/import', (route) => {
    captured.imports.push(route.request().postDataJSON());
    return json(route, { id: 'job-4', store_id: STORE_ID, kind: 'legacy_import', status: 'running', started_at: '2026-09-03T06:40:00Z' }, 201);
  });
  return captured;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((value) => window.localStorage.setItem('pos.session', JSON.stringify(value)), session);
});

test.describe('data & backups', () => {
  test('a backup can be started and the archive is listed', async ({ page }) => {
    const captured = await mockApi(page);
    await page.goto('/settings/data');

    await expect(page.getByTestId('backup-list')).toContainText(backupFile.name);
    await page.getByTestId('backup-create').click();
    await expect.poll(() => captured.backups).toBe(1);
  });

  test('restore only runs after the owner confirms', async ({ page }) => {
    const captured = await mockApi(page);
    await page.goto('/settings/data');

    await page.getByTestId('backup-list').getByRole('button').nth(1).click(); // restore-from-this
    const confirm = page.getByTestId('restore-confirm');
    await expect(confirm).toBeVisible();
    await expect(confirm).toBeDisabled(); // not until the warning is acknowledged

    await page.getByTestId('restore-understood').check();
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect.poll(() => captured.restores.length).toBe(1);
    expect(captured.restores[0]).toEqual({ name: backupFile.name, replace: true, profile: true });
  });

  test('legacy import: dry run goes straight through, the real import asks first', async ({ page }) => {
    const captured = await mockApi(page);
    await page.goto('/settings/data');

    await expect(page.getByTestId('legacy-dump')).toContainText('dump.zip');

    await page.getByTestId('legacy-dry-run').click();
    await expect.poll(() => captured.imports.length).toBe(1);
    expect(captured.imports[0]).toEqual({ dry_run: true });

    await page.getByTestId('legacy-import').click();
    await page.getByTestId('legacy-import-confirm').click();
    await expect.poll(() => captured.imports.length).toBe(2);
    expect(captured.imports[1]).toEqual({ dry_run: false });
  });

  test('a running job blocks the other actions', async ({ page }) => {
    await mockApi(page, { running: true });
    await page.goto('/settings/data');

    await expect(page.getByTestId('backup-create')).toBeDisabled();
    await expect(page.getByTestId('legacy-dry-run')).toBeDisabled();
    await expect(page.getByTestId('legacy-import')).toBeDisabled();
  });
});
