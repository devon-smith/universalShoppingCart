import type { ProductCaptureV1 } from '@universal-cart/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { IngestCapableClient } from './save';
import { fingerprintFor, SaveError, saveCapture } from './save';

function capture(overrides: Partial<ProductCaptureV1> = {}): ProductCaptureV1 {
  return {
    schemaVersion: 1,
    source: {
      url: 'https://shop.example/p/1?utm_source=x',
      canonicalUrl: 'https://shop.example/p/1',
      domain: 'shop.example',
      retailerName: 'Shop',
      pageTitle: 'A product',
    },
    product: {
      title: 'A product',
      brand: null,
      description: null,
      imageUrls: [],
      selectedImageUrl: null,
      identifiers: { sku: 'S1' },
      composition: null,
    },
    offer: {
      priceAmount: '10.00',
      originalPriceAmount: null,
      currency: 'USD',
      availability: 'in_stock',
    },
    selectedVariant: { Size: '10' },
    evidence: [],
    extraction: {
      extractorId: 'generic',
      extractorVersion: '1.0.0',
      overallConfidence: 0.9,
      observedAt: '2026-07-26T12:00:00.000Z',
    },
    ...overrides,
  };
}

function client(response: {
  data: unknown;
  error: { message: string } | null;
}): IngestCapableClient & { rpc: ReturnType<typeof vi.fn> } {
  return { rpc: vi.fn(async () => response) } as never;
}

const ITEM = { id: 'item-1', title: 'A product' };

describe('fingerprintFor', () => {
  it('is stable across identical captures', async () => {
    expect(await fingerprintFor(capture())).toBe(await fingerprintFor(capture()));
  });

  it('ignores tracking parameters on the source URL', async () => {
    const other = capture();
    other.source.url = 'https://shop.example/p/1?gclid=abc';
    expect(await fingerprintFor(other)).toBe(await fingerprintFor(capture()));
  });

  it('changes with the selected variant', async () => {
    const other = capture();
    other.selectedVariant = { Size: '11' };
    expect(await fingerprintFor(other)).not.toBe(await fingerprintFor(capture()));
  });
});

describe('saveCapture', () => {
  it('sends the capture, cart, fingerprint, and user fields', async () => {
    const supabase = client({
      data: { created: true, observationInserted: true, item: ITEM },
      error: null,
    });

    const result = await saveCapture({
      client: supabase,
      capture: capture(),
      cartId: 'cart-1',
      userFields: { note: 'for the trip', quantity: 2 },
    });

    expect(result).toEqual({ item: ITEM, created: true, observationInserted: true });

    const params = supabase.rpc.mock.calls[0]?.[1];
    expect(params.p_cart_id).toBe('cart-1');
    expect(params.p_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(params.p_user_fields).toEqual({ note: 'for the trip', quantity: 2 });
    expect(params.p_source).toBe('capture');
  });

  it('defaults the source to capture and the user fields to empty', async () => {
    const supabase = client({ data: { created: true, item: ITEM }, error: null });
    await saveCapture({ client: supabase, capture: capture(), cartId: 'cart-1' });

    const params = supabase.rpc.mock.calls[0]?.[1];
    expect(params.p_user_fields).toEqual({});
    expect(params.p_source).toBe('capture');
  });

  it('passes a revisit through as a revisit', async () => {
    const supabase = client({ data: { created: false, item: ITEM }, error: null });
    await saveCapture({
      client: supabase,
      capture: capture(),
      cartId: 'cart-1',
      source: 'revisit',
    });

    expect(supabase.rpc.mock.calls[0]?.[1].p_source).toBe('revisit');
  });

  it('reports a refresh distinctly from a creation', async () => {
    const supabase = client({
      data: { created: false, observationInserted: false, item: ITEM },
      error: null,
    });

    const result = await saveCapture({ client: supabase, capture: capture(), cartId: 'cart-1' });
    expect(result.created).toBe(false);
    expect(result.observationInserted).toBe(false);
  });

  it('surfaces a database error', async () => {
    const supabase = client({ data: null, error: { message: 'No edit access to cart' } });

    await expect(
      saveCapture({ client: supabase, capture: capture(), cartId: 'cart-1' }),
    ).rejects.toThrow(/No edit access/);
  });

  it('rejects a response with no item rather than reporting success', async () => {
    const supabase = client({ data: { created: true }, error: null });

    await expect(
      saveCapture({ client: supabase, capture: capture(), cartId: 'cart-1' }),
    ).rejects.toThrow(SaveError);
  });
});
