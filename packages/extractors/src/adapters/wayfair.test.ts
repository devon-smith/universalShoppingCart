import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { wayfairAdapter } from './wayfair';

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/adapters');

function documentFor(file: string): Document {
  return new DOMParser().parseFromString(
    readFileSync(resolve(fixtures, file), 'utf8'),
    'text/html',
  );
}

const SALE = {
  file: 'wayfair-sale-out-of-stock.html',
  url: 'https://www.wayfair.com/furniture/pdp/harbour-vale-calder-3-piece-boucle-modular-sectional-with-loose-back-w998877665.html?piid=640565351%2C640565355',
};
const PRIMARY = {
  file: 'wayfair-primary-in-stock.html',
  url: 'https://www.wayfair.com/furniture/pdp/harbour-vale-thorne-solid-wood-6-drawer-dresser-w445566778.html?piid=771002908',
};

function extract(fixture: { file: string; url: string }) {
  return wayfairAdapter.extract({ document: documentFor(fixture.file), url: fixture.url });
}

describe('wayfairAdapter.supports', () => {
  it('claims a Wayfair US product page', () => {
    expect(wayfairAdapter.supports({ document: documentFor(SALE.file), url: SALE.url })).toBe(true);
  });

  it('declines another retailer', () => {
    expect(
      wayfairAdapter.supports({ document: documentFor(SALE.file), url: 'https://example.com/p' }),
    ).toBe(false);
  });

  it('declines an international Wayfair storefront it cannot price', () => {
    // wayfair.co.uk prices in GBP; claiming it and asserting USD would be worse than declining.
    expect(
      wayfairAdapter.supports({
        document: documentFor(SALE.file),
        url: 'https://www.wayfair.co.uk/p',
      }),
    ).toBe(false);
  });

  it('declines a page with no listing-pricing node', () => {
    const doc = new DOMParser().parseFromString(
      '<html><body><h1>Search</h1></body></html>',
      'text/html',
    );
    expect(wayfairAdapter.supports({ document: doc, url: SALE.url })).toBe(false);
  });
});

describe('wayfairAdapter — the price is scoped past the sponsored decoy', () => {
  it('reads the sale price and struck former price, never the sponsored tile', () => {
    const capture = extract(SALE);
    expect(capture.offer?.priceAmount).toBe('612.50');
    expect(capture.offer?.originalPriceAmount).toBe('875.00');
    // The sponsored tile carries an identical SALE/PREVIOUS/PriceDisplay trio at 940/1610.
    expect(capture.offer?.priceAmount).not.toBe('940.00');
    expect(capture.offer?.originalPriceAmount).not.toBe('1610.00');
  });

  it('reads a PRIMARY price and invents no former price when there is no sale', () => {
    const capture = extract(PRIMARY);
    expect(capture.offer?.priceAmount).toBe('429.99');
    expect(capture.offer?.originalPriceAmount).toBeUndefined();
  });

  it('asserts USD on the US storefront, which the bare $ cannot resolve on its own', () => {
    expect(extract(SALE).offer?.currency).toBe('USD');
  });
});

describe('wayfairAdapter — availability and the selected options', () => {
  it('reads out of stock from the inventory widget metadata', () => {
    expect(extract(SALE).offer?.availability).toBe('out_of_stock');
  });

  it('reads in stock on the primary page', () => {
    expect(extract(PRIMARY).offer?.availability).toBe('in_stock');
  });

  it('reads the selected option value, not the swatch buttons for other choices', () => {
    // The second <p> is the selection; the swatches carry other colours in data-clio-context.
    const variant = extract(SALE).selectedVariant;
    expect(variant).toEqual({ Fabric: 'Sand Boucle', Orientation: 'Right Hand Facing' });
    expect(JSON.stringify(variant)).not.toContain('Moss Boucle');
  });

  it('reads a single-category variant map on the primary page', () => {
    expect(extract(PRIMARY).selectedVariant).toEqual({ Finish: 'Warm Walnut' });
  });
});
