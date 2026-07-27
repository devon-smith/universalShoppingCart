import type { PartialCapture } from '@universal-cart/contracts';

import { normalizeAvailability } from '../normalizers/availability';
import { normalizeCurrency, normalizePrice } from '../normalizers/price';
import { absoluteHttpUrl, normalizeText, normalizeTextCapped, unique } from '../normalizers/text';
import type { ExtractionContext, ProductExtractor } from '../core/types';
import { evidence } from '../core/types';

import { isOptionName } from './variant';

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

/** The variant `Product` nodes a `ProductGroup` declares. */
export function variantsOf(node: JsonObject): JsonObject[] {
  const raw = node.hasVariant;
  const entries = Array.isArray(raw) ? raw : [raw];
  return entries.filter((entry): entry is JsonObject => isObject(entry));
}

/**
 * The one value every variant states, or null when they disagree.
 *
 * Variants that say nothing are not treated as disagreeing — partial markup is common, and
 * silence is not a competing claim. Two different stated values are, and that is the case
 * that must produce nothing.
 */
function agreedValue<T>(values: ReadonlyArray<T | null | undefined>): T | null {
  const stated = values.filter((value): value is T => value !== null && value !== undefined);
  if (stated.length === 0) return null;

  const first = stated[0]!;
  return stated.every((value) => value === first) ? first : null;
}

/**
 * An offer derived from a group's variants.
 *
 * Used only when the group states no offer of its own. Where the variants agree there is
 * one true answer and reporting it is safe; where they disagree and nothing on the page
 * says which one is on screen, this reports nothing. Taking the first variant that happens
 * to carry a price would put a confident wrong number in front of the user, which is worse
 * than an empty field the correction UI flags (BUILD_PLAN.md §10.3).
 *
 * Matching the *selected* variant — by URL parameter, sku, or DOM state — is a separate
 * problem and deliberately not attempted here.
 */
function consolidateFacts(facts: readonly OfferFacts[]): OfferFacts | null {
  if (facts.length === 0) return null;

  const availability = agreedValue(
    facts.map((entry) => (entry.availability === 'unknown' ? null : entry.availability)),
  );

  return {
    priceAmount: agreedValue(facts.map((entry) => entry.priceAmount)),
    originalPriceAmount: agreedValue(facts.map((entry) => entry.originalPriceAmount)),
    currency: agreedValue(facts.map((entry) => entry.currency)),
    availability: availability ?? 'unknown',
    sku: null,
  };
}

function consolidateVariantOffers(variants: readonly JsonObject[]): OfferFacts | null {
  return consolidateFacts(
    variants
      .map((variant) => selectOffer(collectOffers(variant.offers), readString(variant.sku)))
      .filter((entry): entry is OfferFacts => entry !== null),
  );
}

/**
 * Are an aggregate's members competing sellers, or variants of one product?
 *
 * It decides whether disagreement is ambiguity or information. Many vendors quoting
 * different prices for one book is the marketplace shape, and its `lowPrice` is a real
 * answer. Many bag sizes quoting different prices is a range, and picking one is a guess.
 *
 * The signal is the sku: members that differ by sku are different things. Members sharing a
 * sku and naming different sellers are the same thing from different vendors. Anything
 * ambiguous is treated as variants, because under-reporting is the safe direction.
 */
function membersAreSellers(members: readonly JsonObject[]): boolean {
  const skus = members.map((member) => readString(member.sku));
  const stated = skus.filter((sku): sku is string => sku !== null);

  // Distinct skus: different products, so variants.
  if (new Set(stated).size > 1) return false;

  const sellers = members
    .map((member) => readName(member.seller) ?? readName(member.offeredBy))
    .filter((seller): seller is string => seller !== null);

  return new Set(sellers).size > 1;
}

/**
 * The offer describing the item on screen, from a node's own `offers`.
 *
 * An `AggregateOffer` with several members is the case live pages actually broke on: Chewy
 * ships one `ProductGroup` whose aggregate holds eight members, one per bag size. Taking
 * the first member carrying a price reported 73.43 for a page selling the 67.97 bag — and
 * did it at 0.9 confidence, so the DOM layer that had the right number never got a turn.
 *
 * A sku match still wins, because that identifies the offer for this exact item. Otherwise
 * an aggregate of variants is treated like disagreeing variants everywhere else: say
 * nothing. An aggregate of sellers keeps its `lowPrice`.
 */
function readNodeOffer(node: JsonObject, sku: string | null): OfferFacts | null {
  const raw = node.offers;
  const aggregate = isObject(raw) && hasType(raw, 'AggregateOffer') ? raw : null;
  const members = collectOffers(raw);
  if (members.length === 0) return null;

  const facts = members.map(readOffer);

  if (sku) {
    const bySku = facts.find((entry) => entry.sku !== null && entry.sku === sku);
    if (bySku) return bySku;
  }

  // Not an expanded aggregate: a single offer, or a plain array the page authored itself.
  if (!aggregate || members.length < 2) {
    return facts.find((entry) => entry.priceAmount !== null) ?? facts[0]!;
  }

  if (membersAreSellers(members)) return readOffer(aggregate);

  return consolidateFacts(facts);
}

/**
 * Read `additionalProperty` / `hasVariant` style option pairs into a variant map.
 *
 * Structured data describes a product; it does not report what the visitor clicked. So only
 * names that denote a choice are taken, and `material` and `pattern` are not among them even
 * though schema.org gives them dedicated properties.
 *
 * The reason is the fingerprint. `selectedVariant` is hashed into it (BUILD_PLAN.md §9.1), and
 * a spec table that renders on one visit and not the next then hashes one product two ways —
 * so the duplicate-refresh in §9.2 stops firing and the user collects near-identical cards.
 * Zara publishes `Material` and `OUTER SHELL`, H&M `Material` and `Pattern`, Uniqlo its own
 * seller contact details, all through the same door. None is a thing anyone selected.
 */
function readSelectedVariant(node: JsonObject): Record<string, string> {
  const variant: Record<string, string> = {};

  for (const key of ['color', 'size'] as const) {
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
    if (name && value && isOptionName(name)) variant[name] = value;
  }

  return variant;
}

/**
 * The options every variant in a group shares.
 *
 * A group whose variants are all Navy is stating the colour; one offering Navy and Rust is
 * stating the range, not the selection. Only the former belongs in `selectedVariant`, which
 * by contract holds what is currently selected and nothing else (BUILD_PLAN.md §6.2).
 */
function consolidateVariantOptions(variants: readonly JsonObject[]): Record<string, string> {
  const maps = variants.map(readSelectedVariant);
  const shared: Record<string, string> = {};

  for (const key of new Set(maps.flatMap((map) => Object.keys(map)))) {
    const agreed = agreedValue(maps.map((map) => map[key] ?? null));
    if (agreed) shared[key] = agreed;
  }

  return shared;
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

/** Keys whose value is a price belonging to the product this page is about. */
const PRICE_KEYS = /^(price|lowPrice|highPrice)$/;

function collectPrices(node: unknown, found: Set<string>): void {
  if (Array.isArray(node)) {
    for (const entry of node) collectPrices(entry, found);
    return;
  }
  if (node === null || typeof node !== 'object') return;

  for (const [key, value] of Object.entries(node)) {
    if (PRICE_KEYS.test(key) && (typeof value === 'string' || typeof value === 'number')) {
      const amount = normalizePrice(String(value)).amount;
      if (amount) found.add(amount);
    } else {
      collectPrices(value, found);
    }
  }
}

/**
 * Every price the page's structured data attributes to this product.
 *
 * Not an extraction — a corroboration set. JSON-LD knows which prices legitimately belong to
 * this product but often not which one is selected; the DOM knows what is on screen but not
 * this product from a sponsored one beside it. Each covers the other's blind spot, so the DOM
 * layer uses this to tell its own candidates apart (see `dom.ts`).
 *
 * Deliberately unfiltered by offer shape: aggregate members, `hasVariant` offers and plain
 * offers are all legitimate prices for the product. Chewy's bag of dog food publishes nine —
 * one per size — including the 67.97 on screen, and excluding the 49.99 of the sponsored
 * product sitting in the middle of the page.
 */
export function offerPriceSet(document: Document): ReadonlySet<string> {
  const found = new Set<string>();

  for (const script of Array.from(
    document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]'),
  )) {
    collectPrices(parseJsonLdBlock(script.textContent ?? ''), found);
  }

  return found;
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

    // A group's own offer wins. Only when it states none — the shape Zara and Nike both
    // ship — are its variants consulted, and then only where they agree.
    const variants = variantsOf(node);
    const ownOffer = readNodeOffer(node, sku);
    const offer = ownOffer ?? consolidateVariantOffers(variants);

    // A value every variant agrees on is a real reading of the page, but it was inferred
    // across the family rather than stated for the item on screen. The slightly lower
    // confidence keeps a directly-stated offer ahead of it when both exist.
    const offerConfidence = ownOffer ? 1 : 0.9;

    if (offer) {
      if (offer.priceAmount) {
        offerFields.priceAmount = offer.priceAmount;
        capture.evidence.push(evidence('offer.priceAmount', 'json_ld', 0.9 * offerConfidence));
      }
      if (offer.originalPriceAmount) {
        offerFields.originalPriceAmount = offer.originalPriceAmount;
        capture.evidence.push(
          evidence('offer.originalPriceAmount', 'json_ld', 0.8 * offerConfidence),
        );
      }
      if (offer.currency) {
        offerFields.currency = offer.currency;
        capture.evidence.push(evidence('offer.currency', 'json_ld', 0.9 * offerConfidence));
      }
      if (offer.availability !== 'unknown') {
        offerFields.availability = offer.availability;
        capture.evidence.push(evidence('offer.availability', 'json_ld', 0.85 * offerConfidence));
      }
    }

    // Options the node declares directly, falling back to the ones every variant shares —
    // a group whose variants are all Navy is telling us the colour, while a group offering
    // Navy and Rust is not telling us which one is on screen.
    const ownVariant = readSelectedVariant(node);
    const selectedVariant =
      Object.keys(ownVariant).length > 0 ? ownVariant : consolidateVariantOptions(variants);

    if (Object.keys(selectedVariant).length > 0) {
      capture.selectedVariant = selectedVariant;
      capture.evidence.push(evidence('selectedVariant', 'json_ld', 0.7));
    }

    if (Object.keys(product).length > 0) capture.product = product;
    if (Object.keys(offerFields).length > 0) capture.offer = offerFields;

    return capture;
  },
};
