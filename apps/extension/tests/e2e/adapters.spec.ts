import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { signInCodeFrom, waitForEmail } from './mailpit';

/**
 * Phase 5 — a retailer adapter running in the real extension.
 *
 * The unit fixtures already prove the adapters parse what they should. This proves the
 * adapter reaches the panel: the page's structured data says one price, the shopper is
 * looking at a different variant, and the number offered for saving is the variant's.
 */

const fixtureOrigin = `http://127.0.0.1:${process.env.FIXTURE_SERVER_PORT ?? 3200}`;

function uniqueEmail(label: string): string {
  return `adp-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
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

test.describe('retailer adapters', () => {
  test('captures the selected variant, not the price in the structured data', async ({
    context,
    extensionId,
  }) => {
    const email = uniqueEmail('shopify');

    const product = await context.newPage();
    // The JSON-LD on this page says 98.00 — the master product's price. `?variant=` says
    // the shopper is looking at the 41 / Slate, which is 108.00.
    await product.goto(
      `${fixtureOrigin}/adapters/shopify-variant-selected.html?variant=4400220002`,
    );

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await signIn(panel, email);

    await product.bringToFront();
    await clickWithoutFocus(panel, 'button:has-text("Capture this page")');

    await expect(panel.getByLabel('Title')).toHaveValue('Meridian Wool Runner');
    await expect(panel.getByLabel('Price')).toHaveValue('108.00');
    await expect(panel.getByLabel('Currency')).toHaveValue('USD');

    const chips = panel.getByRole('list', { name: 'Selected options' });
    await expect(chips).toContainText('Size: 41');
    await expect(chips).toContainText('Colour: Slate');

    await panel.getByRole('button', { name: 'Save to cart' }).click();
    await expect(panel.getByRole('status')).toContainText('Saved');
    await expect(panel.getByText('$108.00')).toBeVisible();
  });

  test('falls back to the generic pipeline on a page no adapter claims', async ({
    context,
    extensionId,
  }) => {
    const email = uniqueEmail('generic');

    const product = await context.newPage();
    await product.goto(`${fixtureOrigin}/json-ld-complete.html`);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await signIn(panel, email);

    await product.bringToFront();
    await clickWithoutFocus(panel, 'button:has-text("Capture this page")');

    // Adapters loaded, none matched, and the page still captured from structured data.
    await expect(panel.getByLabel('Title')).toHaveValue('Meridian Wool Runner');
    await expect(panel.getByLabel('Price')).toHaveValue('98.00');
  });

  test('reports a WooCommerce variation price rather than the range in the heading', async ({
    context,
    extensionId,
  }) => {
    const email = uniqueEmail('woo');

    const product = await context.newPage();
    await product.goto(`${fixtureOrigin}/adapters/woocommerce-variable.html`);
    // The visible heading price is a range; the selected variation is a single number.
    await expect(product.locator('p.price')).toContainText('£42.00 – £68.00');

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await signIn(panel, email);

    await product.bringToFront();
    await clickWithoutFocus(panel, 'button:has-text("Capture this page")');

    await expect(panel.getByLabel('Title')).toHaveValue('Alder Cutting Board');
    await expect(panel.getByLabel('Price')).toHaveValue('68.00');
    await expect(panel.getByLabel('Currency')).toHaveValue('GBP');
    await expect(panel.getByRole('list', { name: 'Selected options' })).toContainText(
      'Finish: Oiled',
    );
  });
});
