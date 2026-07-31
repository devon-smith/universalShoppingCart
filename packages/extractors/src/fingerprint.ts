import { normalizeUrl } from './normalize-url';

/**
 * Product fingerprinting (BUILD_PLAN.md §9.1).
 *
 * A deterministic SHA-256 over the normalized canonical URL, the selected variant, and
 * the primary product identifier. Two saves of the same product-and-variant produce the
 * same fingerprint, so a re-save refreshes the existing item instead of cluttering the
 * cart with duplicates.
 *
 * The inputs are deliberately narrow. Including price would make every price change a new
 * item; including the raw URL would make every tracking parameter a new item.
 */

export interface FingerprintInput {
  /** Canonical URL when the page provided one, otherwise the page URL. */
  canonicalUrl: string | null;
  url: string;
  selectedVariant: Record<string, string>;
  identifiers: {
    sku?: string | undefined;
    gtin?: string | undefined;
    mpn?: string | undefined;
    productId?: string | undefined;
    variantId?: string | undefined;
  };
}

/**
 * The identifier that best distinguishes this product, or `null`.
 *
 * GTIN first because it is globally unique across retailers — and assigned per sellable
 * unit, so it already names the variant. Then the retailer's variant id: site-local, but
 * the URL in the fingerprint already scopes the hash to the site, and unlike MPN or SKU it
 * is guaranteed per-variant. On Shopify the `sku` is frequently product-level — shared by
 * every size — so ranking `variantId` below `sku` would let two sizes of one garment hash
 * alike, which is the false merge BUILD_PLAN.md §9.3 calls worse than a duplicate. Then
 * MPN (unique per manufacturer), then SKU and product id (site-local, product-level).
 */
export function primaryIdentifier(identifiers: FingerprintInput['identifiers']): string | null {
  for (const [kind, value] of [
    ['gtin', identifiers.gtin],
    ['variantId', identifiers.variantId],
    ['mpn', identifiers.mpn],
    ['sku', identifiers.sku],
    ['productId', identifiers.productId],
  ] as const) {
    const trimmed = value?.trim();
    if (trimmed) return `${kind}:${trimmed}`;
  }
  return null;
}

/** Variant options as a canonical, order-independent string. */
export function canonicalVariant(selectedVariant: Record<string, string>): string {
  return Object.entries(selectedVariant)
    .map(([name, value]) => [name.trim().toLowerCase(), value.trim().toLowerCase()] as const)
    .filter(([name, value]) => name.length > 0 && value.length > 0)
    .sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])))
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
}

/** The exact string that gets hashed. Exported so a test can pin it. */
export function fingerprintSource(input: FingerprintInput): string {
  const url = normalizeUrl(input.canonicalUrl ?? input.url) ?? input.url;
  return [
    url,
    canonicalVariant(input.selectedVariant),
    primaryIdentifier(input.identifiers) ?? '',
  ].join('\n');
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * SHA-256 of the fingerprint source, as lowercase hex.
 *
 * Uses Web Crypto, which is available in the extension, in the browser, and in Node 18+,
 * so the same function produces the same value on every surface. It is async because Web
 * Crypto is.
 */
export async function computeFingerprint(input: FingerprintInput): Promise<string> {
  const bytes = new TextEncoder().encode(fingerprintSource(input));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return toHex(digest);
}
