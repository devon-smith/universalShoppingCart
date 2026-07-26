import type { Database, ProductCaptureV1 } from '@universal-cart/contracts';
import { computeFingerprint } from '@universal-cart/extractors';
import { createClient } from '@supabase/supabase-js';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { mailbox, signInCodeFrom, signInUrlFrom } from './mailpit';

/**
 * The dashboard half of the Phase 2B acceptance flow.
 *
 * A capture is ingested through the real RPC by a second client — standing in for the
 * extension, which has its own suite — and the dashboard is then checked in the browser.
 * Together the two suites cover "saved in the extension, visible on the web".
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

function uniqueEmail(label: string): string {
  return `dash-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

function capture(
  overrides: { title?: string; price?: string; url?: string } = {},
): ProductCaptureV1 {
  const url = overrides.url ?? 'https://shop.northwind.example/p/meridian';

  return {
    schemaVersion: 1,
    source: {
      url,
      canonicalUrl: url,
      domain: 'shop.northwind.example',
      retailerName: 'Northwind',
      pageTitle: 'Meridian Wool Runner',
    },
    product: {
      title: overrides.title ?? 'Meridian Wool Runner',
      brand: 'Northwind',
      description: 'A lightweight everyday shoe.',
      imageUrls: [],
      selectedImageUrl: null,
      identifiers: { sku: 'MWR-042' },
    },
    offer: {
      priceAmount: overrides.price ?? '98.00',
      originalPriceAmount: '120.00',
      currency: 'USD',
      availability: 'in_stock',
    },
    selectedVariant: { Size: '10', Color: 'Natural Black' },
    evidence: [],
    extraction: {
      extractorId: 'generic',
      extractorVersion: '1.0.0',
      overallConfidence: 0.9,
      observedAt: new Date().toISOString(),
    },
  };
}

/** Sign a throwaway user in outside the browser, the way the extension does. */
async function signedInClient(email: string, inbox: ReturnType<typeof mailbox>) {
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

  return client;
}

async function ingest(
  client: Awaited<ReturnType<typeof signedInClient>>,
  payload: ProductCaptureV1,
  userFields: Record<string, unknown> = {},
) {
  const { data: cart, error: cartError } = await client
    .from('carts')
    .select('id')
    .eq('is_default', true)
    .single();
  expect(cartError, cartError?.message).toBeNull();

  const fingerprint = await computeFingerprint({
    canonicalUrl: payload.source.canonicalUrl,
    url: payload.source.url,
    selectedVariant: payload.selectedVariant,
    identifiers: payload.product.identifiers,
  });

  const { data, error } = await client.rpc('ingest_product_capture', {
    p_capture: payload as never,
    p_cart_id: cart!.id,
    p_fingerprint: fingerprint,
    p_user_fields: userFields as never,
  });
  expect(error, error?.message).toBeNull();

  return data as unknown as { created: boolean; observationInserted: boolean };
}

/** Sign the same user in inside the browser, so the dashboard renders their data. */
async function signInBrowser(page: Page, email: string, inbox: ReturnType<typeof mailbox>) {
  // Supabase throttles repeat sign-in emails per address.
  await page.waitForTimeout(1_500);

  await page.goto('/login?next=%2Fapp');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.locator('p[role="status"]')).toContainText(email);

  await page.goto(signInUrlFrom(await inbox.next()));
  await expect(page).toHaveURL(/\/app$/);
}

test.describe('dashboard', () => {
  test('shows a saved product with its price, variant, and note', async ({ page }) => {
    const email = uniqueEmail('shows');
    const inbox = mailbox(email);

    const client = await signedInClient(email, inbox);
    const result = await ingest(client, capture(), { note: 'for the trip', quantity: 2 });
    expect(result.created).toBe(true);

    await signInBrowser(page, email, inbox);

    const card = page.getByRole('listitem').filter({ hasText: 'Meridian Wool Runner' });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('$98.00');
    await expect(card).toContainText('$120.00');
    await expect(card).toContainText('−18%');
    await expect(card).toContainText('Northwind');
    await expect(card).toContainText('Size: 10');
    await expect(card).toContainText('for the trip');
    await expect(card).toContainText('×2');
    await expect(card).toContainText('In stock');
  });

  test('shows a duplicate save as one refreshed item, keeping the note', async ({ page }) => {
    const email = uniqueEmail('dup');
    const inbox = mailbox(email);

    const client = await signedInClient(email, inbox);
    await ingest(client, capture(), { note: 'keep me', quantity: 3 });

    // The same product and variant again, at a lower price.
    const second = await ingest(client, capture({ price: '88.00' }));
    expect(second.created).toBe(false);
    expect(second.observationInserted).toBe(true);

    await signInBrowser(page, email, inbox);

    const card = page.getByRole('listitem').filter({ hasText: 'Meridian Wool Runner' });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('$88.00');
    // The refresh did not touch the user's own fields.
    await expect(card).toContainText('keep me');
    await expect(card).toContainText('×3');
  });

  test('says a price is unknown rather than showing a blank', async ({ page }) => {
    const email = uniqueEmail('unknown');
    const inbox = mailbox(email);

    const client = await signedInClient(email, inbox);
    const sparse = capture({ title: 'Ask in store' });
    sparse.offer = {
      priceAmount: null,
      originalPriceAmount: null,
      currency: null,
      availability: 'unknown',
    };
    await ingest(client, sparse);

    await signInBrowser(page, email, inbox);

    const card = page.getByRole('listitem').filter({ hasText: 'Ask in store' });
    await expect(card).toContainText('Price unknown');
    await expect(card).toContainText('Availability unknown');
  });

  test('shows the empty state before anything is saved', async ({ page }) => {
    const email = uniqueEmail('empty');
    const inbox = mailbox(email);

    await page.goto('/login?next=%2Fapp');
    await page.getByLabel('Email address').fill(email);
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
    await expect(page.locator('p[role="status"]')).toContainText(email);
    await page.goto(signInUrlFrom(await inbox.next()));

    await expect(page.getByText('Nothing saved yet')).toBeVisible();
    await expect(page.getByText('Capture this page')).toBeVisible();
  });

  test("does not show another user their neighbour's products", async ({ page }) => {
    const owner = uniqueEmail('owner');
    const ownerInbox = mailbox(owner);
    const ownerClient = await signedInClient(owner, ownerInbox);
    await ingest(ownerClient, capture({ title: 'Private purchase' }));

    const stranger = uniqueEmail('stranger');
    const strangerInbox = mailbox(stranger);
    await signInBrowser(page, stranger, strangerInbox);

    await expect(page.getByText('Private purchase')).toHaveCount(0);
    await expect(page.getByText('Nothing saved yet')).toBeVisible();
  });
});
