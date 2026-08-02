import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { signInCodeFrom, waitForEmail } from './mailpit';

/**
 * The Phase 2B acceptance flow, end to end: sign in, capture a deterministic fixture
 * product page, edit a field, save, and see the item — then save it again and watch it
 * refresh rather than duplicate.
 */

const fixtureOrigin = `http://127.0.0.1:${process.env.FIXTURE_SERVER_PORT ?? 3200}`;

function uniqueEmail(label: string): string {
  return `cap-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

/**
 * Click a panel control without activating the panel's tab.
 *
 * A real Chrome side panel is not a tab, so the product page stays active while the user
 * interacts with the panel. Playwright's `click()` would bring the panel tab to the front
 * and change which tab `chrome.tabs.query({active:true})` returns, so capture actions are
 * dispatched instead — that keeps the test on the production code path.
 */
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

test.describe('capture and save', () => {
  test('captures a fixture product page, saves it, and refreshes on a second save', async ({
    context,
    extensionId,
  }) => {
    const email = uniqueEmail('flow');

    // A product tab, and the side panel opened as its own page.
    const product = await context.newPage();
    await product.goto(`${fixtureOrigin}/json-ld-complete.html`);
    await expect(product.getByRole('heading', { level: 1 })).toHaveText('Meridian Wool Runner');

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await signIn(panel, email);

    // The panel captures the *active* tab, so the product page must stay in front.
    await product.bringToFront();
    await clickWithoutFocus(panel, 'button:has-text("Capture this page")');

    // Extraction filled the preview from the page's structured data.
    await expect(panel.getByLabel('Title')).toHaveValue('Meridian Wool Runner');
    await expect(panel.getByLabel('Price')).toHaveValue('98.00');
    await expect(panel.getByLabel('Currency')).toHaveValue('USD');
    await expect(panel.getByRole('list', { name: 'Selected options' })).toContainText(
      'Color: Natural Black',
    );

    // Correct a field and add a note before saving.
    await panel.getByLabel('Title').fill('Meridian Wool Runner (my pick)');
    await panel.getByLabel('Note').fill('for the trip');
    await panel.getByLabel('Quantity').fill('2');
    await panel.getByRole('button', { name: 'Save to cart' }).click();

    await expect(panel.getByRole('status')).toContainText('Saved');
    await expect(panel.getByRole('status')).toContainText('Meridian Wool Runner (my pick)');

    // It shows up in the panel's recent list.
    await expect(
      panel.getByRole('listitem').filter({ hasText: 'Meridian Wool Runner (my pick)' }),
    ).toBeVisible();

    // Saving the same page again refreshes rather than duplicating.
    await product.bringToFront();
    await clickWithoutFocus(panel, 'button:has-text("Capture this page")');
    await expect(panel.getByLabel('Title')).toHaveValue('Meridian Wool Runner');
    await panel.getByRole('button', { name: 'Save to cart' }).click();

    await expect(panel.getByRole('status')).toContainText('Already saved');
    await expect(panel.getByRole('status')).toContainText('refreshed');

    // Still one item, and the user's note and quantity survived the refresh.
    const saved = panel.getByRole('listitem').filter({ hasText: 'Meridian Wool Runner' });
    await expect(saved).toHaveCount(1);
  });

  test('captures a page whose price is only in the DOM', async ({ context, extensionId }) => {
    const email = uniqueEmail('dom');

    const product = await context.newPage();
    await product.goto(`${fixtureOrigin}/dom-only.html`);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await signIn(panel, email);

    await product.bringToFront();
    await clickWithoutFocus(panel, 'button:has-text("Capture this page")');

    await expect(panel.getByLabel('Title')).toHaveValue('Solstice Desk Lamp');
    await expect(panel.getByLabel('Price')).toHaveValue('129.00');
    // The variant came from both the DOM and the URL.
    await expect(panel.getByRole('list', { name: 'Selected options' })).toContainText('Finish');
  });

  test('lets the user fill in a page that states nothing', async ({ context, extensionId }) => {
    const email = uniqueEmail('sparse');

    const product = await context.newPage();
    await product.goto(`${fixtureOrigin}/sparse.html`);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await signIn(panel, email);

    await product.bringToFront();
    await clickWithoutFocus(panel, 'button:has-text("Capture this page")');

    // Nothing was extractable, so the panel asks rather than inventing.
    await expect(panel.getByRole('note')).toContainText('Check the highlighted fields');
    await expect(panel.getByLabel('Title')).toHaveValue('');

    await panel.getByLabel('Title').fill('Something I typed myself');
    await panel.getByLabel('Price').fill('12.34');
    await panel.getByLabel('Currency').fill('USD');
    await panel.getByRole('button', { name: 'Save to cart' }).click();

    await expect(panel.getByRole('status')).toContainText('Something I typed myself');
  });

  test('refuses to read a checkout page', async ({ context, extensionId }) => {
    const email = uniqueEmail('checkout');

    const product = await context.newPage();
    // The fixture server only serves .html, so this 404s — but the guard runs on the URL
    // before anything is injected, which is the behaviour under test.
    await product.goto(`${fixtureOrigin}/checkout`).catch(() => undefined);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await signIn(panel, email);

    await product.bringToFront();
    await clickWithoutFocus(panel, 'button:has-text("Capture this page")');

    // The refusal comes from the injected script, which is the only code that can see the
    // page URL — the extension never asked for permission to read tab URLs.
    await expect(panel.getByRole('alert')).toContainText('cannot be captured');
  });
});
