import type { Database, ProductCaptureV1 } from '@universal-cart/contracts';
import { computeFingerprint } from '@universal-cart/extractors';
import { createClient } from '@supabase/supabase-js';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { mailbox, signInCodeFrom } from './mailpit';
import { signInBrowser } from './seed';

/**
 * Phase 3: the dashboard as a daily tool — search, filters, sorting, editing, status
 * changes, archive with undo, and permanent deletion.
 *
 * Fixtures are ingested through the real RPC by a second client, then the same user signs
 * in through the browser.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

function uniqueEmail(label: string): string {
  return `ux-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

interface Fixture {
  title: string;
  price?: string | null;
  original?: string | null;
  retailer?: string;
  slug: string;
  availability?: ProductCaptureV1['offer']['availability'];
}

function capture(fixture: Fixture): ProductCaptureV1 {
  const retailer = fixture.retailer ?? 'Northwind';
  const host = `shop.${retailer.toLowerCase()}.example`;
  const url = `https://${host}/p/${fixture.slug}`;

  return {
    schemaVersion: 1,
    source: {
      url,
      canonicalUrl: url,
      domain: host,
      retailerName: retailer,
      pageTitle: fixture.title,
    },
    product: {
      title: fixture.title,
      brand: retailer,
      description: null,
      imageUrls: [],
      selectedImageUrl: null,
      identifiers: { sku: fixture.slug },
      composition: null,
    },
    offer: {
      priceAmount: fixture.price === undefined ? '98.00' : fixture.price,
      originalPriceAmount: fixture.original ?? null,
      currency: fixture.price === null ? null : 'USD',
      availability: fixture.availability ?? 'in_stock',
    },
    selectedVariant: { Size: '10' },
    evidence: [],
    extraction: {
      extractorId: 'generic',
      extractorVersion: '1.0.0',
      overallConfidence: 0.9,
      observedAt: new Date().toISOString(),
    },
  };
}

async function seed(email: string, inbox: ReturnType<typeof mailbox>, fixtures: Fixture[]) {
  const client = createClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: otpError } = await client.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: 'http://127.0.0.1:3100/auth/confirm?next=%2Fapp',
    },
  });
  expect(otpError, otpError?.message).toBeNull();

  const code = signInCodeFrom(await inbox.next());
  const { error: verifyError } = await client.auth.verifyOtp({ email, token: code, type: 'email' });
  expect(verifyError, verifyError?.message).toBeNull();

  const { data: cart } = await client.from('carts').select('id').eq('is_default', true).single();

  for (const fixture of fixtures) {
    const payload = capture(fixture);
    const fingerprint = await computeFingerprint({
      canonicalUrl: payload.source.canonicalUrl,
      url: payload.source.url,
      selectedVariant: payload.selectedVariant,
      identifiers: payload.product.identifiers,
    });

    const { error } = await client.rpc('ingest_product_capture', {
      p_capture: payload as never,
      p_cart_id: cart!.id,
      p_fingerprint: fingerprint,
      p_user_fields: {} as never,
    });
    expect(error, error?.message).toBeNull();
  }

  return client;
}

const CATALOGUE: Fixture[] = [
  { title: 'Meridian Wool Runner', slug: 'meridian', price: '98.00', original: '120.00' },
  { title: 'Kestrel Rain Shell', slug: 'kestrel', price: '189.00', retailer: 'Fieldcraft' },
  { title: 'Tidewater Skillet', slug: 'tidewater', price: '34.00', retailer: 'Harbour' },
  { title: 'Solstice Desk Lamp', slug: 'solstice', price: null, availability: 'out_of_stock' },
];

async function openDashboard(page: Page, label: string) {
  const email = uniqueEmail(label);
  const inbox = mailbox(email);
  const client = await seed(email, inbox, CATALOGUE);
  await signInBrowser(page, client);
  await expect(page.getByTestId('item-card')).toHaveCount(4);
  return { email, inbox };
}

/**
 * The secondary filters live in a popover now.
 *
 * They used to be a row of bare selects above the results, which at 375px wrapped taller than
 * the first product card — the dashboard opened on its own controls. The filters themselves
 * are unchanged, so these tests still drive the same labelled selects; they just have to open
 * the thing that holds them, which is what a user does.
 */
async function openFilters(page: Page) {
  await page.getByRole('button', { name: /^Filters/ }).click();
  await expect(page.getByRole('dialog', { name: 'Filters' })).toBeVisible();
}

/** Archive and "open at retailer" sit behind the row's overflow menu. */
async function overflow(page: Page, title: string) {
  const card = page.getByTestId('item-card').filter({ hasText: title });
  await card.getByRole('button', { name: /^More actions/ }).click();
  return card;
}

test.describe('dashboard as a daily tool', () => {
  test('searches across title, retailer, and note', async ({ page }) => {
    await openDashboard(page, 'search');

    await page.getByLabel('Search saved products').fill('kestrel');
    await expect(page.getByTestId('item-card')).toHaveCount(1);
    await expect(page.getByTestId('item-card')).toContainText('Kestrel Rain Shell');

    // Multi-term search across different fields.
    await page.getByLabel('Search saved products').fill('harbour skillet');
    await expect(page.getByTestId('item-card')).toHaveCount(1);
    await expect(page.getByTestId('item-card')).toContainText('Tidewater');

    // A search miss and a filter miss are different situations and now say so. Telling
    // somebody who typed a search term to go and check their filters sends them to the wrong
    // control.
    await page.getByLabel('Search saved products').fill('nothing matches this');
    await expect(page.getByText(/No saved product matches/)).toBeVisible();
    await expect(page.getByText('nothing matches this')).toBeVisible();

    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(page.getByTestId('item-card')).toHaveCount(4);
  });

  test('filters by retailer, availability, and sale', async ({ page }) => {
    await openDashboard(page, 'filter');

    await openFilters(page);
    await page.getByLabel('Retailer').selectOption('Fieldcraft');
    await expect(page.getByTestId('item-card')).toHaveCount(1);

    // What is filtering the results is visible outside the popover, as a chip.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Filters' })).toBeHidden();
    await expect(page.getByRole('button', { name: /Fieldcraft/ })).toBeVisible();

    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.getByTestId('item-card')).toHaveCount(4);

    await openFilters(page);
    await page.getByLabel('Availability').selectOption('out_of_stock');
    await expect(page.getByTestId('item-card')).toHaveCount(1);
    await expect(page.getByTestId('item-card')).toContainText('Solstice');

    await page.getByRole('button', { name: 'Reset' }).click();
    await page.getByLabel('On sale').check();
    await expect(page.getByTestId('item-card')).toHaveCount(1);
    await expect(page.getByTestId('item-card')).toContainText('Meridian');
  });

  test('sorts, putting unknown prices last', async ({ page }) => {
    await openDashboard(page, 'sort');

    await page.getByLabel('Sort by').selectOption('price-low');
    const titles = await page.getByTestId('item-card').allTextContents();
    expect(titles[0]).toContain('Tidewater');
    // "Price unknown" is not "free".
    expect(titles[3]).toContain('Solstice');

    await page.getByLabel('Sort by').selectOption('title');
    const alphabetical = await page.getByTestId('item-card').allTextContents();
    expect(alphabetical[0]).toContain('Kestrel');
  });

  test('switches between list and card views', async ({ page }) => {
    await openDashboard(page, 'view');

    const cards = page.getByRole('button', { name: 'cards', exact: true });
    await cards.click();
    await expect(cards).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('item-card')).toHaveCount(4);
  });

  test('edits the user-authored fields and leaves the retailer fields alone', async ({ page }) => {
    await openDashboard(page, 'edit');

    const card = page.getByTestId('item-card').filter({ hasText: 'Meridian' });
    await card.getByRole('button', { name: 'Details' }).click();

    const drawer = page.getByRole('dialog');
    await expect(drawer).toContainText('$98.00');

    await drawer.getByLabel('Quantity').fill('3');
    await drawer.getByLabel('Priority').selectOption('high');
    // Above the observed $98.00, so the "hit your target" badge should appear.
    await drawer.getByLabel('Desired price').fill('100.00');
    await drawer.getByLabel('Note').fill('for the trip');
    await drawer.getByRole('button', { name: 'Save changes' }).click();

    await expect(drawer).toBeHidden();
    await expect(card).toContainText('for the trip');
    await expect(card).toContainText('×3');
    await expect(card).toContainText('high priority');
    await expect(card).toContainText('At or below your target');
    // The observed price is untouched.
    await expect(card).toContainText('$98.00');

    // And it survives a reload, so it really reached the database.
    await page.reload();
    const reloaded = page.getByTestId('item-card').filter({ hasText: 'Meridian' });
    await expect(reloaded).toContainText('for the trip');
    await expect(reloaded).toContainText('$98.00');
  });

  test('rejects an invalid edit before it reaches the database', async ({ page }) => {
    await openDashboard(page, 'invalid');

    await page
      .getByTestId('item-card')
      .filter({ hasText: 'Meridian' })
      .getByRole('button', { name: 'Details' })
      .click();

    const drawer = page.getByRole('dialog');
    await drawer.getByLabel('Quantity').fill('0');
    await drawer.getByRole('button', { name: 'Save changes' }).click();

    await expect(drawer.getByRole('alert')).toContainText('at least 1');
    await expect(drawer).toBeVisible();
  });

  test('changes status from a card', async ({ page }) => {
    await openDashboard(page, 'status');

    const card = page.getByTestId('item-card').filter({ hasText: 'Meridian' });
    await expect(card).toHaveAttribute('data-status', 'saved');

    await card.getByRole('button', { name: 'Move to cart' }).click();
    await expect(card).toHaveAttribute('data-status', 'cart');

    await card.getByRole('button', { name: 'Mark purchased' }).click();
    await expect(card).toHaveAttribute('data-status', 'purchased');

    // The badge flips optimistically, before the write lands. Wait for the card to leave
    // its busy state, or the reload cancels the request that is still in flight.
    await expect(card.getByRole('button', { name: 'Move back to saved' })).toBeEnabled();
    await page.reload();
    await expect(page.getByTestId('item-card').filter({ hasText: 'Meridian' })).toHaveAttribute(
      'data-status',
      'purchased',
    );
  });

  test('archives with an undo, and the undo restores the previous status', async ({ page }) => {
    await openDashboard(page, 'archive');

    const card = page.getByTestId('item-card').filter({ hasText: 'Meridian' });
    await card.getByRole('button', { name: 'Move to cart' }).click();
    await expect(card).toHaveAttribute('data-status', 'cart');

    await overflow(page, 'Meridian');
    await page.getByRole('button', { name: 'Archive', exact: true }).click();

    // Gone from the default view, with an undo offered.
    await expect(page.getByTestId('item-card')).toHaveCount(3);
    const toast = page.getByRole('status');
    await expect(toast).toContainText('Archived');

    await toast.getByRole('button', { name: 'Undo' }).click();

    // Restored to `cart`, not to `saved` — undo puts back what was there.
    await expect(page.getByTestId('item-card')).toHaveCount(4);
    await expect(page.getByTestId('item-card').filter({ hasText: 'Meridian' })).toHaveAttribute(
      'data-status',
      'cart',
    );
  });

  test('shows archived items only when asked', async ({ page }) => {
    await openDashboard(page, 'archived-filter');

    await overflow(page, 'Meridian');
    await page.getByRole('button', { name: 'Archive', exact: true }).click();
    await expect(page.getByTestId('item-card')).toHaveCount(3);

    // Status is the navigation's job now, not a select competing with it. Two controls
    // writing one field could disagree — pick "Archived" in one and the other still read
    // "Any status".
    await page.getByRole('button', { name: /^Archived/ }).click();
    await expect(page.getByTestId('item-card')).toHaveCount(1);
    await expect(page.getByTestId('item-card')).toContainText('Meridian');

    await page.getByTestId('item-card').getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByTestId('item-card')).toHaveCount(0);
  });

  test('drawer traps focus, closes on Escape, and hands focus back to the opener', async ({
    page,
  }) => {
    await openDashboard(page, 'drawer-keys');

    const card = page.getByTestId('item-card').filter({ hasText: 'Meridian' });
    const opener = card.getByRole('button', { name: 'Details' });
    await opener.click();

    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();

    // Focus is inside the drawer, not left behind on the row underneath it.
    await expect(drawer.locator(':focus')).toHaveCount(1);

    // Escape closes, and focus returns to the control that opened it — otherwise a keyboard
    // user lands at the top of the document and has to tab back to where they were reading.
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('confirms a save, and says so without claiming anything was observed', async ({ page }) => {
    await openDashboard(page, 'save-toast');

    const card = page.getByTestId('item-card').filter({ hasText: 'Meridian' });
    await card.getByRole('button', { name: 'Details' }).click();

    const drawer = page.getByRole('dialog');
    await drawer.getByLabel('Note').fill('for the trip');
    await drawer.getByRole('button', { name: 'Save changes' }).click();

    await expect(drawer).toBeHidden();

    // One live region, one message. Saving used to confirm nothing at all.
    const toast = page.getByRole('status');
    await expect(toast).toContainText('Saved your changes');
    await expect(card).toContainText('for the trip');
  });

  test('rolls a refused change back and says so, rather than reverting in silence', async ({
    page,
  }) => {
    await openDashboard(page, 'rollback');

    // A note beyond the 2000-character limit is refused by the same schema on both sides.
    const card = page.getByTestId('item-card').filter({ hasText: 'Meridian' });
    await card.getByRole('button', { name: 'Details' }).click();

    const drawer = page.getByRole('dialog');
    await drawer.getByLabel('Note').fill('x'.repeat(2001));
    await drawer.getByRole('button', { name: 'Save changes' }).click();

    // Rejected before it reaches the database, and the drawer stays open with the reason.
    await expect(drawer.getByRole('alert')).toContainText('2000');
    await expect(drawer).toBeVisible();
  });

  test('deletes permanently, only after confirming', async ({ page }) => {
    await openDashboard(page, 'delete');

    await page
      .getByTestId('item-card')
      .filter({ hasText: 'Meridian' })
      .getByRole('button', { name: 'Details' })
      .click();

    const drawer = page.getByRole('dialog');
    await drawer.getByRole('button', { name: 'Delete permanently' }).click();

    // Asked first, and answering "keep it" really keeps it.
    await expect(drawer.getByText('Delete this item and its price history')).toBeVisible();
    await drawer.getByRole('button', { name: 'Keep it' }).click();
    await expect(page.getByTestId('item-card')).toHaveCount(4);

    await drawer.getByRole('button', { name: 'Delete permanently' }).click();
    await drawer.getByRole('button', { name: 'Yes, delete it' }).click();

    await expect(page.getByTestId('item-card')).toHaveCount(3);

    // The card disappears optimistically, so it is not evidence the row is gone. Wait for
    // the confirmation the server sends back before asserting the deletion survived — a
    // reload issued mid-request would otherwise cancel the delete and hide the bug.
    await expect(page.getByTestId('notice')).toContainText('Deleted');

    await page.reload();
    await expect(page.getByTestId('item-card')).toHaveCount(3);
  });
});
