import type { PartialCapture } from '@universal-cart/contracts';

import type { ExtractionContext, ProductExtractor } from '../core/types';
import { evidence } from '../core/types';
import { normalizeAvailability } from '../normalizers/availability';
import { normalizeCurrency, normalizePrice } from '../normalizers/price';
import { absoluteHttpUrl, normalizeText } from '../normalizers/text';

import { attrOf, textOf } from './shared';

/**
 * Salesforce Commerce Cloud storefronts (SFRA reference architecture, formerly Demandware).
 *
 * SFRA writes the unformatted price into a `content` attribute beside the formatted one,
 * and identifies the selected product by `data-pid` on the product detail container — which
 * is the variant id, not the master id, once an option has been chosen. Attribute blocks
 * carry `data-attr`, so the option name comes from the markup rather than from nearby text.
 */

export const SFCC_ADAPTER_ID = 'salesforce-commerce-cloud';
export const SFCC_ADAPTER_VERSION = '1.0.0';

const PLATFORM_SIGNALS = [
  '.product-detail[data-pid]',
  '[data-querystring][data-pid]',
  'script[src*="/on/demandware.static/"]',
  'link[href*="/on/demandware.static/"]',
  'form[action*="/on/demandware.store/"]',
];

/** SFCC URLs contain the pipeline path even when the storefront uses a vanity domain. */
function isDemandwareUrl(url: string): boolean {
  return url.includes('/on/demandware.store/') || url.includes('/on/demandware.static/');
}

/**
 * Selected variation attributes.
 *
 * Each `.attribute[data-attr]` block names its option in `.non-input-label` (or falls back
 * to the attribute code) and shows the current choice in `.selected-value` — SFRA keeps
 * that element in sync with the swatch the shopper clicked. A size dropdown is a plain
 * `<select>` inside the same block.
 */
function selectedAttributes(root: ParentNode): Record<string, string> {
  const variant: Record<string, string> = {};

  for (const block of Array.from(root.querySelectorAll('.attribute[data-attr]'))) {
    const code = block.getAttribute('data-attr');
    const name =
      normalizeText(block.querySelector('.non-input-label, .attribute-label')?.textContent)
        ?.replace(/[:：].*$/, '')
        .trim() ?? (code ? code.charAt(0).toUpperCase() + code.slice(1) : null);

    if (!name) continue;

    const displayed = normalizeText(block.querySelector('.selected-value')?.textContent);
    if (displayed) {
      variant[name] = displayed;
      continue;
    }

    const select = block.querySelector<HTMLSelectElement>('select');
    if (select) {
      const chosen =
        select.querySelector<HTMLOptionElement>('option[selected]') ??
        (select.selectedIndex >= 0 ? select.options[select.selectedIndex] : null);

      const value = normalizeText(chosen?.textContent);
      if (value && normalizeText(chosen?.value)) {
        variant[name] = value;
        continue;
      }
    }

    const swatch = block.querySelector('[aria-checked="true"], .selected, .selectable.selected');
    const value =
      normalizeText(swatch?.getAttribute('aria-label')) ??
      normalizeText(swatch?.getAttribute('title')) ??
      normalizeText(swatch?.textContent);
    if (value) variant[name] = value;
  }

  return variant;
}

export const salesforceCommerceCloudAdapter: ProductExtractor = {
  id: SFCC_ADAPTER_ID,
  version: SFCC_ADAPTER_VERSION,
  priority: 91,

  supports(context: ExtractionContext): boolean {
    if (isDemandwareUrl(context.url)) return true;
    return context.document.querySelector(PLATFORM_SIGNALS.join(', ')) !== null;
  },

  extract(context: ExtractionContext): PartialCapture {
    const { document, url } = context;
    const capture: PartialCapture = { evidence: [] };

    const detail = document.querySelector('.product-detail') ?? document;

    const productFields: NonNullable<PartialCapture['product']> = {};
    const offer: NonNullable<PartialCapture['offer']> = {};
    const identifiers: Record<string, string> = {};

    const title = textOf(detail, '.product-name', 'h1.product-name', '.product-detail h1');
    if (title) {
      productFields.title = title;
      capture.evidence.push(evidence('product.title', 'adapter', 0.95, '.product-name'));
    }

    const brand = textOf(detail, '.product-brand', '[itemprop="brand"]');
    if (brand) {
      productFields.brand = brand;
      capture.evidence.push(evidence('product.brand', 'adapter', 0.85));
    }

    const image = absoluteHttpUrl(
      attrOf(detail, 'src', '.primary-images img', '.carousel-item.active img', '.product-image'),
      url,
    );
    if (image) {
      productFields.imageUrls = [image];
      productFields.selectedImageUrl = image;
      capture.evidence.push(evidence('product.imageUrls', 'adapter', 0.88));
      capture.evidence.push(evidence('product.selectedImageUrl', 'adapter', 0.88));
    }

    // The `content` attribute holds the unformatted amount; the element's text is the
    // localized rendering. Reading the attribute avoids parsing "1.299,00 €".
    const salesAmount = attrOf(detail, 'content', '.prices .sales .value', '.price .sales .value');
    const price = normalizePrice(
      salesAmount ?? textOf(detail, '.prices .sales', '.price .sales') ?? '',
    );
    if (price.amount) {
      offer.priceAmount = price.amount;
      capture.evidence.push(
        evidence('offer.priceAmount', 'adapter', 0.94, '.prices .sales .value[content]'),
      );
    }

    const listAmount = attrOf(
      detail,
      'content',
      '.prices .strike-through .value',
      '.price .strike-through .value',
    );
    const original = normalizePrice(
      listAmount ?? textOf(detail, '.prices .strike-through', '.price .strike-through') ?? '',
    );
    if (original.amount && original.amount !== price.amount) {
      offer.originalPriceAmount = original.amount;
      capture.evidence.push(evidence('offer.originalPriceAmount', 'adapter', 0.92));
    }

    const currency =
      normalizeCurrency(attrOf(document, 'content', 'meta[itemprop="priceCurrency"]')) ??
      normalizePrice(textOf(detail, '.prices .sales', '.price .sales') ?? '').currency ??
      price.currency;
    if (currency) {
      offer.currency = currency;
      capture.evidence.push(evidence('offer.currency', 'adapter', 0.88));
    }

    const availability = normalizeAvailability(
      textOf(detail, '.availability .availability-msg', '.availability-msg', '.availability'),
    );
    if (availability !== 'unknown') {
      offer.availability = availability;
      capture.evidence.push(evidence('offer.availability', 'adapter', 0.9, '.availability-msg'));
    }

    // Once a variation is chosen, `data-pid` is the variant's id — the identifier that
    // actually distinguishes what is being saved.
    const pid = attrOf(document, 'data-pid', '.product-detail[data-pid]', '[data-pid]');
    if (pid) {
      identifiers.sku = pid;
      identifiers.productId = pid;
    }

    const variant = selectedAttributes(detail);
    if (Object.keys(variant).length > 0) {
      capture.selectedVariant = variant;
      capture.evidence.push(evidence('selectedVariant', 'adapter', 0.92, '.attribute[data-attr]'));
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
