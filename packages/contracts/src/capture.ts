import { z } from 'zod';

/**
 * `ProductCaptureV1` — what the extension produces from a product page and what the
 * ingestion function consumes (BUILD_PLAN.md §6).
 *
 * Design rules this schema enforces rather than merely documents:
 * - Money is a decimal string. Never a JavaScript number: `0.1 + 0.2` is not a price.
 * - Currency is an ISO 4217 code when known, `null` otherwise. Never guessed.
 * - Unknown values are `null` or the explicit `unknown` availability, never invented.
 * - Evidence is per field, so the UI can explain uncertainty and a regression test can
 *   say which extractor produced a wrong value.
 * - Nothing here can carry page HTML, cookies, or tokens: every field is a named scalar.
 */

export const CAPTURE_SCHEMA_VERSION = 1 as const;

/** Availability, normalized from schema.org URLs, meta tags, and DOM signals. */
export const availabilitySchema = z.enum([
  'in_stock',
  'out_of_stock',
  'preorder',
  'backorder',
  'unknown',
]);
export type Availability = z.infer<typeof availabilitySchema>;

/** Where a field value came from, in ascending order of trust. */
export const evidenceSourceSchema = z.enum(['dom', 'meta', 'json_ld', 'adapter', 'user']);
export type EvidenceSource = z.infer<typeof evidenceSourceSchema>;

/**
 * A decimal money amount, as a string.
 *
 * Accepts an optional sign, digits, and an optional fractional part. Rejects exponent
 * notation, thousands separators, and empty fractions — normalization happens before
 * validation, so anything reaching here should already be canonical.
 */
export const decimalStringSchema = z
  .string()
  .regex(/^-?\d+(\.\d+)$/, { error: 'Money must be a decimal string such as "19.99"' });

/** ISO 4217 alphabetic code. */
export const currencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, { error: 'Currency must be an ISO 4217 code such as "USD"' });

const httpUrlSchema = z.url({ protocol: /^https?$/, error: 'Must be an http(s) URL' });

export const evidenceSchema = z.object({
  /** Dotted path into the capture, e.g. `offer.priceAmount`. */
  field: z.string().min(1),
  source: evidenceSourceSchema,
  /** Optional CSS selector or JSON pointer, for diagnosing a regression. */
  selector: z.string().optional(),
  confidence: z.number().min(0).max(1),
  /**
   * What this source actually claimed, recorded only when sources disagreed.
   *
   * Present on every entry for a contested field so diagnostics can show the argument —
   * "JSON-LD said 76, the page said 78" — rather than only the value that won.
   */
  value: z.string().optional(),
});
export type Evidence = z.infer<typeof evidenceSchema>;

export const captureSourceSchema = z.object({
  url: httpUrlSchema,
  canonicalUrl: httpUrlSchema.nullable(),
  domain: z.string().min(1),
  retailerName: z.string().min(1),
  pageTitle: z.string().nullable(),
});

export const productIdentifiersSchema = z.object({
  sku: z.string().min(1).optional(),
  gtin: z.string().min(1).optional(),
  mpn: z.string().min(1).optional(),
  productId: z.string().min(1).optional(),
  /**
   * The retailer's id for the *selected variant* — Shopify's `?variant=47776291946739`,
   * or `variants[].id` in its product JSON. It is an identifier, not an option the
   * shopper chose, so it lives here rather than in `selectedVariant`; but it is the only
   * per-variant identifier on platforms whose `sku` is product-level, which makes it the
   * thing that keeps two sizes of one garment from fingerprinting alike.
   */
  variantId: z.string().min(1).optional(),
});
export type ProductIdentifiers = z.infer<typeof productIdentifiersSchema>;

export const captureProductSchema = z.object({
  title: z.string().nullable(),
  brand: z.string().nullable(),
  description: z.string().nullable(),
  imageUrls: z.array(httpUrlSchema),
  selectedImageUrl: httpUrlSchema.nullable(),
  identifiers: productIdentifiersSchema,
  /**
   * Fibre content, as the page published it — "100% cotton", "Shell: 100% wool; Lining:
   * 52% polyester". A raw string, deliberately not normalized (docs/DECISIONS.md,
   * 2026-08-02): it describes the garment, so it is retailer-observed, and it is never in
   * `selectedVariant` because that feeds the fingerprint. Null when the page did not say.
   */
  composition: z.string().nullable(),
});

export const captureOfferSchema = z.object({
  priceAmount: decimalStringSchema.nullable(),
  originalPriceAmount: decimalStringSchema.nullable(),
  currency: currencyCodeSchema.nullable(),
  /**
   * Availability of the thing the user is buying: the selected variant where one can be
   * identified, the product otherwise. This is the field that gets saved and shown.
   */
  availability: availabilitySchema,
  /**
   * What the page says about the *product*, when that is a different claim.
   *
   * "Is this product sold" and "is this size available" are two facts, and a garment is
   * almost always in stock in some size — so a single field collapsing them is nearly always
   * `in_stock` and nearly always uninformative. Kept separate so both survive: Nike still
   * sells this shoe, your 6.5 is gone. Absent when nothing product-level was claimed, or
   * when it agrees with `availability`.
   */
  productAvailability: availabilitySchema.optional(),
});

export const captureExtractionSchema = z.object({
  extractorId: z.string().min(1),
  extractorVersion: z.string().min(1),
  overallConfidence: z.number().min(0).max(1),
  observedAt: z.iso.datetime({ error: 'observedAt must be an ISO 8601 timestamp' }),
});

export const productCaptureV1Schema = z.object({
  schemaVersion: z.literal(CAPTURE_SCHEMA_VERSION),
  source: captureSourceSchema,
  product: captureProductSchema,
  offer: captureOfferSchema,
  /** Only the options currently selected, never the full option matrix. */
  selectedVariant: z.record(z.string().min(1), z.string()),
  evidence: z.array(evidenceSchema),
  extraction: captureExtractionSchema,
});

export type ProductCaptureV1 = z.infer<typeof productCaptureV1Schema>;
export type CaptureSource = z.infer<typeof captureSourceSchema>;
export type CaptureProduct = z.infer<typeof captureProductSchema>;
export type CaptureOffer = z.infer<typeof captureOfferSchema>;
export type CaptureExtraction = z.infer<typeof captureExtractionSchema>;

/**
 * A partial capture, as returned by a single extractor before merging.
 *
 * Every field is optional and `evidence` is the only required part, because an extractor
 * reports what it found — and how sure it is — rather than a complete product.
 */
export interface PartialCapture {
  source?: Partial<CaptureSource>;
  product?: Partial<CaptureProduct>;
  offer?: Partial<CaptureOffer> & {
    /**
     * Availability of the *selected option*, when the page identifies one.
     *
     * Pre-merge only: the pipeline resolves it into `availability` and it never reaches a
     * saved capture. It is a separate path rather than a competing claim on `availability`
     * because the two answer different questions, and ranking them against each other would
     * have structured data — which only ever speaks about the product — win an argument it
     * is not having.
     */
    variantAvailability?: Availability;
  };
  selectedVariant?: Record<string, string>;
  evidence: Evidence[];
}

export function parseProductCaptureV1(payload: unknown): ProductCaptureV1 {
  return productCaptureV1Schema.parse(payload);
}

export function safeParseProductCaptureV1(payload: unknown) {
  return productCaptureV1Schema.safeParse(payload);
}
