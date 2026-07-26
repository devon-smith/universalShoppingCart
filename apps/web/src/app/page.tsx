import { cn } from '@universal-cart/ui';

import { publicEnv } from '@/lib/env';

const phaseZeroChecklist = [
  'pnpm workspace + Turborepo task graph',
  'Next.js App Router web app',
  'WXT + React Manifest V3 extension with a side panel',
  'Shared contracts, extractors, ui, config, and test-utils packages',
  'Local Supabase configuration and migration directory',
  'GitHub Actions running lint, typecheck, test, and build',
];

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-8 px-6 py-16">
      <header className="flex flex-col gap-3">
        <p className="text-sm font-medium tracking-wide text-[var(--color-accent)] uppercase">
          Phase 0 — repository foundation
        </p>
        <h1 className="text-4xl font-semibold tracking-tight">Universal Cart</h1>
        <p className="text-base text-[var(--color-ink-muted)]">
          A personal, cloud-synced shopping list. The extension captures the product you are looking
          at; this app stores, compares, and shares what you saved.
        </p>
      </header>

      <section aria-labelledby="scaffold-heading" className="flex flex-col gap-3">
        <h2 id="scaffold-heading" className="text-sm font-semibold">
          What is wired up so far
        </h2>
        <ul className="flex flex-col gap-2">
          {phaseZeroChecklist.map((entry) => (
            <li
              key={entry}
              className={cn(
                'rounded-md border border-[var(--color-line)] px-3 py-2 text-sm',
                'text-[var(--color-ink-muted)]',
              )}
            >
              {entry}
            </li>
          ))}
        </ul>
      </section>

      <footer className="text-xs text-[var(--color-ink-muted)]">
        Serving from <code>{publicEnv.NEXT_PUBLIC_APP_URL}</code>. Authentication, capture, and the
        dashboard arrive in later phases.
      </footer>
    </main>
  );
}
