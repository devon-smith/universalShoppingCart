/**
 * Refresh-strategy classification (BUILD_PLAN.md §14.2).
 *
 * Before a saved item is background-refreshed, its domain is placed in one of four strategies.
 * This is deliberately conservative and grounded in the live-capture pass, **not** a speculative
 * per-retailer table (CLAUDE.md; BUILD_PLAN.md §10.7):
 *
 * - `public_fetch` — the default. Most sites that yielded a capture served that data in
 *   fetchable HTML (JSON-LD / meta), so a public GET can re-observe it. A site that turns out
 *   not to is downgraded by the fetch pipeline's repeated-failure backoff (§14.2 step 9), not
 *   guessed at here.
 * - `browser_required` — the domains whose product data is client-rendered, which is the exact
 *   reason their brand adapters exist (amazon, wayfair, stockx): a raw fetch returns a shell
 *   with no price, so background-fetching them only wastes a request. Kept as a small, honest
 *   set rather than inferred from a pattern.
 * - `api` — a domain with an official, authorised product API. None yet; the mechanism exists.
 * - `disabled` — refresh is inappropriate (terms, reliability). None yet — and a blank or
 *   unusable domain lands here too, because there is nothing to fetch.
 */

export type RefreshStrategy = 'public_fetch' | 'api' | 'browser_required' | 'disabled';

/** Item signals that can override a domain's default classification. */
export interface ClassifiableItem {
  /** The adapter recorded on the item, if any (`items.extractor_id`). */
  extractorId?: string | null;
}

/**
 * Domains whose product data is client-rendered — a public fetch cannot reproduce their price.
 * These are exactly the brand-adapter domains, verified client-rendered in the live-capture pass.
 *
 * This set (and BROWSER_ONLY_EXTRACTORS below) is mirrored in SQL by the `enroll_item_refresh`
 * trigger, which is what actually enrols saved items. Keep the two in sync — three names each.
 */
const BROWSER_REQUIRED_DOMAINS = ['amazon.com', 'wayfair.com', 'stockx.com'] as const;

/** Brand adapters that read client-rendered content; an item carrying one cannot be re-fetched. */
const BROWSER_ONLY_EXTRACTORS = ['amazon', 'wayfair', 'stockx'] as const;

/** Domains with an official, authorised API. Empty until one is actually wired. */
const API_DOMAINS: readonly string[] = [];

/** Domains where refresh is inappropriate (terms, reliability). Empty until there is a reason. */
const DISABLED_DOMAINS: readonly string[] = [];

/**
 * Normalise a stored domain for matching: lowercase, no leading `www.`, no port, no trailing dot.
 * Items are stored already-normalised, but a hostile or hand-entered value must not slip a match.
 */
export function normalizeRefreshDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '');
}

/** True when `host` is `base` or a subdomain of it (so `smile.amazon.com` matches `amazon.com`). */
function matchesDomain(host: string, base: string): boolean {
  return host === base || host.endsWith(`.${base}`);
}

function matchesAny(host: string, bases: readonly string[]): boolean {
  return bases.some((base) => matchesDomain(host, base));
}

/**
 * Classify how a saved item should be refreshed. The domain decides; an item's recorded
 * extractor can only escalate to `browser_required` (a brand-adapter capture whose page is
 * client-rendered), never relax a domain-level `disabled`/`api` decision.
 */
export function classifyRefresh(domain: string, item: ClassifiableItem = {}): RefreshStrategy {
  const host = normalizeRefreshDomain(domain);
  if (host === '') return 'disabled'; // no usable domain — nothing to fetch

  if (matchesAny(host, DISABLED_DOMAINS)) return 'disabled';
  if (matchesAny(host, API_DOMAINS)) return 'api';

  const extractorId = item.extractorId ?? null;
  if (matchesAny(host, BROWSER_REQUIRED_DOMAINS)) return 'browser_required';
  if (
    extractorId !== null &&
    (BROWSER_ONLY_EXTRACTORS as readonly string[]).includes(extractorId)
  ) {
    return 'browser_required';
  }

  return 'public_fetch';
}
