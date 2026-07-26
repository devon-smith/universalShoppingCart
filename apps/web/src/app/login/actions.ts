'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { safeRedirectPath } from '@/lib/auth/redirect';
import { createServerSupabase } from '@/lib/supabase/server';

const emailSchema = z.email({ error: 'Enter a valid email address' });

async function originFromRequest(): Promise<string> {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get('x-forwarded-host');
  const host = forwardedHost ?? requestHeaders.get('host');
  const proto = requestHeaders.get('x-forwarded-proto') ?? 'http';

  if (host) return `${proto}://${host}`;
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
}

function loginRedirect(params: Record<string, string>): never {
  const search = new URLSearchParams(params);
  // Without this the client router keeps serving the `/login` payload it already has,
  // and the `sent` / `error` message this redirect carries is never rendered.
  revalidatePath('/login');
  redirect(`/login?${search.toString()}`);
}

/**
 * Start the Google OAuth flow.
 *
 * Supabase returns an authorization URL rather than performing the redirect itself, so
 * the browser is sent there explicitly. The provider secret lives in the Supabase project
 * configuration and never reaches this process.
 */
export async function signInWithGoogle(formData: FormData): Promise<void> {
  const next = safeRedirectPath(formData.get('next')?.toString());
  const origin = await originFromRequest();
  const supabase = await createServerSupabase();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      queryParams: {
        // Ask for a refresh token so the session survives a browser restart.
        access_type: 'offline',
        prompt: 'consent',
      },
    },
  });

  if (error || !data.url) {
    loginRedirect({
      next,
      error: error?.message ?? 'Google sign-in is unavailable right now.',
    });
  }

  redirect(data.url);
}

/** Send a one-time magic link. Used when Google sign-in is unavailable or unwanted. */
export async function sendMagicLink(formData: FormData): Promise<void> {
  const next = safeRedirectPath(formData.get('next')?.toString());
  const parsedEmail = emailSchema.safeParse(formData.get('email')?.toString().trim());

  if (!parsedEmail.success) {
    loginRedirect({ next, error: 'Enter a valid email address.' });
  }

  const origin = await originFromRequest();
  const supabase = await createServerSupabase();

  const { error } = await supabase.auth.signInWithOtp({
    email: parsedEmail.data,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(next)}`,
    },
  });

  if (error) {
    loginRedirect({ next, error: error.message });
  }

  loginRedirect({ next, sent: parsedEmail.data });
}

/** Sign out and drop the session cookies. */
export async function signOut(): Promise<void> {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  redirect('/login');
}
