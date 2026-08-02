import { describe, expect, it } from 'vitest';

import type { PriceSummary, SavedItem } from './query';
import { SECTIONS, inSection, movedItemIds, sectionCounts, sectionStatuses } from './sections';

function item(overrides: Partial<SavedItem> & { id: string }): SavedItem {
  return {
    cart_id: 'cart-1',
    title: 'Meridian Wool Runner',
    brand: null,
    description: null,
    retailer_name: 'Northwind',
    domain: 'shop.northwind.example',
    source_url: 'https://shop.northwind.example/p/meridian',
    canonical_url: null,
    image_url: null,
    currency: 'USD',
    current_price: '98.00',
    original_price: null,
    availability: 'in_stock',
    product_availability: null,
    selected_variant: null,
    identifiers: null,
    note: null,
    quantity: 1,
    priority: 'normal',
    desired_price: null,
    status: 'saved',
    last_observed_at: null,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

function summary(id: string, previous: string | null): PriceSummary {
  return {
    item_id: id,
    latest_price: '98.00',
    latest_observed_at: '2026-07-02T00:00:00Z',
    previous_price: previous,
    previous_observed_at: previous ? '2026-07-01T00:00:00Z' : null,
    observation_count: previous ? 2 : 1,
  };
}

describe('sectionStatuses', () => {
  it('lets the cart mean "everything except archived", as the dashboard always has', () => {
    expect(sectionStatuses('cart')).toEqual([]);
  });

  it('narrows to one status for the two explicit sections', () => {
    expect(sectionStatuses('purchased')).toEqual(['purchased']);
    expect(sectionStatuses('archived')).toEqual(['archived']);
  });
});

describe('inSection', () => {
  const none = new Set<string>();

  it('keeps a purchased item in the cart, so marking one does not make it vanish', () => {
    expect(inSection(item({ id: 'a', status: 'purchased' }), 'cart', none)).toBe(true);
  });

  it('hides archived items from the cart', () => {
    expect(inSection(item({ id: 'a', status: 'archived' }), 'cart', none)).toBe(false);
  });

  it('shows archived items only in their own section', () => {
    const archived = item({ id: 'a', status: 'archived' });
    expect(inSection(archived, 'archived', none)).toBe(true);
    expect(inSection(archived, 'purchased', none)).toBe(false);
  });

  it('restricts "recently changed" to items with a recorded movement', () => {
    const moved = new Set(['a']);
    expect(inSection(item({ id: 'a' }), 'changed', moved)).toBe(true);
    expect(inSection(item({ id: 'b' }), 'changed', moved)).toBe(false);
  });

  it('never shows an archived item under "recently changed"', () => {
    const moved = new Set(['a']);
    expect(inSection(item({ id: 'a', status: 'archived' }), 'changed', moved)).toBe(false);
  });
});

describe('movedItemIds', () => {
  it('counts an item only when two observations disagree', () => {
    const items = [item({ id: 'fell', current_price: '88.00' }), item({ id: 'first-look' })];
    const summaries = new Map([
      ['fell', summary('fell', '98.00')],
      ['first-look', summary('first-look', null)],
    ]);

    expect([...movedItemIds(items, summaries)]).toEqual(['fell']);
  });

  it('does not count an item observed twice at the same price', () => {
    const items = [item({ id: 'steady', current_price: '98.00' })];
    const summaries = new Map([['steady', summary('steady', '98.00')]]);

    expect(movedItemIds(items, summaries).size).toBe(0);
  });

  it('counts a rise as well as a fall', () => {
    const items = [item({ id: 'rose', current_price: '120.00' })];
    const summaries = new Map([['rose', summary('rose', '98.00')]]);

    expect(movedItemIds(items, summaries).has('rose')).toBe(true);
  });

  it('says nothing about an item with no summary at all', () => {
    expect(movedItemIds([item({ id: 'lonely' })], new Map()).size).toBe(0);
  });
});

describe('sectionCounts', () => {
  it('counts every section from one pass of the data', () => {
    const items = [
      item({ id: 'a', status: 'saved' }),
      item({ id: 'b', status: 'purchased' }),
      item({ id: 'c', status: 'archived' }),
    ];

    expect(sectionCounts(items, new Set(['a']))).toEqual({
      cart: 2, // saved + purchased, not archived
      changed: 1,
      purchased: 1,
      archived: 1,
    });
  });

  it('returns a zero for every section when there is nothing saved', () => {
    expect(sectionCounts([], new Set())).toEqual({
      cart: 0,
      changed: 0,
      purchased: 0,
      archived: 0,
    });
  });

  it('has a count for every declared section', () => {
    const counts = sectionCounts([], new Set());
    for (const section of SECTIONS) {
      expect(counts[section.id]).toBeDefined();
    }
  });
});
