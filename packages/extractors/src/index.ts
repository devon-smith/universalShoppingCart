/**
 * Pure product-extraction and normalization logic.
 *
 * Package rules (BUILD_PLAN.md §5.1):
 * - no Supabase calls, no React, no extension storage
 * - DOM-facing functions may accept a `Document`, but every output must be serializable
 * - no remote code and no `eval`
 *
 * Phase 0 ships only the URL normalizer, which the fingerprint (Phase 2B) and the
 * revisit matcher (Phase 4) both depend on. Parsers and adapters arrive in Phase 2A/5.
 */
export { normalizeUrl, TRACKING_PARAMETER_PREFIXES, TRACKING_PARAMETERS } from './normalize-url';
export type { NormalizeUrlOptions } from './normalize-url';
