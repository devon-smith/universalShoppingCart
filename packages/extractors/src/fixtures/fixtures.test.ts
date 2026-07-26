import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ProductCaptureV1 } from '@universal-cart/contracts';
import { describe, expect, it } from 'vitest';

import { extractProductCapture } from '../core/pipeline';

/**
 * Fixture regression suite.
 *
 * Each fixture is a sanitized HTML page paired with the exact capture the pipeline must
 * produce. `observedAt` is pinned so the comparison is on extraction, not on the clock.
 */

const here = dirname(fileURLToPath(import.meta.url));
const OBSERVED_AT = '2026-07-26T12:00:00.000Z';

interface Fixture {
  name: string;
  file: string;
  url: string;
}

const FIXTURES: Fixture[] = [
  {
    name: 'JSON-LD with a single offer',
    file: 'json-ld-complete.html',
    url: 'https://shop.northwind.example/products/meridian-wool-runner?utm_source=newsletter',
  },
  {
    name: 'JSON-LD @graph with multiple offers and a sale price',
    file: 'json-ld-graph-offers.html',
    url: 'https://www.bergsport.example/p/alpenrose-daunenjacke',
  },
  {
    name: 'JSON-LD AggregateOffer',
    file: 'json-ld-aggregate.html',
    url: 'https://harbourkitchen.example/p/tidewater-skillet',
  },
  {
    name: 'Open Graph and product meta only',
    file: 'meta-only.html',
    url: 'https://fieldcraft.example/shop/kestrel-rain-shell',
  },
  {
    name: 'DOM heuristics only',
    file: 'dom-only.html',
    url: 'https://lumenworks.example/lamps/solstice?color=brass',
  },
  {
    name: 'nothing extractable',
    file: 'sparse.html',
    url: 'https://catalogue.example/page',
  },
];

function captureFor(fixture: Fixture): ProductCaptureV1 {
  const html = readFileSync(resolve(here, fixture.file), 'utf8');
  const document = new DOMParser().parseFromString(html, 'text/html');

  const result = extractProductCapture(
    { document, url: fixture.url },
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

describe('fixture captures', () => {
  for (const fixture of FIXTURES) {
    it(`matches the expected capture — ${fixture.name}`, () => {
      const actual = captureFor(fixture);
      const expected = expectedFor(fixture);

      // Evidence ordering depends on extractor priority, which is asserted separately.
      expect({ ...actual, evidence: undefined }).toEqual({ ...expected, evidence: undefined });
      expect([...actual.evidence].sort(compareEvidence)).toEqual(
        [...expected.evidence].sort(compareEvidence),
      );
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
