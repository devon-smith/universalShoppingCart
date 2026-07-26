import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { signInCodeFrom, waitForEmail } from './mailpit';

/**
 * Phase 4: revisiting a saved product page re-observes it (BUILD_PLAN.md §14.1).
 *
 * The fixture server serves the same product at a different price on request, so a real
 * price change can be driven without touching a live retailer. The fixtures declare an
 * absolute canonical URL, so the query string does not change the fingerprint.
 *
 * In Chrome the side panel sits beside the active tab; here it is an ordinary tab, so the
 * panel is *reloaded* rather than reopened — opening a new tab would make the panel itself
 * the active tab, and the panel would read that instead of the product page.
 */

const fixtureOrigin = `http://127.0.0.1:${process.env.FIXTURE_SERVER_PORT ?? 3200}`;

function uniqueEmail(label: string): string {
  return `rev-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

/** Click without activating the panel's tab — see capture.spec.ts. */
async function clickWithoutFocus(page: Page, selector: string) {
  await page.locator(selector).dispatchEvent('click');
}

async function signIn(panel: Page, email: string) {
  await panel.getByLabel('Email address').fill(email);
  await panel.getByRole('button', { name: 'Email me a code' }).click();

  const code = signInCodeFrom(await waitForEmail(email));
  await panel.getByLabel(/6-digit code sent to/).fill(code);
  await panel.getByRole('button', { name: 'Sign in', exact: true }).click();

  await expect(panel.getByRole('heading', { name: 'Save a product' })).toBeVisible();
}

/**
 * Reopen the panel on whatever page is in front.
 *
 * `reload()` does not activate the tab, so the product page stays the one the panel reads.
 */
async function reopenPanel(panel: Page, product: Page) {
  await product.bringToFront();
  await panel.reload();
}

test.describe('revisit refresh', () => {
  test('recognises a page that is already saved and says nothing changed', async ({
    context,
    extensionId,
  }) => {
    const email = uniqueEmail('known');

    const product = await context.newPage();
    await product.goto(`${fixtureOrigin}/json-ld-complete.html`);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await signIn(panel, email);

    await product.bringToFront();
    await clickWithoutFocus(panel, 'button:has-text("Capture this page")');
    await expect(panel.getByLabel('Title')).toHaveValue('Meridian Wool Runner');
    await panel.getByRole('button', { name: 'Save to cart' }).click();
    await expect(panel.getByRole('status')).toContainText('Saved');

    await reopenPanel(panel, product);

    const status = panel.getByRole('status');
    await expect(status).toContainText('already saved');
    await expect(status).toContainText('Meridian Wool Runner');
    // Nothing changed between the two visits, and it says so rather than implying the
    // check found something.
    await expect(status).toContainText('nothing has changed');
  });

  test('re-observes a price that changed since it was saved', async ({ context, extensionId }) => {
    const email = uniqueEmail('changed');

    const product = await context.newPage();
    await product.goto(`${fixtureOrigin}/json-ld-complete.html`);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await signIn(panel, email);

    await product.bringToFront();
    await clickWithoutFocus(panel, 'button:has-text("Capture this page")');
    await expect(panel.getByLabel('Title')).toHaveValue('Meridian Wool Runner');
    await panel.getByRole('button', { name: 'Save to cart' }).click();
    await expect(panel.getByRole('status')).toContainText('Saved');
    await expect(panel.getByText('$98.00')).toBeVisible();

    // Same product, same variant, lower price.
    await product.goto(`${fixtureOrigin}/json-ld-complete.html?price=88.00`);
    await reopenPanel(panel, product);

    await expect(panel.getByRole('status')).toContainText('price and availability updated');
    // One item, at the new price — a refresh, not a second card.
    await expect(panel.getByText('$88.00')).toBeVisible();
    await expect(panel.getByRole('listitem')).toHaveCount(1);
  });

  test('says nothing at all on a page that is not saved', async ({ context, extensionId }) => {
    const email = uniqueEmail('unknown');

    const product = await context.newPage();
    await product.goto(`${fixtureOrigin}/json-ld-complete.html`);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await signIn(panel, email);

    await product.bringToFront();
    await clickWithoutFocus(panel, 'button:has-text("Capture this page")');
    await panel.getByRole('button', { name: 'Save to cart' }).click();
    await expect(panel.getByRole('status')).toContainText('Saved');

    // A different product entirely. The panel is demonstrably working — it just saved
    // something — so silence here means "not saved", not "could not read the page".
    await product.goto(`${fixtureOrigin}/meta-only.html`);
    await reopenPanel(panel, product);

    await expect(panel.getByRole('button', { name: 'Capture this page' })).toBeVisible();
    await expect(panel.getByRole('status')).toHaveCount(0);
  });

  test('offers an explicit refresh once a page is recognised', async ({ context, extensionId }) => {
    const email = uniqueEmail('explicit');

    const product = await context.newPage();
    await product.goto(`${fixtureOrigin}/json-ld-complete.html`);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await signIn(panel, email);

    await product.bringToFront();
    await clickWithoutFocus(panel, 'button:has-text("Capture this page")');
    await expect(panel.getByLabel('Title')).toHaveValue('Meridian Wool Runner');
    await panel.getByRole('button', { name: 'Save to cart' }).click();
    await expect(panel.getByRole('status')).toContainText('Saved');

    await reopenPanel(panel, product);
    await expect(panel.getByRole('status')).toContainText('nothing has changed');

    // The price moves while the panel is open; the manual refresh picks it up.
    await product.goto(`${fixtureOrigin}/json-ld-complete.html?price=79.50`);
    await product.bringToFront();
    await clickWithoutFocus(panel, 'button:has-text("Refresh from this page")');

    await expect(panel.getByRole('status')).toContainText('price and availability updated');
    await expect(panel.getByText('$79.50')).toBeVisible();
  });
});
