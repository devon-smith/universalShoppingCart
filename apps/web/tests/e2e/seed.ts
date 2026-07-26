import type { Database, ProductCaptureV1 } from '@universal-cart/contracts';
import { computeFingerprint } from '@universal-cart/extractors';
import { createClient } from '@supabase/supabase-js';
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

import type { mailbox } from './mailpit';
import { signInCodeFrom, signInUrlFrom } from './mailpit';

/**
 * Seeding helpers for the dashboard suites.
 *
 * Captures are ingested through the real RPC by a second client — standing in for the
 * extension, which has its own suite — so the web tests exercise the same write path a
 * real save takes, rather than inserting rows behind the database function's back.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

export type Inbox = ReturnType<typeof mailbox>;
export type SeedClient = ReturnType<typeof createClient<Database>>;

export function uniqueEmail(prefix: string, label: string): string {
  return `${prefix}-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

export interface CaptureOverrides {
  title?: string;
  price?: string;
  url?: string;
  availability?: ProductCaptureV1['offer']['availability'];
  observedAt?: string;
}

export function capture(overrides: CaptureOverrides = {}): ProductCaptureV1 {
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
      availability: overrides.availability ?? 'in_stock',
    },
    selectedVariant: { Size: '10', Color: 'Natural Black' },
    evidence: [],
    extraction: {
      extractorId: 'generic',
      extractorVersion: '1.0.0',
      overallConfidence: 0.9,
      observedAt: overrides.observedAt ?? new Date().toISOString(),
    },
  };
}

/** Sign a throwaway user in outside the browser, the way the extension does. */
export async function signedInClient(email: string, inbox: Inbox): Promise<SeedClient> {
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

export interface IngestResult {
  created: boolean;
  observationInserted: boolean;
}

export async function ingest(
  client: SeedClient,
  payload: ProductCaptureV1,
  userFields: Record<string, unknown> = {},
  source: 'capture' | 'revisit' = 'capture',
): Promise<IngestResult> {
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
    p_source: source as never,
  });
  expect(error, error?.message).toBeNull();

  return data as unknown as IngestResult;
}

/** Sign the same user in inside the browser, so the dashboard renders their data. */
export async function signInBrowser(page: Page, email: string, inbox: Inbox): Promise<void> {
  // Supabase throttles repeat sign-in emails per address.
  await page.waitForTimeout(1_500);

  await page.goto('/login?next=%2Fapp');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.locator('p[role="status"]')).toContainText(email);

  await page.goto(signInUrlFrom(await inbox.next()));
  await expect(page).toHaveURL(/\/app$/);
}
