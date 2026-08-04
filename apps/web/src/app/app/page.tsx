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
 * Archived items are fetched too, so the archived section and undo work without a round
 * trip. At personal-cart scale that is a few dozen extra rows.
 *
 * Money columns are cast to `text`. PostgREST would otherwise return `numeric` as a JSON
 * number, and JSON numbers are IEEE doubles — the exact decimal the database holds would
 * be silently approximated on the way out (BUILD_PLAN.md §6.2).
 */
const ITEM_COLUMNS =
  'id, cart_id, title, brand, description, retailer_name, domain, source_url, canonical_url, image_url, currency, current_price::text, original_price::text, availability, product_availability, composition, selected_variant, identifiers, note, decision, quantity, priority, desired_price::text, status, last_observed_at, created_at, updated_at';

/**
 * The dashboard route.
 *
 * Fetches, authorises, and hands off. The chrome — navigation, cart selector, search, account
 * menu — lives in `AppShell`, which `ItemsView` composes, because all of it depends on client
 * state that the server has no view of.
 */
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

  const [{ data: carts }, { data: items, error: itemsError }] = await Promise.all([
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
  const cartList = carts ?? [];
  const cartIds = cartList.map((cart) => cart.id);

  if (itemsError) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-3 px-6">
        <h1 className="text-2xl font-semibold">Your saved products could not be loaded</h1>
        <p role="alert" className="text-sm text-[var(--uc-foreground-muted)]">
          {itemsError.message}
        </p>
      </main>
    );
  }

  return (
    <ItemsView
      initialItems={savedItems}
      priceSummaries={priceSummaries}
      cartIds={cartIds}
      carts={cartList}
      email={user.email ?? user.id}
      signOut={signOut}
    />
  );
}
