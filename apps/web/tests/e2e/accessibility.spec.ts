import type { Database, ProductCaptureV1 } from '@universal-cart/contracts';
import { computeFingerprint } from '@universal-cart/extractors';
import { createClient } from '@supabase/supabase-js';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { mailbox, signInCodeFrom } from './mailpit';
import { signInBrowser } from './seed';

/**
 * Phase 5: the dashboard operated entirely by keyboard.
 *
 * These run in a real browser rather than jsdom, and that is not incidental. Every assertion
 * below is about `document.activeElement` after an element has been removed from the page —
 * which is exactly the behaviour jsdom approximates rather than implements, and `offsetParent`
 * (how the focus trap decides what is visible) is always null there. A green jsdom test for any
 * of this would mean nothing.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

function uniqueEmail(label: string): string {
  return `a11y-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

function capture(title: string, slug: string): ProductCaptureV1 {
  const url = `https://shop.northwind.example/p/${slug}`;
  return {
    schemaVersion: 1,
    source: {
      url,
      canonicalUrl: url,
      domain: 'shop.northwind.example',
      retailerName: 'Northwind',
      pageTitle: title,
    },
    product: {
      title,
      brand: 'Northwind',
      description: null,
      imageUrls: [],
      selectedImageUrl: null,
      identifiers: { sku: slug },
      // Required by the capture contract as of 9067454. Null is the honest fixture value:
      // these pages publish no composition, and inventing one would make the field look
      // better covered than it is.
      composition: null,
    },
    offer: {
      priceAmount: '98.00',
      originalPriceAmount: '120.00',
      currency: 'USD',
      availability: 'in_stock',
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

async function openDashboard(page: Page, label: string) {
  const email = uniqueEmail(label);
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

  for (const [title, slug] of [
    ['Meridian Wool Runner', 'meridian'],
    ['Kestrel Rain Shell', 'kestrel'],
  ] as const) {
    const payload = capture(title, slug);
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

  await signInBrowser(page, client);
  await expect(page.getByTestId('item-card')).toHaveCount(2);
}

/** What the keyboard is on right now, described the way a test failure can be read. */
function focused(page: Page) {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (!element || element === document.body) return { tag: 'BODY', name: '', id: '' };
    return {
      tag: element.tagName,
      name: (element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 60),
      id: element.id,
    };
  });
}

test.describe('keyboard and focus', () => {
  /**
   * WCAG 2.4.1. Before this, reaching the first product meant eight tab stops through a rail
   * that is identical on every visit: wordmark, cart selector, four sections, account menu.
   */
  test('the first Tab offers a way past the navigation', async ({ page }) => {
    await openDashboard(page, 'skip');

    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to your saved products' });
    await expect(skip).toBeFocused();
    // Hidden until it has focus, so it costs a mouse user nothing.
    await expect(skip).toBeVisible();

    await page.keyboard.press('Enter');
    expect(await focused(page)).toMatchObject({ id: 'content' });
  });

  /**
   * A disclosure is not a menu.
   *
   * `role="menu"` was removed in Phase 3 because it replaces the implicit button and link
   * roles and promises arrow-key navigation that is not implemented. The trigger went on
   * claiming `aria-haspopup="menu"` anyway, which makes exactly the same promise — and `true`
   * is a synonym for `menu`, so there is no honest value to use here. `aria-expanded` alone is
   * the disclosure pattern.
   */
  test('no control announces a menu it does not implement', async ({ page }) => {
    await openDashboard(page, 'haspopup');

    expect(await page.locator('[aria-haspopup]').count()).toBe(
      // Only the filter popover, which really is a dialog and really does trap focus.
      await page.locator('[aria-haspopup="dialog"]').count(),
    );

    const account = page.getByTestId('account-menu');
    await expect(account).toHaveAttribute('aria-expanded', 'false');
    await account.click();
    await expect(account).toHaveAttribute('aria-expanded', 'true');
    // The panel is a named group, so the label attaches to something. On a bare `div` it is
    // dropped and the panel reaches a screen reader unnamed.
    await expect(page.getByRole('group', { name: 'Account' })).toBeVisible();
  });

  test('Escape gives focus back to the account menu button', async ({ page }) => {
    await openDashboard(page, 'account-escape');

    const account = page.getByTestId('account-menu');
    await account.click();
    await page.getByRole('link', { name: /Extractor health/ }).focus();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('group', { name: 'Account' })).toBeHidden();
    // Without the return, the focused link is removed and the keyboard lands on <body>, so
    // the next Tab restarts from the top of the document.
    await expect(account).toBeFocused();
  });

  test('Escape gives focus back to a card overflow button', async ({ page }) => {
    await openDashboard(page, 'overflow-escape');

    const card = page.getByTestId('item-card').filter({ hasText: 'Meridian Wool Runner' });
    const more = card.getByRole('button', { name: /^More actions/ });
    await more.click();

    const panel = page.getByRole('group', { name: /^Actions for/ });
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Archive', exact: true }).focus();

    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(more).toBeFocused();
  });

  /** Clicking elsewhere is a choice about where focus should go, and it is respected. */
  test('dismissing by clicking another control does not steal focus back', async ({ page }) => {
    await openDashboard(page, 'no-steal');

    const account = page.getByTestId('account-menu');
    await account.click();
    await expect(page.getByRole('group', { name: 'Account' })).toBeVisible();

    const search = page.getByLabel('Search saved products');
    await search.click();

    await expect(page.getByRole('group', { name: 'Account' })).toBeHidden();
    await expect(search).toBeFocused();
  });

  test('the item drawer traps Tab, closes on Escape, and hands focus back', async ({ page }) => {
    await openDashboard(page, 'drawer');

    const card = page.getByTestId('item-card').filter({ hasText: 'Meridian Wool Runner' });
    const details = card.getByRole('button', { name: 'Details' });
    await details.click();

    const drawer = page.getByRole('dialog', { name: /^Details for/ });
    await expect(drawer).toBeVisible();
    // Focus lands inside rather than behind the panel that now covers the page.
    expect(await focused(page)).toMatchObject({ name: 'Close details' });

    // Tab all the way round and land back inside — never on the dashboard underneath.
    for (let press = 0; press < 40; press += 1) await page.keyboard.press('Tab');
    expect(
      await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        return dialog?.contains(document.activeElement) ?? false;
      }),
    ).toBe(true);

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(details).toBeFocused();
  });

  /**
   * The destructive prompt replaces the button that opened it, and a replaced button takes the
   * keyboard with it. Answering a "are you sure?" by silently dropping focus onto `<body>` is
   * the worst place in the app for it to happen.
   */
  test('the delete confirmation moves focus with the decision', async ({ page }) => {
    await openDashboard(page, 'delete-focus');

    const card = page.getByTestId('item-card').filter({ hasText: 'Kestrel Rain Shell' });
    await card.getByRole('button', { name: 'Details' }).click();

    const remove = page.getByRole('button', { name: 'Delete permanently' });
    await remove.click();

    const confirm = page.getByRole('button', { name: 'Yes, delete it' });
    await expect(confirm).toBeFocused();
    // Described by the question, so a screen reader reads the prompt rather than four words.
    await expect(confirm).toHaveAttribute('aria-describedby', 'delete-question');

    await page.getByRole('button', { name: 'Keep it' }).click();
    await expect(remove).toBeFocused();
  });

  test('the filter popover traps focus and Escape closes it', async ({ page }) => {
    await openDashboard(page, 'filters');

    const trigger = page.getByRole('button', { name: /^Filters/ });
    await trigger.click();

    const dialog = page.getByRole('dialog', { name: 'Filters' });
    await expect(dialog).toBeVisible();

    for (let press = 0; press < 20; press += 1) await page.keyboard.press('Tab');
    expect(
      await page.evaluate(() => {
        const panel = document.querySelector('[role="dialog"][aria-label="Filters"]');
        return panel?.contains(document.activeElement) ?? false;
      }),
    ).toBe(true);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});

test.describe('what gets announced', () => {
  /**
   * One region, one message.
   *
   * Archive used to render its own fixed toast beside an inline error paragraph, so two live
   * regions could describe one action. Everything now passes through a single region whose
   * politeness follows the outcome.
   */
  test('a mutation announces once, in one region', async ({ page }) => {
    await openDashboard(page, 'announce');

    const card = page.getByTestId('item-card').filter({ hasText: 'Meridian Wool Runner' });
    await card.getByRole('button', { name: /^More actions/ }).click();
    // Scoped to the panel, and exact: an unscoped "Archive" also matches the "Archived"
    // section in the navigation.
    await page
      .getByRole('group', { name: /^Actions for/ })
      .getByRole('button', { name: 'Archive', exact: true })
      .click();

    const status = page.getByRole('status');
    await expect(status).toHaveCount(1);
    await expect(status).toContainText('Archived');
    // The undo lives inside the region, so it is announced as part of the same sentence
    // rather than as a button orphaned from the message that explains it.
    await expect(status.getByRole('button', { name: 'Undo' })).toBeVisible();
  });

  /**
   * "Add a product" reveals static help. It carried `role="status"`, which made it a live
   * region: the whole explanation was read out on open and stayed live afterwards, ready to
   * re-announce on any change inside it.
   */
  test('a disclosure is not a live region', async ({ page }) => {
    await openDashboard(page, 'disclosure');

    await expect(page.getByRole('status')).toHaveCount(0);

    const add = page.getByRole('button', { name: 'Add a product' });
    await add.click();

    await expect(page.getByText('Products come from the extension')).toBeVisible();
    await expect(add).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('status')).toHaveCount(0);
  });

  /**
   * A price is one fact. Split across an amount, a struck list price and a percentage, a
   * screen reader reads three fragments whose relationship it cannot convey — so the visible
   * pieces are hidden from it and one sentence is offered instead.
   */
  test('a price is spoken as a single sentence', async ({ page }) => {
    await openDashboard(page, 'price');

    const card = page.getByTestId('item-card').filter({ hasText: 'Meridian Wool Runner' });
    await expect(card.locator('.uc-price .uc-sr-only')).toHaveText('$98.00, reduced from $120.00');
    await expect(card.locator('.uc-price__contents')).toHaveAttribute('aria-hidden', 'true');
  });
});

test.describe('responsive', () => {
  const WIDTHS = [375, 768, 1024, 1440];

  /**
   * Nothing needs sideways scrolling, at any width, drawer open or closed.
   *
   * Checked rather than eyeballed: the screenshot pass produces 249 images across 32 states
   * and two themes, and "no horizontal scroll" is exactly the property a person skims past.
   * A grid column that overflows by four pixels looks fine in a thumbnail and is unusable on
   * a phone.
   */
  test('no width makes the page scroll sideways', async ({ page }) => {
    await openDashboard(page, 'overflow');

    const overflowAt = async (width: number) => {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(120);
      return page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
    };

    for (const width of WIDTHS) {
      const box = await overflowAt(width);
      expect(box.scroll, `page overflows at ${width}px`).toBeLessThanOrEqual(box.client);
    }

    // And with the drawer open, which is the widest thing the app renders.
    await page.setViewportSize({ width: 375, height: 900 });
    await page
      .getByTestId('item-card')
      .filter({ hasText: 'Meridian Wool Runner' })
      .getByRole('button', { name: 'Details' })
      .click();
    await expect(page.getByRole('dialog', { name: /^Details for/ })).toBeVisible();

    for (const width of WIDTHS) {
      const box = await overflowAt(width);
      expect(box.scroll, `drawer overflows at ${width}px`).toBeLessThanOrEqual(box.client);
    }
  });

  /**
   * A missing product image must not move anything.
   *
   * Every fixture points at a CDN that does not resolve, so this is the state the suite runs
   * in anyway — the assertion is that the frame keeps its box rather than collapsing and
   * dragging the price up into the space it left.
   */
  test('a broken image costs no layout shift', async ({ page }) => {
    await openDashboard(page, 'image-shift');

    const card = page.getByTestId('item-card').first();
    const before = await card.boundingBox();
    await page.waitForTimeout(600);
    const after = await card.boundingBox();

    expect(after?.height).toBe(before?.height);
  });
});

test.describe('reduced motion', () => {
  /**
   * The tokens zero `--uc-duration-*`, which covers every transition written against one. The
   * dashboard's cards carry Tailwind's `transition-opacity`, whose duration comes from
   * Tailwind's own variable and is untouched by that. This checks the sweeping rule that
   * catches both, by measuring what the browser actually computed.
   */
  test('nothing animates when the system asks it not to', async ({ page }) => {
    await openDashboard(page, 'motion');

    // Set on the page rather than through `test.use`, which did not reach the context here —
    // and an emulation that silently fails would make this test pass by measuring a browser
    // that was never asked to reduce anything.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(
      true,
    );

    const moving = await page.evaluate(() =>
      [...document.querySelectorAll('*')]
        .map((element) => ({ element, style: getComputedStyle(element) }))
        .flatMap(({ element, style }) =>
          [...style.transitionDuration.split(', '), ...style.animationDuration.split(', ')]
            .filter((value) => value !== '')
            // Anything longer than a frame is motion a person would see.
            .filter((value) => Number.parseFloat(value) > 0.05)
            .map((value) => `${element.tagName}.${element.className} ${value}`),
        ),
    );

    expect(moving).toEqual([]);
  });
});
