import { describe, expect, it } from 'vitest';

import { boardCompareIds, groupByDecision, hasDecisions } from './decisions';
import type { SavedItem } from './query';

function item(id: string, decision: string | null): SavedItem {
  return { id, decision } as SavedItem;
}

describe('groupByDecision', () => {
  it('groups by exact name, named boards A–Z, unassigned last', () => {
    const boards = groupByDecision([
      item('a', 'winter jacket'),
      item('b', null),
      item('c', 'running shoes'),
      item('d', 'winter jacket'),
    ]);

    expect(boards.map((board) => board.name)).toEqual(['running shoes', 'winter jacket', null]);
    expect(boards[1]!.items.map((entry) => entry.id)).toEqual(['a', 'd']);
  });

  it('does not merge names that differ, even by a character', () => {
    // "winter jacket" and "winter jackets" are two claims; equating them is invention.
    const boards = groupByDecision([item('a', 'winter jacket'), item('b', 'winter jackets')]);
    expect(boards).toHaveLength(2);
  });

  it('treats a whitespace-only decision as unassigned', () => {
    const boards = groupByDecision([item('a', '  ')]);
    expect(boards).toEqual([{ name: null, items: [item('a', '  ')] }]);
    expect(hasDecisions(boards)).toBe(false);
  });

  it('keeps each board in the incoming order, which is the active sort', () => {
    const boards = groupByDecision([item('b', 'x'), item('a', 'x')]);
    expect(boards[0]!.items.map((entry) => entry.id)).toEqual(['b', 'a']);
  });
});

describe('boardCompareIds', () => {
  it('offers a comparison for two to four candidates', () => {
    const boards = groupByDecision([item('a', 'x'), item('b', 'x')]);
    expect(boardCompareIds(boards[0]!)).toEqual(['a', 'b']);
  });

  it('offers nothing for one candidate, five, or the unassigned board', () => {
    expect(boardCompareIds(groupByDecision([item('a', 'x')])[0]!)).toBeNull();

    const five = groupByDecision(['a', 'b', 'c', 'd', 'e'].map((id) => item(id, 'x')));
    expect(boardCompareIds(five[0]!)).toBeNull();

    const unassigned = groupByDecision([item('a', null), item('b', null)]);
    expect(boardCompareIds(unassigned[0]!)).toBeNull();
  });
});
