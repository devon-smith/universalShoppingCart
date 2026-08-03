import type { PartialCapture } from '@universal-cart/contracts';

import type { ExtractionContext, ProductExtractor } from '../core/types';
import { evidence } from '../core/types';
import { normalizePrice } from '../normalizers/price';
import { absoluteHttpUrl, normalizeText } from '../normalizers/text';

/**
 * Amazon.
 *
 * A brand adapter, justified the same way as StockX and Wayfair: Amazon ships **no JSON-LD at
 * all** — not a Product, not a BreadcrumbList — so the structured-data tier reads nothing, and
 * the generic heuristics do not recognise Amazon's `a-*` price vocabulary. Without an adapter
 * the page yields no price (docs/STATUS.md, the Amazon blocker).
 *
 * ## The price belongs to the selected swatch, not the first one on the page
 *
 * Every price lives in the colour twister — one `apex-pricetopay-value` per swatch, and the
 * buy box (`#apex_desktop`) is empty because it renders client-side. So "the most prominent
 * price" has no answer. Only `.a-button-selected` marks the colour being bought, and only its
 * price is this product's; the unselected swatches carry deliberately different figures. When
 * there is no twister at all, the price is the single `#corePriceDisplay_desktop_feature_div`
 * (note: a *different* id from the twister page's `#corePrice_feature_div` — Amazon ships
 * both). A sponsored carousel further down carries a real strikethrough for a *different*
 * product; reading it would fabricate a discount, so nothing here is read outside the price
 * containers named above.
 *
 * ## Two identifiers, both kept
 *
 * `link[rel=canonical]` points at the PARENT ASIN while the page is a child (a specific
 * colour). Fingerprinting on the canonical alone would collapse every colour into one item, so
 * the child ASIN from the URL's `/dp/` segment is recorded as `identifiers.productId` and the
 * canonical is left untouched — the fingerprint then distinguishes the colours.
 */

export const AMAZON_ADAPTER_ID = 'amazon';
export const AMAZON_ADAPTER_VERSION = '1.0.0';

/** Amazon's US storefront. Other TLDs price in other currencies and are left to the pipeline. */
function isAmazonUs(hostname: string): boolean {
  return hostname === 'amazon.com' || hostname === 'www.amazon.com';
}

/** The child ASIN in a `/dp/<ASIN>` URL — the specific variant being viewed. */
function asinFromUrl(url: string): string | null {
  try {
    const match = /\/dp\/([A-Z0-9]{10})\b/i.exec(new URL(url).pathname);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * The price inside an Amazon price element.
 *
 * `.a-offscreen` carries the full "$56.80" and is preferred — except in a twister swatch,
 * where it is left empty and the value is in the `aria-hidden` span instead. The document-order
 * fallback to `textContent` would concatenate the symbol/whole/fraction spans into "$4600", so
 * it is the last resort, not the first.
 */
function amazonAmount(container: Element | null | undefined): string | null {
  if (!container) return null;
  const offscreen = normalizeText(container.querySelector('.a-offscreen')?.textContent);
  const ariaHidden = normalizeText(container.querySelector('[aria-hidden="true"]')?.textContent);
  return normalizePrice(offscreen || ariaHidden || normalizeText(container.textContent)).amount;
}

/** Does a core-price widget for exactly this ASIN agree with the swatch price? */
function asinCorroborates(document: Document, asin: string | null, amount: string): boolean {
  if (!asin) return false;
  for (const div of Array.from(
    document.querySelectorAll('#corePrice_feature_div, #corePriceDisplay_desktop_feature_div'),
  )) {
    if (div.getAttribute('data-csa-c-asin') !== asin) continue;
    const core = amazonAmount(div.querySelector('.priceToPay') ?? div.querySelector('.a-price'));
    if (core === amount) return true;
  }
  return false;
}

export const amazonAdapter: ProductExtractor = {
  id: AMAZON_ADAPTER_ID,
  version: AMAZON_ADAPTER_VERSION,
  priority: 96,

  supports(context: ExtractionContext): boolean {
    let hostname: string;
    try {
      hostname = new URL(context.url).hostname.toLowerCase();
    } catch {
      return false;
    }
    if (!isAmazonUs(hostname)) return false;

    // #productTitle is the product-detail-page signal, present on both the twister and the
    // single-price layouts. A page without it is search, a store front, or an account page.
    return context.document.querySelector('#productTitle') !== null;
  },

  extract(context: ExtractionContext): PartialCapture {
    const { document, url } = context;

    const capture: PartialCapture = { evidence: [] };
    const product: NonNullable<PartialCapture['product']> = {};
    const offer: NonNullable<PartialCapture['offer']> = {};
    const identifiers: Record<string, string> = {};

    // First match only: #productTitle is duplicated on the real page, and concatenating both
    // yields a doubled title.
    const title = normalizeText(document.querySelector('#productTitle')?.textContent);
    if (title) {
      product.title = title;
      capture.evidence.push(evidence('product.title', 'adapter', 0.95, '#productTitle'));
    }

    // "Visit the Northwind Store" → "Northwind".
    const byline = normalizeText(document.querySelector('#bylineInfo')?.textContent);
    const brand = byline
      ? normalizeText(byline.replace(/^Visit the\s+/i, '').replace(/\s+Store$/i, ''))
      : null;
    if (brand) {
      product.brand = brand;
      capture.evidence.push(evidence('product.brand', 'adapter', 0.85, '#bylineInfo'));
    }

    const image = absoluteHttpUrl(
      document.querySelector('#landingImage')?.getAttribute('src'),
      url,
    );
    if (image) {
      product.imageUrls = [image];
      product.selectedImageUrl = image;
      capture.evidence.push(evidence('product.imageUrls', 'adapter', 0.9));
      capture.evidence.push(evidence('product.selectedImageUrl', 'adapter', 0.9));
    }

    const asin = asinFromUrl(url);
    if (asin) identifiers.productId = asin;

    // Price. Prefer the selected swatch; fall back to the single core-price widget.
    const selected = document.querySelector('[id^="color_name_"].a-button-selected');
    let priceElement: Element | null;
    let originalElement: Element | null = null;
    let priceSelector: string;

    if (selected) {
      priceElement = selected.querySelector('.apex-pricetopay-value');
      originalElement = selected.querySelector('.apex-basisprice-value[data-a-strike="true"]');
      priceSelector = '[id^="color_name_"].a-button-selected .apex-pricetopay-value';
    } else {
      priceElement =
        document.querySelector('#corePriceDisplay_desktop_feature_div .priceToPay') ??
        document.querySelector('#corePrice_feature_div .priceToPay');
      priceSelector = '#corePriceDisplay_desktop_feature_div .priceToPay';
    }

    const amount = amazonAmount(priceElement);
    if (amount) {
      offer.priceAmount = amount;
      // US storefront, no ISO code on the page, bare `$` glyph — the adapter knows the retailer.
      offer.currency = 'USD';
      // When the price came from a swatch, a core-price widget carrying this exact ASIN and the
      // same figure is independent corroboration that the selected colour is the one on screen.
      const corroborated = selected ? asinCorroborates(document, asin, amount) : true;
      capture.evidence.push(
        evidence(
          'offer.priceAmount',
          'adapter',
          corroborated ? 0.95 : 0.85,
          corroborated ? `${priceSelector} (asin-corroborated)` : priceSelector,
        ),
      );
      capture.evidence.push(evidence('offer.currency', 'adapter', 0.6, 'US storefront'));
    }

    const original = amazonAmount(originalElement);
    if (original && original !== amount) {
      offer.originalPriceAmount = original;
      capture.evidence.push(
        evidence(
          'offer.originalPriceAmount',
          'adapter',
          0.9,
          '.apex-basisprice-value[data-a-strike]',
        ),
      );
    }

    // Availability: the prose in #availability, agreeing with #twisterAvailability when present.
    const availabilityText = [
      normalizeText(document.querySelector('#availability')?.textContent),
      normalizeText(document.querySelector('#twisterAvailability')?.textContent),
    ]
      .filter((part): part is string => part !== null)
      .join(' ');
    if (/unavailable|out of stock/i.test(availabilityText)) {
      offer.availability = 'out_of_stock';
      capture.evidence.push(evidence('offer.availability', 'adapter', 0.85, '#availability'));
    } else if (/in stock/i.test(availabilityText)) {
      offer.availability = 'in_stock';
      capture.evidence.push(evidence('offer.availability', 'adapter', 0.8, '#availability'));
    }

    // Selected twister dimensions. Each expanded-dimension-text span is a chosen value; its
    // enclosing dim-title carries the label. A dimension left on "Select" (the size dropdown)
    // has no expanded-dimension-text span, so it is naturally absent rather than recorded as a
    // choice nobody made.
    const variant: Record<string, string> = {};
    for (const valueElement of Array.from(
      document.querySelectorAll('[id^="inline-twister-expanded-dimension-text-"]'),
    )) {
      const value = normalizeText(valueElement.textContent);
      const titleElement = valueElement.closest('[id^="inline-twister-dim-title-"]');
      const titleText = normalizeText(titleElement?.textContent);
      if (!value || !titleText) continue;
      const label = titleText.includes(value)
        ? normalizeText(titleText.slice(0, titleText.lastIndexOf(value)))?.replace(/\s*:\s*$/, '')
        : titleText.replace(/\s*:\s*$/, '');
      if (label) variant[label] = value;
    }
    if (Object.keys(variant).length > 0) {
      capture.selectedVariant = variant;
      capture.evidence.push(
        evidence('selectedVariant', 'adapter', 0.9, 'inline-twister expanded dimensions'),
      );
    }

    if (Object.keys(identifiers).length > 0) {
      product.identifiers = identifiers;
      capture.evidence.push(evidence('product.identifiers', 'adapter', 0.9, 'URL /dp/ ASIN'));
    }

    if (Object.keys(product).length > 0) capture.product = product;
    if (Object.keys(offer).length > 0) capture.offer = offer;

    return capture;
  },
};
