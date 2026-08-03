import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { CompareTable } from '@/features/compare/CompareTable';
import type { CompareInput } from '@/features/compare/compare';
import { compareItems, MAX_COMPARE_ITEMS, MIN_COMPARE_ITEMS } from '@/features/compare/compare';
import { loadCompareItems } from '@/features/compare/compare-query';
import { ComparisonSummaryPanel } from '@/features/compare/ComparisonSummaryPanel';
import { OpenAllByRetailer } from '@/features/compare/OpenAllByRetailer';
import { parseSelection } from '@/features/compare/selection';
import { buildComparisonFacts } from '@/features/compare/summary';
import type { SummarizeResult } from '@/features/compare/summary-action';
import { computeSetFingerprint, readCachedSummary } from '@/features/compare/summary-cache';
import type { PriceSummary } from '@/features/items/query';
import { isAiConfigured } from '@/lib/ai/anthropic';
import { createServerSupabase } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Compare · Universal Cart',
};

export const dynamic = 'force-dynamic';

/**
 * The compare route.
 *
 * The selection is in the URL, so this page is shareable, survives a reload, and can be
 * reached by the back button — see `selection.ts`. That also means the ids are untrusted
 * input: `parseSelection` drops anything that is not a uuid before a query is built, and
 * RLS is the second gate, so a valid uuid belonging to somebody else returns nothing rather
 * than somebody else's product.
 */
export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createServerSupabase();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The middleware already redirects unauthenticated requests; this is the second gate, so a
  // middleware misconfiguration cannot expose the page.
  if (!user) redirect('/login?next=%2Fapp');

  const requested = parseSelection((await searchParams).items);

  if (requested.length < MIN_COMPARE_ITEMS) {
    return <NotEnough count={requested.length} />;
  }

  const items = await loadCompareItems(supabase, requested);

  // Fewer rows than ids means some belong to another account, or were deleted since the link
  // was made. Say so rather than silently comparing whatever survived.
  const missing = requested.length - items.length;

  if (items.length < MIN_COMPARE_ITEMS) {
    return <NotEnough count={items.length} missing={missing} />;
  }

  const { data: summaryRows } = await supabase
    .from('item_price_summary')
    .select(
      'item_id, latest_price::text, latest_observed_at, previous_price::text, previous_observed_at, observation_count',
    )
    .in(
      'item_id',
      items.map((item) => item.id),
    );

  const summaries = new Map(
    ((summaryRows ?? []) as unknown as PriceSummary[]).map((row) => [row.item_id, row]),
  );

  const inputs: CompareInput[] = items.map((item) => ({
    item,
    summary: summaries.get(item.id) ?? null,
  }));

  const comparison = compareItems(inputs);

  // A cached AI summary is shown immediately on a shared link, with no request and no tokens
  // spent — generation itself is an explicit click in the panel. The cache is cart-scoped, so
  // only look one up when every item shares a cart (see summary-action for why).
  const comparedIds = items.map((item) => item.id);
  const cartIds = new Set(items.map((item) => item.cart_id));
  let initialSummary: SummarizeResult | null = null;
  if (cartIds.size === 1) {
    const fingerprint = computeSetFingerprint(buildComparisonFacts(comparison));
    const cached = await readCachedSummary(supabase, items[0]!.cart_id, fingerprint);
    if (cached) {
      initialSummary = { status: 'ok', summary: cached.summary, model: cached.model, cached: true };
    }
  }

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-2">
        <Link
          href="/app"
          className="uc-focusable w-fit rounded-[var(--uc-radius-control)] text-sm text-[var(--uc-primary)]"
        >
          ← Back to your cart
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">
          Comparing {items.length} {items.length === 1 ? 'product' : 'products'}
        </h1>
        {missing > 0 ? (
          <p className="uc-callout uc-callout--warning text-sm" role="note">
            {missing} of the products in this link could not be shown. They may have been deleted,
            or belong to a different account.
          </p>
        ) : null}
      </header>

      <CompareTable comparison={comparison} />

      <ComparisonSummaryPanel
        itemIds={comparedIds}
        initial={initialSummary}
        configured={isAiConfigured()}
      />

      <OpenAllByRetailer items={items} />
    </main>
  );
}

/** Two is the fewest that can be compared; one is just an item. */
function NotEnough({ count, missing = 0 }: { count: number; missing?: number }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-3 px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Nothing to compare yet</h1>
      <p className="text-sm text-[var(--uc-foreground-muted)]">
        {missing > 0
          ? 'The products in this link are no longer available to you — they may have been deleted, or belong to a different account.'
          : count === 1
            ? 'A comparison needs at least two products. Pick one more from your cart.'
            : `Choose two to ${MAX_COMPARE_ITEMS} saved products, then open them side by side.`}
      </p>
      <Link href="/app" className="uc-button uc-button--primary uc-focusable w-fit">
        Back to your cart
      </Link>
    </main>
  );
}
