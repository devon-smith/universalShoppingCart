import type { ProductCaptureV1 } from '@universal-cart/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { IngestCapableClient } from './save';

import type { ItemLookup, RevisitMatch } from './revisit';
import { findSavedItem, itemLookup, refreshFromPage } from './revisit';

function capture(overrides: { variant?: Record<string, string> } = {}): ProductCaptureV1 {
  return {
    schemaVersion: 1,
    source: {
      url: 'https://shop.example/p/1',
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
      priceAmount: '88.00',
      originalPriceAmount: null,
      currency: 'USD',
      availability: 'in_stock',
    },
    selectedVariant: overrides.variant ?? { Size: '10' },
    evidence: [],
    extraction: {
      extractorId: 'generic',
      extractorVersion: '1.0.0',
      overallConfidence: 0.9,
      observedAt: '2026-07-26T12:00:00.000Z',
    },
  };
}

const MATCH: RevisitMatch = { itemId: 'item-1', cartId: 'cart-1', title: 'A product' };

function ingestClient(
  result: unknown = {
    created: false,
    observationInserted: true,
    item: { id: 'item-1', title: 'A product' },
  },
) {
  const rpc = vi.fn(async (_name: string, _params: Record<string, unknown>) => ({
    data: result,
    error: null,
  }));
  return { client: { rpc } as unknown as IngestCapableClient, rpc };
}

describe('itemLookup', () => {
  it('maps the first row to a match', async () => {
    const query = vi.fn(async () => ({
      data: [{ id: 'item-1', cart_id: 'cart-1', title: 'A product' }],
      error: null,
    }));

    await expect(itemLookup(query)('a'.repeat(64))).resolves.toEqual(MATCH);
    expect(query).toHaveBeenCalledWith('a'.repeat(64));
  });

  it('returns null when nothing matches', async () => {
    const query = vi.fn(async () => ({ data: [], error: null }));
    await expect(itemLookup(query)('b'.repeat(64))).resolves.toBeNull();
  });

  it('fails closed when the query errors', async () => {
    // A network blip must not look like "not saved" *and* must not throw into the panel.
    const query = vi.fn(async () => ({ data: null, error: { message: 'network' } }));
    await expect(itemLookup(query)('c'.repeat(64))).resolves.toBeNull();
  });
});

describe('findSavedItem', () => {
  it('looks up the capture fingerprint', async () => {
    const lookup = vi.fn<ItemLookup>(async () => MATCH);

    await expect(findSavedItem({ lookup, capture: capture() })).resolves.toEqual(MATCH);
    expect(lookup).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{64}$/));
  });

  it('uses a different fingerprint for a different variant', async () => {
    const lookup = vi.fn<ItemLookup>(async () => null);

    await findSavedItem({ lookup, capture: capture({ variant: { Size: '10' } }) });
    await findSavedItem({ lookup, capture: capture({ variant: { Size: '11' } }) });

    expect(lookup.mock.calls[0]?.[0]).not.toBe(lookup.mock.calls[1]?.[0]);
  });
});

describe('refreshFromPage', () => {
  it('re-observes a matching item as a revisit', async () => {
    const { client, rpc } = ingestClient();
    const result = await refreshFromPage({
      client,
      lookup: async () => MATCH,
      capture: capture(),
    });

    expect(result?.match.itemId).toBe('item-1');
    expect(result?.observationInserted).toBe(true);

    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_source: 'revisit', p_cart_id: 'cart-1' });
  });

  it('sends no user fields, so a refresh cannot overwrite them', async () => {
    const { client, rpc } = ingestClient();
    await refreshFromPage({ client, lookup: async () => MATCH, capture: capture() });

    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_user_fields: {} });
  });

  it('does nothing at all when the page is not a saved product', async () => {
    const { client, rpc } = ingestClient();

    await expect(
      refreshFromPage({ client, lookup: async () => null, capture: capture() }),
    ).resolves.toBeNull();
    // Nothing left the machine.
    expect(rpc).not.toHaveBeenCalled();
  });

  it('reports when nothing had changed', async () => {
    const { client } = ingestClient({
      created: false,
      observationInserted: false,
      item: { id: 'item-1', title: 'A product' },
    });

    const result = await refreshFromPage({
      client,
      lookup: async () => MATCH,
      capture: capture(),
    });

    expect(result?.observationInserted).toBe(false);
  });
});
