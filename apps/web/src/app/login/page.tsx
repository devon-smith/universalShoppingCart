import type { Metadata } from 'next';

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

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const next = safeRedirectPath(first(params.next));
  const error = first(params.error);
  const sentTo = first(params.sent);

  if (!isSupabaseConfigured()) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6">
        <h1 className="text-2xl font-semibold">Supabase is not configured</h1>
        <p className="text-sm text-[var(--color-ink-muted)]">
          Run <code>pnpm supabase:start</code>, then copy the printed API URL and publishable key
          into <code>apps/web/.env.local</code>.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-6 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-[var(--color-ink-muted)]">
          Universal Cart syncs your saved products between this dashboard and the browser extension.
        </p>
      </header>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        >
          {error}
        </p>
      ) : null}

      {sentTo ? (
        <p
          role="status"
          className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
        >
          Check <strong>{sentTo}</strong> for a sign-in link.
        </p>
      ) : null}

      <form action={signInWithGoogle}>
        <input type="hidden" name="next" value={next} />
        <button
          type="submit"
          className="w-full rounded-md border border-[var(--color-line)] px-4 py-2.5 text-sm font-medium hover:bg-[var(--color-surface-muted)]"
        >
          Continue with Google
        </button>
      </form>

      <div className="flex items-center gap-3 text-xs text-[var(--color-ink-muted)]">
        <span className="h-px flex-1 bg-[var(--color-line)]" />
        or
        <span className="h-px flex-1 bg-[var(--color-line)]" />
      </div>

      <form action={sendMagicLink} className="flex flex-col gap-3">
        <input type="hidden" name="next" value={next} />
        <label className="flex flex-col gap-1.5 text-sm" htmlFor="email">
          Email address
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            className="rounded-md border border-[var(--color-line)] px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          className="w-full rounded-md bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white"
        >
          Email me a sign-in link
        </button>
      </form>

      <p className="text-xs text-[var(--color-ink-muted)]">
        Universal Cart never stores retailer passwords, cookies, or payment details.
      </p>
    </main>
  );
}
