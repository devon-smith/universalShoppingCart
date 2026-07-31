import { describe, expect, it, vi } from 'vitest';

import type { PreferenceStore } from './preferences';
import {
  DEFAULT_PREFERENCES,
  PREFERENCES_KEY,
  parsePreferences,
  readPreferences,
  themeAttribute,
  writePreferences,
} from './preferences';

/** A stand-in for `chrome.storage.local` that keeps one record in memory. */
function memoryStore(initial: Record<string, unknown> = {}): PreferenceStore & {
  contents: Record<string, unknown>;
} {
  const contents: Record<string, unknown> = { ...initial };
  return {
    contents,
    get: async (key: string) => (key in contents ? { [key]: contents[key] } : {}),
    set: async (items: Record<string, unknown>) => {
      Object.assign(contents, items);
    },
  };
}

describe('parsePreferences', () => {
  it('reads a well-formed record', () => {
    expect(parsePreferences({ theme: 'dark', defaultCartId: 'cart-1' })).toEqual({
      theme: 'dark',
      defaultCartId: 'cart-1',
    });
  });

  it.each([null, undefined, 'dark', 42, []])('falls back for %p', (raw) => {
    // An array is an object, so it reaches the field checks and comes back all-defaults.
    expect(parsePreferences(raw)).toEqual(DEFAULT_PREFERENCES);
  });

  it('rejects a theme it does not implement rather than writing it to the document', () => {
    expect(parsePreferences({ theme: 'solarized' }).theme).toBe('system');
  });

  it('treats an empty cart id as no preference', () => {
    expect(parsePreferences({ defaultCartId: '' }).defaultCartId).toBeNull();
  });

  it('ignores a non-string cart id', () => {
    expect(parsePreferences({ defaultCartId: { id: 'x' } }).defaultCartId).toBeNull();
  });
});

describe('readPreferences', () => {
  it('returns defaults when nothing has been stored', async () => {
    expect(await readPreferences(memoryStore())).toEqual(DEFAULT_PREFERENCES);
  });

  it('returns what was stored', async () => {
    const store = memoryStore({ [PREFERENCES_KEY]: { theme: 'light', defaultCartId: 'c' } });
    expect(await readPreferences(store)).toEqual({ theme: 'light', defaultCartId: 'c' });
  });

  it('falls back to defaults when storage itself fails', async () => {
    const broken: PreferenceStore = {
      get: vi.fn().mockRejectedValue(new Error('storage unavailable')),
      set: vi.fn(),
    };
    expect(await readPreferences(broken)).toEqual(DEFAULT_PREFERENCES);
  });
});

describe('writePreferences', () => {
  it('merges a patch over what is there, leaving the rest alone', async () => {
    const store = memoryStore({ [PREFERENCES_KEY]: { theme: 'dark', defaultCartId: 'c' } });

    const next = await writePreferences(store, { theme: 'light' });

    expect(next).toEqual({ theme: 'light', defaultCartId: 'c' });
    expect(store.contents[PREFERENCES_KEY]).toEqual({ theme: 'light', defaultCartId: 'c' });
  });

  it('writes under one key, so nothing else in extension storage is disturbed', async () => {
    const store = memoryStore({ 'universal-cart-auth': { token: 'kept' } });

    await writePreferences(store, { theme: 'dark' });

    expect(store.contents['universal-cart-auth']).toEqual({ token: 'kept' });
  });
});

describe('themeAttribute', () => {
  it('leaves the OS query to answer for "system"', () => {
    expect(themeAttribute('system')).toBeNull();
  });

  it('overrides for an explicit choice', () => {
    expect(themeAttribute('light')).toBe('light');
    expect(themeAttribute('dark')).toBe('dark');
  });
});
