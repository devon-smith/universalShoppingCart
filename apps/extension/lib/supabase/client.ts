import type { Database } from '@universal-cart/contracts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';

import { getSupabaseConfig } from './config';
import { createExtensionStorageAdapter } from './storage';

export type UniversalCartSupabase = SupabaseClient<Database>;

let client: UniversalCartSupabase | undefined;

/**
 * The extension's Supabase client.
 *
 * - Sessions persist in `chrome.storage.local` so a service-worker restart or a browser
 *   restart does not sign the user out.
 * - `detectSessionInUrl` is off: extension pages are never an OAuth redirect target;
 *   the authorization code is handled explicitly by the identity flow.
 * - PKCE, because a browser extension cannot keep a client secret.
 */
export function getSupabase(): UniversalCartSupabase {
  if (!client) {
    const { url, publishableKey } = getSupabaseConfig();
    client = createClient<Database>(url, publishableKey, {
      auth: {
        storage: createExtensionStorageAdapter(chrome.storage.local),
        storageKey: 'universal-cart-auth',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: 'pkce',
      },
    });
  }
  return client;
}

/** Test seam: drops the memoized client. */
export function resetSupabaseForTests(): void {
  client = undefined;
}
