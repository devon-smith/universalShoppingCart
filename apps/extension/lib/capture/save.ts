import type { Json, ProductCaptureV1, Tables } from '@universal-cart/contracts';
import { computeFingerprint } from '@universal-cart/extractors';

/**
 * Save a capture through the atomic ingestion function.
 *
 * The fingerprint is computed here rather than server-side because the normalization it
 * depends on lives in `packages/extractors` and must produce identical values on every
 * surface. The database verifies its shape and scopes it to the cart, so a wrong value
 * can only affect the caller's own deduplication.
 */

export type SavedItem = Tables<'items'>;

export interface SaveResult {
  item: SavedItem;
  /** False when an existing item was refreshed instead. */
  created: boolean;
  observationInserted: boolean;
}

/** User-authored fields, sent alongside the capture and never overwritten by a refresh. */
export interface UserFields {
  title?: string;
  priceAmount?: string;
  currency?: string;
  note?: string;
  quantity?: number;
  priority?: 'low' | 'normal' | 'high';
  desiredPrice?: string;
  status?: 'saved' | 'cart' | 'purchased' | 'archived';
}

export type CaptureSource = 'capture' | 'revisit' | 'manual' | 'background';

/** The narrow slice of the Supabase client this module needs. */
export interface IngestCapableClient {
  rpc(
    name: 'ingest_product_capture',
    params: {
      p_capture: Json;
      p_cart_id: string;
      p_fingerprint: string;
      p_user_fields: Json;
      p_source: CaptureSource;
    },
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export class SaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveError';
  }
}

export async function fingerprintFor(capture: ProductCaptureV1): Promise<string> {
  return computeFingerprint({
    canonicalUrl: capture.source.canonicalUrl,
    url: capture.source.url,
    selectedVariant: capture.selectedVariant,
    identifiers: capture.product.identifiers,
  });
}

export async function saveCapture(deps: {
  client: IngestCapableClient;
  capture: ProductCaptureV1;
  cartId: string;
  userFields?: UserFields;
  source?: CaptureSource;
}): Promise<SaveResult> {
  const fingerprint = await fingerprintFor(deps.capture);

  const { data, error } = await deps.client.rpc('ingest_product_capture', {
    // The capture and user fields are plain serializable objects; `Json` is the shape
    // the generated RPC signature expects.
    p_capture: deps.capture as unknown as Json,
    p_cart_id: deps.cartId,
    p_fingerprint: fingerprint,
    p_user_fields: (deps.userFields ?? {}) as unknown as Json,
    p_source: deps.source ?? 'capture',
  });

  if (error) {
    throw new SaveError(error.message);
  }

  const result = data as { created?: boolean; observationInserted?: boolean; item?: SavedItem };
  if (!result?.item) {
    throw new SaveError('The save did not return an item.');
  }

  return {
    item: result.item,
    created: result.created === true,
    observationInserted: result.observationInserted === true,
  };
}
