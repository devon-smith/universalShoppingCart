import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { signOut } from '@/app/login/actions';
import type { SavedItemSummary } from '@/features/items/ItemCard';
import { ItemCard } from '@/features/items/ItemCard';
import { createServerSupabase } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Your carts · Universal Cart',
};

/** Per-user data; there is nothing here to prerender. */
export const dynamic = 'force-dynamic';

const ITEM_COLUMNS =
  'id, title, brand, retailer_name, source_url, image_url, currency, current_price, original_price, availability, selected_variant, note, quantity, status, last_observed_at';

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
      supabase
        .from('items')
        .select(ITEM_COLUMNS)
        .neq('status', 'archived')
        .order('updated_at', { ascending: false }),
    ]);

  const savedItems = (items ?? []) as unknown as SavedItemSummary[];

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

      <section aria-labelledby="items-heading" className="flex flex-col gap-3">
        <h2 id="items-heading" className="text-sm font-semibold">
          Saved products{savedItems.length > 0 ? ` (${savedItems.length})` : ''}
        </h2>

        {itemsError ? (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            Could not load your saved products: {itemsError.message}
          </p>
        ) : savedItems.length === 0 ? (
          <div className="flex flex-col gap-2 rounded-lg border border-dashed border-[var(--color-line)] px-4 py-6">
            <p className="text-sm font-medium">Nothing saved yet</p>
            <p className="text-sm text-[var(--color-ink-muted)]">
              Install the extension, open a product page, and click{' '}
              <strong>Capture this page</strong> in the side panel. What you save appears here.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {savedItems.map((item) => (
              <ItemCard key={item.id} item={item} />
            ))}
          </ul>
        )}
      </section>

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
