import type { ProductCaptureV1 } from '@universal-cart/contracts';
import { CAPTURE_SCHEMA_VERSION, safeParseProductCaptureV1 } from '@universal-cart/contracts';

import { domExtractor } from '../generic/dom';
import { jsonLdExtractor } from '../generic/json-ld';
import { metaExtractor } from '../generic/meta';
import { normalizeUrl } from '../normalize-url';
import { domainFromUrl, retailerNameFromDomain } from '../normalizers/text';

import { mergeCaptures, overallConfidence } from './merge';
import type { ExtractionContext, ProductExtractor } from './types';

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

/** Ordered highest-priority first. Retailer adapters slot in above these in Phase 5. */
export const DEFAULT_EXTRACTORS: readonly ProductExtractor[] = [
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
  /** Empty on a healthy page. A non-empty list means an extractor needs fixing. */
  extractorFailures: ExtractorFailure[];
}

export interface ExtractionFailure {
  ok: false;
  issues: string[];
  /** The capture as assembled, for diagnostics. Not safe to save. */
  draft: unknown;
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

  const contributors: string[] = [];
  const extractorFailures: ExtractorFailure[] = [];

  const candidates = extractors
    .filter((extractor) => {
      try {
        return extractor.supports(context);
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

  const { capture: merged, winners } = mergeCaptures(candidates);

  const domain = domainFromUrl(context.url);
  if (domain === null) {
    return {
      ok: false,
      issues: [`Page URL is not an http(s) URL: ${context.url}`],
      draft: merged,
      extractorFailures,
    };
  }

  const canonicalUrl = merged.source?.canonicalUrl ?? normalizeUrl(context.url) ?? null;

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
      identifiers: merged.product?.identifiers ?? {},
    },
    offer: {
      priceAmount: merged.offer?.priceAmount ?? null,
      originalPriceAmount: merged.offer?.originalPriceAmount ?? null,
      currency: merged.offer?.currency ?? null,
      availability: merged.offer?.availability ?? 'unknown',
    },
    selectedVariant: merged.selectedVariant ?? {},
    evidence: merged.evidence,
    extraction: {
      extractorId: GENERIC_PIPELINE_ID,
      extractorVersion: GENERIC_PIPELINE_VERSION,
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
      extractorFailures,
    };
  }

  return { ok: true, capture: parsed.data, contributors, extractorFailures };
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
