import { describe, expect, it } from 'vitest';

import { assertSupportedSchemaVersion, UnsupportedSchemaVersionError } from './schema-version';
import type { ProductCaptureV1 } from './capture';
import {
  CAPTURE_SCHEMA_VERSION,
  currencyCodeSchema,
  decimalStringSchema,
  parseProductCaptureV1,
  safeParseProductCaptureV1,
} from './capture';

function validCapture(): ProductCaptureV1 {
  return {
    schemaVersion: 1,
    source: {
      url: 'https://shop.example.com/p/1?utm_source=x',
      canonicalUrl: 'https://shop.example.com/p/1',
      domain: 'shop.example.com',
      retailerName: 'Example Shop',
      pageTitle: 'Wool Runner — Example Shop',
    },
    product: {
      title: 'Wool Runner',
      brand: 'Example',
      description: 'A shoe.',
      imageUrls: ['https://cdn.example.com/1.jpg'],
      selectedImageUrl: 'https://cdn.example.com/1.jpg',
      identifiers: { sku: 'WR-9', gtin: '0123456789012' },
    },
    offer: {
      priceAmount: '98.00',
      originalPriceAmount: '120.00',
      currency: 'USD',
      availability: 'in_stock',
    },
    selectedVariant: { Color: 'Natural Black', Size: '10' },
    evidence: [{ field: 'offer.priceAmount', source: 'json_ld', confidence: 0.9 }],
    extraction: {
      extractorId: 'generic',
      extractorVersion: '1.0.0',
      overallConfidence: 0.82,
      observedAt: '2026-07-26T12:00:00.000Z',
    },
  };
}

describe('decimalStringSchema', () => {
  it('accepts decimal money strings', () => {
    expect(decimalStringSchema.parse('19.99')).toBe('19.99');
    expect(decimalStringSchema.parse('0.00')).toBe('0.00');
    expect(decimalStringSchema.parse('1234.567890')).toBe('1234.567890');
    expect(decimalStringSchema.parse('-5.00')).toBe('-5.00');
  });

  it('rejects anything that is not an exact decimal', () => {
    // A number would have been rounded by the time it got here.
    expect(decimalStringSchema.safeParse(19.99).success).toBe(false);
    expect(decimalStringSchema.safeParse('19').success).toBe(false);
    expect(decimalStringSchema.safeParse('1,299.00').success).toBe(false);
    expect(decimalStringSchema.safeParse('1.2e3').success).toBe(false);
    expect(decimalStringSchema.safeParse('$19.99').success).toBe(false);
    expect(decimalStringSchema.safeParse('').success).toBe(false);
  });
});

describe('currencyCodeSchema', () => {
  it('accepts an ISO 4217 code', () => {
    expect(currencyCodeSchema.parse('USD')).toBe('USD');
    expect(currencyCodeSchema.parse('EUR')).toBe('EUR');
  });

  it('rejects symbols and lowercase', () => {
    expect(currencyCodeSchema.safeParse('$').success).toBe(false);
    expect(currencyCodeSchema.safeParse('usd').success).toBe(false);
    expect(currencyCodeSchema.safeParse('DOLLARS').success).toBe(false);
  });
});

describe('productCaptureV1Schema', () => {
  it('accepts a complete capture', () => {
    expect(parseProductCaptureV1(validCapture())).toEqual(validCapture());
  });

  it('accepts a capture where nothing could be extracted', () => {
    const sparse = validCapture();
    sparse.product = {
      title: null,
      brand: null,
      description: null,
      imageUrls: [],
      selectedImageUrl: null,
      identifiers: {},
    };
    sparse.offer = {
      priceAmount: null,
      originalPriceAmount: null,
      currency: null,
      availability: 'unknown',
    };
    sparse.selectedVariant = {};
    sparse.evidence = [];

    expect(safeParseProductCaptureV1(sparse).success).toBe(true);
  });

  it('rejects a missing required section', () => {
    const { offer: _offer, ...withoutOffer } = validCapture();
    expect(safeParseProductCaptureV1(withoutOffer).success).toBe(false);
  });

  it('rejects a future schema version', () => {
    const future = { ...validCapture(), schemaVersion: 2 };
    expect(safeParseProductCaptureV1(future).success).toBe(false);
    expect(() => assertSupportedSchemaVersion(future, [CAPTURE_SCHEMA_VERSION])).toThrow(
      UnsupportedSchemaVersionError,
    );
  });

  it('rejects a floating-point price', () => {
    const capture = validCapture();
    // @ts-expect-error deliberately wrong: money must never be a number
    capture.offer.priceAmount = 98;
    expect(safeParseProductCaptureV1(capture).success).toBe(false);
  });

  it('rejects a non-http source URL', () => {
    const capture = validCapture();
    capture.source.url = 'javascript:alert(1)';
    expect(safeParseProductCaptureV1(capture).success).toBe(false);
  });

  it('rejects a non-http image URL', () => {
    const capture = validCapture();
    capture.product.imageUrls = ['data:image/png;base64,AAAA'];
    expect(safeParseProductCaptureV1(capture).success).toBe(false);
  });

  it('rejects an unknown availability value', () => {
    const capture = validCapture();
    // @ts-expect-error deliberately wrong
    capture.offer.availability = 'maybe';
    expect(safeParseProductCaptureV1(capture).success).toBe(false);
  });

  it('rejects confidence outside 0..1', () => {
    const capture = validCapture();
    capture.extraction.overallConfidence = 1.5;
    expect(safeParseProductCaptureV1(capture).success).toBe(false);
  });

  it('rejects a non-ISO observedAt', () => {
    const capture = validCapture();
    capture.extraction.observedAt = '26 July 2026';
    expect(safeParseProductCaptureV1(capture).success).toBe(false);
  });

  it('round-trips through JSON so it can cross a process boundary', () => {
    const capture = validCapture();
    expect(parseProductCaptureV1(JSON.parse(JSON.stringify(capture)))).toEqual(capture);
  });
});
