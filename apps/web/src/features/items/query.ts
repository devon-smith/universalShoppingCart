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
  /**
   * The page's *product-level* claim, kept only when it differs from `availability` — which
   * describes the selected variant. Null means the page made no separate claim, or the two
   * agree, so a non-null value is by construction the interesting case: the size you chose is
   * gone while the product is still sold (supabase/migrations/…_product_availability.sql).
   */
  product_availability: ItemAvailability | null;
  /**
   * Fibre content exactly as the page published it — "100% cotton", or a labelled two-part
   * string like "Shell: 100% wool; Lining: 52% polyester" — with no normalization
   * (docs/DECISIONS.md, 2026-08-02).
   *
   * Retailer-observed, so the `reject_observed_field_writes` trigger owns it and no client
   * can write it. The compare view renders it as a *descriptive* row: two garments both
   * reading "100% cotton" is a real shared fact, but nothing here can assert that
   * "100% cotton" and "Cotton 100%" mean the same thing until the strings are normalized.
   */
  composition: string | null;
  selected_variant: Record<string, string> | null;
  identifiers: Record<string, string> | null;
  note: string | null;
  /**
   * Which purchase this candidate is for — "winter jacket", "trail runners". Free text,
   * user-authored, so a retailer refresh never touches it. Items sharing a decision render
   * together as a board on the dashboard; null means not yet assigned.
   */
  decision: string | null;
  quantity: number;
  priority: ItemPriority;
  desired_price: string | number | null;
  status: ItemStatus;
  last_observed_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * The newest observation and the last one at a different price, from
 * `item_price_summary`. Absent when an item has only ever been observed once.
 */
export interface PriceSummary {
  item_id: string;
  latest_price: string | number | null;
  latest_observed_at: string | null;
  previous_price: string | number | null;
  previous_observed_at: string | null;
  observation_count: number;
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

/**
 * Which filter a chip represents.
 *
 * Search is not one of them: it has a visible input holding its own value, and a chip for it
 * would be the same fact in two places.
 */
export type FilterChipId = 'retailer' | 'availability' | 'priority' | 'on-sale' | 'hit-target';

export interface FilterChip {
  id: FilterChipId;
  label: string;
}

/**
 * How many secondary filters are narrowing the results.
 *
 * Drives the count on the Filters button. Without it, a filter set inside a closed popover is
 * invisible, and "why is my cart empty" becomes a puzzle.
 */
export function activeFilterCount(filters: ItemFilters): number {
  return (
    (filters.retailers.length > 0 ? 1 : 0) +
    (filters.availabilities.length > 0 ? 1 : 0) +
    (filters.priorities.length > 0 ? 1 : 0) +
    (filters.onSaleOnly ? 1 : 0) +
    (filters.atOrBelowDesiredOnly ? 1 : 0)
  );
}

/** The active secondary filters, as chips to render next to the results. */
export function activeFilterChips(filters: ItemFilters): FilterChip[] {
  const chips: FilterChip[] = [];

  if (filters.retailers[0]) chips.push({ id: 'retailer', label: filters.retailers[0] });
  if (filters.availabilities[0]) {
    chips.push({ id: 'availability', label: filters.availabilities[0].replace(/_/g, ' ') });
  }
  if (filters.priorities[0]) {
    chips.push({ id: 'priority', label: `${filters.priorities[0]} priority` });
  }
  if (filters.onSaleOnly) chips.push({ id: 'on-sale', label: 'On sale' });
  if (filters.atOrBelowDesiredOnly) chips.push({ id: 'hit-target', label: 'Hit my target' });

  return chips;
}

/** Remove one filter, leaving the rest — and the search term — alone. */
export function clearFilter(filters: ItemFilters, id: FilterChipId): ItemFilters {
  switch (id) {
    case 'retailer':
      return { ...filters, retailers: [] };
    case 'availability':
      return { ...filters, availabilities: [] };
    case 'priority':
      return { ...filters, priorities: [] };
    case 'on-sale':
      return { ...filters, onSaleOnly: false };
    case 'hit-target':
      return { ...filters, atOrBelowDesiredOnly: false };
  }
}
