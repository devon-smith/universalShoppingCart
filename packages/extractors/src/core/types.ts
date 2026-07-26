import type { Evidence, EvidenceSource, PartialCapture } from '@universal-cart/contracts';

/**
 * What an extractor is given.
 *
 * A `Document` plus the page URL, and nothing else. No cookies, no storage, no network.
 * `url` is passed explicitly rather than read from the document so the same extractor can
 * run against a fixture parsed from a string.
 */
export interface ExtractionContext {
  document: Document;
  url: string;
}

export interface ProductExtractor {
  id: string;
  version: string;
  /** Higher runs first, and wins ties during merge. */
  priority: number;
  supports(context: ExtractionContext): boolean;
  extract(context: ExtractionContext): PartialCapture;
}

/**
 * Trust ordering for evidence sources.
 *
 * A user correction always wins. A retailer adapter beats structured data because it was
 * written against the specific page. Structured data beats meta tags, which beat DOM
 * heuristics — heuristics are the last resort precisely because they guess.
 */
export const SOURCE_RANK: Record<EvidenceSource, number> = {
  user: 5,
  adapter: 4,
  json_ld: 3,
  meta: 2,
  dom: 1,
};

export function evidence(
  field: string,
  source: EvidenceSource,
  confidence: number,
  selector?: string,
): Evidence {
  return selector === undefined
    ? { field, source, confidence }
    : { field, source, confidence, selector };
}
