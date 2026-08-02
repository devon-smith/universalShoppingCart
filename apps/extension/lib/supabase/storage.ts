/**
 * Supabase session storage backed by extension-local storage.
 *
 * `chrome.storage.local` survives service-worker restarts and browser restarts, which
 * `localStorage` in an MV3 worker does not — the worker has no `localStorage` at all.
 * Only the Supabase session is stored here; no retailer cookies, tokens, or page data
 * ever touch extension storage (BUILD_PLAN.md §11.4, §17.1).
 */

/** The subset of `chrome.storage.StorageArea` this adapter needs. */
export interface ExtensionStorageArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

/** Matches `SupportedStorage` from `@supabase/supabase-js`. */
export interface SupabaseStorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export function createExtensionStorageAdapter(area: ExtensionStorageArea): SupabaseStorageAdapter {
  return {
    async getItem(key) {
      const stored = await area.get(key);
      const value = stored[key];
      // Anything that is not a string was not written by this adapter; treat it as absent
      // rather than handing Supabase a value it will fail to parse.
      return typeof value === 'string' ? value : null;
    },

    async setItem(key, value) {
      await area.set({ [key]: value });
    },

    async removeItem(key) {
      await area.remove(key);
    },
  };
}
