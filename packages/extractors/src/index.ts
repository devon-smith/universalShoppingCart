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

export {
  canonicalVariant,
  computeFingerprint,
  fingerprintSource,
  primaryIdentifier,
} from './fingerprint';
export type { FingerprintInput } from './fingerprint';

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

export { adapterDescriptors, adaptersFor, RETAILER_ADAPTERS } from './adapters/registry';
export type { AdapterDescriptor } from './adapters/registry';
export {
  BIGCOMMERCE_ADAPTER_ID,
  BIGCOMMERCE_ADAPTER_VERSION,
  bigCommerceAdapter,
} from './adapters/bigcommerce';
export { MAGENTO_ADAPTER_ID, MAGENTO_ADAPTER_VERSION, magentoAdapter } from './adapters/magento';
export {
  SFCC_ADAPTER_ID,
  SFCC_ADAPTER_VERSION,
  salesforceCommerceCloudAdapter,
} from './adapters/salesforce-commerce-cloud';
export { SHOPIFY_ADAPTER_ID, SHOPIFY_ADAPTER_VERSION, shopifyAdapter } from './adapters/shopify';
export {
  WOOCOMMERCE_ADAPTER_ID,
  WOOCOMMERCE_ADAPTER_VERSION,
  wooCommerceAdapter,
} from './adapters/woocommerce';
