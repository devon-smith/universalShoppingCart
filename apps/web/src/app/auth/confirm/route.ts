import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { absoluteUrl, loginUrl } from '@/lib/auth/absolute-url';
import { safeRedirectPath } from '@/lib/auth/redirect';
import { createServerSupabase } from '@/lib/supabase/server';

const ALLOWED_TYPES = new Set<EmailOtpType>([
  'email',
  'magiclink',
  'signup',
  'invite',
  'recovery',
  'email_change',
]);

function isAllowedType(value: string | null): value is EmailOtpType {
  return value !== null && ALLOWED_TYPES.has(value as EmailOtpType);
}

/**
 * Magic-link confirmation.
 *
 * The email template points here with a single-use `token_hash`, which is verified
 * server-side so the session lands in cookies rather than in a URL fragment.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;
  const next = safeRedirectPath(searchParams.get('next'));
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type');

  if (!tokenHash || !isAllowedType(type)) {
    return NextResponse.redirect(loginUrl(request, { error: 'That sign-in link is not valid.' }));
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
    return NextResponse.redirect(loginUrl(request, { error: error.message, next }));
  }

  return NextResponse.redirect(absoluteUrl(next, request));
}
