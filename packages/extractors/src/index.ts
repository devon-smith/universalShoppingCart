/**
 * Pure product-extraction and normalization logic.
 *
 * Package rules (BUILD_PLAN.md §5.1):
 * - no Supabase calls, no React, no extension storage
 * - DOM-facing functions may accept a `Document`, but every output must be serializable
 * - no remote code and no `eval`
 */

export { normalizeUrl, TRACKING_PARAMETER_PREFIXES, TRACKING_PARAMETERS } from './normalize-url';
export type { NormalizeUrlOptions } from './normalize-url';

export { normalizeAvailability } from './normalizers/availability';
export {
  detectCurrency,
  normalizeCurrency,
  normalizePrice,
  normalizePriceAmount,
} from './normalizers/price';
export type { NormalizePriceResult } from './normalizers/price';
export {
  absoluteHttpUrl,
  domainFromUrl,
  normalizeText,
  normalizeTextCapped,
  retailerNameFromDomain,
  unique,
} from './normalizers/text';

export { evidence, SOURCE_RANK } from './core/types';
export type { ExtractionContext, ProductExtractor } from './core/types';
export { mergeCaptures, overallConfidence } from './core/merge';
export type { MergeResult } from './core/merge';
export {
  DEFAULT_EXTRACTORS,
  extractProductCapture,
  fieldsNeedingReview,
  GENERIC_PIPELINE_ID,
  GENERIC_PIPELINE_VERSION,
} from './core/pipeline';
export type {
  ExtractionFailure,
  ExtractionResult,
  ExtractionSuccess,
  ExtractorFailure,
  ExtractOptions,
} from './core/pipeline';

export {
  flattenJsonLd,
  findProductNodes,
  JSON_LD_EXTRACTOR_ID,
  JSON_LD_EXTRACTOR_VERSION,
  jsonLdExtractor,
  parseJsonLdBlock,
  readJsonLdNodes,
} from './generic/json-ld';
export {
  canonicalUrlFrom,
  META_EXTRACTOR_ID,
  META_EXTRACTOR_VERSION,
  metaExtractor,
} from './generic/meta';
export { DOM_EXTRACTOR_ID, DOM_EXTRACTOR_VERSION, domExtractor } from './generic/dom';
export {
  extractSelectedVariantFromDom,
  extractSelectedVariantFromUrl,
  mergeVariants,
} from './generic/variant';
