import { describe, expect, it } from 'vitest';

import { parseStoredLayout } from './layout-preference';

describe('parseStoredLayout', () => {
  it('returns a stored choice verbatim', () => {
    expect(parseStoredLayout('list')).toBe('list');
    expect(parseStoredLayout('cards')).toBe('cards');
  });

  it('falls back to cards when nothing was stored', () => {
    expect(parseStoredLayout(null)).toBe('cards');
  });

  it('ignores a value that names no layout, rather than rendering an unknown view', () => {
    // Old builds or manual edits can leave anything in localStorage.
    expect(parseStoredLayout('table')).toBe('cards');
    expect(parseStoredLayout('')).toBe('cards');
  });
});
