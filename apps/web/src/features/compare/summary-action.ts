'use server';

import { AiNotConfiguredError, isAiConfigured } from '@/lib/ai/anthropic';
import { createServerSupabase } from '@/lib/supabase/server';

import { compareItems, MIN_COMPARE_ITEMS, MAX_COMPARE_ITEMS } from './compare';
import { loadCompareItems } from './compare-query';
import { parseSelectionInput } from './selection';
import { buildComparisonFacts, type ComparisonSummary } from './summary';
import {
  AiSummaryInvalidError,
  AiSummaryRefusedError,
  generateComparisonSummary,
} from './summarize';
import { computeSetFingerprint, readCachedSummary, writeCachedSummary } from './summary-cache';

/**
 * Server Action behind the "Summarize with AI" button (BUILD_PLAN.md §16; Phase 8).
 *
 * The whole AI path lives server-side: the provider key never reaches the browser, and only the
 * grounded facts (never page HTML) are sent to the model. The action returns a small discriminated
 * result the panel renders — a configured-off deploy degrades to a clear message rather than an
 * error, a refusal and a fabrication are distinct outcomes, and a cache hit costs no tokens.
 */
export type SummarizeResult =
  | { status: 'ok'; summary: ComparisonSummary; model: string; cached: boolean }
  | { status: 'not_enough' }
  | { status: 'not_configured' }
  | { status: 'refused' }
  | { status: 'error'; message: string };

/**
 * Generate (or serve from cache) a fact-grounded summary of the given items.
 *
 * The ids are untrusted: `parseSelection` drops non-uuids, and RLS is the second gate, so a valid
 * uuid the caller cannot read simply does not load. A summary is cached only when every item
 * shares one cart — the cache is readable by anyone who can read that cart, so caching a cross-cart
 * comparison could expose one cart's facts to a reader of the other. Cross-cart comparisons are
 * still summarized; they are just not stored.
 */
export async function summarizeComparison(rawItemIds: unknown): Promise<SummarizeResult> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: 'error', message: 'You need to sign in to summarize.' };

  // The panel passes an array of individual ids; parseSelectionInput normalizes that (and a raw
  // string) through the same validate/dedupe/cap path the URL uses.
  const requested = parseSelectionInput(rawItemIds);
  if (requested.length < MIN_COMPARE_ITEMS || requested.length > MAX_COMPARE_ITEMS) {
    return { status: 'not_enough' };
  }

  const items = await loadCompareItems(supabase, requested);
  if (items.length < MIN_COMPARE_ITEMS) return { status: 'not_enough' };

  const comparison = compareItems(items.map((item) => ({ item, summary: null })));
  const facts = buildComparisonFacts(comparison);
  const fingerprint = computeSetFingerprint(facts);

  // Cache and provenance are cart-scoped; only single-cart comparisons are stored (see doc above).
  const cartIds = new Set(items.map((item) => item.cart_id));
  const cacheCartId = cartIds.size === 1 ? items[0]!.cart_id : null;

  if (cacheCartId) {
    const cached = await readCachedSummary(supabase, cacheCartId, fingerprint);
    if (cached) return { status: 'ok', summary: cached.summary, model: cached.model, cached: true };
  }

  if (!isAiConfigured()) return { status: 'not_configured' };

  try {
    // Load the Anthropic SDK only on the path that actually calls it. Keeping it out of this
    // module's static graph means the common paths — not configured, cache hit — never pay to
    // load a large provider SDK, and the action stays a fast DB-only round trip.
    const { createClaudeSummaryCall } = await import('./claude-call');
    const generated = await generateComparisonSummary(comparison, createClaudeSummaryCall());

    if (cacheCartId) {
      await writeCachedSummary(supabase, {
        cartId: cacheCartId,
        fingerprint,
        itemIds: items.map((item) => item.id),
        model: generated.model,
        promptVersion: generated.promptVersion,
        summary: generated.summary,
      });
    }

    return { status: 'ok', summary: generated.summary, model: generated.model, cached: false };
  } catch (error) {
    if (error instanceof AiNotConfiguredError) return { status: 'not_configured' };
    if (error instanceof AiSummaryRefusedError) return { status: 'refused' };
    if (error instanceof AiSummaryInvalidError) {
      // A grounding guardrail tripped (bad schema or a fabricated item). Do not surface internals;
      // the panel offers a retry.
      return { status: 'error', message: 'The summary could not be generated. Please try again.' };
    }
    return { status: 'error', message: 'Something went wrong generating the summary.' };
  }
}
