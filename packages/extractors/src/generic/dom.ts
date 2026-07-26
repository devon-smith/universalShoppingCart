import type { PartialCapture } from '@universal-cart/contracts';

import { normalizeAvailability } from '../normalizers/availability';
import { normalizeCurrency, normalizePrice } from '../normalizers/price';
import { absoluteHttpUrl, normalizeText, unique } from '../normalizers/text';
import type { ExtractionContext, ProductExtractor } from '../core/types';
import { evidence } from '../core/types';

import {
  extractSelectedVariantFromDom,
  extractSelectedVariantFromUrl,
  mergeVariants,
} from './variant';

/**
 * Conservative DOM heuristics — the last resort (BUILD_PLAN.md §10.5).
 *
 * The guiding rule is: never select the first number that looks like a price. Every
 * signal here is either a machine-readable annotation (`itemprop`, `data-price`) or a
 * structural landmark (the `<h1>` inside a product region). Free-text scanning for
 * currency symbols is deliberately absent, because on a real product page it finds
 * shipping thresholds, financing offers, and "customers also bought" tiles.
 *
 * Confidences are low across the board so that any structured data on the page wins.
 */

/** Ordered from most machine-readable to least. */
const PRICE_SELECTORS: ReadonlyArray<readonly [selector: string, confidence: number]> = [
  ['[itemprop="price"]', 0.6],
  ['[data-price-amount]', 0.55],
  ['[data-price]', 0.5],
  ['[data-testid="price"]', 0.45],
  ['[class*="price--current"]', 0.4],
  ['[class*="current-price"]', 0.4],
  ['[class*="sale-price"]', 0.4],
  ['[id="price"]', 0.35],
];

const ORIGINAL_PRICE_SELECTORS: ReadonlyArray<readonly [selector: string, confidence: number]> = [
  ['[data-original-price]', 0.5],
  ['[class*="price--original"]', 0.4],
  ['[class*="original-price"]', 0.4],
  ['[class*="was-price"]', 0.4],
  ['[class*="compare-at"]', 0.4],
  ['s[class*="price"]', 0.35],
  ['del[class*="price"]', 0.35],
];

const TITLE_SELECTORS: ReadonlyArray<readonly [selector: string, confidence: number]> = [
  ['[itemprop="name"]', 0.6],
  ['h1[class*="product"]', 0.55],
  ['[data-testid="product-title"]', 0.55],
  ['main h1', 0.45],
  ['h1', 0.35],
];

const BRAND_SELECTORS: ReadonlyArray<readonly [selector: string, confidence: number]> = [
  ['[itemprop="brand"]', 0.55],
  ['[data-testid="product-brand"]', 0.5],
];

const IMAGE_SELECTORS: ReadonlyArray<readonly [selector: string, confidence: number]> = [
  ['[itemprop="image"]', 0.55],
  ['[data-testid="product-image"] img', 0.5],
  ['[class*="product-gallery"] img', 0.45],
  ['[class*="product-image"] img', 0.4],
];

/** Read a value from an element, preferring an explicit attribute over visible text. */
function readValue(element: Element): string | null {
  for (const attribute of [
    'content',
    'data-price-amount',
    'data-price',
    'data-original-price',
    'value',
  ]) {
    const value = normalizeText(element.getAttribute(attribute));
    if (value) return value;
  }
  return normalizeText(element.textContent);
}

function firstMatch(
  document: Document,
  selectors: ReadonlyArray<readonly [string, number]>,
): { element: Element; selector: string; confidence: number } | null {
  for (const [selector, confidence] of selectors) {
    const element = document.querySelector(selector);
    if (element) return { element, selector, confidence };
  }
  return null;
}

/**
 * Availability inferred from the add-to-cart control.
 *
 * A disabled or missing add-to-cart button is a strong out-of-stock signal, and an
 * enabled one is a weaker in-stock signal — plenty of pages keep the button enabled and
 * fail later. Confidence reflects that asymmetry.
 */
function availabilityFromControls(document: Document): {
  availability: ReturnType<typeof normalizeAvailability>;
  confidence: number;
  selector: string;
} | null {
  const soldOutText = document.querySelector(
    '[data-testid="sold-out"], [class*="sold-out"], [class*="out-of-stock"]',
  );
  if (soldOutText) {
    return { availability: 'out_of_stock', confidence: 0.5, selector: '[class*="sold-out"]' };
  }

  const button = document.querySelector<HTMLButtonElement | HTMLInputElement>(
    'button[name*="add"], button[id*="add-to-cart"], button[class*="add-to-cart"], button[data-testid*="add-to-cart"], [data-testid="add-to-bag"]',
  );
  if (!button) return null;

  const disabled =
    button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true';

  return disabled
    ? { availability: 'out_of_stock', confidence: 0.5, selector: 'add-to-cart[disabled]' }
    : { availability: 'in_stock', confidence: 0.35, selector: 'add-to-cart' };
}

export const DOM_EXTRACTOR_ID = 'generic-dom';
export const DOM_EXTRACTOR_VERSION = '1.0.0';

export const domExtractor: ProductExtractor = {
  id: DOM_EXTRACTOR_ID,
  version: DOM_EXTRACTOR_VERSION,
  priority: 10,

  supports(): boolean {
    // The fallback always runs; its low confidences keep it from overriding better sources.
    return true;
  },

  extract(context: ExtractionContext): PartialCapture {
    const { document, url } = context;
    const capture: PartialCapture = { evidence: [] };
    const product: NonNullable<PartialCapture['product']> = {};
    const offer: NonNullable<PartialCapture['offer']> = {};
    const source: NonNullable<PartialCapture['source']> = {};

    // The document title is worth recording even on a page with no product markup at all;
    // it is what the correction UI shows the user as a starting point.
    const pageTitle = normalizeText(document.title);
    if (pageTitle) {
      source.pageTitle = pageTitle;
      capture.evidence.push(evidence('source.pageTitle', 'dom', 0.6, 'title'));
    }

    const titleMatch = firstMatch(document, TITLE_SELECTORS);
    const title = titleMatch ? normalizeText(readValue(titleMatch.element)) : null;
    if (title && titleMatch) {
      product.title = title;
      capture.evidence.push(
        evidence('product.title', 'dom', titleMatch.confidence, titleMatch.selector),
      );
    }

    const brandMatch = firstMatch(document, BRAND_SELECTORS);
    const brand = brandMatch ? normalizeText(readValue(brandMatch.element)) : null;
    if (brand && brandMatch) {
      product.brand = brand;
      capture.evidence.push(
        evidence('product.brand', 'dom', brandMatch.confidence, brandMatch.selector),
      );
    }

    const images = unique(
      IMAGE_SELECTORS.flatMap(([selector]) =>
        Array.from(document.querySelectorAll(selector))
          .map((element) =>
            absoluteHttpUrl(
              element.getAttribute('src') ??
                element.getAttribute('content') ??
                element.getAttribute('data-src'),
              url,
            ),
          )
          .filter((value): value is string => value !== null),
      ),
    );
    if (images.length > 0) {
      const confidence = IMAGE_SELECTORS[0]?.[1] ?? 0.4;
      product.imageUrls = images;
      product.selectedImageUrl = images[0]!;
      capture.evidence.push(evidence('product.imageUrls', 'dom', confidence));
      capture.evidence.push(evidence('product.selectedImageUrl', 'dom', confidence));
    }

    const priceMatch = firstMatch(document, PRICE_SELECTORS);
    if (priceMatch) {
      const parsed = normalizePrice(readValue(priceMatch.element));
      if (parsed.amount) {
        offer.priceAmount = parsed.amount;
        capture.evidence.push(
          evidence('offer.priceAmount', 'dom', priceMatch.confidence, priceMatch.selector),
        );
      }

      const currency =
        normalizeCurrency(
          document.querySelector('[itemprop="priceCurrency"]')?.getAttribute('content') ?? null,
        ) ?? parsed.currency;
      if (currency) {
        offer.currency = currency;
        capture.evidence.push(evidence('offer.currency', 'dom', priceMatch.confidence));
      }
    }

    const originalMatch = firstMatch(document, ORIGINAL_PRICE_SELECTORS);
    if (originalMatch) {
      const parsed = normalizePrice(readValue(originalMatch.element));
      if (parsed.amount) {
        offer.originalPriceAmount = parsed.amount;
        capture.evidence.push(
          evidence(
            'offer.originalPriceAmount',
            'dom',
            originalMatch.confidence,
            originalMatch.selector,
          ),
        );
      }
    }

    const itempropAvailability = document.querySelector('[itemprop="availability"]');
    const annotated = normalizeAvailability(
      itempropAvailability?.getAttribute('href') ??
        itempropAvailability?.getAttribute('content') ??
        normalizeText(itempropAvailability?.textContent),
    );

    if (annotated !== 'unknown') {
      offer.availability = annotated;
      capture.evidence.push(
        evidence('offer.availability', 'dom', 0.55, '[itemprop="availability"]'),
      );
    } else {
      const inferred = availabilityFromControls(document);
      if (inferred) {
        offer.availability = inferred.availability;
        capture.evidence.push(
          evidence('offer.availability', 'dom', inferred.confidence, inferred.selector),
        );
      }
    }

    const selectedVariant = mergeVariants(
      extractSelectedVariantFromDom(document),
      extractSelectedVariantFromUrl(url),
    );
    if (Object.keys(selectedVariant).length > 0) {
      capture.selectedVariant = selectedVariant;
      capture.evidence.push(evidence('selectedVariant', 'dom', 0.6));
    }

    if (Object.keys(product).length > 0) capture.product = product;
    if (Object.keys(offer).length > 0) capture.offer = offer;
    if (Object.keys(source).length > 0) capture.source = source;

    return capture;
  },
};
