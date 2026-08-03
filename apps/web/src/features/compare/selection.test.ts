import { describe, expect, it } from 'vitest';

import { MAX_COMPARE_ITEMS } from './compare';
import {
  compareHref,
  parseSelection,
  parseSelectionInput,
  serializeSelection,
  toggleSelection,
} from './selection';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';
const E = '55555555-5555-4555-8555-555555555555';

describe('parseSelectionInput', () => {
  // The Server Action receives an array of individual ids from the panel — the exact shape that
  // broke the AI-summary flow when it was routed through parseSelection (which read only the
  // first array element and reported "not enough").
  it('reads an array of individual ids, not just its first element', () => {
    expect(parseSelectionInput([A, B])).toEqual([A, B]);
    expect(parseSelectionInput([A, B, C])).toEqual([A, B, C]);
  });

  it('still reads a comma-separated string', () => {
    expect(parseSelectionInput(`${A},${B}`)).toEqual([A, B]);
  });

  it('validates, dedupes, and caps like the URL parser', () => {
    expect(parseSelectionInput([A, 'not-an-id', B, A])).toEqual([A, B]);
    expect(parseSelectionInput([A, B, C, D, E])).toEqual([A, B, C, D]);
  });

  it('is empty for anything that is not a string or string array', () => {
    expect(parseSelectionInput(undefined)).toEqual([]);
    expect(parseSelectionInput(null)).toEqual([]);
    expect(parseSelectionInput(42)).toEqual([]);
    expect(parseSelectionInput({ items: A })).toEqual([]);
  });
});

describe('parseSelection', () => {
  it('reads a comma-separated list, in order', () => {
    expect(parseSelection(`${A},${B}`)).toEqual([A, B]);
  });

  it('is empty for a missing parameter', () => {
    expect(parseSelection(undefined)).toEqual([]);
    expect(parseSelection('')).toEqual([]);
  });

  /**
   * The value builds a database query, so it is validated rather than trusted. RLS is the
   * second gate, not the first — nothing that is not an id shape should reach a query at all.
   */
  it('drops anything that is not a uuid', () => {
    expect(parseSelection(`${A},not-an-id,${B}`)).toEqual([A, B]);
    expect(parseSelection("'; drop table items; --")).toEqual([]);
    expect(parseSelection('../../etc/passwd')).toEqual([]);
  });

  it('accepts an uppercase uuid and normalizes it', () => {
    expect(parseSelection(A.toUpperCase())).toEqual([A]);
  });

  it('collapses duplicates — an item cannot be compared with itself', () => {
    expect(parseSelection(`${A},${A},${B}`)).toEqual([A, B]);
  });

  it('caps a hand-edited URL at the maximum rather than erroring', () => {
    const many = [A, B, C, D, E].join(',');
    expect(parseSelection(many)).toHaveLength(MAX_COMPARE_ITEMS);
    expect(parseSelection(many)).toEqual([A, B, C, D]);
  });

  it('takes the first value when the parameter repeats', () => {
    expect(parseSelection([`${A}`, `${B}`])).toEqual([A]);
  });

  it('tolerates whitespace around ids', () => {
    expect(parseSelection(` ${A} , ${B} `)).toEqual([A, B]);
  });
});

describe('compareHref', () => {
  it('is null below two items — there is nothing to compare', () => {
    expect(compareHref([])).toBeNull();
    expect(compareHref([A])).toBeNull();
  });

  it('builds a shareable link for a valid selection', () => {
    expect(compareHref([A, B])).toBe(`/app/compare?items=${A},${B}`);
  });

  it('never asks for more than the maximum', () => {
    const href = compareHref([A, B, C, D, E])!;
    expect(parseSelection(href.split('items=')[1])).toHaveLength(MAX_COMPARE_ITEMS);
  });

  it('round-trips through the parser', () => {
    const ids = [A, B, C];
    expect(parseSelection(serializeSelection(ids))).toEqual(ids);
  });
});

describe('toggleSelection', () => {
  it('adds an id that is not selected', () => {
    expect(toggleSelection([A], B)).toEqual([A, B]);
  });

  it('removes one that is', () => {
    expect(toggleSelection([A, B], A)).toEqual([B]);
  });

  it('refuses to grow past the maximum', () => {
    const full = [A, B, C, D];
    expect(toggleSelection(full, E)).toEqual(full);
  });

  it('still removes when full, so a full selection is not a trap', () => {
    expect(toggleSelection([A, B, C, D], B)).toEqual([A, C, D]);
  });

  it('does not mutate its input', () => {
    const current = [A];
    const next = toggleSelection(current, B);
    expect(current).toEqual([A]);
    expect(next).not.toBe(current);
  });
});
