import { describe, expect, it } from 'vitest';

import type { SavedItem } from './query';
import { applyRealtimeUpsert, removeItem, replaceItem, upsertItem, withEdit } from './reduce';

function item(overrides: Partial<SavedItem> = {}): SavedItem {
  return {
    id: 'item-1',
    cart_id: 'cart-1',
    title: 'Meridian Wool Runner',
    brand: null,
    description: null,
    retailer_name: 'Northwind',
    domain: 'shop.northwind.example',
    source_url: 'https://shop.northwind.example/p/1',
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
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('withEdit', () => {
  it('applies every user-authored field', () => {
    const result = withEdit(item(), {
      note: 'for the trip',
      quantity: 2,
      priority: 'high',
      desiredPrice: '75.00',
      status: 'cart',
    });

    expect(result).toMatchObject({
      note: 'for the trip',
      quantity: 2,
      priority: 'high',
      desired_price: '75.00',
      status: 'cart',
    });
  });

  it('leaves every retailer-observed field alone', () => {
    const before = item({
      title: 'Observed title',
      current_price: '98.00',
      availability: 'in_stock',
    });
    const after = withEdit(before, {
      note: null,
      quantity: 5,
      priority: 'low',
      desiredPrice: null,
      status: 'purchased',
    });

    expect(after.title).toBe('Observed title');
    expect(after.current_price).toBe('98.00');
    expect(after.availability).toBe('in_stock');
    expect(after.retailer_name).toBe('Northwind');
  });

  it('advances updated_at so recency sorting stays honest', () => {
    const after = withEdit(item(), {
      note: null,
      quantity: 1,
      priority: 'normal',
      desiredPrice: null,
      status: 'saved',
    });

    expect(new Date(after.updated_at).getTime()).toBeGreaterThan(
      new Date('2026-07-01T00:00:00.000Z').getTime(),
    );
  });
});

describe('upsertItem', () => {
  it('adds a new item', () => {
    expect(upsertItem([item()], item({ id: 'item-2' }))).toHaveLength(2);
  });

  it('replaces an existing item in place', () => {
    const list = [item({ id: 'a' }), item({ id: 'b', note: 'old' })];
    const result = upsertItem(list, item({ id: 'b', note: 'new' }));

    expect(result.map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(result[1]?.note).toBe('new');
  });

  it('does not mutate the input', () => {
    const list = [item()];
    upsertItem(list, item({ id: 'item-2' }));
    expect(list).toHaveLength(1);
  });
});

describe('removeItem', () => {
  it('removes by id', () => {
    expect(removeItem([item({ id: 'a' }), item({ id: 'b' })], 'a').map((e) => e.id)).toEqual(['b']);
  });

  it('is a no-op for an unknown id', () => {
    expect(removeItem([item({ id: 'a' })], 'zzz')).toHaveLength(1);
  });
});

describe('replaceItem', () => {
  it('updates only the matching item', () => {
    const list = [item({ id: 'a', quantity: 1 }), item({ id: 'b', quantity: 1 })];
    const result = replaceItem(list, 'b', (entry) => ({ ...entry, quantity: 9 }));

    expect(result[0]?.quantity).toBe(1);
    expect(result[1]?.quantity).toBe(9);
  });
});

describe('applyRealtimeUpsert', () => {
  it('merges a row for a visible cart', () => {
    const result = applyRealtimeUpsert([], item({ id: 'new' }), ['cart-1']);
    expect(result.map((entry) => entry.id)).toEqual(['new']);
  });

  it('ignores a row for a cart this view is not showing', () => {
    // A shared cart open in another tab must not leak into this one.
    const result = applyRealtimeUpsert([item()], item({ id: 'other', cart_id: 'cart-9' }), [
      'cart-1',
    ]);
    expect(result.map((entry) => entry.id)).toEqual(['item-1']);
  });
});
