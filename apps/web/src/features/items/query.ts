/**
 * Search, filter, and sort for the saved-products list.
 *
 * Pure functions over an array. At personal-cart scale — tens to low hundreds of items —
 * filtering in the browser is instant and lets the controls respond without a round trip.
 * When a cart outgrows that, these same predicates translate directly into a Postgres
 * query; keeping them pure is what makes that a mechanical change rather than a rewrite.
 */

export type ItemStatus = 'saved' | 'cart' | 'purchased' | 'archived';
export type ItemPriority = 'low' | 'normal' | 'high';
export type ItemAvailability = 'in_stock' | 'out_of_stock' | 'preorder' | 'backorder' | 'unknown';

export interface SavedItem {
  id: string;
  cart_id: string;
  title: string;
  brand: string | null;
  description: string | null;
  retailer_name: string;
  domain: string;
  source_url: string;
  canonical_url: string | null;
  image_url: string | null;
  currency: string | null;
  current_price: string | number | null;
  original_price: string | number | null;
  availability: ItemAvailability;
  selected_variant: Record<string, string> | null;
  identifiers: Record<string, string> | null;
  note: string | null;
  quantity: number;
  priority: ItemPriority;
  desired_price: string | number | null;
  status: ItemStatus;
  last_observed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type SortKey =
  'recently-updated' | 'recently-added' | 'price-low' | 'price-high' | 'priority' | 'title';

export interface ItemFilters {
  /** Free text across title, brand, retailer, note, and variant values. */
  search: string;
  /** Empty means "every status except archived". */
  statuses: ItemStatus[];
  retailers: string[];
  availabilities: ItemAvailability[];
  priorities: ItemPriority[];
  /** Only items whose original price is higher than the current one. */
  onSaleOnly: boolean;
  /** Only items at or below the desired price the user set. */
  atOrBelowDesiredOnly: boolean;
}

export const EMPTY_FILTERS: ItemFilters = {
  search: '',
  statuses: [],
  retailers: [],
  availabilities: [],
  priorities: [],
  onSaleOnly: false,
  atOrBelowDesiredOnly: false,
};

export function toNumber(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isOnSale(item: SavedItem): boolean {
  const current = toNumber(item.current_price);
  const original = toNumber(item.original_price);
  return current !== null && original !== null && original > current;
}

export function isAtOrBelowDesired(item: SavedItem): boolean {
  const current = toNumber(item.current_price);
  const desired = toNumber(item.desired_price);
  return current !== null && desired !== null && current <= desired;
}

/** Everything a search term is allowed to match. Deliberately not the description. */
function searchableText(item: SavedItem): string {
  return [
    item.title,
    item.brand,
    item.retailer_name,
    item.note,
    ...Object.values(item.selected_variant ?? {}),
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')
    .toLowerCase();
}

/**
 * All terms must match, in any field. Multi-term search is how someone finds "the black
 * runner from Northwind" without remembering the exact title.
 */
export function matchesSearch(item: SavedItem, search: string): boolean {
  const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;

  const haystack = searchableText(item);
  return terms.every((term) => haystack.includes(term));
}

export function filterItems(items: readonly SavedItem[], filters: ItemFilters): SavedItem[] {
  return items.filter((item) => {
    // Archived items are hidden unless explicitly asked for — that is what archiving means.
    if (filters.statuses.length === 0) {
      if (item.status === 'archived') return false;
    } else if (!filters.statuses.includes(item.status)) {
      return false;
    }

    if (filters.retailers.length > 0 && !filters.retailers.includes(item.retailer_name)) {
      return false;
    }

    if (filters.availabilities.length > 0 && !filters.availabilities.includes(item.availability)) {
      return false;
    }

    if (filters.priorities.length > 0 && !filters.priorities.includes(item.priority)) {
      return false;
    }

    if (filters.onSaleOnly && !isOnSale(item)) return false;
    if (filters.atOrBelowDesiredOnly && !isAtOrBelowDesired(item)) return false;

    return matchesSearch(item, filters.search);
  });
}

const PRIORITY_ORDER: Record<ItemPriority, number> = { high: 0, normal: 1, low: 2 };

function byTime(a: string, b: string): number {
  return new Date(b).getTime() - new Date(a).getTime();
}

/**
 * Sort a filtered list.
 *
 * Items with no price sort last in both price directions rather than being treated as
 * zero — "unknown" is not "free".
 */
export function sortItems(items: readonly SavedItem[], key: SortKey): SavedItem[] {
  const sorted = [...items];

  switch (key) {
    case 'recently-updated':
      return sorted.sort((a, b) => byTime(a.updated_at, b.updated_at));

    case 'recently-added':
      return sorted.sort((a, b) => byTime(a.created_at, b.created_at));

    case 'price-low':
    case 'price-high':
      return sorted.sort((a, b) => {
        const left = toNumber(a.current_price);
        const right = toNumber(b.current_price);
        if (left === null && right === null) return byTime(a.updated_at, b.updated_at);
        if (left === null) return 1;
        if (right === null) return -1;
        return key === 'price-low' ? left - right : right - left;
      });

    case 'priority':
      return sorted.sort(
        (a, b) =>
          PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
          byTime(a.updated_at, b.updated_at),
      );

    case 'title':
      return sorted.sort((a, b) => a.title.localeCompare(b.title));
  }
}

export function applyQuery(
  items: readonly SavedItem[],
  filters: ItemFilters,
  sort: SortKey,
): SavedItem[] {
  return sortItems(filterItems(items, filters), sort);
}

/** Retailers present in the data, for the filter control. */
export function retailerOptions(items: readonly SavedItem[]): string[] {
  return [...new Set(items.map((item) => item.retailer_name))].sort((a, b) => a.localeCompare(b));
}

/** True when a filter is doing something, so the UI can offer to clear it. */
export function hasActiveFilters(filters: ItemFilters): boolean {
  return (
    filters.search.trim().length > 0 ||
    filters.statuses.length > 0 ||
    filters.retailers.length > 0 ||
    filters.availabilities.length > 0 ||
    filters.priorities.length > 0 ||
    filters.onSaleOnly ||
    filters.atOrBelowDesiredOnly
  );
}
