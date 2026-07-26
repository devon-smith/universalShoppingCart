import { describe, expect, it } from 'vitest';

import { findProductNodes, jsonLdExtractor, parseJsonLdBlock } from './json-ld';

function pageWith(jsonLd: string, extra = ''): Document {
  return new DOMParser().parseFromString(
    `<!doctype html><html><head><title>T</title>
     <script type="application/ld+json">${jsonLd}</script>${extra}</head><body></body></html>`,
    'text/html',
  );
}

function extract(jsonLd: string, url = 'https://shop.example/p/1') {
  return jsonLdExtractor.extract({ document: pageWith(jsonLd), url });
}

describe('parseJsonLdBlock', () => {
  it('parses well-formed JSON', () => {
    expect(parseJsonLdBlock('{"a":1}')).toEqual({ a: 1 });
  });

  it('recovers from a trailing semicolon', () => {
    expect(parseJsonLdBlock('{"a":1};')).toEqual({ a: 1 });
  });

  it('recovers from HTML comment wrappers', () => {
    expect(parseJsonLdBlock('<!-- {"a":1} -->')).toEqual({ a: 1 });
  });

  it('recovers from leading junk', () => {
    expect(parseJsonLdBlock('/* generated */ {"a":1}')).toEqual({ a: 1 });
  });

  it('returns null for unrecoverable input rather than guessing', () => {
    expect(parseJsonLdBlock('{"a":')).toBeNull();
    expect(parseJsonLdBlock('not json at all')).toBeNull();
    expect(parseJsonLdBlock('')).toBeNull();
  });
});

describe('findProductNodes', () => {
  it('finds a top-level Product', () => {
    expect(findProductNodes({ '@type': 'Product', name: 'X' })).toHaveLength(1);
  });

  it('finds a Product inside an array', () => {
    expect(
      findProductNodes([{ '@type': 'WebPage' }, { '@type': 'Product', name: 'X' }]),
    ).toHaveLength(1);
  });

  it('finds a Product inside @graph', () => {
    expect(
      findProductNodes({
        '@graph': [{ '@type': 'Organization' }, { '@type': 'Product', name: 'X' }],
      }),
    ).toHaveLength(1);
  });

  it('accepts @type as an array', () => {
    expect(findProductNodes({ '@type': ['Thing', 'Product'], name: 'X' })).toHaveLength(1);
  });

  it('accepts a fully-qualified @type URL', () => {
    expect(findProductNodes({ '@type': 'https://schema.org/Product', name: 'X' })).toHaveLength(1);
  });

  it('ignores non-product nodes', () => {
    expect(findProductNodes({ '@type': 'Article', headline: 'X' })).toHaveLength(0);
  });
});

describe('jsonLdExtractor — offers', () => {
  it('reads a single offer', () => {
    const result = extract(
      JSON.stringify({
        '@type': 'Product',
        name: 'X',
        offers: { '@type': 'Offer', price: '19.99', priceCurrency: 'USD' },
      }),
    );

    expect(result.offer?.priceAmount).toBe('19.99');
    expect(result.offer?.currency).toBe('USD');
  });

  it('prefers the offer whose sku matches the product', () => {
    const result = extract(
      JSON.stringify({
        '@type': 'Product',
        name: 'X',
        sku: 'B',
        offers: [
          { '@type': 'Offer', sku: 'A', price: '10.00', priceCurrency: 'USD' },
          { '@type': 'Offer', sku: 'B', price: '20.00', priceCurrency: 'USD' },
        ],
      }),
    );

    // Not "the cheapest": on a multi-variant page that is a different product.
    expect(result.offer?.priceAmount).toBe('20.00');
  });

  it('falls back to the first offer carrying a price', () => {
    const result = extract(
      JSON.stringify({
        '@type': 'Product',
        name: 'X',
        offers: [
          { '@type': 'Offer', availability: 'https://schema.org/OutOfStock' },
          { '@type': 'Offer', price: '30.00', priceCurrency: 'USD' },
        ],
      }),
    );

    expect(result.offer?.priceAmount).toBe('30.00');
  });

  it('expands an AggregateOffer into its members', () => {
    const result = extract(
      JSON.stringify({
        '@type': 'Product',
        name: 'X',
        offers: {
          '@type': 'AggregateOffer',
          lowPrice: '10.00',
          offers: [{ '@type': 'Offer', price: '15.00', priceCurrency: 'EUR' }],
        },
      }),
    );

    expect(result.offer?.priceAmount).toBe('15.00');
    expect(result.offer?.currency).toBe('EUR');
  });

  it('uses an AggregateOffer low price when it has no members', () => {
    const result = extract(
      JSON.stringify({
        '@type': 'Product',
        name: 'X',
        offers: { '@type': 'AggregateOffer', lowPrice: '10.00', priceCurrency: 'EUR' },
      }),
    );

    expect(result.offer?.priceAmount).toBe('10.00');
  });

  it('reads a price out of priceSpecification', () => {
    const result = extract(
      JSON.stringify({
        '@type': 'Product',
        name: 'X',
        offers: {
          '@type': 'Offer',
          priceSpecification: { price: '12.50', priceCurrency: 'GBP' },
        },
      }),
    );

    expect(result.offer?.priceAmount).toBe('12.50');
    expect(result.offer?.currency).toBe('GBP');
  });

  it('reads a sale price and its original', () => {
    const result = extract(
      JSON.stringify({
        '@type': 'Product',
        name: 'X',
        offers: {
          '@type': 'Offer',
          price: '80.00',
          highPrice: '100.00',
          priceCurrency: 'USD',
        },
      }),
    );

    expect(result.offer?.priceAmount).toBe('80.00');
    expect(result.offer?.originalPriceAmount).toBe('100.00');
  });

  it('leaves currency null rather than guessing when none is given', () => {
    const result = extract(
      JSON.stringify({ '@type': 'Product', name: 'X', offers: { price: '19.99' } }),
    );

    expect(result.offer?.priceAmount).toBe('19.99');
    expect(result.offer?.currency).toBeUndefined();
  });

  it('normalizes availability', () => {
    const result = extract(
      JSON.stringify({
        '@type': 'Product',
        name: 'X',
        offers: { price: '1.00', availability: 'https://schema.org/PreOrder' },
      }),
    );

    expect(result.offer?.availability).toBe('preorder');
  });
});

describe('jsonLdExtractor — product fields', () => {
  it('reads brand as a string or an object', () => {
    expect(
      extract(JSON.stringify({ '@type': 'Product', name: 'X', brand: 'Acme' })).product?.brand,
    ).toBe('Acme');
    expect(
      extract(
        JSON.stringify({
          '@type': 'Product',
          name: 'X',
          brand: { '@type': 'Brand', name: 'Acme' },
        }),
      ).product?.brand,
    ).toBe('Acme');
  });

  it('reads image as a string, an object, or a list', () => {
    expect(
      extract(JSON.stringify({ '@type': 'Product', name: 'X', image: 'https://cdn.example/1.jpg' }))
        .product?.imageUrls,
    ).toEqual(['https://cdn.example/1.jpg']);

    expect(
      extract(
        JSON.stringify({
          '@type': 'Product',
          name: 'X',
          image: { '@type': 'ImageObject', url: 'https://cdn.example/2.jpg' },
        }),
      ).product?.imageUrls,
    ).toEqual(['https://cdn.example/2.jpg']);

    expect(
      extract(
        JSON.stringify({
          '@type': 'Product',
          name: 'X',
          image: ['https://cdn.example/1.jpg', 'https://cdn.example/1.jpg'],
        }),
      ).product?.imageUrls,
    ).toEqual(['https://cdn.example/1.jpg']);
  });

  it('resolves a relative image against the page URL', () => {
    expect(
      extract(JSON.stringify({ '@type': 'Product', name: 'X', image: '/img/1.jpg' })).product
        ?.imageUrls,
    ).toEqual(['https://shop.example/img/1.jpg']);
  });

  it('refuses to carry a data: image into the capture', () => {
    expect(
      extract(JSON.stringify({ '@type': 'Product', name: 'X', image: 'data:image/png;base64,AAA' }))
        .product?.imageUrls,
    ).toBeUndefined();
  });

  it('collects identifiers', () => {
    const result = extract(
      JSON.stringify({
        '@type': 'Product',
        name: 'X',
        sku: 'S1',
        mpn: 'M1',
        gtin13: '0123456789012',
        productID: 'P1',
      }),
    );

    expect(result.product?.identifiers).toEqual({
      sku: 'S1',
      mpn: 'M1',
      gtin: '0123456789012',
      productId: 'P1',
    });
  });

  it('reads selected options into the variant map', () => {
    const result = extract(
      JSON.stringify({
        '@type': 'Product',
        name: 'X',
        color: 'Blue',
        size: 'M',
        additionalProperty: [{ '@type': 'PropertyValue', name: 'Storage', value: '256GB' }],
      }),
    );

    expect(result.selectedVariant).toEqual({ Color: 'Blue', Size: 'M', Storage: '256GB' });
  });
});

describe('jsonLdExtractor — support', () => {
  it('supports a page with a Product block', () => {
    const document = pageWith(JSON.stringify({ '@type': 'Product', name: 'X' }));
    expect(jsonLdExtractor.supports({ document, url: 'https://shop.example/p' })).toBe(true);
  });

  it('does not support a page whose only block is unrelated', () => {
    const document = pageWith(JSON.stringify({ '@type': 'Organization', name: 'X' }));
    expect(jsonLdExtractor.supports({ document, url: 'https://shop.example/p' })).toBe(false);
  });

  it('reads across several script blocks', () => {
    const document = new DOMParser().parseFromString(
      `<!doctype html><html><head>
        <script type="application/ld+json">{"@type":"Organization","name":"Shop"}</script>
        <script type="application/ld+json">{"@type":"Product","name":"Real product"}</script>
       </head><body></body></html>`,
      'text/html',
    );

    expect(
      jsonLdExtractor.extract({ document, url: 'https://shop.example/p' }).product?.title,
    ).toBe('Real product');
  });

  it('skips a malformed block without losing a later valid one', () => {
    const document = new DOMParser().parseFromString(
      `<!doctype html><html><head>
        <script type="application/ld+json">{ broken </script>
        <script type="application/ld+json">{"@type":"Product","name":"Survivor"}</script>
       </head><body></body></html>`,
      'text/html',
    );

    expect(
      jsonLdExtractor.extract({ document, url: 'https://shop.example/p' }).product?.title,
    ).toBe('Survivor');
  });
});

describe('jsonLdExtractor — pages describing more than one product', () => {
  function pageWithBlocks(...blocks: object[]): Document {
    const scripts = blocks
      .map((block) => `<script type="application/ld+json">${JSON.stringify(block)}</script>`)
      .join('');
    return new DOMParser().parseFromString(
      `<!doctype html><html><head><title>T</title>${scripts}</head><body></body></html>`,
      'text/html',
    );
  }

  it('takes the first Product as the page subject, not a recommended one', () => {
    // Recommendation carousels ship their own Product blocks. Every template we have seen
    // writes the page's own product first; picking the cheapest or the last would quietly
    // capture a "customers also bought" tile instead.
    const document = pageWithBlocks(
      {
        '@type': 'Product',
        name: 'The product being viewed',
        offers: { '@type': 'Offer', price: '129.00', priceCurrency: 'USD' },
      },
      {
        '@type': 'Product',
        name: 'Customers also bought',
        offers: { '@type': 'Offer', price: '19.99', priceCurrency: 'USD' },
      },
    );

    const result = jsonLdExtractor.extract({ document, url: 'https://shop.example/p/1' });

    expect(result.product?.title).toBe('The product being viewed');
    expect(result.offer?.priceAmount).toBe('129.00');
  });

  it('ignores a BreadcrumbList and an Organization sharing the page', () => {
    const document = pageWithBlocks(
      { '@type': 'Organization', name: 'The shop itself' },
      { '@type': 'BreadcrumbList', itemListElement: [] },
      {
        '@type': 'Product',
        name: 'The actual product',
        offers: { '@type': 'Offer', price: '12.00', priceCurrency: 'USD' },
      },
    );

    const result = jsonLdExtractor.extract({ document, url: 'https://shop.example/p/1' });

    expect(result.product?.title).toBe('The actual product');
  });
});

describe('jsonLdExtractor — price ranges and variant groups', () => {
  it('does not turn an AggregateOffer range into a discount', () => {
    // lowPrice/highPrice bound a range across variants. Reporting highPrice as the original
    // price renders "was $40.00, now $20.00" — a sale the retailer never offered, which is
    // exactly the kind of invented fact BUILD_PLAN.md §6.2 rules out.
    const result = extract(
      JSON.stringify({
        '@type': 'Product',
        name: 'X',
        offers: {
          '@type': 'AggregateOffer',
          lowPrice: '20.00',
          highPrice: '40.00',
          priceCurrency: 'USD',
        },
      }),
    );

    expect(result.offer?.priceAmount).toBe('20.00');
    expect(result.offer?.originalPriceAmount).toBeUndefined();
  });

  it('still reads a genuine was-price from a plain offer', () => {
    const result = extract(
      JSON.stringify({
        '@type': 'Product',
        name: 'X',
        offers: { '@type': 'Offer', price: '20.00', listPrice: '40.00', priceCurrency: 'USD' },
      }),
    );

    expect(result.offer?.priceAmount).toBe('20.00');
    expect(result.offer?.originalPriceAmount).toBe('40.00');
  });

  it('reads a ProductGroup as the page subject', () => {
    // Google's variant markup wraps a family in a ProductGroup. Without it, a page whose
    // only block is a group extracts nothing at all and falls back to DOM guessing.
    const result = extract(
      JSON.stringify({
        '@type': 'ProductGroup',
        name: 'Merino crew',
        brand: { '@type': 'Brand', name: 'Northsea' },
        offers: { '@type': 'Offer', price: '89.00', priceCurrency: 'USD' },
      }),
    );

    expect(result.product?.title).toBe('Merino crew');
    expect(result.product?.brand).toBe('Northsea');
    expect(result.offer?.priceAmount).toBe('89.00');
  });

  it('takes the offer for the selected variant even when other variants are in stock', () => {
    // The product is generally available; the size on screen is not. Reporting the family's
    // availability would tell the user something false about what they are looking at.
    const result = extract(
      JSON.stringify({
        '@type': 'Product',
        name: 'Merino crew',
        sku: 'CREW-BLUE-L',
        offers: [
          {
            '@type': 'Offer',
            sku: 'CREW-BLUE-M',
            price: '89.00',
            priceCurrency: 'USD',
            availability: 'https://schema.org/InStock',
          },
          {
            '@type': 'Offer',
            sku: 'CREW-BLUE-L',
            price: '89.00',
            priceCurrency: 'USD',
            availability: 'https://schema.org/OutOfStock',
          },
        ],
      }),
    );

    expect(result.offer?.availability).toBe('out_of_stock');
  });
});
