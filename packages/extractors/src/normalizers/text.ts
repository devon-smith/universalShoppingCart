/**
 * Text and identity normalization for values pulled off a page.
 *
 * Everything here is conservative: it collapses whitespace and trims, but never
 * rewrites, truncates meaningfully, or invents. A title that comes back empty stays
 * `null` so the UI can ask the user rather than showing a blank product.
 */

/** Collapse whitespace and trim. Returns `null` for anything with no content. */
export function normalizeText(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  const collapsed = input.replace(/\s+/g, ' ').trim();
  return collapsed.length > 0 ? collapsed : null;
}

/**
 * Cap a normalized string at `max` characters.
 *
 * Descriptions on retailer pages run to thousands of characters; storing all of it is
 * both wasteful and closer to "a copy of the page" than to product metadata.
 */
export function normalizeTextCapped(input: string | null | undefined, max: number): string | null {
  const text = normalizeText(input);
  if (text === null) return null;
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** The registrable-ish host of a URL, lowercased and without a `www.` prefix. */
export function domainFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

/** Hosts whose second-to-last label is not a meaningful retailer name. */
const MULTI_PART_PUBLIC_SUFFIXES = new Set([
  'co.uk',
  'co.jp',
  'co.kr',
  'co.nz',
  'co.za',
  'com.au',
  'com.br',
  'com.mx',
  'com.tr',
  'com.sg',
  'com.hk',
  'net.au',
  'org.uk',
]);

/**
 * A human-readable retailer name derived from a domain.
 *
 * This is a display fallback, not an identity: `shop.example.co.uk` becomes "Example".
 * A retailer adapter that knows the real brand name overrides it (Phase 5).
 */
export function retailerNameFromDomain(domain: string): string {
  const labels = domain.split('.').filter(Boolean);
  if (labels.length === 0) return domain;

  const lastTwo = labels.slice(-2).join('.');
  const nameIndex = MULTI_PART_PUBLIC_SUFFIXES.has(lastTwo) ? labels.length - 3 : labels.length - 2;
  const name = labels[Math.max(nameIndex, 0)] ?? labels[0]!;

  return name
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * Resolve a possibly-relative URL against the page URL, keeping only `http(s)`.
 *
 * Rejecting `data:` and other schemes here means a capture can never carry an inline
 * image blob, which would be page content rather than product metadata.
 */
export function absoluteHttpUrl(
  candidate: string | null | undefined,
  baseUrl: string,
): string | null {
  const text = normalizeText(candidate);
  if (!text) return null;

  try {
    const resolved = new URL(text, baseUrl);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
    return resolved.toString();
  } catch {
    return null;
  }
}

/** De-duplicate while preserving order. */
export function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
