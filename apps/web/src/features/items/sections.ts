/**
 * The dashboard's navigation, as data.
 *
 * A section is a saved question about the cart — "what am I still deciding on", "what moved",
 * "what did I buy", "what did I put away". Making them data rather than four hand-written
 * views means the nav, the empty states and the heading all read from one definition and
 * cannot drift apart.
 *
 * The nav is also the *only* control for status. The old dashboard had a Status select in the
 * filter row as well, so two controls wrote one field and could disagree — pick "Archived" in
 * one and the other still said "Any status". One fact, one control.
 */

import { priceChange } from './freshness';
import type { ItemStatus, PriceSummary, SavedItem } from './query';

export type SectionId = 'cart' | 'changed' | 'purchased' | 'archived';

export interface Section {
  id: SectionId;
  label: string;
  /** Shown under the heading, so a section explains itself the first time it is opened. */
  blurb: string;
}

export const SECTIONS: readonly Section[] = [
  {
    id: 'cart',
    label: 'Cart',
    blurb: 'Everything you are considering.',
  },
  {
    id: 'changed',
    label: 'Recently changed',
    blurb: 'Items whose price moved between two observations.',
  },
  {
    id: 'purchased',
    label: 'Purchased',
    blurb: 'Things you decided on.',
  },
  {
    id: 'archived',
    label: 'Archived',
    blurb: 'Put away, not deleted. Restore any of these at any time.',
  },
];

/**
 * Which statuses a section shows.
 *
 * `cart` returns an empty list, which `filterItems` reads as "everything except archived" —
 * the same default the dashboard has always had. Purchased items therefore appear both here
 * and in their own section; that is deliberate. Marking something purchased from a card should
 * not make the card vanish out from under the cursor.
 */
export function sectionStatuses(section: SectionId): ItemStatus[] {
  switch (section) {
    case 'cart':
    case 'changed':
      return [];
    case 'purchased':
      return ['purchased'];
    case 'archived':
      return ['archived'];
  }
}

/**
 * Items with a recorded price movement.
 *
 * "Recorded" is the whole point: an item qualifies only when two observations exist and
 * disagree. Nothing is inferred from a single capture, and no item is described as having
 * moved because time passed (BUILD_PLAN.md §14.3).
 */
export function movedItemIds(
  items: readonly SavedItem[],
  summaries: ReadonlyMap<string, PriceSummary>,
): Set<string> {
  const moved = new Set<string>();

  for (const item of items) {
    const previous = summaries.get(item.id)?.previous_price ?? null;
    const direction = priceChange(item.current_price, previous).direction;
    if (direction === 'up' || direction === 'down') moved.add(item.id);
  }

  return moved;
}

/** Whether an item belongs in a section, before the user's own filters run. */
export function inSection(
  item: SavedItem,
  section: SectionId,
  moved: ReadonlySet<string>,
): boolean {
  if (section === 'changed') {
    return item.status !== 'archived' && moved.has(item.id);
  }

  const statuses = sectionStatuses(section);
  return statuses.length === 0 ? item.status !== 'archived' : statuses.includes(item.status);
}

/** How many items each section holds, for the counts beside the nav labels. */
export function sectionCounts(
  items: readonly SavedItem[],
  moved: ReadonlySet<string>,
): Record<SectionId, number> {
  const counts: Record<SectionId, number> = { cart: 0, changed: 0, purchased: 0, archived: 0 };

  for (const section of SECTIONS) {
    counts[section.id] = items.filter((item) => inSection(item, section.id, moved)).length;
  }

  return counts;
}
