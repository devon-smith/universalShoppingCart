import type { Database } from '@universal-cart/contracts';
import { createServerClient } from '@supabase/ssr';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { absoluteUrl, loginUrl } from '@/lib/auth/absolute-url';

import { isSupabaseConfigured, getSupabaseConfig } from './config';

/** Routes that require a signed-in user. Everything else is public. */
export const PROTECTED_PREFIXES = ['/app'] as const;

/** Routes a signed-in user has no reason to see. */
export const SIGNED_OUT_ONLY_PREFIXES = ['/login'] as const;

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function isSignedOutOnlyPath(pathname: string): boolean {
  return SIGNED_OUT_ONLY_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Refresh the Supabase session on every matched request and gate protected routes.
 *
 * The refreshed cookies have to be written onto the response that is actually returned,
 * which is why the response object is created up front and handed to the client.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  if (!isSupabaseConfigured()) {
    // Nothing to refresh and nothing to protect: an unconfigured deployment has no users.
    return response;
  }

  const { url, publishableKey } = getSupabaseConfig();

  const supabase = createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;

  if (!user && isProtectedPath(pathname)) {
    return NextResponse.redirect(loginUrl(request, { next: `${pathname}${search}` }));
  }

  if (user && isSignedOutOnlyPath(pathname)) {
    return NextResponse.redirect(absoluteUrl('/app', request));
  }

  return response;
}
