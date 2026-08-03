import { describe, expect, it } from 'vitest';

import type { ItemAvailability, ItemFilters, SavedItem } from './query';
import {
  activeFilterChips,
  activeFilterCount,
  applyQuery,
  clearFilter,
  EMPTY_FILTERS,
  filterItems,
  hasActiveFilters,
  isAtOrBelowDesired,
  isOnSale,
  matchesSearch,
  retailerOptions,
  sortItems,
} from './query';

function item(overrides: Partial<SavedItem> = {}): SavedItem {
  return {
    id: overrides.id ?? 'item-1',
    cart_id: 'cart-1',
    title: 'Meridian Wool Runner',
    brand: 'Northwind',
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
    // Retailer-observed, raw, and required on `SavedItem` since it reaches the compare
    // view. Null is the ordinary case: most pages publish no fibre content at all.
    composition: null,
    selected_variant: { Size: '10', Color: 'Natural Black' },
    identifiers: null,
    note: null,
    quantity: 1,
    priority: 'normal',
    desired_price: null,
    status: 'saved',
    last_observed_at: '2026-07-26T12:00:00.000Z',
    created_at: '2026-07-01T12:00:00.000Z',
    updated_at: '2026-07-26T12:00:00.000Z',
    ...overrides,
  };
}

function filters(overrides: Partial<ItemFilters> = {}): ItemFilters {
  return { ...EMPTY_FILTERS, ...overrides };
}

describe('matchesSearch', () => {
  it('matches the title', () => {
    expect(matchesSearch(item(), 'meridian')).toBe(true);
  });

  it('matches the brand, retailer, note, and variant', () => {
    expect(matchesSearch(item({ note: 'for the trip' }), 'trip')).toBe(true);
    expect(matchesSearch(item(), 'northwind')).toBe(true);
    expect(matchesSearch(item(), 'natural black')).toBe(true);
  });

  it('requires every term to match somewhere', () => {
    // "the black runner from Northwind", without remembering the exact title.
    expect(matchesSearch(item(), 'runner black northwind')).toBe(true);
    expect(matchesSearch(item(), 'runner purple')).toBe(false);
  });

  it('ignores case and surrounding whitespace', () => {
    expect(matchesSearch(item(), '  MERIDIAN  ')).toBe(true);
  });

  it('matches everything when the search is empty', () => {
    expect(matchesSearch(item(), '')).toBe(true);
    expect(matchesSearch(item(), '   ')).toBe(true);
  });
});

describe('isOnSale / isAtOrBelowDesired', () => {
  it('detects a genuine discount', () => {
    expect(isOnSale(item({ current_price: '80.00', original_price: '100.00' }))).toBe(true);
  });

  it('does not call an equal or higher original a sale', () => {
    expect(isOnSale(item({ current_price: '100.00', original_price: '100.00' }))).toBe(false);
    expect(isOnSale(item({ current_price: '120.00', original_price: '100.00' }))).toBe(false);
    expect(isOnSale(item({ original_price: null }))).toBe(false);
  });

  it('detects a price at or below the desired one', () => {
    expect(isAtOrBelowDesired(item({ current_price: '75.00', desired_price: '80.00' }))).toBe(true);
    expect(isAtOrBelowDesired(item({ current_price: '80.00', desired_price: '80.00' }))).toBe(true);
    expect(isAtOrBelowDesired(item({ current_price: '85.00', desired_price: '80.00' }))).toBe(
      false,
    );
    expect(isAtOrBelowDesired(item({ desired_price: null }))).toBe(false);
  });
});

describe('filterItems — status', () => {
  const items = [
    item({ id: 'a', status: 'saved' }),
    item({ id: 'b', status: 'cart' }),
    item({ id: 'c', status: 'purchased' }),
    item({ id: 'd', status: 'archived' }),
  ];

  it('hides archived items by default', () => {
    expect(filterItems(items, filters()).map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
  });

  it('shows archived items when explicitly asked', () => {
    expect(
      filterItems(items, filters({ statuses: ['archived'] })).map((entry) => entry.id),
    ).toEqual(['d']);
  });

  it('filters to a chosen set of statuses', () => {
    expect(
      filterItems(items, filters({ statuses: ['cart', 'purchased'] })).map((entry) => entry.id),
    ).toEqual(['b', 'c']);
  });
});

describe('filterItems — facets', () => {
  const items = [
    item({ id: 'a', retailer_name: 'Northwind', availability: 'in_stock', priority: 'high' }),
    item({ id: 'b', retailer_name: 'Fieldcraft', availability: 'out_of_stock', priority: 'low' }),
    item({ id: 'c', retailer_name: 'Northwind', availability: 'unknown', priority: 'normal' }),
  ];

  it('filters by retailer', () => {
    expect(
      filterItems(items, filters({ retailers: ['Northwind'] })).map((entry) => entry.id),
    ).toEqual(['a', 'c']);
  });

  it('filters by availability', () => {
    expect(
      filterItems(items, filters({ availabilities: ['out_of_stock'] })).map((entry) => entry.id),
    ).toEqual(['b']);
  });

  it('filters by priority', () => {
    expect(
      filterItems(items, filters({ priorities: ['high', 'low'] })).map((entry) => entry.id),
    ).toEqual(['a', 'b']);
  });

  it('combines facets with search', () => {
    const result = filterItems(
      items,
      filters({ retailers: ['Northwind'], search: 'meridian', priorities: ['high'] }),
    );
    expect(result.map((entry) => entry.id)).toEqual(['a']);
  });

  it('filters to items on sale', () => {
    const sale = [
      item({ id: 'a', current_price: '80.00', original_price: '100.00' }),
      item({ id: 'b', current_price: '80.00', original_price: null }),
    ];
    expect(filterItems(sale, filters({ onSaleOnly: true })).map((entry) => entry.id)).toEqual([
      'a',
    ]);
  });

  it('filters to items that hit a desired price', () => {
    const watched = [
      item({ id: 'a', current_price: '70.00', desired_price: '75.00' }),
      item({ id: 'b', current_price: '90.00', desired_price: '75.00' }),
    ];
    expect(
      filterItems(watched, filters({ atOrBelowDesiredOnly: true })).map((entry) => entry.id),
    ).toEqual(['a']);
  });
});

describe('sortItems', () => {
  const items = [
    item({
      id: 'a',
      title: 'Zebra lamp',
      current_price: '50.00',
      priority: 'low',
      created_at: '2026-07-01T00:00:00.000Z',
      updated_at: '2026-07-10T00:00:00.000Z',
    }),
    item({
      id: 'b',
      title: 'Apple crate',
      current_price: '150.00',
      priority: 'high',
      created_at: '2026-07-05T00:00:00.000Z',
      updated_at: '2026-07-20T00:00:00.000Z',
    }),
    item({
      id: 'c',
      title: 'Meridian runner',
      current_price: null,
      priority: 'normal',
      created_at: '2026-07-03T00:00:00.000Z',
      updated_at: '2026-07-15T00:00:00.000Z',
    }),
  ];

  it('sorts by most recently updated', () => {
    expect(sortItems(items, 'recently-updated').map((entry) => entry.id)).toEqual(['b', 'c', 'a']);
  });

  it('sorts by most recently added', () => {
    expect(sortItems(items, 'recently-added').map((entry) => entry.id)).toEqual(['b', 'c', 'a']);
  });

  it('sorts by price, putting unknown prices last in both directions', () => {
    // An unknown price is not a free product.
    expect(sortItems(items, 'price-low').map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
    expect(sortItems(items, 'price-high').map((entry) => entry.id)).toEqual(['b', 'a', 'c']);
  });

  it('sorts by priority, then recency', () => {
    expect(sortItems(items, 'priority').map((entry) => entry.id)).toEqual(['b', 'c', 'a']);
  });

  it('sorts by title', () => {
    expect(sortItems(items, 'title').map((entry) => entry.id)).toEqual(['b', 'c', 'a']);
  });

  it('does not mutate the input', () => {
    const original = [...items];
    sortItems(items, 'title');
    expect(items).toEqual(original);
  });
});

describe('applyQuery', () => {
  it('filters then sorts', () => {
    const items = [
      item({ id: 'a', title: 'Wool runner', current_price: '98.00' }),
      item({ id: 'b', title: 'Wool sock', current_price: '18.00' }),
      item({ id: 'c', title: 'Cast iron pan', current_price: '40.00' }),
    ];

    expect(applyQuery(items, filters({ search: 'wool' }), 'price-low').map((e) => e.id)).toEqual([
      'b',
      'a',
    ]);
  });
});

describe('retailerOptions', () => {
  it('lists each retailer once, alphabetically', () => {
    expect(
      retailerOptions([
        item({ id: 'a', retailer_name: 'Northwind' }),
        item({ id: 'b', retailer_name: 'Fieldcraft' }),
        item({ id: 'c', retailer_name: 'Northwind' }),
      ]),
    ).toEqual(['Fieldcraft', 'Northwind']);
  });
});

describe('hasActiveFilters', () => {
  it('is false for the default filters', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters(filters({ search: '   ' }))).toBe(false);
  });

  it('is true when anything is set', () => {
    expect(hasActiveFilters(filters({ search: 'wool' }))).toBe(true);
    expect(hasActiveFilters(filters({ statuses: ['cart'] }))).toBe(true);
    expect(hasActiveFilters(filters({ onSaleOnly: true }))).toBe(true);
    expect(hasActiveFilters(filters({ atOrBelowDesiredOnly: true }))).toBe(true);
  });
});

describe('activeFilterCount', () => {
  it('counts nothing when no secondary filter is set', () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
  });

  it('does not count search, which has its own visible input', () => {
    expect(activeFilterCount({ ...EMPTY_FILTERS, search: 'runner' })).toBe(0);
  });

  it('counts each distinct narrowing once', () => {
    expect(
      activeFilterCount({
        ...EMPTY_FILTERS,
        retailers: ['Northwind'],
        availabilities: ['in_stock'],
        onSaleOnly: true,
      }),
    ).toBe(3);
  });
});

describe('activeFilterChips', () => {
  it('is empty for empty filters', () => {
    expect(activeFilterChips(EMPTY_FILTERS)).toEqual([]);
  });

  it('names the retailer it is filtering to', () => {
    expect(activeFilterChips({ ...EMPTY_FILTERS, retailers: ['Fieldcraft'] })).toEqual([
      { id: 'retailer', label: 'Fieldcraft' },
    ]);
  });

  it('reads an availability as words rather than a database enum', () => {
    expect(
      activeFilterChips({ ...EMPTY_FILTERS, availabilities: ['out_of_stock'] })[0]?.label,
    ).toBe('out of stock');
  });

  it('produces one chip per active filter', () => {
    const chips = activeFilterChips({
      ...EMPTY_FILTERS,
      retailers: ['Northwind'],
      onSaleOnly: true,
      atOrBelowDesiredOnly: true,
    });
    expect(chips.map((chip) => chip.id)).toEqual(['retailer', 'on-sale', 'hit-target']);
  });
});

describe('clearFilter', () => {
  it('removes one filter and leaves the others', () => {
    const filters = {
      ...EMPTY_FILTERS,
      retailers: ['Northwind'],
      availabilities: ['in_stock'] as ItemAvailability[],
    };

    const next = clearFilter(filters, 'retailer');

    expect(next.retailers).toEqual([]);
    expect(next.availabilities).toEqual(['in_stock']);
  });

  it('keeps the search term, which is a separate control', () => {
    const filters = { ...EMPTY_FILTERS, search: 'runner', onSaleOnly: true };
    expect(clearFilter(filters, 'on-sale').search).toBe('runner');
  });

  it('does not mutate the filters it was given', () => {
    const filters = { ...EMPTY_FILTERS, onSaleOnly: true };
    clearFilter(filters, 'on-sale');
    expect(filters.onSaleOnly).toBe(true);
  });
});
