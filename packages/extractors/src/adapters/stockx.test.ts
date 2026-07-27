import { describe, expect, it } from 'vitest';

import { extractProductCapture } from '../core/pipeline';

import { stockxAdapter } from './stockx';

function parse(body: string): Document {
  return new DOMParser().parseFromString(
    `<!doctype html><html><head><title>T</title></head><body>${body}</body></html>`,
    'text/html',
  );
}

const HERO = `
  <div data-testid="pdp-hero">
    <div data-testid="pdp-hero-media"><img src="https://images.example.com/hero.jpg" /></div>
    <div data-testid="pdp-hero-title">
      <h1 data-component="primary-product-title">Vantage Court Low<span
        data-component="secondary-product-title">Sail Cobalt</span></h1>
    </div>
    <div data-testid="pdp-hero-buysell">
      <button type="button"><div><p>Size:</p><div><p>US Men's 10.5</p></div></div></button>
      <h2 data-testid="trade-box-buy-amount">$84</h2>
    </div>
    <div data-testid="product-traits">
      <div data-component="product-trait"><span>Style</span><p>VC1234-101</p></div>
      <div data-component="product-trait"><span>Colorway</span><p>Sail/Cobalt-Sail</p></div>
      <div data-component="product-trait"><span>Retail Price</span><p>$120</p></div>
    </div>
  </div>`;

const URL = 'https://stockx.com/vantage-court-low-sail-cobalt';

function extract(body: string, url = URL) {
  return stockxAdapter.extract({ document: parse(body), url });
}

describe('stockxAdapter — support', () => {
  it('claims a StockX product page', () => {
    expect(stockxAdapter.supports({ document: parse(HERO), url: URL })).toBe(true);
  });

  it('does not claim another retailer that happens to use the same test ids', () => {
    expect(stockxAdapter.supports({ document: parse(HERO), url: 'https://shop.example/p' })).toBe(
      false,
    );
  });

  it('does not claim a StockX page that is not a product page', () => {
    // A search or account page. Claiming it would contribute nothing and hide the fact from
    // the diagnostics page, where a matched-but-empty adapter is the signal for rotted
    // selectors.
    expect(stockxAdapter.supports({ document: parse('<div>Search results</div>'), url: URL })).toBe(
      false,
    );
  });

  it('does not throw on a URL it cannot parse', () => {
    expect(stockxAdapter.supports({ document: parse(HERO), url: 'not a url' })).toBe(false);
  });
});

describe('stockxAdapter — the fields', () => {
  it('joins the split title instead of running the halves together', () => {
    // The secondary title is nested inside the primary, so textContent yields
    // "Vantage Court LowSail Cobalt".
    expect(extract(HERO).product?.title).toBe('Vantage Court Low Sail Cobalt');
  });

  it('reads Buy Now for the selected size, not the lowest ask', () => {
    // Both are real prices for this product. The shopper is buying a size.
    expect(extract(HERO).offer?.priceAmount).toBe('84.00');
  });

  it('does not guess a currency from the dollar sign', () => {
    // `$` is USD, CAD, AUD and more. The currency comes from structured data, which states
    // it; guessing here would put the wrong one on a saved product.
    expect(extract(HERO).offer?.currency).toBeUndefined();
  });

  it('reads the retail price as the original price', () => {
    expect(extract(HERO).offer?.originalPriceAmount).toBe('120.00');
  });

  it('reads the selected size and the colourway', () => {
    expect(extract(HERO).selectedVariant).toEqual({
      Size: "US Men's 10.5",
      Color: 'Sail/Cobalt-Sail',
    });
  });

  it('reads the style code as an MPN', () => {
    expect(extract(HERO).product?.identifiers).toEqual({ mpn: 'VC1234-101' });
  });

  it('reads the hero image', () => {
    expect(extract(HERO).product?.selectedImageUrl).toBe('https://images.example.com/hero.jpg');
  });

  it('treats a Buy Now price as availability of the selected size', () => {
    const result = extract(HERO);
    expect(result.offer?.variantAvailability).toBe('in_stock');
    // Never on the product-level field: whether this style is sold is a different question.
    expect(result.offer?.availability).toBeUndefined();
  });
});

describe('stockxAdapter — what it refuses to say', () => {
  it('claims nothing about availability when there is no Buy Now price', () => {
    // A missing element is equally what a markup change looks like, so absence proves
    // nothing. Reporting out_of_stock from it would invent a fact.
    const noBuyNow = HERO.replace('<h2 data-testid="trade-box-buy-amount">$84</h2>', '');
    const result = extract(noBuyNow);

    expect(result.offer?.priceAmount).toBeUndefined();
    expect(result.offer?.variantAvailability).toBeUndefined();
    expect(result.product?.title).toBe('Vantage Court Low Sail Cobalt');
  });

  it('ignores a sponsored tile below the hero', () => {
    // `product-tile-lowest-ask-amount` is a plausible price belonging to a different shoe.
    const withTile = `${HERO}
      <div data-testid="productTile">
        <p data-testid="product-tile-title">Meridian Runner</p>
        <p data-testid="product-tile-lowest-ask-amount">$59</p>
        <span data-testid="sponsored-tag">Sponsored</span>
      </div>`;

    expect(extract(withTile).offer?.priceAmount).toBe('84.00');
  });

  it('does not report a retail price that merely repeats the current one', () => {
    const same = HERO.replace('<p>$120</p>', '<p>$84</p>');
    expect(extract(same).offer?.originalPriceAmount).toBeUndefined();
  });
});

describe('stockxAdapter — degrading when the selectors rot', () => {
  it('still captures from structured data when the hero markup has changed', () => {
    // BUILD_PLAN.md §10.7: an adapter failure must never prevent a capture. Here the test
    // ids have been renamed, so the adapter declines the page entirely and the generic
    // layers carry it.
    const rotted = `
      <script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org/',
        '@type': 'Product',
        name: 'Vantage Court Low Sail Cobalt',
        offers: { '@type': 'Offer', price: 76, priceCurrency: 'USD' },
      })}</script>
      <div data-testid="pdp-hero-v2"><h1>Vantage Court Low Sail Cobalt</h1></div>`;

    const result = extractProductCapture({ document: parse(rotted), url: URL });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.matchedAdapters).not.toContain('stockx');
    expect(result.capture.offer.priceAmount).toBe('76.00');
    expect(result.capture.product.title).toBe('Vantage Court Low Sail Cobalt');
  });

  it('records a throwing adapter as a failure rather than losing the capture', () => {
    const exploding = {
      ...stockxAdapter,
      extract() {
        throw new Error('selectors rotted');
      },
    };

    const result = extractProductCapture(
      { document: parse(HERO), url: URL },
      { extractors: [exploding] },
    );

    // Nothing extractable is left, so the capture cannot validate — but the crash is
    // recorded rather than swallowed, which is what tells the health page an adapter is
    // broken instead of the page being empty.
    const failures = result.ok ? result.extractorFailures : result.extractorFailures;
    expect(failures).toEqual([
      { extractorId: 'stockx', phase: 'extract', message: 'selectors rotted' },
    ]);
  });
});
