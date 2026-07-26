import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ProductCaptureV1 } from '@universal-cart/contracts';
import { describe, expect, it } from 'vitest';

import { extractProductCapture } from '../../core/pipeline';

/**
 * Retailer-adapter fixture regression suite (BUILD_PLAN.md §18.2).
 *
 * Two sanitized fixtures per adapter, each paired with the exact capture the pipeline must
 * produce. The pages are reduced to the DOM the adapter reads — they are regression tests,
 * not archives — and every host is a synthetic `.example` retailer.
 */

const here = dirname(fileURLToPath(import.meta.url));
const OBSERVED_AT = '2026-07-26T12:00:00.000Z';

interface Fixture {
  name: string;
  file: string;
  url: string;
  /** The adapter that must claim the page and be recorded against the observation. */
  adapter: string;
}

export const ADAPTER_FIXTURES: Fixture[] = [
  {
    name: 'Shopify — the variant in the URL, not the default one',
    file: 'shopify-variant-selected.html',
    url: 'https://shop.northwind.example/products/meridian-wool-runner?variant=4400220002',
    adapter: 'shopify',
  },
  {
    name: 'Shopify — first variant sold out, so the shown one is the second',
    file: 'shopify-sold-out-default.html',
    url: 'https://shop.northwind.example/products/harbour-enamel-mug',
    adapter: 'shopify',
  },
  {
    name: 'WooCommerce — variable product matched against the variation matrix',
    file: 'woocommerce-variable.html',
    url: 'https://fieldcraft.example/product/alder-cutting-board',
    adapter: 'woocommerce',
  },
  {
    name: 'WooCommerce — simple product on sale',
    file: 'woocommerce-simple-sale.html',
    url: 'https://fieldcraft.example/product/beeswax-wrap-set',
    adapter: 'woocommerce',
  },
  {
    name: 'Magento — configurable product with swatches and a European price format',
    file: 'magento-configurable.html',
    url: 'https://bergsport.example/alpenrose-daunenjacke.html',
    adapter: 'magento',
  },
  {
    name: 'Magento — out of stock, no sale price, no options',
    file: 'magento-out-of-stock.html',
    url: 'https://harbourkitchen.example/tidewater-skillet.html',
    adapter: 'magento',
  },
  {
    name: 'BigCommerce — checked swatch and a chosen dropdown',
    file: 'bigcommerce-swatch.html',
    url: 'https://lumenworks.example/solstice-desk-lamp/',
    adapter: 'bigcommerce',
  },
  {
    name: 'BigCommerce — stock only inferable from a disabled add-to-cart button',
    file: 'bigcommerce-unavailable.html',
    url: 'https://lumenworks.example/cirrus-floor-lamp/',
    adapter: 'bigcommerce',
  },
  {
    name: 'Salesforce Commerce Cloud — selected colour and size, sale price',
    file: 'sfcc-variation-selected.html',
    url: 'https://www.fieldcraft.example/kestrel-rain-shell.html',
    adapter: 'salesforce-commerce-cloud',
  },
  {
    name: 'Salesforce Commerce Cloud — size dropdown on a Demandware pipeline URL',
    file: 'sfcc-size-select.html',
    url: 'https://www.fieldcraft.example/on/demandware.store/Sites-fc-Site/en_CA/Product-Show?pid=TMS-0091-GRY',
    adapter: 'salesforce-commerce-cloud',
  },
];

export function documentFor(file: string): Document {
  const html = readFileSync(resolve(here, file), 'utf8');
  return new DOMParser().parseFromString(html, 'text/html');
}

function captureFor(fixture: Fixture): ProductCaptureV1 {
  const result = extractProductCapture(
    { document: documentFor(fixture.file), url: fixture.url },
    { now: () => new Date(OBSERVED_AT) },
  );

  if (!result.ok) {
    throw new Error(`${fixture.file} failed validation: ${result.issues.join('; ')}`);
  }
  return result.capture;
}

function expectedFor(fixture: Fixture): ProductCaptureV1 {
  const path = resolve(here, fixture.file.replace(/\.html$/, '.expected.json'));
  return JSON.parse(readFileSync(path, 'utf8')) as ProductCaptureV1;
}

describe('adapter fixture captures', () => {
  for (const fixture of ADAPTER_FIXTURES) {
    it(`matches the expected capture — ${fixture.name}`, () => {
      const actual = captureFor(fixture);
      const expected = expectedFor(fixture);

      // Evidence ordering depends on extractor priority, which is asserted separately.
      expect({ ...actual, evidence: undefined }).toEqual({ ...expected, evidence: undefined });
      expect([...actual.evidence].sort(compareEvidence)).toEqual(
        [...expected.evidence].sort(compareEvidence),
      );
    });

    it(`records the adapter and its version — ${fixture.name}`, () => {
      const result = extractProductCapture(
        { document: documentFor(fixture.file), url: fixture.url },
        { now: () => new Date(OBSERVED_AT) },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.matchedAdapters).toContain(fixture.adapter);
      expect(result.contributors).toContain(fixture.adapter);
      expect(result.capture.extraction.extractorId).toBe(fixture.adapter);
      expect(result.capture.extraction.extractorVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(result.extractorFailures).toEqual([]);
    });

    it(`states every field it claims — ${fixture.name}`, () => {
      const capture = captureFor(fixture);

      // Nothing is asserted about *which* fields are present; the point is that every
      // present field is backed by evidence and every absent one is explicitly absent.
      if (capture.product.title !== null) {
        expect(capture.evidence.some((item) => item.field === 'product.title')).toBe(true);
      }
      if (capture.offer.priceAmount !== null) {
        expect(capture.evidence.some((item) => item.field === 'offer.priceAmount')).toBe(true);
        expect(capture.offer.priceAmount).toMatch(/^\d+\.\d+$/);
      }
      if (capture.offer.originalPriceAmount !== null) {
        expect(capture.offer.originalPriceAmount).not.toBe(capture.offer.priceAmount);
      }
    });
  }
});

function compareEvidence(
  a: ProductCaptureV1['evidence'][number],
  b: ProductCaptureV1['evidence'][number],
): number {
  return (
    a.field.localeCompare(b.field) ||
    a.source.localeCompare(b.source) ||
    a.confidence - b.confidence ||
    (a.selector ?? '').localeCompare(b.selector ?? '')
  );
}
