import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { signOut } from '@/app/login/actions';
import { ItemsView } from '@/features/items/ItemsView';
import type { PriceSummary, SavedItem } from '@/features/items/query';
import { createServerSupabase } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Your carts · Universal Cart',
};

/** Per-user data; there is nothing here to prerender. */
export const dynamic = 'force-dynamic';

/**
 * Archived items are fetched too, so the archived filter and undo work without a round
 * trip. At personal-cart scale that is a few dozen extra rows.
 *
 * Money columns are cast to `text`. PostgREST would otherwise return `numeric` as a JSON
 * number, and JSON numbers are IEEE doubles — the exact decimal the database holds would
 * be silently approximated on the way out (BUILD_PLAN.md §6.2).
 */
const ITEM_COLUMNS =
  'id, cart_id, title, brand, description, retailer_name, domain, source_url, canonical_url, image_url, currency, current_price::text, original_price::text, availability, selected_variant, identifiers, note, quantity, priority, desired_price::text, status, last_observed_at, created_at, updated_at';

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

  const [{ data: profile }, { data: carts }, { data: items, error: itemsError }] =
    await Promise.all([
      supabase.from('profiles').select('display_name').eq('id', user.id).single(),
      supabase
        .from('carts')
        .select('id, name, is_default')
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: true }),
      supabase.from('items').select(ITEM_COLUMNS).order('updated_at', { ascending: false }),
    ]);

  // One extra query for every card's price-change badge, rather than one per card.
  const { data: summaries } = await supabase
    .from('item_price_summary')
    .select(
      'item_id, latest_price::text, latest_observed_at, previous_price::text, previous_observed_at, observation_count',
    );

  const savedItems = (items ?? []) as unknown as SavedItem[];
  const priceSummaries = (summaries ?? []) as unknown as PriceSummary[];
  const cartIds = (carts ?? []).map((cart) => cart.id);

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-6 py-12">
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

      {itemsError ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          Could not load your saved products: {itemsError.message}
        </p>
      ) : (
        <ItemsView initialItems={savedItems} priceSummaries={priceSummaries} cartIds={cartIds} />
      )}

      <section aria-labelledby="carts-heading" className="flex flex-col gap-3">
        <h2 id="carts-heading" className="text-sm font-semibold">
          Carts
        </h2>
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
      </section>
    </main>
  );
}
