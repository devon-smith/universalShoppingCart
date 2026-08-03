/**
 * The two availability facts, said in one sentence.
 *
 * `availability` describes the variant the user picked; `product_availability` is the page's
 * separate product-level claim, and the database keeps it *only* when the two differ
 * (docs/DECISIONS.md, 2026-07-27). So a non-null second value is by construction the case
 * worth a sentence: your size is gone, the product is still sold.
 *
 * That distinction is the difference between "stop looking" and "try another size", and it is
 * the sort of thing only the drawer has room to say properly.
 */

import { AVAILABILITY_LABELS } from './format';

export interface AvailabilitySplit {
  /** What the user's chosen variant is doing. Always present. */
  variant: string;
  /** The product-level claim, when the page made a different one. */
  product: string | null;
  /** One sentence covering both, or `null` when there is only one fact to state. */
  sentence: string | null;
}

const VARIANT_PHRASE: Record<string, string> = {
  in_stock: 'The size you chose is available',
  out_of_stock: 'The size you chose is sold out',
  preorder: 'The size you chose is on pre-order',
  backorder: 'The size you chose is on backorder',
  unknown: 'The page did not say whether your size is available',
};

const PRODUCT_PHRASE: Record<string, string> = {
  in_stock: 'the product is still sold',
  out_of_stock: 'the product is no longer sold',
  preorder: 'the product is on pre-order',
  backorder: 'the product is on backorder',
  unknown: 'the page did not say whether the product is still sold',
};

export function availabilitySplit(
  variantAvailability: string,
  productAvailability: string | null,
): AvailabilitySplit {
  const variant = AVAILABILITY_LABELS[variantAvailability] ?? AVAILABILITY_LABELS.unknown!;
  const product =
    productAvailability === null
      ? null
      : (AVAILABILITY_LABELS[productAvailability] ?? AVAILABILITY_LABELS.unknown!);

  // Nothing to contrast: the page made one claim, or both claims agreed and the column is null.
  if (productAvailability === null || productAvailability === variantAvailability) {
    return { variant, product: null, sentence: null };
  }

  const left = VARIANT_PHRASE[variantAvailability] ?? VARIANT_PHRASE.unknown!;
  const right = PRODUCT_PHRASE[productAvailability] ?? PRODUCT_PHRASE.unknown!;

  return { variant, product, sentence: `${left} — ${right}.` };
}
