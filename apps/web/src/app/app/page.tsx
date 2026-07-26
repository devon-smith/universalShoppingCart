import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { signOut } from '@/app/login/actions';
import { createServerSupabase } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Your carts · Universal Cart',
};

/** Per-user data; there is nothing here to prerender. */
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const supabase = await createServerSupabase();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The middleware already redirects unauthenticated requests; this is the second gate,
  // so a middleware misconfiguration cannot expose the page.
  if (!user) {
    redirect('/login?next=%2Fapp');
  }

  const [{ data: profile }, { data: carts, error: cartsError }] = await Promise.all([
    supabase.from('profiles').select('display_name, default_currency').eq('id', user.id).single(),
    supabase
      .from('carts')
      .select('id, name, description, is_default, created_at')
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true }),
  ]);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {profile?.display_name ? `Hi, ${profile.display_name}` : 'Your carts'}
          </h1>
          <p className="text-sm text-[var(--color-ink-muted)]">
            Signed in as {user.email ?? user.id}
          </p>
        </div>
        <form action={signOut}>
          <button
            type="submit"
            className="rounded-md border border-[var(--color-line)] px-3 py-1.5 text-sm hover:bg-[var(--color-surface-muted)]"
          >
            Sign out
          </button>
        </form>
      </header>

      <section aria-labelledby="carts-heading" className="flex flex-col gap-3">
        <h2 id="carts-heading" className="text-sm font-semibold">
          Carts
        </h2>

        {cartsError ? (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            Could not load your carts: {cartsError.message}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {(carts ?? []).map((cart) => (
              <li
                key={cart.id}
                className="flex items-center justify-between rounded-md border border-[var(--color-line)] px-3 py-2.5"
              >
                <span className="text-sm font-medium">{cart.name}</span>
                {cart.is_default ? (
                  <span className="text-xs text-[var(--color-ink-muted)]">Default</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        aria-labelledby="next-heading"
        className="flex flex-col gap-2 rounded-md border border-[var(--color-line)] px-4 py-3"
      >
        <h2 id="next-heading" className="text-sm font-semibold">
          Nothing to save yet
        </h2>
        <p className="text-sm text-[var(--color-ink-muted)]">
          Product capture lands in Phase 2. Until then this page proves that sign-in, the default
          cart, and row-level access control work end to end.
        </p>
      </section>
    </main>
  );
}
