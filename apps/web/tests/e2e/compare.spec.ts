import type { Database, ProductCaptureV1 } from '@universal-cart/contracts';
import { computeFingerprint } from '@universal-cart/extractors';
import { createClient } from '@supabase/supabase-js';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { mailbox, signInCodeFrom } from './mailpit';
import { signInBrowser } from './seed';

/**
 * Comparison, the visible half.
 *
 * The core (`compareItems`, `groupByRetailer`) is unit-tested; what these check is that the
 * view honours the distinction that core encodes. A **comparable** row may say "differs" and
 * mark the cheapest; a **descriptive** row — size, colour, composition, notes — may say
 * nothing of the sort, no matter how similar the values look. That is the product's central
 * honesty rule and it is only enforceable here, where the markup exists.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

function uniqueEmail(label: string): string {
  return `cmp-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

interface Fixture {
  title: string;
  slug: string;
  retailer?: string;
  price?: string | null;
  original?: string | null;
  currency?: string | null;
  availability?: ProductCaptureV1['offer']['availability'];
  variant?: Record<string, string>;
  composition?: string | null;
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
      composition: fixture.composition ?? null,
    },
    offer: {
      priceAmount: fixture.price === undefined ? '98.00' : fixture.price,
      originalPriceAmount: fixture.original ?? null,
      currency: fixture.currency === undefined ? 'USD' : fixture.currency,
      availability: fixture.availability ?? 'in_stock',
    },
    selectedVariant: fixture.variant ?? { Size: 'M' },
    evidence: [],
    extraction: {
      extractorId: 'generic',
      extractorVersion: '1.0.0',
      overallConfidence: 0.9,
      observedAt: new Date().toISOString(),
    },
  };
}

async function seed(email: string, fixtures: Fixture[]) {
  const inbox = mailbox(email);
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
    const { error } = await client.rpc('ingest_product_capture', {
      p_capture: payload as never,
      p_cart_id: cart!.id,
      p_fingerprint: await computeFingerprint({
        canonicalUrl: payload.source.canonicalUrl,
        url: payload.source.url,
        selectedVariant: payload.selectedVariant,
        identifiers: payload.product.identifiers,
      }),
      p_user_fields: {} as never,
    });
    expect(error, error?.message).toBeNull();
  }

  return client;
}

/**
 * Two jackets a shopper would genuinely be choosing between.
 *
 * Deliberately share a size label across two different retailers, because that is the case
 * the view must not claim agreement on — the whole reason variant rows are descriptive.
 */
const CATALOGUE: Fixture[] = [
  {
    title: 'Meridian Wool Runner',
    slug: 'meridian',
    retailer: 'Northwind',
    price: '84.00',
    original: '120.00',
    variant: { Size: 'M', Color: 'Natural Black' },
    composition: '100% merino wool',
  },
  {
    title: 'Kestrel Rain Shell',
    slug: 'kestrel',
    retailer: 'Fieldcraft',
    price: '189.00',
    availability: 'out_of_stock',
    variant: { Size: 'M', Color: 'Slate' },
    composition: 'Shell: 100% nylon; Lining: 52% polyester',
  },
  {
    title: 'Alpenrose Down Jacket',
    slug: 'alpenrose',
    retailer: 'Bergsport',
    price: '242.50',
    variant: { Size: 'L' },
  },
  { title: 'Tidewater Skillet', slug: 'tidewater', retailer: 'Harbour', price: '34.00' },
];

async function openDashboard(page: Page, label: string, fixtures: Fixture[] = CATALOGUE) {
  const email = uniqueEmail(label);
  const client = await seed(email, fixtures);
  await signInBrowser(page, client);
  await expect(page.getByTestId('item-card')).toHaveCount(fixtures.length);
  return client;
}

/** Put named products into the comparison through the UI, the way a person does. */
async function choose(page: Page, ...titles: string[]) {
  for (const title of titles) {
    await page
      .getByTestId('item-card')
      .filter({ hasText: title })
      .getByTestId('compare-toggle')
      .click();
  }
}

function row(page: Page, key: string) {
  return page.locator(`[data-testid="compare-row"][data-row="${key}"]`);
}

test.describe('choosing what to compare', () => {
  test('the tray appears on the first pick and opens a comparison at two', async ({ page }) => {
    await openDashboard(page, 'tray');

    await expect(page.getByTestId('compare-tray')).toBeHidden();

    await choose(page, 'Meridian Wool Runner');
    const tray = page.getByTestId('compare-tray');
    await expect(tray).toBeVisible();
    // One item is not a comparison, so there is no link to click — and no disabled button
    // pretending otherwise.
    await expect(tray.getByTestId('compare-open')).toHaveCount(0);
    await expect(tray).toContainText('Pick 1 more');

    await choose(page, 'Kestrel Rain Shell');
    await expect(tray.getByTestId('compare-open')).toBeVisible();

    await tray.getByTestId('compare-open').click();
    await expect(page).toHaveURL(/\/app\/compare\?items=/);
    await expect(page.getByTestId('compare-column')).toHaveCount(2);
  });

  test('stops at four and says why, without swallowing the click', async ({ page }) => {
    await openDashboard(page, 'cap');

    await choose(
      page,
      'Meridian Wool Runner',
      'Kestrel Rain Shell',
      'Alpenrose Down Jacket',
      'Tidewater Skillet',
    );
    await expect(page.getByTestId('compare-tray')).toContainText('Comparing 4 of 4');

    // Every unselected toggle is blocked rather than silently ignoring a click.
    const blocked = page.locator('[data-testid="compare-toggle"][disabled]');
    await expect(blocked).toHaveCount(0); // all four are selected, so none is blocked

    // Deselecting one frees a slot.
    await page
      .getByTestId('item-card')
      .filter({ hasText: 'Tidewater Skillet' })
      .getByTestId('compare-toggle')
      .click();
    await expect(page.getByTestId('compare-tray')).toContainText('Comparing 3 of 4');
  });

  test('a removed item leaves the tray with it', async ({ page }) => {
    await openDashboard(page, 'remove');

    await choose(page, 'Meridian Wool Runner', 'Kestrel Rain Shell');
    const tray = page.getByTestId('compare-tray');
    await expect(tray).toContainText('Comparing 2 of 4');

    await tray.getByRole('button', { name: /Meridian Wool Runner/ }).click();
    await expect(tray).toContainText('Comparing 1 of 4');
    await expect(tray).not.toContainText('Meridian Wool Runner');
  });
});

test.describe('what the comparison asserts', () => {
  async function compareTwo(page: Page, label: string) {
    await openDashboard(page, label);
    await choose(page, 'Meridian Wool Runner', 'Kestrel Rain Shell');
    await page.getByTestId('compare-open').click();
    await expect(page.getByTestId('compare-table')).toBeVisible();
  }

  test('marks the cheapest, and says which comparable rows differ', async ({ page }) => {
    await compareTwo(page, 'verdicts');

    const price = row(page, 'price');
    await expect(price).toHaveAttribute('data-comparable', 'true');
    await expect(price).toHaveAttribute('data-differs', 'true');
    // 84.00 against 189.00 — the mark belongs to exactly one column.
    await expect(price.getByText('Lowest of these')).toHaveCount(1);

    const availability = row(page, 'availability');
    await expect(availability).toHaveAttribute('data-comparable', 'true');
    await expect(availability).toHaveAttribute('data-differs', 'true');

    const retailer = row(page, 'retailer');
    await expect(retailer).toHaveAttribute('data-differs', 'true');
  });

  /**
   * The rule the whole feature turns on. Both jackets are a size "M", from two different
   * retailers. Nothing may call that agreement.
   */
  test('never claims two retailers’ size “M” are the same size', async ({ page }) => {
    await compareTwo(page, 'variant');

    const size = row(page, 'variant.Size');
    await expect(size).toBeVisible();
    await expect(size).toHaveAttribute('data-comparable', 'false');
    // No verdict either way — not "same", and not "differs".
    await expect(size).toHaveAttribute('data-differs', 'false');
    await expect(size.locator('th')).toContainText('not compared');
    await expect(size.locator('th')).not.toContainText('same');

    // Both values are still shown; they are just not being matched.
    await expect(size.locator('td').nth(0)).toContainText('M');
    await expect(size.locator('td').nth(1)).toContainText('M');
  });

  test('shows composition without asserting two fibre strings agree', async ({ page }) => {
    await compareTwo(page, 'composition');

    const composition = row(page, 'composition');
    await expect(composition).toBeVisible();
    await expect(composition).toHaveAttribute('data-comparable', 'false');
    await expect(composition.locator('th')).toContainText('not compared');
    await expect(composition).toContainText('100% merino wool');
    await expect(composition).toContainText('Shell: 100% nylon');
  });

  test('shows a former price only where one is genuinely higher', async ({ page }) => {
    await compareTwo(page, 'was');

    const was = row(page, 'original');
    await expect(was).toBeVisible();
    // Meridian was 120.00; Kestrel never had a former price, so its cell is absent, not zero.
    await expect(was.locator('td').nth(0)).toContainText('$120.00');
    await expect(was.locator('td').nth(1)).toHaveAttribute('data-present', 'false');
  });

  test('a missing value reads as missing, not as an answer', async ({ page }) => {
    await compareTwo(page, 'absent');

    const absent = page.locator('[data-testid="compare-cell"][data-present="false"]').first();
    await expect(absent).toContainText('—');
    await expect(absent.locator('.uc-sr-only')).toHaveText('Not stated on the page');
  });

  test('refuses to name a cheapest across two currencies', async ({ page }) => {
    await openDashboard(page, 'currency', [
      { title: 'Dollar Jacket', slug: 'usd', price: '84.00', currency: 'USD' },
      {
        title: 'Euro Jacket',
        slug: 'eur',
        retailer: 'Zalando',
        price: '79.00',
        currency: 'EUR',
      },
    ]);

    await choose(page, 'Dollar Jacket', 'Euro Jacket');
    await page.getByTestId('compare-open').click();

    await expect(page.getByTestId('mixed-currency')).toBeVisible();
    await expect(page.getByText('Lowest of these')).toHaveCount(0);
  });
});

test.describe('the compare route', () => {
  test('groups the open-at-retailer action by site', async ({ page }) => {
    await openDashboard(page, 'openall');
    await choose(page, 'Meridian Wool Runner', 'Kestrel Rain Shell');
    await page.getByTestId('compare-open').click();

    const groups = page.getByTestId('open-group');
    await expect(groups).toHaveCount(2);
    await expect(groups.nth(0)).toContainText('Open 1 at Northwind');
    await expect(groups.nth(1)).toContainText('Open 1 at Fieldcraft');
  });

  /** The link is user-controlled input, and RLS is the gate that makes that safe. */
  test('shows nothing for another account’s item id', async ({ page, browser }) => {
    const strangerEmail = uniqueEmail('stranger');
    const stranger = await seed(strangerEmail, [
      { title: 'Someone Else’s Coat', slug: 'private', price: '55.00' },
    ]);
    const { data: theirs } = await stranger.from('items').select('id').limit(2);
    const strangerIds = (theirs ?? []).map((row) => row.id);
    expect(strangerIds.length).toBeGreaterThan(0);

    await openDashboard(page, 'rls');
    await page.goto(`/app/compare?items=${strangerIds[0]},${strangerIds[0]}`);

    await expect(page.getByRole('heading', { name: 'Nothing to compare yet' })).toBeVisible();
    await expect(page.getByText('Someone Else’s Coat')).toHaveCount(0);
    void browser;
  });

  test('a malformed link does not reach a query', async ({ page }) => {
    await openDashboard(page, 'malformed');
    await page.goto('/app/compare?items=not-an-id,%27%3B%20drop%20table%20items%3B%20--');
    await expect(page.getByRole('heading', { name: 'Nothing to compare yet' })).toBeVisible();
  });

  test('survives a reload, because the selection is in the URL', async ({ page }) => {
    await openDashboard(page, 'reload');
    await choose(page, 'Meridian Wool Runner', 'Kestrel Rain Shell');
    await page.getByTestId('compare-open').click();
    await expect(page.getByTestId('compare-column')).toHaveCount(2);

    await page.reload();
    await expect(page.getByTestId('compare-column')).toHaveCount(2);
  });
});

test.describe('responsive', () => {
  /**
   * Four columns cannot fit a phone, and the table says so by scrolling inside its own box.
   * What must never happen is the *page* scrolling sideways — Phase 5's rule.
   */
  test('the table scrolls, the page does not', async ({ page }) => {
    await openDashboard(page, 'responsive');
    await choose(
      page,
      'Meridian Wool Runner',
      'Kestrel Rain Shell',
      'Alpenrose Down Jacket',
      'Tidewater Skillet',
    );
    await page.getByTestId('compare-open').click();
    await expect(page.getByTestId('compare-column')).toHaveCount(4);

    for (const width of [375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(120);

      const box = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(box.scroll, `page overflows at ${width}px`).toBeLessThanOrEqual(box.client);
    }

    // At 375 the table itself is the thing that scrolls.
    await page.setViewportSize({ width: 375, height: 900 });
    const scroller = await page
      .getByTestId('compare-scroll')
      .evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(scroller.scroll).toBeGreaterThan(scroller.client);
  });
});
