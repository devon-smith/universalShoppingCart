import type { Evidence, PartialCapture } from '@universal-cart/contracts';

import { SOURCE_RANK } from './types';

/**
 * Merge candidate field values from several extractors into one capture.
 *
 * The rule, per field: highest source rank wins; ties break on confidence; remaining ties
 * break on the order the candidates were supplied, which is extractor priority order. A
 * field that no extractor claimed stays absent, so the caller can distinguish "nobody
 * looked" from "looked and found nothing".
 *
 * Merging is driven entirely by the `evidence` each extractor reports. An extractor that
 * sets a value without evidence for it is ignored — that is deliberate, because the
 * evidence is what lets the UI explain a value and lets a test say which extractor is
 * wrong.
 */

/** Dotted paths that the merge engine knows how to resolve. */
export type MergeableField =
  | `source.${'url' | 'canonicalUrl' | 'domain' | 'retailerName' | 'pageTitle'}`
  | `product.${'title' | 'brand' | 'description' | 'imageUrls' | 'selectedImageUrl' | 'identifiers'}`
  | `offer.${'priceAmount' | 'originalPriceAmount' | 'currency' | 'availability' | 'variantAvailability'}`
  | 'selectedVariant';

export interface MergeResult {
  capture: PartialCapture;
  /** The evidence entry that won each field, keyed by dotted path. */
  winners: Map<string, Evidence>;
}

function readPath(capture: PartialCapture, path: string): unknown {
  const [section, key] = path.split('.') as [keyof PartialCapture, string | undefined];
  const container = capture[section];
  if (container === undefined) return undefined;
  if (key === undefined) return container;
  return (container as Record<string, unknown>)[key];
}

function writePath(target: PartialCapture, path: string, value: unknown): void {
  const [section, key] = path.split('.') as [string, string | undefined];
  const record = target as unknown as Record<string, unknown>;

  if (key === undefined) {
    record[section] = value;
    return;
  }

  const container = (record[section] ??= {}) as Record<string, unknown>;
  container[key] = value;
}

function beats(candidate: Evidence, incumbent: Evidence): boolean {
  const candidateRank = SOURCE_RANK[candidate.source];
  const incumbentRank = SOURCE_RANK[incumbent.source];
  if (candidateRank !== incumbentRank) return candidateRank > incumbentRank;
  return candidate.confidence > incumbent.confidence;
}

/**
 * Values that are present but carry no information. A `null` title from a high-priority
 * extractor must not beat a real title from a lower-priority one.
 */
function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value as object).length === 0;
  return false;
}

export function mergeCaptures(candidates: readonly PartialCapture[]): MergeResult {
  const capture: PartialCapture = { evidence: [] };
  const winners = new Map<string, Evidence>();
  const allEvidence: Evidence[] = [];

  for (const candidate of candidates) {
    for (const item of candidate.evidence) {
      allEvidence.push(item);

      const value = readPath(candidate, item.field);
      if (isEmptyValue(value)) continue;

      const incumbent = winners.get(item.field);
      if (incumbent && !beats(item, incumbent)) continue;

      winners.set(item.field, item);
      writePath(capture, item.field, value);
    }
  }

  // Every candidate's evidence is kept, not just the winning entries: the losing entries
  // are what make a disagreement between extractors visible in diagnostics.
  capture.evidence = allEvidence;

  return { capture, winners };
}

/**
 * Overall confidence: the mean of the winning evidence for the fields that matter most,
 * with missing fields counting as zero.
 *
 * Weighting title and price highest reflects what makes a saved product useful. A capture
 * with a perfect description and no price is not a good capture.
 */
const CONFIDENCE_WEIGHTS: ReadonlyArray<readonly [string, number]> = [
  ['product.title', 3],
  ['offer.priceAmount', 3],
  ['offer.currency', 1],
  ['product.selectedImageUrl', 1],
  ['offer.availability', 1],
];

export function overallConfidence(winners: ReadonlyMap<string, Evidence>): number {
  let weighted = 0;
  let total = 0;

  for (const [field, weight] of CONFIDENCE_WEIGHTS) {
    total += weight;
    const winner = winners.get(field);
    if (winner) weighted += weight * winner.confidence;
  }

  if (total === 0) return 0;
  return Math.round((weighted / total) * 1000) / 1000;
}
