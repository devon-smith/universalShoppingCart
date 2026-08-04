import { MAX_COMPARE_ITEMS, MIN_COMPARE_ITEMS } from '@/features/compare/compare';

import type { SavedItem } from './query';

/**
 * Decision boards: the dashboard grouped by what each candidate is *for*.
 *
 * Long-horizon shopping means holding several open purchases at once — three jacket
 * candidates, two pairs of trail runners — over days or weeks. Flat lists interleave them;
 * a board per decision keeps each choice's candidates side by side, which is the comparison
 * this product exists for.
 *
 * The group is `item.decision`, free text the user typed. Grouping is by the exact trimmed
 * name — no fuzzy matching, because silently merging "winter jacket" and "winter jackets"
 * is inventing an equivalence the user did not state.
 */

export interface DecisionBoard {
  /** The decision's name, or null for the candidates not yet assigned to one. */
  name: string | null;
  items: SavedItem[];
}

/**
 * Group items into boards: named decisions first, A–Z; unassigned last under null.
 *
 * Alphabetical, not most-recent: boards are places, and places that reshuffle on every
 * price observation cannot be returned to.
 */
export function groupByDecision(items: readonly SavedItem[]): DecisionBoard[] {
  const named = new Map<string, SavedItem[]>();
  const unassigned: SavedItem[] = [];

  for (const item of items) {
    const name = item.decision?.trim();
    if (!name) {
      unassigned.push(item);
      continue;
    }
    const board = named.get(name);
    if (board) {
      board.push(item);
    } else {
      named.set(name, [item]);
    }
  }

  const boards: DecisionBoard[] = [...named.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, boardItems]) => ({ name, items: boardItems }));

  if (unassigned.length > 0) {
    boards.push({ name: null, items: unassigned });
  }

  return boards;
}

/** Whether grouping would change anything — one all-unassigned board means a flat list. */
export function hasDecisions(boards: readonly DecisionBoard[]): boolean {
  return boards.some((board) => board.name !== null);
}

/**
 * The board's items as a compare selection, when the board *is* a comparison.
 *
 * Two to four candidates: exactly what the compare view accepts. One is just an item, and
 * five or more means the user narrows first — silently comparing an arbitrary four would
 * misrepresent the board it claims to show.
 */
export function boardCompareIds(board: DecisionBoard): string[] | null {
  if (board.name === null) return null;
  if (board.items.length < MIN_COMPARE_ITEMS || board.items.length > MAX_COMPARE_ITEMS) {
    return null;
  }
  return board.items.map((item) => item.id);
}
