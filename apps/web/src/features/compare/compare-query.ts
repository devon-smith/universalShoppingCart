import type { SupabaseClient } from '@supabase/supabase-js';

import type { CompareItem } from './compare';

/**
 * The columns a comparison renders, and the loader that fetches them in the caller's order.
 *
 * Shared by the compare page and the summarize action so the two cannot drift on which fields a
 * comparison is built from. Money is cast to `text` because PostgREST would otherwise return
 * `numeric` as a JSON number — an IEEE double — and money must stay an exact decimal string
 * (BUILD_PLAN.md §6.2).
 */
export const COMPARE_COLUMNS =
  'id, cart_id, title, brand, description, retailer_name, domain, source_url, canonical_url, image_url, currency, current_price::text, original_price::text, availability, product_availability, composition, selected_variant, identifiers, note, quantity, priority, desired_price::text, status, last_observed_at, created_at, updated_at';

/**
 * Load the requested items, back in the order they were asked for.
 *
 * `in()` returns rows in whatever order Postgres finds them; a comparison whose columns shuffle
 * between loads is disorienting, so the caller's order is restored here. RLS is the access gate —
 * ids belonging to another account simply do not come back, so fewer rows than ids means some
 * were private or deleted, which the caller detects by comparing lengths.
 */
export async function loadCompareItems(
  supabase: SupabaseClient,
  requested: string[],
): Promise<CompareItem[]> {
  const { data } = await supabase.from('items').select(COMPARE_COLUMNS).in('id', requested);
  const found = (data ?? []) as unknown as CompareItem[];
  return requested
    .map((id) => found.find((item) => item.id === id))
    .filter((item): item is CompareItem => item !== undefined);
}
