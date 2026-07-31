import { expect, test } from '@playwright/test';

test.describe('landing page', () => {
  /**
   * This used to assert the page said "Phase 1 — accounts and access control". That line was
   * the first thing a visitor read, and it stopped being true several phases ago — capture,
   * the dashboard, price history and retailer adapters all ship now. Asserting the build phase
   * on the marketing page also meant the test had to be edited every phase to stay green,
   * which is a test measuring the wrong thing.
   *
   * What is asserted instead is what the page is for: it names the product, says what it does,
   * and offers the way in.
   */
  test('says what the product does', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1, name: 'Universal Cart' })).toBeVisible();
    await expect(page.getByText(/save the things you are choosing between/i)).toBeVisible();
    await expect(page.getByText(/Capture what you are considering/i)).toBeVisible();
  });

  test('does not promise features that are still unbuilt', async ({ page }) => {
    await page.goto('/');

    // The old footer said capture, the dashboard and sharing "arrive in later phases".
    await expect(page.getByText(/arrive in later phases/i)).toHaveCount(0);
    await expect(page.getByText(/Phase \d/i)).toHaveCount(0);
  });

  test('sends a signed-out visitor to sign in', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});
