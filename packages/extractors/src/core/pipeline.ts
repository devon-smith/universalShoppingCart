import type { ProductCaptureV1 } from '@universal-cart/contracts';
import { CAPTURE_SCHEMA_VERSION, safeParseProductCaptureV1 } from '@universal-cart/contracts';

import { RETAILER_ADAPTERS } from '../adapters/registry';
import { domExtractor, struckOriginalForValue } from '../generic/dom';
import { jsonLdExtractor } from '../generic/json-ld';
import { metaExtractor } from '../generic/meta';
import { extractVariantIdFromUrl } from '../generic/variant';
import { normalizeUrl } from '../normalize-url';
import { domainFromUrl, retailerNameFromDomain } from '../normalizers/text';

import { mergeCaptures, overallConfidence } from './merge';
import type { ExtractionContext, ProductExtractor } from './types';
import { evidence } from './types';

/**
 * The generic extraction pipeline (BUILD_PLAN.md §10.2).
 *
 * Runs every extractor that supports the page, merges their claims by source rank and
 * confidence, fills in the fields that come from the URL rather than the page, and
 * validates the result. A capture that fails validation is returned as a failure with the
 * issues attached, never silently repaired.
 */

export const GENERIC_PIPELINE_ID = 'generic';
export const GENERIC_PIPELINE_VERSION = '1.0.0';

/**
 * Ordered highest-priority first: retailer adapters, then structured data, then meta tags,
 * then DOM heuristics. The generic layers always run, so an adapter whose selectors have
 * rotted degrades to the generic result instead of to nothing.
 */
export const DEFAULT_EXTRACTORS: readonly ProductExtractor[] = [
  ...RETAILER_ADAPTERS,
  jsonLdExtractor,
  metaExtractor,
  domExtractor,
];

/** An extractor that threw. Recorded rather than swallowed, so a crash is visible. */
export interface ExtractorFailure {
  extractorId: string;
  phase: 'supports' | 'extract';
  message: string;
}

export interface ExtractionSuccess {
  ok: true;
  capture: ProductCaptureV1;
  /** Extractors that claimed at least one field, highest priority first. */
  contributors: string[];
  /**
   * Adapters whose `supports()` matched the page, whether or not they then found anything.
   * A matched adapter that contributed nothing is the signature of rotted selectors.
   */
  matchedAdapters: string[];
  /** Empty on a healthy page. A non-empty list means an extractor needs fixing. */
  extractorFailures: ExtractorFailure[];
}

export interface ExtractionFailure {
  ok: false;
  issues: string[];
  /** The capture as assembled, for diagnostics. Not safe to save. */
  draft: unknown;
  matchedAdapters: string[];
  extractorFailures: ExtractorFailure[];
}

export type ExtractionResult = ExtractionSuccess | ExtractionFailure;

export interface ExtractOptions {
  extractors?: readonly ProductExtractor[];
  /** Injected so a test can assert on a fixed timestamp. */
  now?: () => Date;
}

export function extractProductCapture(
  context: ExtractionContext,
  options: ExtractOptions = {},
): ExtractionResult {
  const extractors = [...(options.extractors ?? DEFAULT_EXTRACTORS)].sort(
    (a, b) => b.priority - a.priority,
  );
  const now = options.now ?? (() => new Date());

  const adapterIds = new Set(RETAILER_ADAPTERS.map((adapter) => adapter.id));
  const contributors: string[] = [];
  const matchedAdapters: string[] = [];
  const extractorFailures: ExtractorFailure[] = [];

  const candidates = extractors
    .filter((extractor) => {
      try {
        const supported = extractor.supports(context);
        if (supported && adapterIds.has(extractor.id)) matchedAdapters.push(extractor.id);
        return supported;
      } catch (error) {
        // A broken extractor must never prevent a capture (BUILD_PLAN.md §24) — but it
        // must also not disappear, or a crash looks exactly like an empty page.
        extractorFailures.push({
          extractorId: extractor.id,
          phase: 'supports',
          message: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    })
    .map((extractor) => {
      try {
        const result = extractor.extract(context);
        if (result.evidence.length > 0) contributors.push(extractor.id);
        return result;
      } catch (error) {
        extractorFailures.push({
          extractorId: extractor.id,
          phase: 'extract',
          message: error instanceof Error ? error.message : String(error),
        });
        return { evidence: [] };
      }
    });

  /**
   * What to record as the extractor that produced this capture.
   *
   * The highest-priority adapter that actually contributed a field, if any — that is the
   * code whose version needs to appear beside the observation, because it is the code that
   * will need fixing when the page changes. A page with no adapter, or one whose adapter
   * found nothing, is a generic-pipeline capture and says so.
   */
  const winningAdapter =
    extractors.find(
      (extractor) => adapterIds.has(extractor.id) && contributors.includes(extractor.id),
    ) ?? null;

  const { capture: merged, winners } = mergeCaptures(candidates);

  const domain = domainFromUrl(context.url);
  if (domain === null) {
    return {
      ok: false,
      issues: [`Page URL is not an http(s) URL: ${context.url}`],
      draft: merged,
      matchedAdapters,
      extractorFailures,
    };
  }

  // Normalized whatever its source. An extractor reports the canonical link as the page
  // wrote it — with `www.`, a trailing slash, whatever — while the fallback was already
  // normalized, so the same page yielded a different shape depending on which layer spoke.
  // The fingerprint normalizes again before hashing, so this is about the stored value being
  // consistent rather than about duplicate detection.
  const canonicalUrl =
    normalizeUrl(merged.source?.canonicalUrl ?? context.url) ?? merged.source?.canonicalUrl ?? null;

  // Two different facts, resolved rather than ranked. The selected option's availability is
  // what the user is buying, so it wins where the page identifies one; the product-level
  // claim stands otherwise, which is every page without option controls. Where they disagree
  // both are kept — "Nike still sells this shoe, your 6.5 is gone" beats either half alone.
  const variantAvailability = merged.offer?.variantAvailability;
  const claimedAvailability = merged.offer?.availability;
  const availability = variantAvailability ?? claimedAvailability ?? 'unknown';
  const productAvailability =
    claimedAvailability !== undefined && claimedAvailability !== availability
      ? claimedAvailability
      : undefined;

  // Like the canonical URL above, a `?variant=` id is a fact about the page rather than a
  // layer's claim, so it is resolved here rather than merged: an adapter that read the id
  // out of the page's own data wins, and the URL fills in for the generic path. Identifiers
  // merge whole-object by source rank, so without this a JSON-LD `{sku}` would silently
  // discard a URL-only variant id.
  const identifiers = { ...(merged.product?.identifiers ?? {}) };
  if (!identifiers.variantId) {
    const urlVariantId = extractVariantIdFromUrl(context.url);
    if (urlVariantId) identifiers.variantId = urlVariantId;
  }

  // A former price the DOM shows but no layer captured. The strikethrough rule inside the
  // DOM extractor anchors on a price element the DOM tier found — but on pages whose price
  // comes from JSON-LD (Nike, Wayfair, Zalando, Amazon) the DOM tier finds none, so the
  // rule never runs even though the struck former price is visible. Here the merged current
  // price supplies the anchor by value, so it works whichever layer produced the price.
  // Resolved rather than merged, like the canonical URL and the variant id above.
  let originalPriceAmount = merged.offer?.originalPriceAmount ?? null;
  if (originalPriceAmount === null && merged.offer?.priceAmount) {
    const struck = struckOriginalForValue(context.document, merged.offer.priceAmount);
    if (struck) {
      originalPriceAmount = struck.amount;
      merged.evidence.push(evidence('offer.originalPriceAmount', 'dom', 0.5, struck.selector));
    }
  }

  const draft = {
    schemaVersion: CAPTURE_SCHEMA_VERSION,
    source: {
      url: context.url,
      canonicalUrl,
      domain,
      retailerName: merged.source?.retailerName ?? retailerNameFromDomain(domain),
      pageTitle: merged.source?.pageTitle ?? null,
    },
    product: {
      title: merged.product?.title ?? null,
      brand: merged.product?.brand ?? null,
      description: merged.product?.description ?? null,
      imageUrls: merged.product?.imageUrls ?? [],
      selectedImageUrl: merged.product?.selectedImageUrl ?? null,
      identifiers,
      composition: merged.product?.composition ?? null,
    },
    offer: {
      priceAmount: merged.offer?.priceAmount ?? null,
      originalPriceAmount,
      currency: merged.offer?.currency ?? null,
      availability,
      ...(productAvailability === undefined ? {} : { productAvailability }),
    },
    selectedVariant: merged.selectedVariant ?? {},
    evidence: merged.evidence,
    extraction: {
      extractorId: winningAdapter?.id ?? GENERIC_PIPELINE_ID,
      extractorVersion: winningAdapter?.version ?? GENERIC_PIPELINE_VERSION,
      overallConfidence: overallConfidence(winners),
      observedAt: now().toISOString(),
    },
  };

  const parsed = safeParseProductCaptureV1(draft);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      ),
      draft,
      matchedAdapters,
      extractorFailures,
    };
  }

  return { ok: true, capture: parsed.data, contributors, matchedAdapters, extractorFailures };
}

/**
 * Fields a user should be asked about before saving.
 *
 * Title and price are what make a saved product recognizable and comparable; everything
 * else can stay unknown without the item being useless.
 */
export function fieldsNeedingReview(capture: ProductCaptureV1, threshold = 0.6): string[] {
  const needsReview: string[] = [];
  const confidenceFor = (field: string): number | null => {
    const entries = capture.evidence.filter((item) => item.field === field);
    if (entries.length === 0) return null;
    return Math.max(...entries.map((item) => item.confidence));
  };

  if (capture.product.title === null) {
    needsReview.push('product.title');
  } else if ((confidenceFor('product.title') ?? 0) < threshold) {
    needsReview.push('product.title');
  }

  if (capture.offer.priceAmount === null) {
    needsReview.push('offer.priceAmount');
  } else if ((confidenceFor('offer.priceAmount') ?? 0) < threshold) {
    needsReview.push('offer.priceAmount');
  }

  if (capture.offer.priceAmount !== null && capture.offer.currency === null) {
    needsReview.push('offer.currency');
  }

  return needsReview;
}
