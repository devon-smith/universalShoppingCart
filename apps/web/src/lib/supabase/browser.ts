'use client';

import type { Database } from '@universal-cart/contracts';
import { createBrowserClient } from '@supabase/ssr';

import { getSupabaseConfig } from './config';

let client: ReturnType<typeof createBrowserClient<Database>> | undefined;

/**
 * Browser Supabase client. `@supabase/ssr` stores the session in cookies so that the
 * same session is visible to React Server Components on the next request.
 */
export function getBrowserSupabase() {
  if (!client) {
    const { url, publishableKey } = getSupabaseConfig();
    client = createBrowserClient<Database>(url, publishableKey);
  }
  return client;
}
