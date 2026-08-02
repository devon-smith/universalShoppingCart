import { describe, expect, it } from 'vitest';

import { shopifyAdapter } from './shopify';

import {
  humanizeAttributeCode,
  minorUnitsToDecimal,
  moneyProp,
  readJsonAttribute,
  readJsonScript,
  stringProp,
} from './shared';

function documentFrom(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('minorUnitsToDecimal', () => {
  it('moves the decimal point rather than dividing', () => {
    expect(minorUnitsToDecimal(9800)).toBe('98.00');
    expect(minorUnitsToDecimal(10800)).toBe('108.00');
    expect(minorUnitsToDecimal(5)).toBe('0.05');
    expect(minorUnitsToDecimal(0)).toBe('0.00');
  });

  it('is exact for amounts a double would round', () => {
    // 1e15 + 15 cents. `x / 100` in JavaScript loses the cents entirely.
    expect(minorUnitsToDecimal('100000000000000015')).toBe('1000000000000000.15');
  });

  it('accepts the same value as a string', () => {
    expect(minorUnitsToDecimal('9800')).toBe('98.00');
    expect(minorUnitsToDecimal(' 9800 ')).toBe('98.00');
  });

  it('refuses anything that is not integer minor units', () => {
    expect(minorUnitsToDecimal(98.5)).toBeNull();
    expect(minorUnitsToDecimal('98.00')).toBeNull();
    expect(minorUnitsToDecimal(-100)).toBeNull();
    expect(minorUnitsToDecimal(null)).toBeNull();
    expect(minorUnitsToDecimal('free')).toBeNull();
  });
});

describe('readJsonScript', () => {
  it('parses the first well-formed block', () => {
    const document = documentFrom(`
      <script type="application/json" id="a">not json{</script>
      <script type="application/json" id="b">{"title":"A"}</script>
    `);

    expect(readJsonScript(document, 'script[type="application/json"]')).toEqual({ title: 'A' });
  });

  it('returns null rather than throwing on a broken page', () => {
    const document = documentFrom('<script type="application/json">{oops</script>');
    expect(readJsonScript(document, 'script[type="application/json"]')).toBeNull();
  });

  it('tries selectors in order', () => {
    const document = documentFrom(`
      <script type="application/json" id="second">{"n":2}</script>
      <script type="application/json" id="first">{"n":1}</script>
    `);

    expect(readJsonScript(document, '#first', '#second')).toEqual({ n: 1 });
  });
});

describe('readJsonAttribute', () => {
  it('parses JSON out of an attribute', () => {
    const document = documentFrom('<form data-v=\'[{"id":1}]\'></form>');
    expect(readJsonAttribute(document.querySelector('form'), 'data-v')).toEqual([{ id: 1 }]);
  });

  it('is null for a missing element or attribute', () => {
    expect(readJsonAttribute(null, 'data-v')).toBeNull();
    const document = documentFrom('<form></form>');
    expect(readJsonAttribute(document.querySelector('form'), 'data-v')).toBeNull();
  });
});

describe('property readers', () => {
  it('treats a non-string as absent rather than coercing it', () => {
    expect(stringProp({ a: 1 }, 'a')).toBeNull();
    expect(stringProp({ a: '  spaced  ' }, 'a')).toBe('spaced');
    expect(stringProp({ a: '' }, 'a')).toBeNull();
    expect(stringProp(null, 'a')).toBeNull();
  });

  it('hands a price back in the form the platform wrote it', () => {
    expect(moneyProp({ p: 68 }, 'p')).toBe(68);
    expect(moneyProp({ p: '68.00' }, 'p')).toBe('68.00');
    expect(moneyProp({ p: null }, 'p')).toBeNull();
  });
});

describe('humanizeAttributeCode', () => {
  it('strips platform prefixes without renaming the option', () => {
    expect(humanizeAttributeCode('attribute_pa_size')).toBe('Size');
    expect(humanizeAttributeCode('attribute_pa_shoe-size')).toBe('Shoe size');
    expect(humanizeAttributeCode('super_attribute_color')).toBe('Color');
  });

  it('refuses anything that is not a label', () => {
    expect(humanizeAttributeCode('attribute_pa_')).toBeNull();
    expect(humanizeAttributeCode('a'.repeat(60))).toBeNull();
  });
});

describe('shopifyAdapter.supports — the data has to be there', () => {
  function page(body: string): Document {
    return new DOMParser().parseFromString(
      `<!doctype html><html><head><link rel="preconnect" href="https://cdn.shopify.com/" />
       </head><body>${body}</body></html>`,
      'text/html',
    );
  }

  it('declines a headless storefront that only preconnects to the Shopify CDN', () => {
    // Gymshark's shape. Matching on the platform signal alone claimed the page and then
    // returned nothing, which is worse than never claiming it.
    const document = page('<h1>Sport 7" Shorts</h1>');
    expect(shopifyAdapter.supports({ document, url: 'https://shop.example/products/x' })).toBe(
      false,
    );
  });

  it('claims a page that carries the product JSON it reads', () => {
    const document = page(
      `<script type="application/json" id="ProductJson-product-template">
         {"title":"A shirt","variants":[{"id":1,"price":1999,"available":true}]}
       </script>`,
    );
    expect(shopifyAdapter.supports({ document, url: 'https://shop.example/products/x' })).toBe(
      true,
    );
  });
});
