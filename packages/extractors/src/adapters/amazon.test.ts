import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { amazonAdapter } from './amazon';

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/adapters');

function documentFor(file: string): Document {
  return new DOMParser().parseFromString(
    readFileSync(resolve(fixtures, file), 'utf8'),
    'text/html',
  );
}

const TWISTER = {
  file: 'amazon-twister-selected.html',
  url: 'https://www.amazon.com/Northwind-Standard-Washed-Indigo-32x32/dp/B0EXAMPLE1',
};
const SINGLE = {
  file: 'amazon-single-price-no-twister.html',
  url: 'https://www.amazon.com/Northwind-Cotton-Chore-Jacket/dp/B0EXAMPLE7',
};

function extract(fixture: { file: string; url: string }) {
  return amazonAdapter.extract({ document: documentFor(fixture.file), url: fixture.url });
}

describe('amazonAdapter.supports', () => {
  it('claims an Amazon US product page', () => {
    expect(amazonAdapter.supports({ document: documentFor(TWISTER.file), url: TWISTER.url })).toBe(
      true,
    );
  });

  it('declines another retailer', () => {
    expect(
      amazonAdapter.supports({
        document: documentFor(TWISTER.file),
        url: 'https://example.com/dp/B0',
      }),
    ).toBe(false);
  });

  it('declines a page with no product title', () => {
    const doc = new DOMParser().parseFromString(
      '<html><body><div>search</div></body></html>',
      'text/html',
    );
    expect(amazonAdapter.supports({ document: doc, url: TWISTER.url })).toBe(false);
  });
});

describe('amazonAdapter — the price is the selected swatch, not the first one', () => {
  it('reads the selected colour swatch, never an unselected one', () => {
    const capture = extract(TWISTER);
    expect(capture.offer?.priceAmount).toBe('56.80');
    expect(capture.offer?.originalPriceAmount).toBe('71.00');
    // Unselected swatches carry 71.20/63.40 and a basis 80.00; none may be reported.
    for (const wrong of ['71.20', '63.40']) expect(capture.offer?.priceAmount).not.toBe(wrong);
    expect(capture.offer?.originalPriceAmount).not.toBe('80.00');
  });

  it('records the selected variant, and omits a dimension left on "Select"', () => {
    const variant = extract(TWISTER).selectedVariant;
    expect(variant).toEqual({ Color: 'Washed Indigo', 'Special Size': 'Standard' });
    // Size still reads "Select" in the dropdown — a choice nobody made, so it must be absent.
    expect(Object.keys(variant ?? {})).not.toContain('Size');
    expect(JSON.stringify(variant)).not.toContain('Select');
  });

  it('takes the child ASIN from the URL, not the parent from the canonical', () => {
    // Fingerprinting on the parent canonical alone would collapse every colour into one item.
    expect(extract(TWISTER).product?.identifiers).toEqual({ productId: 'B0EXAMPLE1' });
  });

  it('reads the duplicated #productTitle once, not doubled', () => {
    expect(extract(TWISTER).product?.title).toBe(
      "Northwind Men's Standard Fit Jeans (Also Available in Big & Tall)",
    );
  });

  it('reads in stock from the availability prose', () => {
    expect(extract(TWISTER).offer?.availability).toBe('in_stock');
  });
});

describe('amazonAdapter — single price, no twister', () => {
  it('reads the core price widget, never the sponsored carousel', () => {
    const capture = extract(SINGLE);
    expect(capture.offer?.priceAmount).toBe('46.00');
    // #sp_detail carries a different product at $96.16 with a struck List: $110.00.
    expect(capture.offer?.priceAmount).not.toBe('96.16');
    expect(capture.offer?.originalPriceAmount).toBeUndefined();
  });

  it('reports out of stock and no selected variant', () => {
    const capture = extract(SINGLE);
    expect(capture.offer?.availability).toBe('out_of_stock');
    expect(capture.selectedVariant).toBeUndefined();
  });

  it('still takes the child ASIN from the URL', () => {
    expect(extract(SINGLE).product?.identifiers).toEqual({ productId: 'B0EXAMPLE7' });
  });
});
