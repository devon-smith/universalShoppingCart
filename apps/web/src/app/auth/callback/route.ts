import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { absoluteUrl, loginUrl } from '@/lib/auth/absolute-url';
import { safeRedirectPath } from '@/lib/auth/redirect';
import { createServerSupabase } from '@/lib/supabase/server';

/**
 * OAuth (PKCE) callback.
 *
 * The provider redirects here with an authorization code, which is exchanged for a
 * session. The exchange writes the session cookies through the server client.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;
  const next = safeRedirectPath(searchParams.get('next'));

  const providerError = searchParams.get('error_description') ?? searchParams.get('error');
  if (providerError) {
    return NextResponse.redirect(loginUrl(request, { error: providerError, next }));
  }

  const code = searchParams.get('code');
  if (!code) {
    return NextResponse.redirect(
      loginUrl(request, { error: 'Sign-in link was missing its authorization code.' }),
    );
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(loginUrl(request, { error: error.message, next }));
  }

  return NextResponse.redirect(absoluteUrl(next, request));
}
