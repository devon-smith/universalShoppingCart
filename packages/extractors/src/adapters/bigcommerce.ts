import type { PartialCapture } from '@universal-cart/contracts';

import type { ExtractionContext, ProductExtractor } from '../core/types';
import { evidence } from '../core/types';
import { normalizeAvailability } from '../normalizers/availability';
import { normalizePrice } from '../normalizers/price';
import { absoluteHttpUrl, normalizeText } from '../normalizers/text';

import { attrOf, textOf } from './shared';

/**
 * BigCommerce storefronts (Stencil themes).
 *
 * Stencil labels the parts of a product page with `data-product-*` attributes and
 * `.productView-*` classes, which survive theme restyling far better than the visual
 * layout does. Options are rendered as `.form-field[data-product-attribute]` blocks whose
 * label is the option name and whose checked input is the selected value.
 */

export const BIGCOMMERCE_ADAPTER_ID = 'bigcommerce';
export const BIGCOMMERCE_ADAPTER_VERSION = '1.0.0';

const PLATFORM_SIGNALS = [
  'meta[name="generator"][content*="BigCommerce" i]',
  'script[src*="cdn11.bigcommerce.com"]',
  'img[src*="cdn11.bigcommerce.com"]',
  '[data-product-attribute]',
  '.productView[data-product-id]',
  'form[data-cart-item-add]',
];

/**
 * Selected product options.
 *
 * Each option lives in a `.form-field[data-product-attribute]`; the value is whichever
 * input is checked, or the chosen `<option>` for a dropdown. A swatch's readable name is
 * on its label's `title`, because the label itself renders as a colour square.
 */
function selectedOptions(document: Document): Record<string, string> {
  const variant: Record<string, string> = {};

  for (const field of Array.from(document.querySelectorAll('[data-product-attribute]'))) {
    const name = normalizeText(
      field.querySelector('.form-label')?.textContent ?? field.querySelector('label')?.textContent,
    )
      // Stencil renders "Color: Natural Black" — the group name is before the colon.
      ?.split(/[:：]/)[0]
      ?.trim();

    if (!name) continue;

    const checked = field.querySelector<HTMLInputElement>('input:checked');
    if (checked) {
      const id = checked.getAttribute('id');
      const label = id
        ? Array.from(field.querySelectorAll('label[for]')).find(
            (candidate) => candidate.getAttribute('for') === id,
          )
        : null;

      const value =
        normalizeText(label?.getAttribute('title')) ??
        normalizeText(label?.textContent) ??
        normalizeText(checked.getAttribute('value'));

      if (value) {
        variant[name] = value;
        continue;
      }
    }

    const select = field.querySelector<HTMLSelectElement>('select');
    if (!select) continue;

    const chosen =
      select.querySelector<HTMLOptionElement>('option[selected]') ??
      (select.selectedIndex >= 0 ? select.options[select.selectedIndex] : null);

    const value = normalizeText(chosen?.textContent);
    if (value && normalizeText(chosen?.value)) variant[name] = value;
  }

  return variant;
}

export const bigCommerceAdapter: ProductExtractor = {
  id: BIGCOMMERCE_ADAPTER_ID,
  version: BIGCOMMERCE_ADAPTER_VERSION,
  priority: 92,

  supports(context: ExtractionContext): boolean {
    return context.document.querySelector(PLATFORM_SIGNALS.join(', ')) !== null;
  },

  extract(context: ExtractionContext): PartialCapture {
    const { document, url } = context;
    const capture: PartialCapture = { evidence: [] };

    const productFields: NonNullable<PartialCapture['product']> = {};
    const offer: NonNullable<PartialCapture['offer']> = {};
    const identifiers: Record<string, string> = {};

    const title = textOf(document, '.productView-title', 'h1.productView-title');
    if (title) {
      productFields.title = title;
      capture.evidence.push(evidence('product.title', 'adapter', 0.95, '.productView-title'));
    }

    const brand = textOf(document, '.productView-brand a', '.productView-brand');
    if (brand) {
      productFields.brand = brand;
      capture.evidence.push(evidence('product.brand', 'adapter', 0.9));
    }

    const image = absoluteHttpUrl(
      attrOf(document, 'src', '.productView-image img', '[data-image-gallery-main] img'),
      url,
    );
    if (image) {
      productFields.imageUrls = [image];
      productFields.selectedImageUrl = image;
      capture.evidence.push(evidence('product.imageUrls', 'adapter', 0.9));
      capture.evidence.push(evidence('product.selectedImageUrl', 'adapter', 0.9));
    }

    // Stencil marks the price the shopper pays; which of the tax variants is rendered
    // depends on the store's settings, so both are accepted, without-tax first.
    const priceText = textOf(
      document,
      '.productView-price [data-product-price-without-tax]',
      '.productView-price [data-product-price-with-tax]',
      '.productView-price .price--withoutTax',
      '.productView-price .price--withTax',
      '.productView-price .price--main',
    );
    const price = normalizePrice(priceText ?? '');
    if (price.amount) {
      offer.priceAmount = price.amount;
      capture.evidence.push(
        evidence('offer.priceAmount', 'adapter', 0.93, '[data-product-price-without-tax]'),
      );
    }
    if (price.currency) {
      offer.currency = price.currency;
      capture.evidence.push(evidence('offer.currency', 'adapter', 0.85));
    }

    const original = normalizePrice(
      textOf(document, '.productView-price .price--rrp', '[data-product-rrp-price-without-tax]') ??
        '',
    );
    if (original.amount && original.amount !== price.amount) {
      offer.originalPriceAmount = original.amount;
      capture.evidence.push(evidence('offer.originalPriceAmount', 'adapter', 0.9));
    }

    const availability = normalizeAvailability(
      textOf(document, '[data-product-stock]', '.productView-info-value--stock', '.form-action p'),
    );
    if (availability !== 'unknown') {
      offer.availability = availability;
      capture.evidence.push(evidence('offer.availability', 'adapter', 0.85));
    } else if (
      document.querySelector('[data-button-purchase][disabled], #form-action-addToCart[disabled]')
    ) {
      // A disabled add-to-cart button is the clearest signal a themed page gives.
      offer.availability = 'out_of_stock';
      capture.evidence.push(evidence('offer.availability', 'adapter', 0.75, '[disabled]'));
    }

    const sku =
      attrOf(document, 'data-product-sku', '[data-product-sku]') ??
      textOf(document, '[data-product-sku]');
    if (sku) identifiers.sku = sku;

    const productId = attrOf(
      document,
      'data-product-id',
      '.productView[data-product-id]',
      '[data-product-id]',
    );
    if (productId) identifiers.productId = productId;

    const variant = selectedOptions(document);
    if (Object.keys(variant).length > 0) {
      capture.selectedVariant = variant;
      capture.evidence.push(
        evidence('selectedVariant', 'adapter', 0.92, '[data-product-attribute] input:checked'),
      );
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
