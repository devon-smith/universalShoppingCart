import type { PartialCapture } from '@universal-cart/contracts';
import { describe, expect, it } from 'vitest';

import { extractProductCapture, fieldsNeedingReview } from './pipeline';
import type { ProductExtractor } from './types';
import { evidence } from './types';

const OBSERVED_AT = '2026-07-26T12:00:00.000Z';

function page(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

function run(html: string, url = 'https://shop.example/p/1') {
  return extractProductCapture({ document: page(html), url }, { now: () => new Date(OBSERVED_AT) });
}

function stubExtractor(
  id: string,
  priority: number,
  result: PartialCapture | (() => never),
): ProductExtractor {
  return {
    id,
    version: '1.0.0',
    priority,
    supports: () => true,
    extract: () => (typeof result === 'function' ? result() : result),
  };
}

describe('extractProductCapture', () => {
  it('produces a valid capture from structured data', () => {
    const result = run(`<!doctype html><html><head><title>T</title>
      <script type="application/ld+json">
        {"@type":"Product","name":"A lamp","offers":{"price":"10.00","priceCurrency":"USD"}}
      </script></head><body></body></html>`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.capture.product.title).toBe('A lamp');
    expect(result.capture.offer.priceAmount).toBe('10.00');
    expect(result.capture.extraction.observedAt).toBe(OBSERVED_AT);
    expect(result.contributors).toContain('json-ld');
  });

  it('fills source fields the page does not carry', () => {
    const result = run(
      '<html><head><title>T</title></head><body></body></html>',
      'https://shop.lumenworks.example/p/1?utm_source=x',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.capture.source.domain).toBe('shop.lumenworks.example');
    expect(result.capture.source.retailerName).toBe('Lumenworks');
    // Falls back to the normalized page URL when there is no canonical link.
    expect(result.capture.source.canonicalUrl).toBe('https://shop.lumenworks.example/p/1');
  });

  it('routes an opaque ?variant= id to identifiers, not selectedVariant', () => {
    const result = run(
      `<!doctype html><html><head><title>Crew</title>
      <script type="application/ld+json">
        {"@type":"Product","name":"Essential Crew","sku":"CREW-UNIFORM",
         "offers":{"price":"23.00","priceCurrency":"USD"}}
      </script></head><body></body></html>`,
      'https://shop.example/products/crew?variant=43742060085334',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The id identifies the variant rather than describing it, so it must not pollute the
    // compare view — and it must still reach the fingerprint through identifiers, or two
    // sizes sharing a product-level sku would hash alike.
    expect(result.capture.selectedVariant).toEqual({});
    expect(result.capture.product.identifiers.variantId).toBe('43742060085334');
    expect(result.capture.product.identifiers.sku).toBe('CREW-UNIFORM');
  });

  it('lets an adapter-supplied variant id win over the URL', () => {
    const adapterCapture: PartialCapture = {
      product: { identifiers: { variantId: 'from-adapter-1' } },
      evidence: [evidence('product.identifiers', 'adapter', 0.95)],
    };
    const result = extractProductCapture(
      {
        document: page('<!doctype html><html><body></body></html>'),
        url: 'https://shop.example/p?variant=99887766',
      },
      {
        now: () => new Date(OBSERVED_AT),
        extractors: [stubExtractor('shopify', 95, adapterCapture)],
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.capture.product.identifiers.variantId).toBe('from-adapter-1');
  });

  it('returns a graceful capture when nothing is extractable', () => {
    const result = run('<html><head><title>Catalogue</title></head><body></body></html>');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.capture.product.title).toBeNull();
    expect(result.capture.offer.priceAmount).toBeNull();
    expect(result.capture.offer.availability).toBe('unknown');
    expect(result.capture.extraction.overallConfidence).toBe(0);
  });

  it('rejects a page that is not on an http(s) URL', () => {
    const result = extractProductCapture({
      document: page('<html><body></body></html>'),
      url: 'chrome-extension://abc/page.html',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]).toMatch(/not an http/);
  });

  it('lets a higher-priority extractor override a lower one', () => {
    const low = stubExtractor('low', 1, {
      product: { title: 'Low' },
      evidence: [evidence('product.title', 'dom', 0.9)],
    });
    const high = stubExtractor('high', 100, {
      product: { title: 'High' },
      evidence: [evidence('product.title', 'adapter', 0.5)],
    });

    const result = extractProductCapture(
      { document: page('<html><body></body></html>'), url: 'https://shop.example/p' },
      { extractors: [low, high], now: () => new Date(OBSERVED_AT) },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.capture.product.title).toBe('High');
  });
});

describe('extractProductCapture — resilience', () => {
  it('still produces a capture when an extractor throws', () => {
    const broken = stubExtractor('broken', 100, () => {
      throw new Error('selector blew up');
    });
    const working = stubExtractor('working', 1, {
      product: { title: 'Saved anyway' },
      evidence: [evidence('product.title', 'dom', 0.5)],
    });

    const result = extractProductCapture(
      { document: page('<html><body></body></html>'), url: 'https://shop.example/p' },
      { extractors: [broken, working], now: () => new Date(OBSERVED_AT) },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.capture.product.title).toBe('Saved anyway');
  });

  it('reports the failure rather than swallowing it', () => {
    const broken = stubExtractor('broken', 100, () => {
      throw new Error('selector blew up');
    });

    const result = extractProductCapture(
      { document: page('<html><body></body></html>'), url: 'https://shop.example/p' },
      { extractors: [broken], now: () => new Date(OBSERVED_AT) },
    );

    // A crash that looks like an empty page is how a silently broken extractor survives.
    expect(result.extractorFailures).toEqual([
      { extractorId: 'broken', phase: 'extract', message: 'selector blew up' },
    ]);
  });

  it('records a failure in supports() too', () => {
    const broken: ProductExtractor = {
      id: 'broken-supports',
      version: '1.0.0',
      priority: 100,
      supports: () => {
        throw new Error('bad query');
      },
      extract: () => ({ evidence: [] }),
    };

    const result = extractProductCapture(
      { document: page('<html><body></body></html>'), url: 'https://shop.example/p' },
      { extractors: [broken], now: () => new Date(OBSERVED_AT) },
    );

    expect(result.extractorFailures).toEqual([
      { extractorId: 'broken-supports', phase: 'supports', message: 'bad query' },
    ]);
  });
});

describe('fieldsNeedingReview', () => {
  function captureFrom(html: string) {
    const result = run(html);
    if (!result.ok) throw new Error(result.issues.join('; '));
    return result.capture;
  }

  it('asks about a missing title and price', () => {
    const capture = captureFrom('<html><head><title>T</title></head><body></body></html>');
    expect(fieldsNeedingReview(capture)).toEqual(['product.title', 'offer.priceAmount']);
  });

  it('asks about nothing when structured data was confident', () => {
    const capture = captureFrom(`<!doctype html><html><head><title>T</title>
      <script type="application/ld+json">
        {"@type":"Product","name":"A lamp","offers":{"price":"10.00","priceCurrency":"USD"}}
      </script></head><body></body></html>`);

    expect(fieldsNeedingReview(capture)).toEqual([]);
  });

  it('asks about a price found only by DOM guessing', () => {
    const capture = captureFrom(`<!doctype html><html><head><title>T</title></head><body>
      <h1 class="product-title">A lamp</h1>
      <div class="sale-price">$10.00</div>
    </body></html>`);

    expect(fieldsNeedingReview(capture)).toContain('offer.priceAmount');
  });

  it('asks about a price with no currency', () => {
    const capture = captureFrom(`<!doctype html><html><head><title>T</title>
      <script type="application/ld+json">
        {"@type":"Product","name":"A lamp","offers":{"price":"10.00"}}
      </script></head><body></body></html>`);

    expect(fieldsNeedingReview(capture)).toEqual(['offer.currency']);
  });
});
