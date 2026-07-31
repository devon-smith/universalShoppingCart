import type { Metadata } from 'next';
import Link from 'next/link';

import { safeRedirectPath } from '@/lib/auth/redirect';
import { isSupabaseConfigured } from '@/lib/supabase/config';

import { sendMagicLink, signInWithGoogle } from './actions';

export const metadata: Metadata = {
  title: 'Sign in · Universal Cart',
};

/**
 * Rendered per request. Without this, Next serves a prerendered `/login` and the client
 * router keeps reusing it, so the `sent` and `error` messages that the sign-in actions
 * redirect back with never appear.
 */
export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Sign in.
 *
 * The mechanism is untouched by the redesign: the same two server actions, the same magic
 * link, the same `next` sanitisation. What changed is that the page says what the account is
 * for before asking for an address, and looks like the rest of the product.
 */
export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const next = safeRedirectPath(first(params.next));
  const error = first(params.error);
  const sentTo = first(params.sent);

  if (!isSupabaseConfigured()) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6">
        <h1 className="text-2xl font-semibold">Universal Cart cannot start</h1>
        <p className="text-sm leading-relaxed text-[var(--uc-foreground-muted)]">
          This deployment is missing part of its setup, so it cannot reach any accounts. If you are
          running it locally, start Supabase with <code>pnpm supabase:start</code> and copy the
          printed API URL and publishable key into <code>apps/web/.env.local</code>.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-6 py-16">
      <header className="flex flex-col gap-3">
        <Link href="/" className="uc-wordmark w-fit text-xl tracking-tight">
          Universal Cart
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm leading-relaxed text-[var(--uc-foreground-muted)]">
          One account for the dashboard and the browser extension, so what you save in one shows up
          in the other.
        </p>
      </header>

      {error ? (
        <p role="alert" className="uc-callout uc-callout--danger">
          {error}
        </p>
      ) : null}

      {sentTo ? (
        <p role="status" className="uc-callout uc-callout--success">
          Check <strong>{sentTo}</strong> for a sign-in link.
        </p>
      ) : null}

      <form action={signInWithGoogle}>
        <input type="hidden" name="next" value={next} />
        <button
          type="submit"
          className="uc-button uc-button--secondary uc-button--full uc-focusable"
        >
          Continue with Google
        </button>
      </form>

      <div className="flex items-center gap-3 text-xs text-[var(--uc-foreground-muted)]">
        <span className="h-px flex-1 bg-[var(--uc-border)]" />
        or
        <span className="h-px flex-1 bg-[var(--uc-border)]" />
      </div>

      <form action={sendMagicLink} className="flex flex-col gap-3">
        <input type="hidden" name="next" value={next} />
        <div className="uc-field">
          <label className="uc-field__label" htmlFor="email">
            Email address
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            className="uc-input uc-focusable"
          />
        </div>
        <button type="submit" className="uc-button uc-button--primary uc-button--full uc-focusable">
          Email me a sign-in link
        </button>
        <p className="text-xs leading-relaxed text-[var(--uc-foreground-muted)]">
          We will send you a link. No password to invent or forget.
        </p>
      </form>

      <p className="border-t border-[var(--uc-border)] pt-6 text-xs leading-relaxed text-[var(--uc-foreground-muted)]">
        Universal Cart never stores retailer passwords, cookies, or payment details.
      </p>
    </main>
  );
}
