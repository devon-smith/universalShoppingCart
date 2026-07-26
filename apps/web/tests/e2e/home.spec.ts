import { expect, test } from '@playwright/test';

test.describe('landing page', () => {
  test('renders the product name and phase status', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1, name: 'Universal Cart' })).toBeVisible();
    await expect(page.getByText('Phase 0 — repository foundation')).toBeVisible();
  });

  test('lists what the scaffold provides', async ({ page }) => {
    await page.goto('/');

    const items = page.getByRole('listitem');
    await expect(items).toHaveCount(6);
    await expect(items.first()).toContainText('Turborepo');
  });
});
