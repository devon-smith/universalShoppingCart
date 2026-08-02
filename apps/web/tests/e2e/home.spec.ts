import { expect, test } from '@playwright/test';

test.describe('landing page', () => {
  test('renders the product name and current phase', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1, name: 'Universal Cart' })).toBeVisible();
    await expect(page.getByText('Phase 1 — accounts and access control')).toBeVisible();
  });

  test('sends a signed-out visitor to sign in', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});
