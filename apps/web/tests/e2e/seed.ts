import type { Database, ProductCaptureV1 } from '@universal-cart/contracts';
import { computeFingerprint } from '@universal-cart/extractors';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

import type { mailbox } from './mailpit';
import { signInCodeFrom } from './mailpit';

/**
 * Seeding helpers for the dashboard suites.
 *
 * Captures are ingested through the real RPC by a second client — standing in for the
 * extension, which has its own suite — so the web tests exercise the same write path a
 * real save takes, rather than inserting rows behind the database function's back.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
/** Where the app under test is served; the session cookies are scoped to its host. */
const APP_HOST = new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://127.0.0.1:3100').hostname;

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
  /** Save a product whose price the page never stated. */
  noPrice?: boolean;
  retailerName?: string;
  extractorId?: string;
  extractorVersion?: string;
  confidence?: number;
}

export function capture(overrides: CaptureOverrides = {}): ProductCaptureV1 {
  const url = overrides.url ?? 'https://shop.northwind.example/p/meridian';
  // Derived, not hardcoded: a test that overrides the URL is testing a different retailer,
  // and silently filing it under the default domain would make the assertion meaningless.
  const domain = new URL(url).hostname.replace(/^www\./, '');

  return {
    schemaVersion: 1,
    source: {
      url,
      canonicalUrl: url,
      domain,
      retailerName: overrides.retailerName ?? 'Northwind',
      pageTitle: 'Meridian Wool Runner',
    },
    product: {
      title: overrides.title ?? 'Meridian Wool Runner',
      brand: 'Northwind',
      description: 'A lightweight everyday shoe.',
      imageUrls: [],
      selectedImageUrl: null,
      identifiers: { sku: 'MWR-042' },
      composition: null,
    },
    offer: {
      priceAmount: overrides.noPrice ? null : (overrides.price ?? '98.00'),
      originalPriceAmount: overrides.noPrice ? null : '120.00',
      currency: overrides.noPrice ? null : 'USD',
      availability: overrides.availability ?? 'in_stock',
    },
    selectedVariant: { Size: '10', Color: 'Natural Black' },
    evidence: [],
    extraction: {
      extractorId: overrides.extractorId ?? 'generic',
      extractorVersion: overrides.extractorVersion ?? '1.0.0',
      overallConfidence: overrides.confidence ?? 0.9,
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

/**
 * Put the session `signedInClient` already holds into the browser.
 *
 * These suites are about the dashboard, not about signing in. Asking for a second sign-in
 * email meant every one of them sent twice to the same address seconds apart, so each had to
 * sleep past `auth.email.max_frequency` — sixteen call sites all depending on the throttle
 * being short enough to wait out. That in turn forced the window down to `1s` locally, which
 * left the one test that asserts the throttle racing a page load against it: it failed under
 * parallel workers and passed when run alone.
 *
 * Reusing the session removes the second send, so the throttle can sit at the production
 * default and the assertion about it becomes a statement rather than a race.
 *
 * The cookies are written by `@supabase/ssr` itself rather than assembled here: the encoding
 * and the chunking across `.0`/`.1` are its business, and a hand-rolled copy would be a
 * second implementation to keep in step with the app's.
 *
 * The magic-link flow is still exercised end to end by `auth.spec.ts`, which signs in for
 * real. It is the path most likely to break on a hosted origin, so it keeps a real test.
 */
export async function signInBrowser(page: Page, client: SeedClient): Promise<void> {
  const { data, error } = await client.auth.getSession();
  expect(error, error?.message).toBeNull();
  expect(data.session, 'seed client has no session to install').not.toBeNull();

  const { access_token, refresh_token } = data.session!;
  const written: { name: string; value: string }[] = [];

  const writer = createServerClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => [],
      setAll: (cookies) => {
        written.push(...cookies.map(({ name, value }) => ({ name, value })));
      },
    },
  });
  await writer.auth.setSession({ access_token, refresh_token });
  expect(written.length, 'no auth cookies were produced').toBeGreaterThan(0);

  await page.context().addCookies(
    written.map(({ name, value }) => ({
      name,
      value,
      domain: APP_HOST,
      path: '/',
      httpOnly: false,
      secure: false,
      sameSite: 'Lax' as const,
    })),
  );

  await page.goto('/app');
  await expect(page).toHaveURL(/\/app$/);
}
