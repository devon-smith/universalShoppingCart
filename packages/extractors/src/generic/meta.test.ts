import { describe, expect, it } from 'vitest';

import { canonicalUrlFrom, metaExtractor } from './meta';

function page(head: string): Document {
  return new DOMParser().parseFromString(
    `<!doctype html><html><head><title>Page title</title>${head}</head><body></body></html>`,
    'text/html',
  );
}

function extract(head: string, url = 'https://shop.example/p/1') {
  return metaExtractor.extract({ document: page(head), url });
}

describe('metaExtractor — Open Graph', () => {
  it('reads title, description, and image', () => {
    const result = extract(`
      <meta property="og:title" content="Kestrel Rain Shell" />
      <meta property="og:description" content="A packable shell." />
      <meta property="og:image" content="https://cdn.example/1.jpg" />
    `);

    expect(result.product?.title).toBe('Kestrel Rain Shell');
    expect(result.product?.description).toBe('A packable shell.');
    expect(result.product?.imageUrls).toEqual(['https://cdn.example/1.jpg']);
  });

  it('resolves a relative og:image', () => {
    const result = extract('<meta property="og:image" content="/img/1.jpg" />');
    expect(result.product?.imageUrls).toEqual(['https://shop.example/img/1.jpg']);
  });

  it('collects Twitter card images too, without duplicating', () => {
    const result = extract(`
      <meta property="og:image" content="https://cdn.example/1.jpg" />
      <meta name="twitter:image" content="https://cdn.example/1.jpg" />
    `);

    expect(result.product?.imageUrls).toEqual(['https://cdn.example/1.jpg']);
  });

  it('falls back to a Twitter title', () => {
    const result = extract('<meta name="twitter:title" content="From Twitter" />');
    expect(result.product?.title).toBe('From Twitter');
  });
});

describe('metaExtractor — product meta', () => {
  it('reads price, currency, and availability', () => {
    const result = extract(`
      <meta property="product:price:amount" content="189.00" />
      <meta property="product:price:currency" content="CAD" />
      <meta property="product:availability" content="instock" />
    `);

    expect(result.offer).toMatchObject({
      priceAmount: '189.00',
      currency: 'CAD',
      availability: 'in_stock',
    });
  });

  it('reads an original price', () => {
    const result = extract(`
      <meta property="product:price:amount" content="189.00" />
      <meta property="product:original_price:amount" content="245.00" />
    `);

    expect(result.offer?.originalPriceAmount).toBe('245.00');
  });

  it('normalizes a European price in a meta tag', () => {
    const result = extract('<meta property="product:price:amount" content="1.299,00" />');
    expect(result.offer?.priceAmount).toBe('1299.00');
  });

  it('does not invent a currency', () => {
    const result = extract('<meta property="product:price:amount" content="19.99" />');
    expect(result.offer?.currency).toBeUndefined();
  });
});

describe('metaExtractor — source fields', () => {
  it('reads the canonical link', () => {
    const document = page('<link rel="canonical" href="/p/1" />');
    expect(canonicalUrlFrom(document, 'https://shop.example/p/1?utm_source=x')).toBe(
      'https://shop.example/p/1',
    );
  });

  it('falls back to og:url when there is no canonical link', () => {
    const document = page('<meta property="og:url" content="https://shop.example/p/1" />');
    expect(canonicalUrlFrom(document, 'https://shop.example/p/1?ref=x')).toBe(
      'https://shop.example/p/1',
    );
  });

  it('returns null when neither is present', () => {
    expect(canonicalUrlFrom(page(''), 'https://shop.example/p/1')).toBeNull();
  });

  it('records the document title', () => {
    expect(extract('<meta property="og:title" content="X" />').source?.pageTitle).toBe(
      'Page title',
    );
  });
});

describe('metaExtractor — support and confidence', () => {
  it('supports a page with Open Graph tags', () => {
    const document = page('<meta property="og:title" content="X" />');
    expect(metaExtractor.supports({ document, url: 'https://shop.example/p' })).toBe(true);
  });

  it('does not support a page with no product-ish meta at all', () => {
    const document = page('<meta name="viewport" content="width=device-width" />');
    expect(metaExtractor.supports({ document, url: 'https://shop.example/p' })).toBe(false);
  });

  it('claims less confidence in og:title than JSON-LD would', () => {
    // og:title routinely carries a " | Retailer" suffix, so it loses to structured data.
    const result = extract('<meta property="og:title" content="X | Retailer" />');
    const titleEvidence = result.evidence.find((item) => item.field === 'product.title');

    expect(titleEvidence?.source).toBe('meta');
    expect(titleEvidence?.confidence).toBeLessThan(0.95);
  });
});
