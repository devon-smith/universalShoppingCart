import { describe, expect, it } from 'vitest';

import type { PriceSummary } from '../items/query';
import {
  compareItems,
  MAX_COMPARE_ITEMS,
  type CompareInput,
  type CompareItem,
  type CompareRow,
} from './compare';

function item(overrides: Partial<CompareItem> = {}): CompareItem {
  return {
    id: overrides.id ?? 'item-1',
    cart_id: 'cart-1',
    title: 'Meridian Polo',
    brand: 'Northwind',
    description: null,
    retailer_name: 'Northwind',
    domain: 'northwind.example',
    source_url: 'https://northwind.example/p/1',
    canonical_url: 'https://northwind.example/p/1',
    image_url: 'https://cdn.example.com/1.jpg',
    currency: 'USD',
    current_price: '98.00',
    original_price: null,
    availability: 'in_stock',
    // Required on `SavedItem` since Phase 4, because every dashboard query selects it. It is
    // non-null only when the page's product-level claim disagreed with the variant's, so the
    // two agreeing — `null` — is the ordinary case for a fixture.
    product_availability: null,
    // Retailer-observed, raw, and required on `SavedItem` since it reaches the compare
    // view. Null is the ordinary case: most pages publish no fibre content at all.
    composition: null,
    selected_variant: { Color: 'Navy', Size: 'M' },
    identifiers: {},
    note: null,
    decision: null,
    quantity: 1,
    priority: 'normal',
    desired_price: null,
    status: 'saved',
    last_observed_at: '2026-07-26T12:00:00Z',
    created_at: '2026-07-26T12:00:00Z',
    updated_at: '2026-07-26T12:00:00Z',
    ...overrides,
  };
}

function input(overrides: Partial<CompareItem> = {}, summary?: PriceSummary): CompareInput {
  return { item: item(overrides), summary };
}

function row(comparison: ReturnType<typeof compareItems>, key: string): CompareRow | undefined {
  return comparison.rows.find((r) => r.key === key);
}

describe('compareItems — bounds', () => {
  it('rejects fewer than two items', () => {
    expect(() => compareItems([input()])).toThrow(RangeError);
  });

  it('rejects more than four', () => {
    const many = Array.from({ length: MAX_COMPARE_ITEMS + 1 }, (_, i) => input({ id: `i${i}` }));
    expect(() => compareItems(many)).toThrow(RangeError);
  });

  it('accepts two through four', () => {
    expect(() => compareItems([input({ id: 'a' }), input({ id: 'b' })])).not.toThrow();
    const four = Array.from({ length: 4 }, (_, i) => input({ id: `i${i}` }));
    expect(() => compareItems(four)).not.toThrow();
  });
});

describe('compareItems — price', () => {
  it('marks the single cheapest item, within one currency', () => {
    const comparison = compareItems([
      input({ id: 'a', current_price: '98.00' }),
      input({ id: 'b', current_price: '84.00' }),
      input({ id: 'c', current_price: '120.00' }),
    ]);
    const price = row(comparison, 'price')!;

    expect(price.lowestItemIds).toEqual(['b']);
    expect(price.cells.find((c) => c.itemId === 'b')!.annotations).toContain('lowest');
    expect(price.cells.find((c) => c.itemId === 'a')!.annotations).not.toContain('lowest');
  });

  it('compares by decimal value, not string length', () => {
    const comparison = compareItems([
      input({ id: 'a', current_price: '9.99' }),
      input({ id: 'b', current_price: '100.00' }),
    ]);
    expect(row(comparison, 'price')!.lowestItemIds).toEqual(['a']);
  });

  it('marks no lowest when the set spans two currencies', () => {
    const comparison = compareItems([
      input({ id: 'a', current_price: '98.00', currency: 'USD' }),
      input({ id: 'b', current_price: '84.00', currency: 'EUR' }),
    ]);
    expect(comparison.mixedCurrency).toBe(true);
    expect(row(comparison, 'price')!.lowestItemIds).toEqual([]);
    expect(row(comparison, 'price')!.cells.every((c) => !c.annotations.includes('lowest'))).toBe(
      true,
    );
  });

  it('marks no lowest when every priced item ties', () => {
    const comparison = compareItems([
      input({ id: 'a', current_price: '98.00' }),
      input({ id: 'b', current_price: '98.00' }),
    ]);
    expect(row(comparison, 'price')!.lowestItemIds).toEqual([]);
  });

  it('leaves an item with no price absent, and still ranks the rest', () => {
    const comparison = compareItems([
      input({ id: 'a', current_price: null }),
      input({ id: 'b', current_price: '84.00' }),
      input({ id: 'c', current_price: '90.00' }),
    ]);
    const price = row(comparison, 'price')!;
    expect(price.cells.find((c) => c.itemId === 'a')!.present).toBe(false);
    expect(price.lowestItemIds).toEqual(['b']);
  });

  it('defines allAgree on the price row — it is always a compared row', () => {
    // The contract (CompareRow.allAgree): a comparable row carries allAgree. A view keying off
    // its presence to mean "compared" must never see Price, of all rows, as "not compared".
    const comparison = compareItems([
      input({ id: 'a', current_price: '98.00' }),
      input({ id: 'b', current_price: '84.00' }),
    ]);
    const price = row(comparison, 'price')!;
    expect(price.comparable).toBe(true);
    expect(price.allAgree).toBe(false);
  });

  it('reports agreement when every priced item is the same price', () => {
    const comparison = compareItems([
      input({ id: 'a', current_price: '79.95' }),
      input({ id: 'b', current_price: '79.95' }),
    ]);
    expect(row(comparison, 'price')!.allAgree).toBe(true);
  });

  it('does not call two equal amounts in different currencies the same price', () => {
    // Mixed currency already suppresses "lowest"; agreement must be currency-aware too, or the
    // view would assert "same price" across USD and EUR on matching numbers.
    const comparison = compareItems([
      input({ id: 'a', current_price: '79.95', currency: 'USD' }),
      input({ id: 'b', current_price: '79.95', currency: 'EUR' }),
    ]);
    expect(row(comparison, 'price')!.allAgree).toBe(false);
  });
});

describe('compareItems — the "Was" row is only a real former price', () => {
  it('omits the row when no item is genuinely on sale', () => {
    const comparison = compareItems([input({ id: 'a' }), input({ id: 'b' })]);
    expect(row(comparison, 'original')).toBeUndefined();
  });

  it('shows only the item whose original is strictly above its current price', () => {
    const comparison = compareItems([
      input({ id: 'a', current_price: '84.00', original_price: '120.00' }),
      input({ id: 'b', current_price: '98.00', original_price: '98.00' }), // equal — not a sale
    ]);
    const was = row(comparison, 'original')!;
    expect(was.cells.find((c) => c.itemId === 'a')!.present).toBe(true);
    expect(was.cells.find((c) => c.itemId === 'a')!.annotations).toContain('on-sale');
    expect(was.cells.find((c) => c.itemId === 'b')!.present).toBe(false);
  });
});

describe('compareItems — variant rows are never comparable', () => {
  it('does not assert agreement even when two items share a size label', () => {
    // A Zara M and a Nike M are different garments; the structure must not claim they agree.
    const comparison = compareItems([
      input({ id: 'a', retailer_name: 'Zara', selected_variant: { Size: 'M' } }),
      input({ id: 'b', retailer_name: 'Nike', selected_variant: { Size: 'M' } }),
    ]);
    const size = row(comparison, 'variant.Size')!;
    expect(size.comparable).toBe(false);
    expect(size.allAgree).toBeUndefined();
  });

  it('unions option names across items and marks absent where a page did not have one', () => {
    const comparison = compareItems([
      input({ id: 'a', selected_variant: { Color: 'Navy', Size: 'M' } }),
      input({ id: 'b', selected_variant: { Color: 'Rust', Material: '100% cotton' } }),
    ]);
    expect(comparison.rows.filter((r) => r.kind === 'variant').map((r) => r.key)).toEqual([
      'variant.Color',
      'variant.Size',
      'variant.Material',
    ]);
    const size = row(comparison, 'variant.Size')!;
    expect(size.cells.find((c) => c.itemId === 'b')!.present).toBe(false);
  });
});

describe('compareItems — availability', () => {
  it('is comparable and surfaces a differing product-level claim', () => {
    const comparison = compareItems([
      input({ id: 'a', availability: 'out_of_stock', product_availability: 'in_stock' }),
      input({ id: 'b', availability: 'in_stock' }),
    ]);
    const avail = row(comparison, 'availability')!;
    expect(avail.comparable).toBe(true);
    expect(avail.allAgree).toBe(false);
    expect(avail.cells.find((c) => c.itemId === 'a')!.annotations).toContain('product:in_stock');
    expect(avail.cells.find((c) => c.itemId === 'b')!.annotations).toEqual([]);
  });

  it('agrees when both items are in stock', () => {
    const comparison = compareItems([input({ id: 'a' }), input({ id: 'b' })]);
    expect(row(comparison, 'availability')!.allAgree).toBe(true);
  });
});

describe('compareItems — price change from the summary', () => {
  function summary(over: Partial<PriceSummary>): PriceSummary {
    return {
      item_id: 'a',
      latest_price: '88.00',
      latest_observed_at: '2026-07-28T12:00:00Z',
      previous_price: '98.00',
      previous_observed_at: '2026-07-26T12:00:00Z',
      observation_count: 2,
      ...over,
    };
  }

  it('reports a drop when the latest price is below the previous', () => {
    const comparison = compareItems([
      { item: item({ id: 'a' }), summary: summary({ item_id: 'a' }) },
      input({ id: 'b' }),
    ]);
    const change = row(comparison, 'price-change')!;
    expect(change.cells.find((c) => c.itemId === 'a')!.annotations).toContain('price-drop');
  });

  it('omits the row when no item has a prior observation at a different price', () => {
    const comparison = compareItems([input({ id: 'a' }), input({ id: 'b' })]);
    expect(row(comparison, 'price-change')).toBeUndefined();
  });
});

describe('compareItems — target price', () => {
  it('marks below-target only when the current price is at or under it', () => {
    const comparison = compareItems([
      input({ id: 'a', current_price: '84.00', desired_price: '90.00' }),
      input({ id: 'b', current_price: '98.00', desired_price: '90.00' }),
    ]);
    const target = row(comparison, 'desired-price')!;
    expect(target.comparable).toBe(false);
    expect(target.cells.find((c) => c.itemId === 'a')!.annotations).toContain('below-target');
    expect(target.cells.find((c) => c.itemId === 'b')!.annotations).not.toContain('below-target');
  });

  it('omits the row when no item has a target', () => {
    const comparison = compareItems([input({ id: 'a' }), input({ id: 'b' })]);
    expect(row(comparison, 'desired-price')).toBeUndefined();
  });
});

describe('compareItems — retailer agreement is a real fact', () => {
  it('reports agreement when both items are from the same retailer', () => {
    const comparison = compareItems([
      input({ id: 'a', retailer_name: 'Northwind' }),
      input({ id: 'b', retailer_name: 'Northwind' }),
    ]);
    const retailer = row(comparison, 'retailer')!;
    expect(retailer.comparable).toBe(true);
    expect(retailer.allAgree).toBe(true);
  });

  it('reports disagreement across retailers', () => {
    const comparison = compareItems([
      input({ id: 'a', retailer_name: 'Zara' }),
      input({ id: 'b', retailer_name: 'Nike' }),
    ]);
    expect(row(comparison, 'retailer')!.allAgree).toBe(false);
  });
});

describe('compareItems — composition', () => {
  it('shows the raw string and is never comparable', () => {
    const comparison = compareItems([
      input({ id: 'a', composition: '100% cotton' }),
      input({ id: 'b', composition: 'Cotton 100%' }),
    ]);
    const comp = row(comparison, 'composition')!;
    // Two ways of writing the same fabric — but the tool must not assert they agree.
    expect(comp.comparable).toBe(false);
    expect(comp.allAgree).toBeUndefined();
    expect(comp.cells.find((c) => c.itemId === 'a')!.text).toBe('100% cotton');
    expect(comp.cells.find((c) => c.itemId === 'b')!.text).toBe('Cotton 100%');
  });

  it('omits the row when no item has composition, and marks absent per item', () => {
    expect(
      row(compareItems([input({ id: 'a' }), input({ id: 'b' })]), 'composition'),
    ).toBeUndefined();

    const partial = compareItems([
      input({ id: 'a', composition: 'Shell: 100% wool' }),
      input({ id: 'b' }),
    ]);
    const comp = row(partial, 'composition')!;
    expect(comp.cells.find((c) => c.itemId === 'a')!.present).toBe(true);
    expect(comp.cells.find((c) => c.itemId === 'b')!.present).toBe(false);
  });
});

describe('compareItems — shape', () => {
  it('preserves input order in items and in every row', () => {
    const comparison = compareItems([
      input({ id: 'first' }),
      input({ id: 'second' }),
      input({ id: 'third' }),
    ]);
    expect(comparison.items.map((i) => i.id)).toEqual(['first', 'second', 'third']);
    for (const r of comparison.rows) {
      expect(r.cells.map((c) => c.itemId)).toEqual(['first', 'second', 'third']);
    }
  });

  it('always includes image, title, retailer, price, and availability', () => {
    const comparison = compareItems([input({ id: 'a' }), input({ id: 'b' })]);
    for (const key of ['image', 'title', 'retailer', 'price', 'availability']) {
      expect(row(comparison, key)).toBeDefined();
    }
  });
});
