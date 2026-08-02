import Link from 'next/link';

import { getCurrentUser } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/config';

const capabilities = [
  'Sign in with Google or a one-time email link',
  'One default cart created for you, automatically',
  'Row-level access control — nobody else can read your carts',
  'The same account in the dashboard and the browser extension',
];

export default async function HomePage() {
  const user = isSupabaseConfigured() ? await getCurrentUser() : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-8 px-6 py-16">
      <header className="flex flex-col gap-3">
        <p className="text-sm font-medium tracking-wide text-[var(--color-accent)] uppercase">
          Phase 1 — accounts and access control
        </p>
        <h1 className="text-4xl font-semibold tracking-tight">Universal Cart</h1>
        <p className="text-base text-[var(--color-ink-muted)]">
          A personal, cloud-synced shopping list. The extension captures the product you are looking
          at; this app stores, compares, and shares what you saved.
        </p>
      </header>

      <section aria-labelledby="capabilities-heading" className="flex flex-col gap-3">
        <h2 id="capabilities-heading" className="text-sm font-semibold">
          What works today
        </h2>
        <ul className="flex flex-col gap-2">
          {capabilities.map((entry) => (
            <li
              key={entry}
              className="rounded-md border border-[var(--color-line)] px-3 py-2 text-sm text-[var(--color-ink-muted)]"
            >
              {entry}
            </li>
          ))}
        </ul>
      </section>

      <div className="flex gap-3">
        <Link
          href={user ? '/app' : '/login'}
          className="rounded-md bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white"
        >
          {user ? 'Go to your carts' : 'Sign in'}
        </Link>
      </div>

      <footer className="text-xs text-[var(--color-ink-muted)]">
        Product capture, the dashboard, and sharing arrive in later phases.
      </footer>
    </main>
  );
}
