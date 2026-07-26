import type { PartialCapture } from '@universal-cart/contracts';

import type { ExtractionContext, ProductExtractor } from '../core/types';
import { evidence } from '../core/types';
import { normalizeAvailability } from '../normalizers/availability';
import { normalizeCurrency, normalizePrice } from '../normalizers/price';
import { absoluteHttpUrl, normalizeText } from '../normalizers/text';

import { attrOf, humanizeAttributeCode, textOf } from './shared';

/**
 * Magento / Adobe Commerce storefronts.
 *
 * Magento annotates its rendered prices with `data-price-amount`, which is the unformatted
 * number behind the localized text — so the price can be read without parsing "1.299,00 €"
 * and hoping the separator convention was guessed right. Configurable products expose the
 * chosen swatch as `.swatch-attribute-selected-option`, next to the attribute's label.
 */

export const MAGENTO_ADAPTER_ID = 'magento';
export const MAGENTO_ADAPTER_VERSION = '1.0.0';

const PLATFORM_SIGNALS = [
  'body.catalog-product-view',
  'script[type="text/x-magento-init"]',
  'meta[name="generator"][content*="Magento" i]',
  '[data-role="priceBox"]',
  '.swatch-attribute[data-attribute-code]',
];

/** Read `data-price-amount`, Magento's machine-readable copy of a rendered price. */
function priceAmount(root: ParentNode, ...selectors: string[]): string | null {
  return normalizePrice(attrOf(root, 'data-price-amount', ...selectors) ?? '').amount;
}

/**
 * Selected configurable-product options.
 *
 * Magento renders one `.swatch-attribute` per option with the chosen value written into
 * `.swatch-attribute-selected-option`. An unselected attribute leaves that element empty,
 * which is reported as "not selected" rather than as a guess at the default.
 */
function selectedSwatches(document: Document): Record<string, string> {
  const variant: Record<string, string> = {};

  for (const attribute of Array.from(document.querySelectorAll('.swatch-attribute'))) {
    const code = attribute.getAttribute('data-attribute-code');
    const label =
      normalizeText(attribute.querySelector('.swatch-attribute-label')?.textContent) ??
      (code ? humanizeAttributeCode(code) : null);

    const value = normalizeText(
      attribute.querySelector('.swatch-attribute-selected-option')?.textContent,
    );

    if (label && value) variant[label] = value;
  }

  // Themes without swatches fall back to plain selects named `super_attribute[123]`.
  for (const select of Array.from(
    document.querySelectorAll<HTMLSelectElement>('select.super-attribute-select'),
  )) {
    const chosen =
      select.querySelector<HTMLOptionElement>('option[selected]') ??
      (select.selectedIndex >= 0 ? select.options[select.selectedIndex] : null);

    const value = normalizeText(chosen?.textContent);
    if (!value || !normalizeText(chosen?.value)) continue;

    const label = normalizeText(
      select.closest('.field')?.querySelector('label span, .label span')?.textContent,
    );
    if (label && !(label in variant)) variant[label] = value;
  }

  return variant;
}

export const magentoAdapter: ProductExtractor = {
  id: MAGENTO_ADAPTER_ID,
  version: MAGENTO_ADAPTER_VERSION,
  priority: 93,

  supports(context: ExtractionContext): boolean {
    return context.document.querySelector(PLATFORM_SIGNALS.join(', ')) !== null;
  },

  extract(context: ExtractionContext): PartialCapture {
    const { document, url } = context;
    const capture: PartialCapture = { evidence: [] };

    const productFields: NonNullable<PartialCapture['product']> = {};
    const offer: NonNullable<PartialCapture['offer']> = {};
    const identifiers: Record<string, string> = {};

    const title = textOf(
      document,
      '.page-title .base',
      '[data-ui-id="page-title-wrapper"]',
      '.product-info-main .page-title',
    );
    if (title) {
      productFields.title = title;
      capture.evidence.push(evidence('product.title', 'adapter', 0.95, '.page-title .base'));
    }

    const brand = textOf(document, '[itemprop="brand"]', '.product.attribute.brand .value');
    if (brand) {
      productFields.brand = brand;
      capture.evidence.push(evidence('product.brand', 'adapter', 0.85));
    }

    const image = absoluteHttpUrl(
      attrOf(document, 'src', '.fotorama__stage img', '.product.media img', '[itemprop="image"]'),
      url,
    );
    if (image) {
      productFields.imageUrls = [image];
      productFields.selectedImageUrl = image;
      capture.evidence.push(evidence('product.imageUrls', 'adapter', 0.85));
      capture.evidence.push(evidence('product.selectedImageUrl', 'adapter', 0.85));
    }

    // `finalPrice` is what the customer pays; `oldPrice` is the struck-out one. Reading
    // them by price type rather than by position keeps a themed layout from swapping them.
    const price =
      priceAmount(
        document,
        '.product-info-main [data-price-type="finalPrice"]',
        '[data-price-type="finalPrice"]',
      ) ?? priceAmount(document, '.product-info-price .price-wrapper');
    if (price) {
      offer.priceAmount = price;
      capture.evidence.push(
        evidence('offer.priceAmount', 'adapter', 0.96, '[data-price-type="finalPrice"]'),
      );
    }

    const original = priceAmount(
      document,
      '.product-info-main .old-price [data-price-type="oldPrice"]',
      '.old-price [data-price-type="oldPrice"]',
    );
    if (original && original !== price) {
      offer.originalPriceAmount = original;
      capture.evidence.push(evidence('offer.originalPriceAmount', 'adapter', 0.94));
    }

    const currency =
      normalizeCurrency(attrOf(document, 'content', 'meta[itemprop="priceCurrency"]')) ??
      normalizePrice(textOf(document, '.product-info-price .price') ?? '').currency;
    if (currency) {
      offer.currency = currency;
      capture.evidence.push(evidence('offer.currency', 'adapter', 0.9));
    }

    /**
     * Stock, from the class rather than the words.
     *
     * Magento puts `available` / `unavailable` on the stock element and localizes only the
     * text inside it. "Auf Lager" is not in any English word list and never will be —
     * reading the class is what makes this adapter work on a store that is not in English.
     */
    if (document.querySelector('.stock.available, [data-role="stock-status"].available')) {
      offer.availability = 'in_stock';
      capture.evidence.push(evidence('offer.availability', 'adapter', 0.92, '.stock.available'));
    } else if (
      document.querySelector('.stock.unavailable, [data-role="stock-status"].unavailable')
    ) {
      offer.availability = 'out_of_stock';
      capture.evidence.push(evidence('offer.availability', 'adapter', 0.92, '.stock.unavailable'));
    } else {
      const availability = normalizeAvailability(
        textOf(document, '.product-info-main .stock', '[data-role="stock-status"]', '.stock'),
      );
      if (availability !== 'unknown') {
        offer.availability = availability;
        capture.evidence.push(evidence('offer.availability', 'adapter', 0.85, '.stock'));
      }
    }

    const sku = textOf(
      document,
      '.product.attribute.sku .value',
      '[itemprop="sku"]',
      '[data-th="SKU"]',
    );
    if (sku) identifiers.sku = sku;

    const variant = selectedSwatches(document);
    if (Object.keys(variant).length > 0) {
      capture.selectedVariant = variant;
      capture.evidence.push(
        evidence('selectedVariant', 'adapter', 0.94, '.swatch-attribute-selected-option'),
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
