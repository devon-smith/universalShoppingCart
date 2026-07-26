import type { PartialCapture } from '@universal-cart/contracts';

import { normalizeAvailability } from '../normalizers/availability';
import { normalizeCurrency, normalizePrice } from '../normalizers/price';
import { absoluteHttpUrl, normalizeText, normalizeTextCapped, unique } from '../normalizers/text';
import type { ExtractionContext, ProductExtractor } from '../core/types';
import { evidence } from '../core/types';

/**
 * Open Graph, product meta tags, Twitter cards, and the canonical link.
 *
 * Ranked below JSON-LD because meta tags describe the page for sharing rather than the
 * product for buying: `og:title` is frequently "Wool Runner | Example Shop" and
 * `product:price:amount` frequently belongs to the default variant rather than the
 * selected one. Still far better than DOM guessing when structured data is absent.
 */

const DESCRIPTION_MAX = 1000;

function metaContent(document: Document, ...selectors: string[]): string | null {
  for (const selector of selectors) {
    const element = document.querySelector<HTMLMetaElement>(selector);
    const value = normalizeText(element?.content ?? element?.getAttribute('content'));
    if (value) return value;
  }
  return null;
}

const TITLE_SELECTORS = [
  'meta[property="og:title"]',
  'meta[name="og:title"]',
  'meta[name="twitter:title"]',
  'meta[property="twitter:title"]',
];

const IMAGE_SELECTORS = [
  'meta[property="og:image:secure_url"]',
  'meta[property="og:image"]',
  'meta[name="og:image"]',
  'meta[name="twitter:image"]',
  'meta[property="twitter:image"]',
  'meta[name="twitter:image:src"]',
];

const DESCRIPTION_SELECTORS = [
  'meta[property="og:description"]',
  'meta[name="og:description"]',
  'meta[name="description"]',
  'meta[name="twitter:description"]',
];

const PRICE_SELECTORS = [
  'meta[property="product:price:amount"]',
  'meta[name="product:price:amount"]',
  'meta[property="og:price:amount"]',
  'meta[itemprop="price"]',
];

const CURRENCY_SELECTORS = [
  'meta[property="product:price:currency"]',
  'meta[name="product:price:currency"]',
  'meta[property="og:price:currency"]',
  'meta[itemprop="priceCurrency"]',
];

const ORIGINAL_PRICE_SELECTORS = [
  'meta[property="product:original_price:amount"]',
  'meta[name="product:original_price:amount"]',
];

const AVAILABILITY_SELECTORS = [
  'meta[property="product:availability"]',
  'meta[name="product:availability"]',
  'meta[property="og:availability"]',
  'meta[itemprop="availability"]',
];

const BRAND_SELECTORS = [
  'meta[property="product:brand"]',
  'meta[name="product:brand"]',
  'meta[property="og:brand"]',
];

/** Read `<link rel="canonical">`, resolved against the page URL. */
export function canonicalUrlFrom(document: Document, baseUrl: string): string | null {
  const link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  const href = link?.getAttribute('href');
  return (
    absoluteHttpUrl(href, baseUrl) ??
    absoluteHttpUrl(metaContent(document, 'meta[property="og:url"]'), baseUrl)
  );
}

export const META_EXTRACTOR_ID = 'meta';
export const META_EXTRACTOR_VERSION = '1.0.0';

export const metaExtractor: ProductExtractor = {
  id: META_EXTRACTOR_ID,
  version: META_EXTRACTOR_VERSION,
  priority: 50,

  supports(context: ExtractionContext): boolean {
    return (
      context.document.querySelector(
        'meta[property^="og:"], meta[property^="product:"], meta[name^="twitter:"]',
      ) !== null
    );
  },

  extract(context: ExtractionContext): PartialCapture {
    const { document, url } = context;
    const capture: PartialCapture = { evidence: [] };
    const product: NonNullable<PartialCapture['product']> = {};
    const offer: NonNullable<PartialCapture['offer']> = {};
    const source: NonNullable<PartialCapture['source']> = {};

    const title = metaContent(document, ...TITLE_SELECTORS);
    if (title) {
      product.title = title;
      // Lower than JSON-LD's: og:title often carries a " | Retailer" suffix.
      capture.evidence.push(evidence('product.title', 'meta', 0.75, 'meta[property="og:title"]'));
    }

    const brand = metaContent(document, ...BRAND_SELECTORS);
    if (brand) {
      product.brand = brand;
      capture.evidence.push(evidence('product.brand', 'meta', 0.7));
    }

    const description = normalizeTextCapped(
      metaContent(document, ...DESCRIPTION_SELECTORS),
      DESCRIPTION_MAX,
    );
    if (description) {
      product.description = description;
      capture.evidence.push(evidence('product.description', 'meta', 0.7));
    }

    const images = unique(
      IMAGE_SELECTORS.map((selector) =>
        absoluteHttpUrl(metaContent(document, selector), url),
      ).filter((value): value is string => value !== null),
    );
    if (images.length > 0) {
      product.imageUrls = images;
      product.selectedImageUrl = images[0]!;
      capture.evidence.push(evidence('product.imageUrls', 'meta', 0.75));
      capture.evidence.push(evidence('product.selectedImageUrl', 'meta', 0.75));
    }

    const price = normalizePrice(metaContent(document, ...PRICE_SELECTORS));
    if (price.amount) {
      offer.priceAmount = price.amount;
      capture.evidence.push(
        evidence('offer.priceAmount', 'meta', 0.7, 'meta[property="product:price:amount"]'),
      );
    }

    const originalPrice = normalizePrice(metaContent(document, ...ORIGINAL_PRICE_SELECTORS));
    if (originalPrice.amount) {
      offer.originalPriceAmount = originalPrice.amount;
      capture.evidence.push(evidence('offer.originalPriceAmount', 'meta', 0.65));
    }

    const currency =
      normalizeCurrency(metaContent(document, ...CURRENCY_SELECTORS)) ?? price.currency;
    if (currency) {
      offer.currency = currency;
      capture.evidence.push(evidence('offer.currency', 'meta', 0.75));
    }

    const availability = normalizeAvailability(metaContent(document, ...AVAILABILITY_SELECTORS));
    if (availability !== 'unknown') {
      offer.availability = availability;
      capture.evidence.push(evidence('offer.availability', 'meta', 0.7));
    }

    const canonical = canonicalUrlFrom(document, url);
    if (canonical) {
      source.canonicalUrl = canonical;
      capture.evidence.push(evidence('source.canonicalUrl', 'meta', 0.9, 'link[rel="canonical"]'));
    }

    const pageTitle = normalizeText(document.title);
    if (pageTitle) {
      source.pageTitle = pageTitle;
      capture.evidence.push(evidence('source.pageTitle', 'meta', 0.9));
    }

    if (Object.keys(product).length > 0) capture.product = product;
    if (Object.keys(offer).length > 0) capture.offer = offer;
    if (Object.keys(source).length > 0) capture.source = source;

    return capture;
  },
};
