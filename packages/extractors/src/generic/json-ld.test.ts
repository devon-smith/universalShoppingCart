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

  it('says nothing when an AggregateOffer’s members disagree on price', () => {
    // Chewy's dog food: one ProductGroup, an AggregateOffer whose 8 members are the bag
    // sizes at 73.43 / 39.97 / 135.94 / 67.97 / 10.99. Taking the first priced member
    // reported 73.43 for a page selling the 67.97 bag — a confident wrong number at 0.9,
    // beating a DOM layer that had the right one.
    const result = extract(
      JSON.stringify({
        '@type': 'ProductGroup',
        name: 'Dog food',
        offers: {
          '@type': 'AggregateOffer',
          lowPrice: '10.99',
          highPrice: '135.94',
          priceCurrency: 'USD',
          offers: [
            { '@type': 'Offer', sku: 'BAG-4', price: '73.43', priceCurrency: 'USD' },
            { '@type': 'Offer', sku: 'BAG-15', price: '39.97', priceCurrency: 'USD' },
            { '@type': 'Offer', sku: 'BAG-30', price: '67.97', priceCurrency: 'USD' },
          ],
        },
      }),
    );

    expect(result.offer?.priceAmount).toBeUndefined();
    // The currency is not in dispute, so it survives.
    expect(result.offer?.currency).toBe('USD');
  });

  it('takes an AggregateOffer member when the product’s sku names it', () => {
    const result = extract(
      JSON.stringify({
        '@type': 'ProductGroup',
        name: 'Dog food',
        sku: 'BAG-30',
        offers: {
          '@type': 'AggregateOffer',
          lowPrice: '10.99',
          priceCurrency: 'USD',
          offers: [
            { '@type': 'Offer', sku: 'BAG-4', price: '73.43', priceCurrency: 'USD' },
            { '@type': 'Offer', sku: 'BAG-30', price: '67.97', priceCurrency: 'USD' },
          ],
        },
      }),
    );

    expect(result.offer?.priceAmount).toBe('67.97');
  });

  it('uses the low price when an AggregateOffer’s members are competing sellers', () => {
    // The marketplace shape: one product, many vendors. Members sharing a sku and differing
    // by seller are not variants, so disagreement is expected rather than ambiguous, and the
    // aggregate's own lowPrice is a real answer.
    const result = extract(
      JSON.stringify({
        '@type': 'Product',
        name: 'A book',
        offers: {
          '@type': 'AggregateOffer',
          lowPrice: '18.00',
          highPrice: '24.00',
          priceCurrency: 'USD',
          offers: [
            {
              '@type': 'Offer',
              sku: 'ISBN-1',
              price: '24.00',
              priceCurrency: 'USD',
              seller: { '@type': 'Organization', name: 'Shop A' },
            },
            {
              '@type': 'Offer',
              sku: 'ISBN-1',
              price: '18.00',
              priceCurrency: 'USD',
              seller: { '@type': 'Organization', name: 'Shop B' },
            },
          ],
        },
      }),
    );

    expect(result.offer?.priceAmount).toBe('18.00');
    expect(result.offer?.originalPriceAmount).toBeUndefined();
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

  it('leaves composition and other described facts out of the variant map', () => {
    // Zara publishes `Material` and `OUTER SHELL`, H&M `Material` and `Pattern`, Uniqlo its
    // own contact details — all through schema.org properties, none of them chosen by anyone.
    // selectedVariant is hashed into the fingerprint (BUILD_PLAN.md §9.1), so a spec table
    // that renders on one visit and not the next hashes one product two ways.
    const result = extract(
      JSON.stringify({
        '@type': 'Product',
        name: 'X',
        color: 'Blue',
        material: '100% cotton',
        pattern: 'Ribbed',
        additionalProperty: [
          { '@type': 'PropertyValue', name: 'OUTER SHELL', value: '100% cotton' },
          { '@type': 'PropertyValue', name: 'seller_name', value: 'UNIQLO US' },
        ],
      }),
    );

    expect(result.selectedVariant).toEqual({ Color: 'Blue' });
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

  it('reads the price out of hasVariant when the group carries no offers of its own', () => {
    // Zara and Nike both ship exactly one block, a ProductGroup, with the price only inside
    // hasVariant. Descending into @graph alone never reached it, so both pages extracted no
    // price at all while the number sat in machine-readable markup.
    const result = extract(
      JSON.stringify({
        '@type': 'ProductGroup',
        name: 'Merino crew',
        hasVariant: [
          {
            '@type': 'Product',
            sku: 'CREW-BLUE-M',
            offers: { '@type': 'Offer', price: '89.00', priceCurrency: 'USD' },
          },
          {
            '@type': 'Product',
            sku: 'CREW-BLUE-L',
            offers: { '@type': 'Offer', price: '89.00', priceCurrency: 'USD' },
          },
        ],
      }),
    );

    expect(result.offer?.priceAmount).toBe('89.00');
    expect(result.offer?.currency).toBe('USD');
    expect(result.evidence.find((item) => item.field === 'offer.priceAmount')?.source).toBe(
      'json_ld',
    );
  });

  it('reports no price when variants disagree and nothing says which is selected', () => {
    // Picking the first variant carrying a price would show a confident wrong number. A
    // missing price is recoverable — the panel flags it and the user corrects it — while a
    // plausible wrong one is not noticed at all (BUILD_PLAN.md §10.3).
    const result = extract(
      JSON.stringify({
        '@type': 'ProductGroup',
        name: 'Merino crew',
        hasVariant: [
          {
            '@type': 'Product',
            sku: 'CREW-S',
            offers: { '@type': 'Offer', price: '89.00', priceCurrency: 'USD' },
          },
          {
            '@type': 'Product',
            sku: 'CREW-XL',
            offers: { '@type': 'Offer', price: '119.00', priceCurrency: 'USD' },
          },
        ],
      }),
    );

    expect(result.offer?.priceAmount).toBeUndefined();
    expect(result.evidence.find((item) => item.field === 'offer.priceAmount')).toBeUndefined();

    // The currency is not in dispute, so it survives.
    expect(result.offer?.currency).toBe('USD');
  });

  it('consolidates availability and declared options the same way', () => {
    const agreeing = extract(
      JSON.stringify({
        '@type': 'ProductGroup',
        name: 'Merino crew',
        hasVariant: [
          {
            '@type': 'Product',
            color: 'Navy',
            offers: {
              '@type': 'Offer',
              price: '89.00',
              priceCurrency: 'USD',
              availability: 'https://schema.org/OutOfStock',
            },
          },
          {
            '@type': 'Product',
            color: 'Navy',
            offers: {
              '@type': 'Offer',
              price: '89.00',
              priceCurrency: 'USD',
              availability: 'https://schema.org/OutOfStock',
            },
          },
        ],
      }),
    );

    expect(agreeing.offer?.availability).toBe('out_of_stock');
    expect(agreeing.selectedVariant).toEqual({ Color: 'Navy' });

    const disagreeing = extract(
      JSON.stringify({
        '@type': 'ProductGroup',
        name: 'Merino crew',
        hasVariant: [
          { '@type': 'Product', color: 'Navy', offers: { '@type': 'Offer', price: '89.00' } },
          { '@type': 'Product', color: 'Rust', offers: { '@type': 'Offer', price: '89.00' } },
        ],
      }),
    );

    // Two colours and no signal which is on screen: say nothing rather than guess.
    expect(disagreeing.selectedVariant).toBeUndefined();
    expect(disagreeing.offer?.priceAmount).toBe('89.00');
  });

  it('prefers the group’s own offers over its variants', () => {
    const result = extract(
      JSON.stringify({
        '@type': 'ProductGroup',
        name: 'Merino crew',
        offers: { '@type': 'Offer', price: '79.00', priceCurrency: 'USD' },
        hasVariant: [
          {
            '@type': 'Product',
            offers: { '@type': 'Offer', price: '89.00', priceCurrency: 'USD' },
          },
        ],
      }),
    );

    expect(result.offer?.priceAmount).toBe('79.00');
  });

  it('still refuses to turn a group’s aggregate range into a discount', () => {
    // The 9b03646 rule has to keep holding through the hasVariant path.
    const result = extract(
      JSON.stringify({
        '@type': 'ProductGroup',
        name: 'Merino crew',
        offers: {
          '@type': 'AggregateOffer',
          lowPrice: '89.00',
          highPrice: '119.00',
          priceCurrency: 'USD',
        },
      }),
    );

    expect(result.offer?.priceAmount).toBe('89.00');
    expect(result.offer?.originalPriceAmount).toBeUndefined();
  });

  it('leaves a plain Product untouched', () => {
    const result = extract(
      JSON.stringify({
        '@type': 'Product',
        name: 'Merino crew',
        offers: { '@type': 'Offer', price: '89.00', priceCurrency: 'USD', availability: 'InStock' },
      }),
    );

    expect(result.product?.title).toBe('Merino crew');
    expect(result.offer?.priceAmount).toBe('89.00');
    expect(result.offer?.availability).toBe('in_stock');
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
