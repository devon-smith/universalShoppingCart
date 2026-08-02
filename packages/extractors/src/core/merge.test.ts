import type { PartialCapture } from '@universal-cart/contracts';
import { describe, expect, it } from 'vitest';

import { mergeCaptures, overallConfidence } from './merge';
import { evidence } from './types';

describe('mergeCaptures — source precedence', () => {
  it('prefers structured data over meta tags', () => {
    const meta: PartialCapture = {
      product: { title: 'From meta' },
      evidence: [evidence('product.title', 'meta', 0.9)],
    };
    const jsonLd: PartialCapture = {
      product: { title: 'From JSON-LD' },
      evidence: [evidence('product.title', 'json_ld', 0.7)],
    };

    // Rank beats confidence: a confident guess is still a guess.
    expect(mergeCaptures([meta, jsonLd]).capture.product?.title).toBe('From JSON-LD');
  });

  it('prefers an adapter over structured data', () => {
    const jsonLd: PartialCapture = {
      offer: { priceAmount: '10.00' },
      evidence: [evidence('offer.priceAmount', 'json_ld', 0.95)],
    };
    const adapter: PartialCapture = {
      offer: { priceAmount: '8.00' },
      evidence: [evidence('offer.priceAmount', 'adapter', 0.6)],
    };

    expect(mergeCaptures([jsonLd, adapter]).capture.offer?.priceAmount).toBe('8.00');
  });

  it('lets a user correction win over everything', () => {
    const adapter: PartialCapture = {
      product: { title: 'Adapter title' },
      evidence: [evidence('product.title', 'adapter', 1)],
    };
    const user: PartialCapture = {
      product: { title: 'What the human typed' },
      evidence: [evidence('product.title', 'user', 0.5)],
    };

    expect(mergeCaptures([adapter, user]).capture.product?.title).toBe('What the human typed');
  });

  it('breaks a same-source tie on confidence', () => {
    const low: PartialCapture = {
      product: { title: 'Low' },
      evidence: [evidence('product.title', 'dom', 0.3)],
    };
    const high: PartialCapture = {
      product: { title: 'High' },
      evidence: [evidence('product.title', 'dom', 0.8)],
    };

    expect(mergeCaptures([low, high]).capture.product?.title).toBe('High');
    expect(mergeCaptures([high, low]).capture.product?.title).toBe('High');
  });

  it('keeps the first candidate when rank and confidence are equal', () => {
    const first: PartialCapture = {
      product: { title: 'First' },
      evidence: [evidence('product.title', 'dom', 0.5)],
    };
    const second: PartialCapture = {
      product: { title: 'Second' },
      evidence: [evidence('product.title', 'dom', 0.5)],
    };

    expect(mergeCaptures([first, second]).capture.product?.title).toBe('First');
  });
});

describe('mergeCaptures — empty values', () => {
  it('does not let a null from a trusted source erase a real value', () => {
    const jsonLd: PartialCapture = {
      product: { title: null },
      evidence: [evidence('product.title', 'json_ld', 1)],
    };
    const dom: PartialCapture = {
      product: { title: 'Real title' },
      evidence: [evidence('product.title', 'dom', 0.4)],
    };

    expect(mergeCaptures([jsonLd, dom]).capture.product?.title).toBe('Real title');
  });

  it('ignores empty arrays and objects', () => {
    const empty: PartialCapture = {
      product: { imageUrls: [] },
      evidence: [evidence('product.imageUrls', 'json_ld', 1)],
    };
    const real: PartialCapture = {
      product: { imageUrls: ['https://cdn.example.com/1.jpg'] },
      evidence: [evidence('product.imageUrls', 'meta', 0.5)],
    };

    expect(mergeCaptures([empty, real]).capture.product?.imageUrls).toEqual([
      'https://cdn.example.com/1.jpg',
    ]);
  });

  it('leaves a field absent when nobody claimed it', () => {
    const merged = mergeCaptures([{ evidence: [] }]);
    expect(merged.capture.product).toBeUndefined();
    expect(merged.winners.size).toBe(0);
  });

  it('ignores a value set without evidence', () => {
    const silent: PartialCapture = { product: { title: 'Unsupported' }, evidence: [] };
    expect(mergeCaptures([silent]).capture.product).toBeUndefined();
  });
});

describe('mergeCaptures — evidence', () => {
  it('keeps losing evidence so disagreements stay visible', () => {
    const a: PartialCapture = {
      offer: { priceAmount: '10.00' },
      evidence: [evidence('offer.priceAmount', 'dom', 0.4, '.price')],
    };
    const b: PartialCapture = {
      offer: { priceAmount: '12.00' },
      evidence: [evidence('offer.priceAmount', 'json_ld', 0.9)],
    };

    const merged = mergeCaptures([a, b]);
    expect(merged.capture.offer?.priceAmount).toBe('12.00');
    expect(merged.capture.evidence).toHaveLength(2);
    expect(merged.capture.evidence.map((item) => item.source).sort()).toEqual(['dom', 'json_ld']);
  });

  it('reports which evidence won each field', () => {
    const merged = mergeCaptures([
      {
        product: { title: 'T' },
        offer: { priceAmount: '1.00' },
        evidence: [
          evidence('product.title', 'json_ld', 0.9),
          evidence('offer.priceAmount', 'meta', 0.6),
        ],
      },
    ]);

    expect(merged.winners.get('product.title')?.source).toBe('json_ld');
    expect(merged.winners.get('offer.priceAmount')?.source).toBe('meta');
  });
});

describe('overallConfidence', () => {
  it('is zero when nothing was found', () => {
    expect(overallConfidence(new Map())).toBe(0);
  });

  it('is one when every weighted field is certain', () => {
    const { winners } = mergeCaptures([
      {
        product: { title: 'T', selectedImageUrl: 'https://cdn.example.com/1.jpg' },
        offer: { priceAmount: '1.00', currency: 'USD', availability: 'in_stock' },
        evidence: [
          evidence('product.title', 'json_ld', 1),
          evidence('product.selectedImageUrl', 'json_ld', 1),
          evidence('offer.priceAmount', 'json_ld', 1),
          evidence('offer.currency', 'json_ld', 1),
          evidence('offer.availability', 'json_ld', 1),
        ],
      },
    ]);

    expect(overallConfidence(winners)).toBe(1);
  });

  it('drops sharply when the price is missing', () => {
    const { winners } = mergeCaptures([
      {
        product: { title: 'T' },
        evidence: [evidence('product.title', 'json_ld', 1)],
      },
    ]);

    // Title alone carries 3 of 9 weight.
    expect(overallConfidence(winners)).toBeCloseTo(0.333, 3);
  });

  it('weights a title-and-price capture above a description-only one', () => {
    const withPrice = mergeCaptures([
      {
        product: { title: 'T' },
        offer: { priceAmount: '1.00' },
        evidence: [
          evidence('product.title', 'json_ld', 1),
          evidence('offer.priceAmount', 'json_ld', 1),
        ],
      },
    ]);
    const withoutPrice = mergeCaptures([
      {
        product: { description: 'A very good description' },
        evidence: [evidence('product.description', 'json_ld', 1)],
      },
    ]);

    expect(overallConfidence(withPrice.winners)).toBeGreaterThan(
      overallConfidence(withoutPrice.winners),
    );
  });
});

describe('mergeCaptures — disagreement lowers confidence', () => {
  const priceFrom = (
    source: 'json_ld' | 'dom' | 'meta' | 'adapter',
    amount: string,
    confidence: number,
  ) => ({
    offer: { priceAmount: amount },
    evidence: [evidence('offer.priceAmount', source, confidence)],
  });

  it('keeps the higher-ranked value but stops trusting it', () => {
    // StockX publishes 76 in JSON-LD and renders 78. Structured data is evidence, not
    // absolute truth (BUILD_PLAN.md §10.3) — a rendered page contradicting it is precisely
    // the evidence that it is stale.
    const { capture, winners } = mergeCaptures([
      priceFrom('json_ld', '76.00', 0.9),
      priceFrom('dom', '78.00', 0.5),
    ]);

    expect(capture.offer?.priceAmount).toBe('76.00');
    expect(winners.get('offer.priceAmount')!.confidence).toBeLessThan(0.6);
  });

  it('records what each source claimed, so diagnostics can show the argument', () => {
    const { capture } = mergeCaptures([
      priceFrom('json_ld', '76.00', 0.9),
      priceFrom('dom', '78.00', 0.5),
    ]);

    const claims = capture.evidence
      .filter((item) => item.field === 'offer.priceAmount')
      .map((item) => `${item.source}=${item.value}`);

    expect(claims).toEqual(['json_ld=76.00', 'dom=78.00']);
  });

  it('says nothing when the sources agree', () => {
    const { capture, winners } = mergeCaptures([
      priceFrom('json_ld', '76.00', 0.9),
      priceFrom('dom', '76.00', 0.5),
    ]);

    expect(winners.get('offer.priceAmount')!.confidence).toBe(0.9);
    expect(capture.evidence.every((item) => item.value === undefined)).toBe(true);
  });

  it('does not treat one layer being imprecise as a contradiction', () => {
    // Two DOM heuristics differing is a weak layer, not two witnesses disagreeing.
    const { winners } = mergeCaptures([
      { offer: { priceAmount: '10.00' }, evidence: [evidence('offer.priceAmount', 'dom', 0.5)] },
      { offer: { priceAmount: '12.00' }, evidence: [evidence('offer.priceAmount', 'dom', 0.4)] },
    ]);

    expect(winners.get('offer.priceAmount')!.confidence).toBe(0.5);
  });

  it('never second-guesses a value the user supplied', () => {
    const { capture, winners } = mergeCaptures([
      { offer: { priceAmount: '99.00' }, evidence: [evidence('offer.priceAmount', 'user', 1)] },
      priceFrom('json_ld', '76.00', 0.9),
    ]);

    expect(capture.offer?.priceAmount).toBe('99.00');
    expect(winners.get('offer.priceAmount')!.confidence).toBe(1);
  });

  it('leaves free-text fields alone, so the warning stays meaningful', () => {
    // JSON-LD's name and the <h1> differ on most pages as a matter of punctuation. Flagging
    // that would put a warning on nearly every capture and teach the user to dismiss them.
    const { winners } = mergeCaptures([
      {
        product: { title: 'Nike Dunk Low Retro' },
        evidence: [evidence('product.title', 'json_ld', 0.95)],
      },
      {
        product: { title: "Nike Dunk Low Retro Men's Shoes" },
        evidence: [evidence('product.title', 'dom', 0.45)],
      },
    ]);

    expect(winners.get('product.title')!.confidence).toBe(0.95);
  });
});
