import type { Database } from '@universal-cart/contracts';
import { createClient } from '@supabase/supabase-js';

import { getSupabaseConfig } from './config';

/**
 * A Supabase client authenticated as `service_role`, for server-only background work.
 *
 * It bypasses Row Level Security, so it may be created only in trusted server code that has
 * already authorised the caller — never in a component, a client bundle, or a route reachable
 * without the cron secret. The key is read from the server-only `SUPABASE_SERVICE_ROLE_KEY`; that
 * variable must never carry a `NEXT_PUBLIC_` prefix, or it would ship to the browser.
 */
export function createServiceRoleClient() {
  const { url } = getSupabaseConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  }
  return createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
