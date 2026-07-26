import type { Availability } from '@universal-cart/contracts';

/**
 * Availability normalization.
 *
 * Sources are schema.org URLs (`https://schema.org/InStock`), Open Graph values
 * (`instock`, `oos`), and free text. Anything unrecognized becomes `unknown` — the UI
 * shows "unknown" honestly rather than implying a product is buyable.
 */

const SCHEMA_ORG_AVAILABILITY: Record<string, Availability> = {
  instock: 'in_stock',
  onlineonly: 'in_stock',
  instoreonly: 'in_stock',
  limitedavailability: 'in_stock',
  outofstock: 'out_of_stock',
  soldout: 'out_of_stock',
  discontinued: 'out_of_stock',
  preorder: 'preorder',
  presale: 'preorder',
  backorder: 'backorder',
};

/** Open Graph `product:availability` and common retailer text values. */
const TEXT_AVAILABILITY: Record<string, Availability> = {
  'in stock': 'in_stock',
  instock: 'in_stock',
  available: 'in_stock',
  'available for order': 'in_stock',
  'add to cart': 'in_stock',
  'add to bag': 'in_stock',
  'out of stock': 'out_of_stock',
  outofstock: 'out_of_stock',
  oos: 'out_of_stock',
  'sold out': 'out_of_stock',
  soldout: 'out_of_stock',
  unavailable: 'out_of_stock',
  discontinued: 'out_of_stock',
  'pre-order': 'preorder',
  preorder: 'preorder',
  'pre order': 'preorder',
  backorder: 'backorder',
  'back-order': 'backorder',
  'on backorder': 'backorder',
};

/**
 * Normalize an availability value from any source.
 *
 * schema.org enumeration members are matched by their final path segment, so both
 * `http://schema.org/InStock` and `https://schema.org/InStock` work, as does the bare
 * `InStock` that some sites emit.
 */
export function normalizeAvailability(input: string | null | undefined): Availability {
  if (!input) return 'unknown';

  const trimmed = input.trim();
  if (trimmed.length === 0) return 'unknown';

  const lastSegment = trimmed.split(/[/#]/).pop() ?? trimmed;
  const compact = lastSegment.toLowerCase().replace(/[\s_-]/g, '');

  const schemaMatch = SCHEMA_ORG_AVAILABILITY[compact];
  if (schemaMatch) return schemaMatch;

  const textMatch = TEXT_AVAILABILITY[trimmed.toLowerCase()] ?? TEXT_AVAILABILITY[compact];
  if (textMatch) return textMatch;

  return 'unknown';
}
