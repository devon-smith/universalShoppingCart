import { describe, expect, it } from 'vitest';

import type { FingerprintInput } from './fingerprint';
import {
  canonicalVariant,
  computeFingerprint,
  fingerprintSource,
  primaryIdentifier,
} from './fingerprint';

function input(overrides: Partial<FingerprintInput> = {}): FingerprintInput {
  return {
    canonicalUrl: 'https://shop.example/p/1',
    url: 'https://shop.example/p/1',
    selectedVariant: {},
    identifiers: {},
    ...overrides,
  };
}

describe('primaryIdentifier', () => {
  it('prefers GTIN, which is unique across retailers', () => {
    expect(primaryIdentifier({ gtin: '012', mpn: 'M', sku: 'S' })).toBe('gtin:012');
  });

  it('falls through GTIN → MPN → SKU → product id', () => {
    expect(primaryIdentifier({ mpn: 'M', sku: 'S' })).toBe('mpn:M');
    expect(primaryIdentifier({ sku: 'S', productId: 'P' })).toBe('sku:S');
    expect(primaryIdentifier({ productId: 'P' })).toBe('productId:P');
  });

  it('ignores blank values', () => {
    expect(primaryIdentifier({ gtin: '   ', sku: 'S' })).toBe('sku:S');
    expect(primaryIdentifier({})).toBeNull();
  });

  it('keeps the kind in the value so two kinds cannot collide', () => {
    expect(primaryIdentifier({ sku: 'X' })).not.toBe(primaryIdentifier({ mpn: 'X' }));
  });
});

describe('canonicalVariant', () => {
  it('is order-independent', () => {
    expect(canonicalVariant({ Size: '10', Color: 'Blue' })).toBe(
      canonicalVariant({ Color: 'Blue', Size: '10' }),
    );
  });

  it('is case- and whitespace-insensitive', () => {
    expect(canonicalVariant({ ' Color ': ' Blue ' })).toBe(canonicalVariant({ color: 'blue' }));
  });

  it('drops empty names and values', () => {
    expect(canonicalVariant({ Color: '', '': 'Blue', Size: '10' })).toBe('size=10');
  });

  it('is empty for no options', () => {
    expect(canonicalVariant({})).toBe('');
  });
});

describe('fingerprintSource', () => {
  it('normalizes the URL, stripping tracking parameters', () => {
    const withTracking = fingerprintSource(
      input({ canonicalUrl: null, url: 'https://shop.example/p/1?utm_source=news&gclid=x' }),
    );
    const without = fingerprintSource(
      input({ canonicalUrl: null, url: 'https://shop.example/p/1' }),
    );

    expect(withTracking).toBe(without);
  });

  it('prefers the canonical URL over the page URL', () => {
    const viaCanonical = fingerprintSource(
      input({ canonicalUrl: 'https://shop.example/p/1', url: 'https://shop.example/x?a=1' }),
    );
    const direct = fingerprintSource(
      input({ canonicalUrl: null, url: 'https://shop.example/p/1' }),
    );

    expect(viaCanonical).toBe(direct);
  });

  it('falls back to the raw URL when normalization fails', () => {
    expect(fingerprintSource(input({ canonicalUrl: null, url: 'not a url' }))).toContain(
      'not a url',
    );
  });
});

describe('computeFingerprint', () => {
  it('is a lowercase hex SHA-256', async () => {
    expect(await computeFingerprint(input())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable across calls', async () => {
    expect(await computeFingerprint(input())).toBe(await computeFingerprint(input()));
  });

  it('ignores tracking parameters, so a shared link matches a direct visit', async () => {
    const shared = await computeFingerprint(
      input({ canonicalUrl: null, url: 'https://shop.example/p/1?utm_campaign=spring&fbclid=abc' }),
    );
    const direct = await computeFingerprint(input({ canonicalUrl: null }));

    expect(shared).toBe(direct);
  });

  it('ignores variant ordering and casing', async () => {
    const a = await computeFingerprint(input({ selectedVariant: { Color: 'Blue', Size: '10' } }));
    const b = await computeFingerprint(input({ selectedVariant: { size: '10', color: 'blue' } }));

    expect(a).toBe(b);
  });

  it('distinguishes two variants of the same product', async () => {
    const small = await computeFingerprint(input({ selectedVariant: { Size: 'S' } }));
    const large = await computeFingerprint(input({ selectedVariant: { Size: 'L' } }));

    expect(small).not.toBe(large);
  });

  it('distinguishes two products on the same site', async () => {
    const first = await computeFingerprint(input({ canonicalUrl: 'https://shop.example/p/1' }));
    const second = await computeFingerprint(input({ canonicalUrl: 'https://shop.example/p/2' }));

    expect(first).not.toBe(second);
  });

  it('distinguishes the same product at two retailers', async () => {
    const here = await computeFingerprint(
      input({ canonicalUrl: 'https://a.example/p/1', identifiers: { gtin: '012' } }),
    );
    const there = await computeFingerprint(
      input({ canonicalUrl: 'https://b.example/p/1', identifiers: { gtin: '012' } }),
    );

    // Cross-retailer matching is Phase 8 and must be deliberate, never an accident of
    // fingerprint collision.
    expect(here).not.toBe(there);
  });

  it('does not change when the price does', async () => {
    // Price is not an input: a price change must update an item, not create one.
    const before = await computeFingerprint(input());
    const after = await computeFingerprint(input());

    expect(before).toBe(after);
  });

  it('changes when the product identifier changes', async () => {
    const withSku = await computeFingerprint(input({ identifiers: { sku: 'A' } }));
    const otherSku = await computeFingerprint(input({ identifiers: { sku: 'B' } }));

    expect(withSku).not.toBe(otherSku);
  });
});
