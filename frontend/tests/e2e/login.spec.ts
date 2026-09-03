import { expect, test } from '@playwright/test';

test.describe('login page i18n', () => {
  test('renders in Thai by default and switches to English', async ({ page }) => {
    await page.goto('/login');

    // Thai is the default locale (no cookie set yet).
    await expect(page.getByRole('heading', { name: 'เข้าสู่ระบบ' })).toBeVisible();
    await expect(page.getByLabel('ชื่อผู้ใช้')).toBeVisible();
    await expect(page.getByRole('button', { name: 'เข้าสู่ระบบ' })).toBeVisible();

    // Switch to English through the language toggle.
    await page.getByTestId('lang-en').click();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByLabel('Username')).toBeVisible();

    // Cookie is persisted so a reload keeps English.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    // And back to Thai.
    await page.getByTestId('lang-th').click();
    await expect(page.getByRole('heading', { name: 'เข้าสู่ระบบ' })).toBeVisible();
  });
});
