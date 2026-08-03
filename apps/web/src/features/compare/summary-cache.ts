import 'server-only';

import { createHash } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  factsFingerprintInput,
  summarySchema,
  type ComparisonFacts,
  type ComparisonSummary,
} from './summary';

/**
 * The provenance store as a cache (BUILD_PLAN.md §16.2; migration 20260803180000).
 *
 * A comparison summary is deterministic in its grounded facts, so the same facts should never be
 * billed to the provider twice. The cache key is a sha256 of `factsFingerprintInput` — which
 * already folds in the model and prompt version, so a prompt change misses the cache and
 * regenerates rather than serving a stale answer. Hashing is done here, in Node, and the DB only
 * stores the string, so the two sides cannot drift over a hash implementation.
 *
 * Everything here runs under the caller's authenticated client, so RLS is the access boundary:
 * a read or write only touches carts the user can read.
 */

/** The sha256 cache key for a set of grounded facts. Stable and reproducible for equal facts. */
export function computeSetFingerprint(facts: ComparisonFacts): string {
  return createHash('sha256').update(factsFingerprintInput(facts)).digest('hex');
}

/** A cached summary with the provenance stored alongside it. */
export interface CachedSummary {
  summary: ComparisonSummary;
  model: string;
  promptVersion: string;
}

/**
 * Read the cached summary for a fingerprint in a cart, or null on a miss.
 *
 * Validates the stored JSON against the schema before returning it: a row written under an older
 * schema that no longer parses is treated as a miss, not rendered blindly.
 */
export async function readCachedSummary(
  supabase: SupabaseClient,
  cartId: string,
  fingerprint: string,
): Promise<CachedSummary | null> {
  const { data } = await supabase
    .from('comparison_summaries')
    .select('summary, model, prompt_version')
    .eq('cart_id', cartId)
    .eq('set_fingerprint', fingerprint)
    .maybeSingle();

  if (!data) return null;

  const parsed = summarySchema.safeParse(data.summary);
  if (!parsed.success) return null;

  return { summary: parsed.data, model: data.model, promptVersion: data.prompt_version };
}

/**
 * Store a generated summary. A concurrent request may have written the same fingerprint first;
 * the unique index turns that into an ignorable conflict, so a lost race is never an error the
 * user sees — they already have an identical summary.
 */
export async function writeCachedSummary(
  supabase: SupabaseClient,
  input: {
    cartId: string;
    fingerprint: string;
    itemIds: string[];
    model: string;
    promptVersion: string;
    summary: ComparisonSummary;
  },
): Promise<void> {
  await supabase.from('comparison_summaries').insert({
    cart_id: input.cartId,
    set_fingerprint: input.fingerprint,
    item_ids: input.itemIds,
    model: input.model,
    prompt_version: input.promptVersion,
    summary: input.summary,
  });
  // A 23505 (duplicate fingerprint) is expected under a race and intentionally ignored: the
  // stored row is identical, and the caller returns its freshly-generated copy regardless.
}
