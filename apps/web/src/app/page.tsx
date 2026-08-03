import Link from 'next/link';

import { isSupabaseConfigured } from '@/lib/supabase/config';
import { getCurrentUser } from '@/lib/supabase/server';

/**
 * The landing page.
 *
 * It used to open with "Phase 1 — accounts and access control" and close with "product
 * capture, the dashboard, and sharing arrive in later phases". Both were true when written
 * and are now false: capture, the dashboard, price history and adapters all ship. A first
 * visitor was reading a changelog written for the person building it, describing a product
 * less capable than the one they were about to use.
 *
 * What replaces it says what the thing does, in the order somebody unfamiliar needs it. Every
 * claim maps to shipped behaviour — in particular "re-checked when you revisit" rather than
 * "tracked", because nothing runs in the background yet (BUILD_PLAN.md §14.2).
 */
const STEPS = [
  {
    title: 'Capture what you are considering',
    body: 'On any product page, one click in the browser extension saves the photograph, price, the size and colour you picked, and where it came from.',
  },
  {
    title: 'Put the candidates together',
    body: 'Three jackets from three shops in one list, instead of fifteen tabs you are afraid to close.',
  },
  {
    title: 'See what moved',
    body: 'Revisit a page and its price is re-checked. Your notes and your target price are yours, and survive every refresh.',
  },
] as const;

export default async function HomePage() {
  const user = isSupabaseConfigured() ? await getCurrentUser() : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-10 px-6 py-16">
      <header className="flex flex-col gap-4">
        <h1 className="uc-wordmark text-4xl tracking-tight sm:text-5xl">Universal Cart</h1>
        <p className="max-w-xl text-lg leading-relaxed text-[var(--uc-foreground-muted)]">
          A shopping list for deciding. Save the things you are choosing between — from any shop —
          and compare them in one place instead of across a dozen open tabs.
        </p>
      </header>

      <section aria-labelledby="how-heading" className="flex flex-col gap-4">
        <h2 id="how-heading" className="sr-only">
          How it works
        </h2>
        <ol className="flex flex-col gap-4">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-4">
              <span
                aria-hidden="true"
                className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--uc-border-strong)] text-sm font-semibold"
              >
                {index + 1}
              </span>
              <div className="flex flex-col gap-1">
                <p className="font-semibold">{step.title}</p>
                <p className="text-sm leading-relaxed text-[var(--uc-foreground-muted)]">
                  {step.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <div className="flex flex-wrap items-center gap-4">
        <Link href={user ? '/app' : '/login'} className="uc-button uc-button--primary uc-focusable">
          {user ? 'Go to your carts' : 'Sign in'}
        </Link>
        <p className="text-sm text-[var(--uc-foreground-muted)]">
          Your carts are private unless you share one.
        </p>
      </div>

      <footer className="border-t border-[var(--uc-border)] pt-6 text-sm text-[var(--uc-foreground-muted)]">
        The extension reads a product page only when you ask it to. It never touches your cookies,
        your browsing history, or your payment details, and it never stores a retailer password.
      </footer>
    </main>
  );
}
