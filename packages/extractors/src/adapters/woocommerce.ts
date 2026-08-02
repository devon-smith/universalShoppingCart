import type { PartialCapture } from '@universal-cart/contracts';

import type { ExtractionContext, ProductExtractor } from '../core/types';
import { evidence } from '../core/types';
import { normalizeAvailability } from '../normalizers/availability';
import { normalizePrice } from '../normalizers/price';
import { absoluteHttpUrl, normalizeText } from '../normalizers/text';

import {
  asArray,
  attrOf,
  humanizeAttributeCode,
  isRecord,
  moneyProp,
  readJsonAttribute,
  stringProp,
  textOf,
} from './shared';

/**
 * WooCommerce stores.
 *
 * A variable product publishes its whole variation matrix in
 * `form.variations_form[data-product_variations]`, and the attribute `<select>`s say which
 * one is selected. Matching the two gives the price and stock status of the variation in
 * front of the shopper rather than the "from" price the page heading shows.
 */

export const WOOCOMMERCE_ADAPTER_ID = 'woocommerce';
export const WOOCOMMERCE_ADAPTER_VERSION = '1.0.0';

const PLATFORM_SIGNALS = [
  'body.woocommerce',
  'body.woocommerce-page',
  '.woocommerce div.product',
  'form.variations_form',
  'meta[name="generator"][content*="WooCommerce" i]',
  'link[href*="/plugins/woocommerce/"]',
];

interface SelectedAttribute {
  /** The option name a person reads, e.g. "Size". */
  label: string;
  /** The slug Woo matches variations on, e.g. "large". */
  value: string;
  /** What the option says on screen, e.g. "Large — 45cm". */
  display: string;
}

/**
 * The attribute `<select>`s, keyed by their raw `attribute_*` name.
 *
 * The slug and the visible text are kept apart on purpose: variations are matched on the
 * slug, but the slug is what a database calls the option, not what the shopper chose.
 */
function selectedAttributes(document: Document): Map<string, SelectedAttribute> {
  const selected = new Map<string, SelectedAttribute>();

  for (const select of Array.from(
    document.querySelectorAll<HTMLSelectElement>('select[name^="attribute_"]'),
  )) {
    const name = select.getAttribute('name');
    if (!name) continue;

    const chosen =
      select.querySelector<HTMLOptionElement>('option[selected]') ??
      (select.selectedIndex >= 0 ? select.options[select.selectedIndex] : null);

    const value = normalizeText(chosen?.value);
    // Woo's placeholder option has an empty value — "Choose an option" is not a choice.
    if (!value) continue;

    const label =
      normalizeText(select.closest('tr')?.querySelector('label')?.textContent) ??
      humanizeAttributeCode(name) ??
      name;

    selected.set(name, {
      label,
      value,
      display: normalizeText(chosen?.textContent) ?? value,
    });
  }

  return selected;
}

/**
 * Find the variation matching the selected attributes.
 *
 * An empty string in a variation's `attributes` means "any value", which is how Woo models
 * a variation that does not depend on that attribute. A variation only matches when every
 * attribute it constrains agrees with the selection.
 */
function matchingVariation(
  variations: unknown[],
  selected: Map<string, SelectedAttribute>,
): Record<string, unknown> | null {
  if (selected.size === 0) return null;

  for (const variation of variations) {
    if (!isRecord(variation)) continue;

    const attributes = variation.attributes;
    if (!isRecord(attributes)) continue;

    const agrees = Object.entries(attributes).every(([name, value]) => {
      if (typeof value !== 'string' || value === '') return true;
      return selected.get(name)?.value === value;
    });

    if (agrees) return variation;
  }

  return null;
}

/** WooCommerce renders money inside `<bdi>`, with the symbol in its own span. */
function priceFrom(root: ParentNode | null, ...selectors: string[]): string | null {
  if (!root) return null;
  return textOf(root, ...selectors);
}

export const wooCommerceAdapter: ProductExtractor = {
  id: WOOCOMMERCE_ADAPTER_ID,
  version: WOOCOMMERCE_ADAPTER_VERSION,
  priority: 94,

  supports(context: ExtractionContext): boolean {
    return context.document.querySelector(PLATFORM_SIGNALS.join(', ')) !== null;
  },

  extract(context: ExtractionContext): PartialCapture {
    const { document, url } = context;
    const capture: PartialCapture = { evidence: [] };

    const container = document.querySelector('div.product, .woocommerce div.product') ?? document;

    const productFields: NonNullable<PartialCapture['product']> = {};
    const offer: NonNullable<PartialCapture['offer']> = {};
    const identifiers: Record<string, string> = {};

    const title = textOf(container, '.product_title', 'h1.entry-title');
    if (title) {
      productFields.title = title;
      capture.evidence.push(evidence('product.title', 'adapter', 0.95, '.product_title'));
    }

    const image = absoluteHttpUrl(
      attrOf(
        container,
        'src',
        '.woocommerce-product-gallery__image img',
        '.woocommerce-product-gallery img',
      ),
      url,
    );
    if (image) {
      productFields.imageUrls = [image];
      productFields.selectedImageUrl = image;
      capture.evidence.push(evidence('product.imageUrls', 'adapter', 0.9));
      capture.evidence.push(evidence('product.selectedImageUrl', 'adapter', 0.9));
    }

    const form = document.querySelector('form.variations_form');
    const variations = asArray(readJsonAttribute(form, 'data-product_variations'));
    const selected = selectedAttributes(document);
    const variation = matchingVariation(variations, selected);

    if (selected.size > 0) {
      const variant: Record<string, string> = {};
      for (const { label, display } of selected.values()) variant[label] = display;
      capture.selectedVariant = variant;
      capture.evidence.push(
        evidence('selectedVariant', 'adapter', 0.95, 'select[name^="attribute_"]'),
      );
    }

    if (variation) {
      // `display_price` is the price of the selected variation, tax-adjusted for the
      // store's display settings — the number the shopper is being quoted.
      const price = normalizePrice(moneyProp(variation, 'display_price'));
      if (price.amount) {
        offer.priceAmount = price.amount;
        capture.evidence.push(
          evidence('offer.priceAmount', 'adapter', 0.96, 'variations_form.display_price'),
        );
      }

      const regular = normalizePrice(moneyProp(variation, 'display_regular_price'));
      if (regular.amount && regular.amount !== price.amount) {
        offer.originalPriceAmount = regular.amount;
        capture.evidence.push(evidence('offer.originalPriceAmount', 'adapter', 0.94));
      }

      if (typeof variation.is_in_stock === 'boolean') {
        offer.availability = variation.is_in_stock ? 'in_stock' : 'out_of_stock';
        capture.evidence.push(
          evidence('offer.availability', 'adapter', 0.94, 'variations_form.is_in_stock'),
        );
      }

      const sku = stringProp(variation, 'sku');
      if (sku) identifiers.sku = sku;
    } else {
      // A simple product: the sale price is inside `<ins>`, the struck-out one in `<del>`.
      const sale = priceFrom(container, '.summary p.price ins .amount', 'p.price ins .amount');
      const listed = priceFrom(container, '.summary p.price del .amount', 'p.price del .amount');
      const plain = priceFrom(container, '.summary p.price .amount', 'p.price .amount');

      const price = normalizePrice(sale ?? plain ?? '');
      if (price.amount) {
        offer.priceAmount = price.amount;
        capture.evidence.push(evidence('offer.priceAmount', 'adapter', 0.9, 'p.price .amount'));
      }
      if (price.currency) {
        offer.currency = price.currency;
        capture.evidence.push(evidence('offer.currency', 'adapter', 0.85));
      }

      const original = normalizePrice(listed ?? '');
      if (original.amount && original.amount !== price.amount) {
        offer.originalPriceAmount = original.amount;
        capture.evidence.push(evidence('offer.originalPriceAmount', 'adapter', 0.9));
      }

      const stockText = textOf(container, '.stock', '.availability');
      const availability = normalizeAvailability(stockText);
      if (availability !== 'unknown') {
        offer.availability = availability;
        capture.evidence.push(evidence('offer.availability', 'adapter', 0.85, '.stock'));
      }
    }

    // The variation JSON carries no currency, so it comes from the rendered price either
    // way. Only an unambiguous symbol or code counts — see `detectCurrency`.
    if (offer.currency === undefined) {
      const currency = normalizePrice(
        textOf(container, 'p.price .amount', '.woocommerce-Price-amount') ?? '',
      ).currency;
      if (currency) {
        offer.currency = currency;
        capture.evidence.push(evidence('offer.currency', 'adapter', 0.85));
      }
    }

    if (!identifiers.sku) {
      const sku = textOf(container, '.sku_wrapper .sku', '.sku');
      // Woo prints "N/A" when a product has no SKU. That is not an identifier.
      if (sku && sku.toUpperCase() !== 'N/A') identifiers.sku = sku;
    }

    if (Object.keys(identifiers).length > 0) {
      productFields.identifiers = identifiers;
      capture.evidence.push(evidence('product.identifiers', 'adapter', 0.9));
    }

    if (Object.keys(productFields).length > 0) capture.product = productFields;
    if (Object.keys(offer).length > 0) capture.offer = offer;

    return capture;
  },
};
