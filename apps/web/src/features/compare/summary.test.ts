import { describe, expect, it } from 'vitest';

import type { CompareInput, CompareItem } from './compare';
import { compareItems } from './compare';
import {
  buildComparisonFacts,
  buildSummaryMessages,
  factsFingerprintInput,
  summarySchema,
  SUMMARY_MODEL,
  SUMMARY_PROMPT_VERSION,
  validItemRefs,
} from './summary';

/** A minimal saved item; overrides fill in the fields a given test cares about. */
function item(overrides: Partial<CompareItem>): CompareItem {
  return {
    id: overrides.id ?? '00000000-0000-4000-8000-000000000001',
    cart_id: 'cart-1',
    title: 'A jacket',
    brand: null,
    description: null,
    retailer_name: 'Shop',
    domain: 'shop.example',
    source_url: 'https://shop.example/p/1',
    canonical_url: 'https://shop.example/p/1',
    image_url: null,
    currency: 'USD',
    current_price: null,
    original_price: null,
    availability: 'in_stock',
    product_availability: null,
    selected_variant: {},
    identifiers: {},
    note: null,
    quantity: 1,
    priority: 'normal',
    desired_price: null,
    status: 'saved',
    last_observed_at: null,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    composition: null,
    ...overrides,
  } as CompareItem;
}

function facts(items: CompareItem[]) {
  const inputs: CompareInput[] = items.map((it) => ({ item: it, summary: null }));
  return buildComparisonFacts(compareItems(inputs));
}

describe('buildComparisonFacts', () => {
  it('reduces a comparison to grounded facts with per-item values in order', () => {
    const f = facts([
      item({ id: 'a', title: 'Blue parka', current_price: '120.00', retailer_name: 'Alpha' }),
      item({ id: 'b', title: 'Red parka', current_price: '99.00', retailer_name: 'Beta' }),
    ]);

    expect(f.items).toEqual([
      { id: 'a', ref: 'Item 1', title: 'Blue parka' },
      { id: 'b', ref: 'Item 2', title: 'Red parka' },
    ]);

    const price = f.facts.find((row) => row.key === 'price');
    expect(price).toBeDefined();
    expect(price!.comparable).toBe(true);
    // Currency rides with the amount so the model is never handed a bare number.
    expect(price!.values).toEqual(['120.00 USD', '99.00 USD']);
  });

  it('carries currency into money values so the model does not invent a currency gap', () => {
    // The exact live failure: three USD prices reached the model as bare numbers, and it
    // reported "no currency stated" in the authoritative gaps callout — an invented gap.
    const f = facts([
      item({ id: 'a', title: 'A', current_price: '84.00', currency: 'USD' }),
      item({ id: 'b', title: 'B', current_price: '189.00', currency: 'USD' }),
      item({ id: 'c', title: 'C', current_price: '242.50', currency: 'USD' }),
    ]);

    const price = f.facts.find((row) => row.key === 'price')!;
    expect(price.values).toEqual(['84.00 USD', '189.00 USD', '242.50 USD']);

    // The currency is present on every price, so nothing about currency is a gap.
    expect(f.missing.join(' ')).not.toMatch(/currency/i);
    const { user } = buildSummaryMessages(f);
    expect(user).toContain('84.00 USD');
  });

  it('never sends page HTML, cookies, or derived rows — only stored fields', () => {
    const f = facts([
      item({ id: 'a', current_price: '10.00', original_price: '20.00' }),
      item({ id: 'b', current_price: '12.00' }),
    ]);
    // The image row and the derived "Was"/price-change rows are omitted from the facts.
    const keys = f.facts.map((row) => row.key);
    expect(keys).not.toContain('image');
    expect(keys).not.toContain('original');
    expect(keys).not.toContain('price-change');
  });

  it('names every missing field rather than hiding it', () => {
    const f = facts([
      item({ id: 'a', current_price: '50.00' }),
      item({ id: 'b', current_price: null }), // no price
    ]);
    expect(f.missing).toContain('Item 2 has no listed price.');
  });

  it('marks variant rows as non-comparable so no agreement can be claimed', () => {
    const f = facts([
      item({ id: 'a', selected_variant: { Size: 'M' } }),
      item({ id: 'b', selected_variant: { Size: 'M' } }),
    ]);
    const size = f.facts.find((row) => row.key === 'variant.Size');
    expect(size).toBeDefined();
    expect(size!.comparable).toBe(false);
    expect(size!.values).toEqual(['M', 'M']);
  });

  it('marks retailer and price as comparable', () => {
    const f = facts([
      item({ id: 'a', current_price: '10.00', retailer_name: 'Alpha' }),
      item({ id: 'b', current_price: '12.00', retailer_name: 'Beta' }),
    ]);
    expect(f.facts.find((r) => r.key === 'price')!.comparable).toBe(true);
    expect(f.facts.find((r) => r.key === 'retailer')!.comparable).toBe(true);
  });

  it('carries the mixed-currency flag through', () => {
    const f = facts([
      item({ id: 'a', current_price: '10.00', currency: 'USD' }),
      item({ id: 'b', current_price: '12.00', currency: 'EUR' }),
    ]);
    expect(f.mixedCurrency).toBe(true);
  });
});

describe('buildSummaryMessages', () => {
  it('renders facts deterministically and forbids invention in the system prompt', () => {
    const f = facts([
      item({ id: 'a', title: 'Blue parka', current_price: '120.00' }),
      item({ id: 'b', title: 'Red parka', current_price: '99.00' }),
    ]);
    const first = buildSummaryMessages(f);
    const second = buildSummaryMessages(f);
    expect(first).toEqual(second); // deterministic

    expect(first.system).toMatch(/only the provided facts/i);
    expect(first.system).toMatch(/never invent/i);
    expect(first.user).toContain('Item 1: Blue parka');
    expect(first.user).toContain('Item 1=120.00');
  });

  it('flags a missing value as (missing) and lists it under known gaps', () => {
    const f = facts([
      item({ id: 'a', current_price: '50.00' }),
      item({ id: 'b', current_price: null }),
    ]);
    const { user } = buildSummaryMessages(f);
    expect(user).toContain('Item 2=(missing)');
    expect(user).toContain('Known gaps:');
    expect(user).toContain('Item 2 has no listed price.');
  });

  it('tells the model not to rank prices across currencies', () => {
    const f = facts([
      item({ id: 'a', current_price: '10.00', currency: 'USD' }),
      item({ id: 'b', current_price: '12.00', currency: 'EUR' }),
    ]);
    const { user } = buildSummaryMessages(f);
    expect(user).toMatch(/different currencies; do not rank prices/i);
  });

  it('labels non-comparable rows as descriptive in the prompt', () => {
    const f = facts([
      item({ id: 'a', selected_variant: { Size: 'M' } }),
      item({ id: 'b', selected_variant: { Size: 'L' } }),
    ]);
    const { user } = buildSummaryMessages(f);
    expect(user).toMatch(/Size \[descriptive, do not claim agreement\]/);
  });
});

describe('factsFingerprintInput', () => {
  it('is stable for identical facts and includes model + prompt version', () => {
    const build = () =>
      facts([item({ id: 'a', current_price: '10.00' }), item({ id: 'b', current_price: '12.00' })]);
    const one = factsFingerprintInput(build());
    const two = factsFingerprintInput(build());
    expect(one).toBe(two);
    expect(one).toContain(`v=${SUMMARY_PROMPT_VERSION}`);
    expect(one).toContain(`m=${SUMMARY_MODEL}`);
  });

  it('changes when a fact value changes', () => {
    const a = factsFingerprintInput(
      facts([item({ id: 'a', current_price: '10.00' }), item({ id: 'b', current_price: '12.00' })]),
    );
    const b = factsFingerprintInput(
      facts([item({ id: 'a', current_price: '10.00' }), item({ id: 'b', current_price: '13.00' })]),
    );
    expect(a).not.toBe(b);
  });
});

describe('summarySchema', () => {
  it('accepts a well-formed summary and defaults itemRefs to []', () => {
    const parsed = summarySchema.parse({
      overview: 'Two similar parkas; Item 2 is cheaper.',
      points: [{ text: 'Item 2 costs less.' }],
      missingData: ['Item 1 has no listed composition.'],
    });
    expect(parsed.points[0]!.itemRefs).toEqual([]);
    expect(parsed.missingData).toHaveLength(1);
  });

  it('rejects an empty overview', () => {
    expect(() => summarySchema.parse({ overview: '', points: [], missingData: [] })).toThrow();
  });
});

describe('validItemRefs', () => {
  it('is exactly the refs the facts assigned', () => {
    const refs = validItemRefs(facts([item({ id: 'a' }), item({ id: 'b' }), item({ id: 'c' })]));
    expect(refs).toEqual(new Set(['Item 1', 'Item 2', 'Item 3']));
  });
});
