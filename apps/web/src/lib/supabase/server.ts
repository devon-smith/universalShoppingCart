import type { Database } from '@universal-cart/contracts';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { getSupabaseConfig } from './config';

/**
 * Supabase client for Server Components, Server Actions, and Route Handlers.
 *
 * Server Components cannot write cookies, so the setter is a no-op there; the refresh
 * that a Server Component would have written is performed by the middleware instead.
 */
export async function createServerSupabase() {
  // Read cookies first: this marks the render dynamic, so a build without Supabase
  // configuration fails at request time with a clear message instead of failing to
  // prerender a page that was never static in the first place.
  const cookieStore = await cookies();
  const { url, publishableKey } = getSupabaseConfig();

  return createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component. Safe to ignore — see the note above.
        }
      },
    },
  });
}

/**
 * The signed-in user, verified against the Auth server.
 *
 * Always prefer this over reading the session cookie: the cookie is attacker-supplied
 * until `getUser()` has validated it.
 */
export async function getCurrentUser() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
