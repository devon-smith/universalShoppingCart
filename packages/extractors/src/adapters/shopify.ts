import type { PartialCapture } from '@universal-cart/contracts';

import type { ExtractionContext, ProductExtractor } from '../core/types';
import { evidence } from '../core/types';
import { normalizeCurrency } from '../normalizers/price';
import { absoluteHttpUrl, normalizeText, unique } from '../normalizers/text';

import {
  arrayProp,
  isRecord,
  minorUnitsToDecimal,
  numberProp,
  readJsonScript,
  stringProp,
} from './shared';

/**
 * Shopify storefronts.
 *
 * Shopify themes embed the product as JSON, and — critically — the URL carries the
 * selected variant id. That pairing is the reason this adapter earns its place: generic
 * extraction sees one price and one title for a page whose `?variant=` says the user is
 * looking at the 41 / Natural Black, at a different price and stock status. Everything
 * here comes from the platform's own serialization, so the confidences are high.
 */

export const SHOPIFY_ADAPTER_ID = 'shopify';
export const SHOPIFY_ADAPTER_VERSION = '1.0.0';

const PRODUCT_JSON_SELECTORS = [
  'script[type="application/json"][data-product-json]',
  'script[type="application/json"][id^="ProductJson"]',
  'script[type="application/json"][id="ProductJson"]',
  'script[type="application/ld+json"][data-product-json]',
];

/** Asset hosts and body classes that only a Shopify storefront has. */
const PLATFORM_SIGNALS = [
  'link[href*="cdn.shopify.com"]',
  'script[src*="cdn.shopify.com"]',
  'img[src*="/cdn/shop/"]',
  'body.template-product',
  'meta[name="shopify-digital-wallet"]',
  'meta[name="shopify-checkout-api-token"]',
];

function productJson(document: Document): Record<string, unknown> | null {
  const parsed = readJsonScript(document, ...PRODUCT_JSON_SELECTORS);
  if (!isRecord(parsed)) return null;

  // A Shopify product always has a title and a variants array. Anything else in one of
  // these script tags is some other theme's payload and is not ours to interpret.
  return typeof parsed.title === 'string' && Array.isArray(parsed.variants) ? parsed : null;
}

/** The variant id in `?variant=`, which is what the shopper is actually looking at. */
function selectedVariantId(url: string): string | null {
  try {
    return normalizeText(new URL(url).searchParams.get('variant'));
  } catch {
    return null;
  }
}

function pickVariant(
  product: Record<string, unknown>,
  url: string,
): Record<string, unknown> | null {
  const variants = arrayProp(product, 'variants').filter(isRecord);
  if (variants.length === 0) return null;

  const wanted = selectedVariantId(url);
  if (wanted) {
    const match = variants.find((variant) => String(variant.id ?? '') === wanted);
    if (match) return match;
  }

  // No variant in the URL: the theme shows the first available one, so that is what the
  // shopper sees. Falling back to the first variant outright would report a sold-out
  // price as the current price.
  return variants.find((variant) => variant.available === true) ?? variants[0] ?? null;
}

/**
 * Map the variant's option values onto the product's option names.
 *
 * Shopify stores them positionally — `option1`, `option2`, `option3` line up with
 * `options[0..2]`. `variant.title` is those same values joined by " / ", which is why it
 * is not used here: splitting a title is guesswork when an option value contains a slash.
 */
function variantOptions(
  product: Record<string, unknown>,
  variant: Record<string, unknown>,
): Record<string, string> {
  const selected: Record<string, string> = {};

  const names = arrayProp(product, 'options').map((option) =>
    typeof option === 'string' ? normalizeText(option) : stringProp(option, 'name'),
  );

  names.forEach((name, index) => {
    if (!name) return;
    const value = stringProp(variant, `option${index + 1}`);
    if (value) selected[name] = value;
  });

  return selected;
}

function imagesFrom(product: Record<string, unknown>, url: string): string[] {
  return unique(
    arrayProp(product, 'images')
      .map((image) =>
        absoluteHttpUrl(typeof image === 'string' ? image : stringProp(image, 'src'), url),
      )
      .filter((value): value is string => value !== null),
  );
}

export const shopifyAdapter: ProductExtractor = {
  id: SHOPIFY_ADAPTER_ID,
  version: SHOPIFY_ADAPTER_VERSION,
  priority: 95,

  supports(context: ExtractionContext): boolean {
    const { document } = context;
    if (document.querySelector(PLATFORM_SIGNALS.join(', ')) !== null) return true;

    // Themes that host their own assets still declare the global.
    return Array.from(document.querySelectorAll('script:not([src])')).some((script) =>
      /window\.Shopify\s*=|var\s+Shopify\s*=|Shopify\.shop\s*=/.test(script.textContent ?? ''),
    );
  },

  extract(context: ExtractionContext): PartialCapture {
    const { document, url } = context;
    const capture: PartialCapture = { evidence: [] };

    const product = productJson(document);
    if (!product) return capture;

    const productFields: NonNullable<PartialCapture['product']> = {};
    const offer: NonNullable<PartialCapture['offer']> = {};
    const identifiers: Record<string, string> = {};

    const title = stringProp(product, 'title');
    if (title) {
      productFields.title = title;
      capture.evidence.push(evidence('product.title', 'adapter', 0.97, 'ProductJson.title'));
    }

    const vendor = stringProp(product, 'vendor');
    if (vendor) {
      productFields.brand = vendor;
      capture.evidence.push(evidence('product.brand', 'adapter', 0.95, 'ProductJson.vendor'));
    }

    const productId = product.id;
    if (typeof productId === 'number' || typeof productId === 'string') {
      identifiers.productId = String(productId);
    }

    const images = imagesFrom(product, url);
    if (images.length > 0) {
      productFields.imageUrls = images;
      capture.evidence.push(evidence('product.imageUrls', 'adapter', 0.95));
    }

    const variant = pickVariant(product, url);
    if (variant) {
      // Prices in the product JSON are integer minor units.
      const price = minorUnitsToDecimal(variant.price ?? numberProp(variant, 'price'));
      if (price) {
        offer.priceAmount = price;
        capture.evidence.push(
          evidence('offer.priceAmount', 'adapter', 0.97, 'ProductJson.variants[].price'),
        );
      }

      const compareAt = minorUnitsToDecimal(variant.compare_at_price);
      if (compareAt && compareAt !== price) {
        offer.originalPriceAmount = compareAt;
        capture.evidence.push(
          evidence(
            'offer.originalPriceAmount',
            'adapter',
            0.95,
            'ProductJson.variants[].compare_at_price',
          ),
        );
      }

      if (typeof variant.available === 'boolean') {
        offer.availability = variant.available ? 'in_stock' : 'out_of_stock';
        capture.evidence.push(
          evidence('offer.availability', 'adapter', 0.95, 'ProductJson.variants[].available'),
        );
      }

      const sku = stringProp(variant, 'sku');
      if (sku) identifiers.sku = sku;

      const barcode = stringProp(variant, 'barcode');
      if (barcode) identifiers.gtin = barcode;

      const variantImage =
        absoluteHttpUrl(stringProp(variant, 'featured_image'), url) ??
        absoluteHttpUrl(stringProp(variant.featured_image, 'src'), url) ??
        absoluteHttpUrl(stringProp(product, 'featured_image'), url) ??
        images[0] ??
        null;
      if (variantImage) {
        productFields.selectedImageUrl = variantImage;
        capture.evidence.push(evidence('product.selectedImageUrl', 'adapter', 0.95));
      }

      const selected = variantOptions(product, variant);
      if (Object.keys(selected).length > 0) {
        capture.selectedVariant = selected;
        capture.evidence.push(
          evidence('selectedVariant', 'adapter', 0.97, 'ProductJson.options + variant.optionN'),
        );
      }
    }

    // The product JSON carries no currency; the storefront declares it separately. Left
    // null rather than assumed when neither is present — the meta extractor may know.
    const currency = normalizeCurrency(
      document
        .querySelector<HTMLMetaElement>('meta[property="product:price:currency"]')
        ?.getAttribute('content') ??
        document
          .querySelector<HTMLMetaElement>('meta[property="og:price:currency"]')
          ?.getAttribute('content'),
    );
    if (currency) {
      offer.currency = currency;
      capture.evidence.push(evidence('offer.currency', 'adapter', 0.9));
    }

    if (Object.keys(identifiers).length > 0) {
      productFields.identifiers = identifiers;
      capture.evidence.push(evidence('product.identifiers', 'adapter', 0.95));
    }

    if (Object.keys(productFields).length > 0) capture.product = productFields;
    if (Object.keys(offer).length > 0) capture.offer = offer;

    return capture;
  },
};
