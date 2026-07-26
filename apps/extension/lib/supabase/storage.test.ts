import { describe, expect, it } from 'vitest';

import type { ExtensionStorageArea } from './storage';
import { createExtensionStorageAdapter } from './storage';

function fakeArea(initial: Record<string, unknown> = {}): ExtensionStorageArea & {
  data: Record<string, unknown>;
} {
  const data: Record<string, unknown> = { ...initial };
  return {
    data,
    async get(keys) {
      const wanted = typeof keys === 'string' ? [keys] : keys;
      const result: Record<string, unknown> = {};
      for (const key of wanted) {
        if (key in data) result[key] = data[key];
      }
      return result;
    },
    async set(items) {
      Object.assign(data, items);
    },
    async remove(keys) {
      const unwanted = typeof keys === 'string' ? [keys] : keys;
      for (const key of unwanted) delete data[key];
    },
  };
}

describe('createExtensionStorageAdapter', () => {
  it('round-trips a value', async () => {
    const area = fakeArea();
    const storage = createExtensionStorageAdapter(area);

    await storage.setItem('sb-session', '{"access_token":"abc"}');
    expect(await storage.getItem('sb-session')).toBe('{"access_token":"abc"}');
    expect(area.data['sb-session']).toBe('{"access_token":"abc"}');
  });

  it('returns null for a key that was never written', async () => {
    const storage = createExtensionStorageAdapter(fakeArea());
    expect(await storage.getItem('sb-session')).toBeNull();
  });

  it('treats a non-string value as absent rather than passing it through', async () => {
    const storage = createExtensionStorageAdapter(fakeArea({ 'sb-session': { token: 'abc' } }));
    expect(await storage.getItem('sb-session')).toBeNull();
  });

  it('removes a value so sign-out leaves nothing behind', async () => {
    const area = fakeArea({ 'sb-session': 'value' });
    const storage = createExtensionStorageAdapter(area);

    await storage.removeItem('sb-session');
    expect(await storage.getItem('sb-session')).toBeNull();
    expect('sb-session' in area.data).toBe(false);
  });

  it('does not disturb unrelated keys', async () => {
    const area = fakeArea({ 'sb-session': 'value', 'pending-captures': '[]' });
    const storage = createExtensionStorageAdapter(area);

    await storage.removeItem('sb-session');
    expect(area.data['pending-captures']).toBe('[]');
  });
});
