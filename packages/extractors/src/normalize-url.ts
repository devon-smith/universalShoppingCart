/**
 * Canonical URL normalization.
 *
 * Two URLs that point at the same product page should normalize to the same
 * string so that fingerprinting (BUILD_PLAN.md §9.1) and revisit matching treat
 * them as one item. Normalization is deliberately conservative: it removes
 * parameters that are known to be marketing/attribution noise and leaves
 * everything else alone, because an unknown parameter may well select a variant.
 *
 * The caller keeps the original URL separately — normalization is for matching,
 * never for navigation.
 */

/** Exact query-parameter names dropped during normalization. */
export const TRACKING_PARAMETERS: readonly string[] = [
  // Google / Google Ads
  'gclid',
  'gclsrc',
  'gbraid',
  'wbraid',
  'dclid',
  '_ga',
  '_gl',
  // Meta / TikTok / Twitter / Microsoft / Yandex
  'fbclid',
  'ttclid',
  'twclid',
  'msclkid',
  'yclid',
  'igshid',
  // Mailing platforms
  'mc_cid',
  'mc_eid',
  'ml_subscriber',
  'ml_subscriber_hash',
  'vero_conv',
  'vero_id',
  // Affiliate / referral breadcrumbs
  'ref',
  'ref_',
  'ref_src',
  'referrer',
  'irclickid',
  'irgwc',
  'cjevent',
  'affiliate_id',
  'aff_id',
  'tag',
  'ascsubtag',
  'linkcode',
  'linkid',
  'creative',
  'creativeasin',
  'camp',
];

/** Query-parameter prefixes dropped during normalization. */
export const TRACKING_PARAMETER_PREFIXES: readonly string[] = [
  'utm_',
  'pk_',
  'mtm_',
  'matomo_',
  'hsa_',
  'oly_',
];

export interface NormalizeUrlOptions {
  /** Additional parameter names to drop (retailer adapters may know more). */
  dropParameters?: readonly string[];
  /**
   * Parameter names to keep even when they match a tracking rule. Use this when a
   * retailer overloads a normally-tracking name to select a variant.
   */
  keepParameters?: readonly string[];
}

const DEFAULT_PORTS: Record<string, string> = {
  'http:': '80',
  'https:': '443',
};

function isTrackingParameter(
  name: string,
  drop: ReadonlySet<string>,
  keep: ReadonlySet<string>,
): boolean {
  const lower = name.toLowerCase();
  if (keep.has(lower)) return false;
  if (drop.has(lower)) return true;
  return TRACKING_PARAMETER_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/**
 * Normalize a URL for matching.
 *
 * Returns `null` for input that is not a parseable `http`/`https` URL. Non-web
 * schemes are rejected outright rather than normalized, so a caller can never
 * accidentally carry a `javascript:` or `file:` URL into storage.
 */
export function normalizeUrl(input: string, options: NormalizeUrlOptions = {}): string | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }

  const drop = new Set([
    ...TRACKING_PARAMETERS,
    ...(options.dropParameters ?? []).map((name) => name.toLowerCase()),
  ]);
  const keep = new Set((options.keepParameters ?? []).map((name) => name.toLowerCase()));

  url.hash = '';
  url.username = '';
  url.password = '';
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  if (url.port === DEFAULT_PORTS[url.protocol]) {
    url.port = '';
  }

  // Collapse a trailing slash so `/p/123` and `/p/123/` match. The root path keeps its slash.
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }

  const kept: Array<[string, string]> = [];
  for (const [name, value] of url.searchParams) {
    if (isTrackingParameter(name, drop, keep)) continue;
    kept.push([name, value]);
  }
  kept.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));

  const search = new URLSearchParams();
  for (const [name, value] of kept) {
    search.append(name, value);
  }
  url.search = search.toString();

  return url.toString();
}
