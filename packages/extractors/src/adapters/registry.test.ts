import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { extractProductCapture, GENERIC_PIPELINE_ID } from '../core/pipeline';
import type { ExtractionContext, ProductExtractor } from '../core/types';
import { evidence } from '../core/types';
import { jsonLdExtractor } from '../generic/json-ld';

import { adapterDescriptors, adaptersFor, RETAILER_ADAPTERS } from './registry';

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/adapters');

function contextFor(file: string, url: string): ExtractionContext {
  const html = readFileSync(resolve(fixtures, file), 'utf8');
  return { document: new DOMParser().parseFromString(html, 'text/html'), url };
}

describe('the registry itself', () => {
  it('gives every adapter a unique id and an explicit version', () => {
    const ids = RETAILER_ADAPTERS.map((adapter) => adapter.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const adapter of RETAILER_ADAPTERS) {
      expect(adapter.version, adapter.id).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('ranks every adapter above the generic extractors', () => {
    for (const adapter of RETAILER_ADAPTERS) {
      expect(adapter.priority, adapter.id).toBeGreaterThan(jsonLdExtractor.priority);
    }
  });

  it('describes itself as plain data', () => {
    expect(adapterDescriptors()).toEqual(
      RETAILER_ADAPTERS.map((adapter) => ({
        id: adapter.id,
        version: adapter.version,
        priority: adapter.priority,
      })),
    );
  });
});

describe('supports()', () => {
  const pages: Array<{ file: string; url: string; adapter: string }> = [
    {
      file: 'shopify-variant-selected.html',
      url: 'https://shop.northwind.example/products/meridian-wool-runner?variant=4400220002',
      adapter: 'shopify',
    },
    {
      file: 'woocommerce-variable.html',
      url: 'https://fieldcraft.example/product/alder-cutting-board',
      adapter: 'woocommerce',
    },
    {
      file: 'magento-configurable.html',
      url: 'https://bergsport.example/alpenrose-daunenjacke.html',
      adapter: 'magento',
    },
    {
      file: 'bigcommerce-swatch.html',
      url: 'https://lumenworks.example/solstice-desk-lamp/',
      adapter: 'bigcommerce',
    },
    {
      file: 'sfcc-variation-selected.html',
      url: 'https://www.fieldcraft.example/kestrel-rain-shell.html',
      adapter: 'salesforce-commerce-cloud',
    },
  ];

  for (const page of pages) {
    it(`claims a ${page.adapter} page and no other adapter does`, () => {
      const claimed = adaptersFor(contextFor(page.file, page.url)).map((adapter) => adapter.id);
      expect(claimed).toEqual([page.adapter]);
    });
  }

  it('claims none of the generic fixtures', () => {
    const generic = resolve(fixtures, '..');
    for (const file of ['json-ld-complete.html', 'meta-only.html', 'dom-only.html']) {
      const html = readFileSync(resolve(generic, file), 'utf8');
      const context: ExtractionContext = {
        document: new DOMParser().parseFromString(html, 'text/html'),
        url: 'https://shop.example/p/1',
      };
      expect(
        adaptersFor(context).map((adapter) => adapter.id),
        file,
      ).toEqual([]);
    }
  });
});

/** A minimal page that no adapter claims, so the generic layers are the only contributors. */
const PLAIN_PAGE = `
  <html><head><title>A product</title>
  <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Product","name":"A product",
     "offers":{"@type":"Offer","price":"12.00","priceCurrency":"USD"}}
  </script></head><body></body></html>`;

function plainContext(): ExtractionContext {
  return {
    document: new DOMParser().parseFromString(PLAIN_PAGE, 'text/html'),
    url: 'https://shop.example/p/1',
  };
}

function brokenAdapter(phase: 'supports' | 'extract'): ProductExtractor {
  return {
    id: 'broken',
    version: '9.9.9',
    priority: 99,
    supports() {
      if (phase === 'supports') throw new Error('selector engine exploded');
      return true;
    },
    extract() {
      throw new Error('selectors have rotted');
    },
  };
}

describe('an adapter never takes the capture down with it', () => {
  it('falls back to the generic result when extract() throws', () => {
    const result = extractProductCapture(plainContext(), {
      extractors: [brokenAdapter('extract'), jsonLdExtractor],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The page still saved, from structured data.
    expect(result.capture.product.title).toBe('A product');
    expect(result.capture.offer.priceAmount).toBe('12.00');

    // And the crash is visible rather than looking like an empty page.
    expect(result.extractorFailures).toEqual([
      { extractorId: 'broken', phase: 'extract', message: 'selectors have rotted' },
    ]);
  });

  it('falls back when supports() throws', () => {
    const result = extractProductCapture(plainContext(), {
      extractors: [brokenAdapter('supports'), jsonLdExtractor],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.capture.product.title).toBe('A product');
    expect(result.extractorFailures[0]?.phase).toBe('supports');
  });

  it('records the generic pipeline when an adapter matched but found nothing', () => {
    // Rotted selectors: the platform is still detected, the fields are all gone.
    const silent: ProductExtractor = {
      id: 'silent',
      version: '1.0.0',
      priority: 99,
      supports: () => true,
      extract: () => ({ evidence: [] }),
    };

    const result = extractProductCapture(plainContext(), {
      extractors: [silent, jsonLdExtractor],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.contributors).not.toContain('silent');
    // `silent` is not in the registry, so it is not reported as a matched *adapter* — but
    // the version recorded is the generic pipeline's, which is the load-bearing part.
    expect(result.capture.extraction.extractorId).toBe(GENERIC_PIPELINE_ID);
  });
});

describe('adapter claims outrank structured data', () => {
  it('takes the adapter price over the JSON-LD price', () => {
    const adapter: ProductExtractor = {
      id: 'test-adapter',
      version: '1.0.0',
      priority: 99,
      supports: () => true,
      extract: () => ({
        offer: { priceAmount: '99.00' },
        evidence: [evidence('offer.priceAmount', 'adapter', 0.5)],
      }),
    };

    const result = extractProductCapture(plainContext(), {
      extractors: [adapter, jsonLdExtractor],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Note the adapter's confidence is *lower* than JSON-LD's. Source rank decides first:
    // an adapter was written against this page, structured data was written for everyone.
    expect(result.capture.offer.priceAmount).toBe('99.00');
  });
});
