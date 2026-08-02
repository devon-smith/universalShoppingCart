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
  | `product.${'title' | 'brand' | 'description' | 'composition' | 'imageUrls' | 'selectedImageUrl' | 'identifiers'}`
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

/**
 * Fields where two sources reporting different values means one of them is wrong.
 *
 * Deliberately narrow. Titles, descriptions and image URLs differ between layers as a matter
 * of course — JSON-LD's name is punctuated differently from the `<h1>`, a gallery URL carries
 * a different size suffix — and flagging those would put a warning on nearly every capture,
 * which trains the user to dismiss warnings. These four are exact values where a difference is
 * a genuine contradiction.
 */
const CONTESTABLE_FIELDS: ReadonlySet<string> = new Set([
  'offer.priceAmount',
  'offer.originalPriceAmount',
  'offer.currency',
  'offer.availability',
]);

/**
 * Confidence assigned to a contested field, below the 0.6 review threshold in
 * `fieldsNeedingReview` so the preview asks the user before saving.
 */
const CONTESTED_CONFIDENCE = 0.4;

interface Observation {
  item: Evidence;
  value: unknown;
}

/**
 * Fields where two *independent* sources made different claims.
 *
 * Independence is what makes a difference meaningful: two DOM heuristics disagreeing is one
 * layer being imprecise, while JSON-LD and the rendered page disagreeing means the structured
 * data is stale or describes something else. StockX publishes 76 in JSON-LD and renders 78,
 * and 78 is the price you pay.
 *
 * A field the user has corrected is never contested — their answer is the answer.
 */
function contestedFields(observations: readonly Observation[]): Set<string> {
  const claims = new Map<string, Map<string, Set<string>>>();
  const corrected = new Set<string>();

  for (const { item, value } of observations) {
    if (!CONTESTABLE_FIELDS.has(item.field)) continue;
    if (item.source === 'user') {
      corrected.add(item.field);
      continue;
    }
    if (isEmptyValue(value)) continue;

    const byValue = claims.get(item.field) ?? new Map<string, Set<string>>();
    const sources = byValue.get(String(value)) ?? new Set<string>();
    sources.add(item.source);
    byValue.set(String(value), sources);
    claims.set(item.field, byValue);
  }

  const contested = new Set<string>();
  for (const [field, byValue] of claims) {
    if (corrected.has(field) || byValue.size < 2) continue;

    // Two different values are only a contradiction if they came from different layers.
    const sources = new Set<string>();
    for (const claimants of byValue.values()) {
      for (const source of claimants) sources.add(source);
    }
    if (sources.size >= 2) contested.add(field);
  }

  return contested;
}

export function mergeCaptures(candidates: readonly PartialCapture[]): MergeResult {
  const capture: PartialCapture = { evidence: [] };
  const winners = new Map<string, Evidence>();
  const observations: Observation[] = [];

  for (const candidate of candidates) {
    for (const item of candidate.evidence) {
      const value = readPath(candidate, item.field);
      observations.push({ item, value });
      if (isEmptyValue(value)) continue;

      const incumbent = winners.get(item.field);
      if (incumbent && !beats(item, incumbent)) continue;

      winners.set(item.field, item);
      writePath(capture, item.field, value);
    }
  }

  // Which source wins is unchanged: structured data is still the better guess, and swapping
  // the ranking on a disagreement would just make the DOM authoritative instead. What changes
  // is how sure the capture claims to be — BUILD_PLAN.md §10.3 calls structured data evidence,
  // not absolute truth, and a layer contradicting it is exactly the evidence that it is wrong.
  const contested = contestedFields(observations);

  // Every candidate's evidence is kept, not just the winning entries: the losing entries are
  // what make a disagreement visible in diagnostics. Contested entries are rewritten rather
  // than edited in place, because these objects belong to the extractors that returned them.
  capture.evidence = observations.map(({ item, value }) => {
    if (!contested.has(item.field)) return item;
    return {
      ...item,
      confidence: Math.min(item.confidence, CONTESTED_CONFIDENCE),
      ...(isEmptyValue(value) ? {} : { value: String(value) }),
    };
  });

  for (const item of capture.evidence) {
    const winner = winners.get(item.field);
    if (winner && contested.has(item.field) && winner.source === item.source) {
      winners.set(item.field, item);
    }
  }

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
