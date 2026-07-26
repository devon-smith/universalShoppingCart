import type { PartialCapture } from '@universal-cart/contracts';

import { normalizeAvailability } from '../normalizers/availability';
import { normalizeCurrency, normalizePrice } from '../normalizers/price';
import { absoluteHttpUrl, normalizeText, normalizeTextCapped, unique } from '../normalizers/text';
import type { ExtractionContext, ProductExtractor } from '../core/types';
import { evidence } from '../core/types';

/**
 * schema.org Product/Offer extraction from `<script type="application/ld+json">`.
 *
 * Structured data is evidence, not truth (BUILD_PLAN.md §10.3). Retailers ship stale
 * JSON-LD, prices for the wrong variant, and blocks describing the site rather than the
 * product, so every value carries a confidence and can be beaten by an adapter or by the
 * user.
 *
 * Handles: multiple script blocks, top-level arrays, `@graph`, `@type` as a string or an
 * array, single offers, offer arrays, and `AggregateOffer`.
 */

const DESCRIPTION_MAX = 1000;

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
interface JsonObject {
  [key: string]: JsonValue | undefined;
}

/**
 * Parse JSON that a page author may have mangled.
 *
 * Recovers from two things seen in the wild: a trailing `;` (or other junk) after the
 * closing brace, and HTML comment wrappers left over from older CMS templates. Anything
 * else is skipped rather than repaired — a heuristically "fixed" block is more likely to
 * produce a wrong price than no price.
 */
export function parseJsonLdBlock(raw: string): JsonValue | null {
  const text = raw
    .replace(/^\s*<!--/, '')
    .replace(/-->\s*$/, '')
    .trim();

  if (text.length === 0) return null;

  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    // Retry against the outermost balanced object or array.
    const start = text.search(/[[{]/);
    if (start < 0) return null;
    const opener = text[start];
    const closer = opener === '[' ? ']' : '}';
    const end = text.lastIndexOf(closer);
    if (end <= start) return null;

    try {
      return JSON.parse(text.slice(start, end + 1)) as JsonValue;
    } catch {
      return null;
    }
  }
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Flatten a JSON-LD document into every node it contains, including `@graph` members. */
export function flattenJsonLd(value: JsonValue | null): JsonObject[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (!isObject(value)) return [];

  const nodes: JsonObject[] = [value];
  const graph = value['@graph'];
  if (graph !== undefined) nodes.push(...flattenJsonLd(graph));
  return nodes;
}

function typesOf(node: JsonObject): string[] {
  const raw = node['@type'];
  const values = Array.isArray(raw) ? raw : [raw];
  return values
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.split(/[/#]/).pop() ?? entry)
    .map((entry) => entry.toLowerCase());
}

function hasType(node: JsonObject, ...wanted: string[]): boolean {
  const types = typesOf(node);
  return wanted.some((entry) => types.includes(entry.toLowerCase()));
}

/** `Product` and the subtypes retailers actually use. */
export function findProductNodes(value: JsonValue | null): JsonObject[] {
  const nodes = flattenJsonLd(value).filter((node) =>
    hasType(
      node,
      'Product',
      'ProductModel',
      'ProductGroup',
      'IndividualProduct',
      'Vehicle',
      'Book',
    ),
  );

  // Google's variant markup describes the family as a `ProductGroup` and the variant on
  // screen as a `Product`. The variant is the better subject — it carries the price and
  // availability the user is looking at — so groups sort last. Document order is otherwise
  // preserved, and a page whose only block is a group still extracts.
  const groups = nodes.filter((node) => hasType(node, 'ProductGroup'));
  if (groups.length === 0 || groups.length === nodes.length) return nodes;

  return [...nodes.filter((node) => !hasType(node, 'ProductGroup')), ...groups];
}

/** Read a value that schema.org allows to be a string, an object with `name`, or a list. */
function readName(value: JsonValue | undefined): string | null {
  if (typeof value === 'string') return normalizeText(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = readName(entry);
      if (found) return found;
    }
    return null;
  }
  if (isObject(value)) {
    return readName(value.name) ?? readName(value['@id']);
  }
  return null;
}

/** Read `image`, which may be a string, an ImageObject, or a list of either. */
function readImages(value: JsonValue | undefined, baseUrl: string): string[] {
  if (typeof value === 'string') {
    const url = absoluteHttpUrl(value, baseUrl);
    return url ? [url] : [];
  }
  if (Array.isArray(value)) return value.flatMap((entry) => readImages(entry, baseUrl));
  if (isObject(value)) {
    return readImages(value.url ?? value.contentUrl ?? value['@id'], baseUrl);
  }
  return [];
}

function readString(value: JsonValue | undefined): string | null {
  if (typeof value === 'string') return normalizeText(value);
  if (typeof value === 'number') return String(value);
  return null;
}

interface OfferFacts {
  priceAmount: string | null;
  originalPriceAmount: string | null;
  currency: string | null;
  availability: ReturnType<typeof normalizeAvailability>;
  sku: string | null;
}

/**
 * Collect the offers attached to a product node.
 *
 * `AggregateOffer` is expanded into its `offers`, falling back to its `lowPrice` when it
 * has no members — an aggregate's low price is a real observed price, and better than
 * showing nothing.
 */
function collectOffers(value: JsonValue | undefined): JsonObject[] {
  if (Array.isArray(value)) return value.flatMap(collectOffers);
  if (!isObject(value)) return [];

  if (hasType(value, 'AggregateOffer')) {
    const members = collectOffers(value.offers);
    return members.length > 0 ? members : [value];
  }

  return [value];
}

function readOffer(offer: JsonObject): OfferFacts {
  const priceSpecification = isObject(offer.priceSpecification)
    ? offer.priceSpecification
    : undefined;

  const rawPrice =
    offer.price ??
    offer.lowPrice ??
    priceSpecification?.price ??
    priceSpecification?.minPrice ??
    null;

  const price = normalizePrice(
    typeof rawPrice === 'string' || typeof rawPrice === 'number' ? rawPrice : null,
  );

  const currency = normalizeCurrency(
    readString(offer.priceCurrency) ?? readString(priceSpecification?.priceCurrency),
  );

  // schema.org has no canonical "was" price; retailers use these three. On an
  // AggregateOffer, though, `highPrice` is the top of a range across variants rather than a
  // former price — reporting it as one renders a discount the retailer never offered.
  const originalRaw =
    (hasType(offer, 'AggregateOffer') ? null : offer.highPrice) ??
    (isObject(offer.priceSpecification) ? offer.priceSpecification.listPrice : undefined) ??
    offer.listPrice ??
    null;
  const original = normalizePrice(
    typeof originalRaw === 'string' || typeof originalRaw === 'number' ? originalRaw : null,
  );

  return {
    priceAmount: price.amount,
    originalPriceAmount: original.amount,
    currency: currency ?? price.currency,
    availability: normalizeAvailability(
      readString(offer.availability) ?? readString(offer.itemCondition),
    ),
    sku: readString(offer.sku),
  };
}

/**
 * Choose which offer describes the thing the user is looking at.
 *
 * Preference order: an offer whose `sku` matches the product's, then the first offer that
 * carries a price, then the first offer at all. Picking "the cheapest" would be wrong —
 * on a page with several variants that is a different product than the one on screen.
 */
export function selectOffer(
  offers: readonly JsonObject[],
  productSku: string | null,
): OfferFacts | null {
  if (offers.length === 0) return null;

  const facts = offers.map(readOffer);

  if (productSku) {
    const bySku = facts.find((entry) => entry.sku !== null && entry.sku === productSku);
    if (bySku) return bySku;
  }

  return facts.find((entry) => entry.priceAmount !== null) ?? facts[0]!;
}

/** Read `additionalProperty` / `hasVariant` style option pairs into a variant map. */
function readSelectedVariant(node: JsonObject): Record<string, string> {
  const variant: Record<string, string> = {};

  for (const key of ['color', 'size', 'material', 'pattern'] as const) {
    const value = readName(node[key]);
    if (value) {
      variant[key.charAt(0).toUpperCase() + key.slice(1)] = value;
    }
  }

  const additional = node.additionalProperty;
  const entries = Array.isArray(additional) ? additional : [additional];
  for (const entry of entries) {
    if (!isObject(entry)) continue;
    const name = readString(entry.name);
    const value = readString(entry.value);
    if (name && value) variant[name] = value;
  }

  return variant;
}

export const JSON_LD_EXTRACTOR_ID = 'json-ld';
export const JSON_LD_EXTRACTOR_VERSION = '1.0.0';

/** Read every JSON-LD block on the page. Exported for diagnostics and tests. */
export function readJsonLdNodes(document: Document): JsonObject[] {
  const scripts = Array.from(
    document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]'),
  );

  return scripts.flatMap((script) => findProductNodes(parseJsonLdBlock(script.textContent ?? '')));
}

export const jsonLdExtractor: ProductExtractor = {
  id: JSON_LD_EXTRACTOR_ID,
  version: JSON_LD_EXTRACTOR_VERSION,
  priority: 70,

  supports(context: ExtractionContext): boolean {
    return readJsonLdNodes(context.document).length > 0;
  },

  extract(context: ExtractionContext): PartialCapture {
    const nodes = readJsonLdNodes(context.document);
    const capture: PartialCapture = { evidence: [] };
    if (nodes.length === 0) return capture;

    // The first Product node is the page's subject; later ones are usually related items.
    const node = nodes[0]!;
    const product: NonNullable<PartialCapture['product']> = {};
    const offerFields: NonNullable<PartialCapture['offer']> = {};

    const title = readName(node.name);
    if (title) {
      product.title = title;
      capture.evidence.push(evidence('product.title', 'json_ld', 0.95));
    }

    const brand = readName(node.brand) ?? readName(node.manufacturer);
    if (brand) {
      product.brand = brand;
      capture.evidence.push(evidence('product.brand', 'json_ld', 0.9));
    }

    const description = normalizeTextCapped(readString(node.description), DESCRIPTION_MAX);
    if (description) {
      product.description = description;
      capture.evidence.push(evidence('product.description', 'json_ld', 0.85));
    }

    const images = unique(readImages(node.image, context.url));
    if (images.length > 0) {
      product.imageUrls = images;
      product.selectedImageUrl = images[0]!;
      capture.evidence.push(evidence('product.imageUrls', 'json_ld', 0.9));
      capture.evidence.push(evidence('product.selectedImageUrl', 'json_ld', 0.85));
    }

    const sku = readString(node.sku);
    const identifiers: Record<string, string> = {};
    if (sku) identifiers.sku = sku;

    const gtin =
      readString(node.gtin) ??
      readString(node.gtin13) ??
      readString(node.gtin12) ??
      readString(node.gtin14) ??
      readString(node.gtin8);
    if (gtin) identifiers.gtin = gtin;

    const mpn = readString(node.mpn);
    if (mpn) identifiers.mpn = mpn;

    const productId = readString(node.productID) ?? readString(node['@id']);
    if (productId) identifiers.productId = productId;

    if (Object.keys(identifiers).length > 0) {
      product.identifiers = identifiers;
      capture.evidence.push(evidence('product.identifiers', 'json_ld', 0.9));
    }

    const offer = selectOffer(collectOffers(node.offers), sku);
    if (offer) {
      if (offer.priceAmount) {
        offerFields.priceAmount = offer.priceAmount;
        capture.evidence.push(evidence('offer.priceAmount', 'json_ld', 0.9));
      }
      if (offer.originalPriceAmount) {
        offerFields.originalPriceAmount = offer.originalPriceAmount;
        capture.evidence.push(evidence('offer.originalPriceAmount', 'json_ld', 0.8));
      }
      if (offer.currency) {
        offerFields.currency = offer.currency;
        capture.evidence.push(evidence('offer.currency', 'json_ld', 0.9));
      }
      if (offer.availability !== 'unknown') {
        offerFields.availability = offer.availability;
        capture.evidence.push(evidence('offer.availability', 'json_ld', 0.85));
      }
    }

    const selectedVariant = readSelectedVariant(node);
    if (Object.keys(selectedVariant).length > 0) {
      capture.selectedVariant = selectedVariant;
      capture.evidence.push(evidence('selectedVariant', 'json_ld', 0.7));
    }

    if (Object.keys(product).length > 0) capture.product = product;
    if (Object.keys(offerFields).length > 0) capture.offer = offerFields;

    return capture;
  },
};
