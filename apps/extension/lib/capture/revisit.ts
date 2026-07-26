import type { ProductCaptureV1 } from '@universal-cart/contracts';

import { fingerprintFor, saveCapture } from './save';
import type { IngestCapableClient, SavedItem } from './save';

/**
 * Revisit matching and refresh (BUILD_PLAN.md §14.1).
 *
 * When the panel opens on a page the user has already saved, the observed price and
 * availability are re-recorded. Nothing is sent anywhere unless a saved item matches — the
 * extraction happened locally, so opening the panel on an unsaved page leaves no trace.
 *
 * The match is by fingerprint, so it is the same product *and the same variant*. A
 * different size of a saved shoe is a different item, not a refresh of one.
 */

export interface RevisitMatch {
  itemId: string;
  cartId: string;
  title: string;
}

/**
 * Look up a saved item by fingerprint.
 *
 * A function rather than a client shape: the Supabase query builder's generics do not
 * survive being described structurally, and the only thing this module needs is the answer.
 */
export type ItemLookup = (fingerprint: string) => Promise<RevisitMatch | null>;

/** What the caller's query must hand back. */
export interface ItemLookupRow {
  id: string;
  cart_id: string;
  title: string;
}

export type ItemLookupQuery = (
  fingerprint: string,
) => PromiseLike<{ data: ItemLookupRow[] | null; error: { message: string } | null }>;

/**
 * Turn a fingerprint query into a lookup.
 *
 * The query itself is supplied by the caller so it can be written against the real
 * Supabase client and keep its generics; this function owns the part worth testing —
 * mapping a result set, and failing closed when the query errors.
 */
export function itemLookup(query: ItemLookupQuery): ItemLookup {
  return async (fingerprint) => {
    const { data, error } = await query(fingerprint);
    if (error || !data || data.length === 0) return null;

    const match = data[0]!;
    return { itemId: match.id, cartId: match.cart_id, title: match.title };
  };
}

export async function findSavedItem(deps: {
  lookup: ItemLookup;
  capture: ProductCaptureV1;
}): Promise<RevisitMatch | null> {
  return deps.lookup(await fingerprintFor(deps.capture));
}

export interface RevisitResult {
  match: RevisitMatch;
  item: SavedItem;
  /** False when nothing tracked had changed since the last observation. */
  observationInserted: boolean;
}

/**
 * Re-observe a saved item from the page in front of the user.
 *
 * No user fields are sent, so the ingestion function has nothing to write over the note,
 * quantity, priority, desired price, or status even in principle.
 */
export async function refreshFromPage(deps: {
  client: IngestCapableClient;
  lookup: ItemLookup;
  capture: ProductCaptureV1;
}): Promise<RevisitResult | null> {
  const match = await findSavedItem({ lookup: deps.lookup, capture: deps.capture });
  if (!match) return null;

  const result = await saveCapture({
    client: deps.client,
    capture: deps.capture,
    cartId: match.cartId,
    source: 'revisit',
  });

  return {
    match,
    item: result.item,
    observationInserted: result.observationInserted,
  };
}
