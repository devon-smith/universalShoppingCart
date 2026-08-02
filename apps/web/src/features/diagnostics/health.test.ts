import { describe, expect, it } from 'vitest';

import type { DiagnosticItem } from './health';
import { failureClass, fieldPresence, summarizeByDomain } from './health';

function item(overrides: Partial<DiagnosticItem> = {}): DiagnosticItem {
  return {
    domain: 'shop.example',
    extractor_id: 'shopify',
    extractor_version: '1.0.0',
    extraction_confidence: 0.95,
    title: 'A product',
    current_price: '98.00',
    currency: 'USD',
    image_url: 'https://cdn.example/a.jpg',
    availability: 'in_stock',
    selected_variant: { Size: '41' },
    identifiers: { sku: 'A-1' },
    last_observed_at: '2026-07-26T12:00:00.000Z',
    ...overrides,
  };
}

describe('fieldPresence', () => {
  it('reports a complete capture', () => {
    expect(fieldPresence(item())).toEqual({
      title: true,
      price: true,
      currency: true,
      image: true,
      availability: true,
      variant: true,
      identifier: true,
    });
  });

  it('treats unknown availability and empty objects as absent', () => {
    const sparse = fieldPresence(
      item({ availability: 'unknown', selected_variant: {}, identifiers: {}, current_price: null }),
    );

    expect(sparse.availability).toBe(false);
    expect(sparse.variant).toBe(false);
    expect(sparse.identifier).toBe(false);
    expect(sparse.price).toBe(false);
  });

  it('does not count a blank title as a title', () => {
    expect(fieldPresence(item({ title: '   ' })).title).toBe(false);
  });
});

describe('failureClass', () => {
  it('reports the worst problem, not all of them', () => {
    expect(failureClass(item({ current_price: null, extraction_confidence: 0.1 }))).toBe(
      'no_price',
    );
  });

  it('names each class', () => {
    expect(failureClass(item())).toBe('ok');
    expect(failureClass(item({ current_price: null }))).toBe('no_price');
    expect(failureClass(item({ currency: null }))).toBe('no_currency');
    expect(failureClass(item({ extraction_confidence: 0.4 }))).toBe('low_confidence');
    expect(failureClass(item({ extractor_id: 'generic' }))).toBe('generic_fallback');
    expect(failureClass(item({ extractor_id: null }))).toBe('generic_fallback');
  });

  it('does not call a missing confidence low', () => {
    expect(failureClass(item({ extraction_confidence: null }))).toBe('ok');
  });
});

describe('summarizeByDomain', () => {
  it('groups by domain and counts each extractor version', () => {
    const summaries = summarizeByDomain([
      item({ domain: 'a.example' }),
      item({ domain: 'a.example', extractor_version: '1.1.0' }),
      item({ domain: 'a.example', extractor_version: '1.1.0' }),
      item({ domain: 'b.example', extractor_id: 'generic' }),
    ]);

    const a = summaries.find((summary) => summary.domain === 'a.example')!;
    expect(a.items).toBe(3);
    expect(a.extractors).toEqual([
      { id: 'shopify', version: '1.1.0', count: 2 },
      { id: 'shopify', version: '1.0.0', count: 1 },
    ]);
  });

  it('sorts the domains that are failing to the top', () => {
    const summaries = summarizeByDomain([
      item({ domain: 'healthy.example' }),
      item({ domain: 'healthy.example' }),
      item({ domain: 'broken.example', current_price: null }),
      item({ domain: 'broken.example', current_price: null }),
    ]);

    expect(summaries.map((summary) => summary.domain)).toEqual([
      'broken.example',
      'healthy.example',
    ]);
    expect(summaries[0]?.classes.no_price).toBe(2);
  });

  it('reports field presence as a share', () => {
    const [summary] = summarizeByDomain([item(), item({ image_url: null })]);
    expect(summary?.presence.image).toBe(0.5);
    expect(summary?.presence.title).toBe(1);
  });

  it('averages only the confidences that were recorded', () => {
    const [summary] = summarizeByDomain([
      item({ extraction_confidence: 0.9 }),
      item({ extraction_confidence: 0.7 }),
      item({ extraction_confidence: null }),
    ]);

    expect(summary?.meanConfidence).toBeCloseTo(0.8, 10);
  });

  it('has no confidence to report when none was recorded', () => {
    const [summary] = summarizeByDomain([item({ extraction_confidence: null })]);
    expect(summary?.meanConfidence).toBeNull();
  });

  it('reports the newest observation on the domain', () => {
    const [summary] = summarizeByDomain([
      item({ last_observed_at: '2026-07-20T00:00:00.000Z' }),
      item({ last_observed_at: '2026-07-25T00:00:00.000Z' }),
      item({ last_observed_at: null }),
    ]);

    expect(summary?.lastObservedAt).toBe('2026-07-25T00:00:00.000Z');
  });

  it('is empty for no items', () => {
    expect(summarizeByDomain([])).toEqual([]);
  });
});
