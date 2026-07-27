import type { PartialCapture } from '@universal-cart/contracts';

import { normalizeAvailability } from '../normalizers/availability';
import { normalizeCurrency, normalizePrice } from '../normalizers/price';
import { absoluteHttpUrl, normalizeText, unique } from '../normalizers/text';
import type { ExtractionContext, ProductExtractor } from '../core/types';
import { evidence } from '../core/types';

import { offerPriceSet } from './json-ld';
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

/**
 * Attributes that may carry an image URL, most authoritative first.
 *
 * Lazy loaders leave a placeholder in `src` — usually a 1x1 data: URI — and keep the real
 * URL in one of the data attributes, so the reader has to keep looking past an attribute
 * that exists but resolves to nothing usable.
 */
const IMAGE_URL_ATTRIBUTES = [
  'src',
  'content',
  'data-src',
  'data-original',
  'data-lazy-src',
] as const;

/** Take the first candidate from a `srcset`, dropping its width/density descriptor. */
function firstSrcsetUrl(value: string | null): string | null {
  const first = value?.split(',')[0]?.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : null;
}

/**
 * Resolve an element's image to an http(s) URL, trying each source until one works.
 *
 * Stopping at the first attribute that merely *exists* loses the image on every
 * lazy-loading page, because the placeholder in `src` is not a usable URL.
 */
function imageUrlFrom(element: Element, baseUrl: string): string | null {
  for (const attribute of IMAGE_URL_ATTRIBUTES) {
    const resolved = absoluteHttpUrl(element.getAttribute(attribute), baseUrl);
    if (resolved) return resolved;
  }

  for (const attribute of ['srcset', 'data-srcset'] as const) {
    const resolved = absoluteHttpUrl(firstSrcsetUrl(element.getAttribute(attribute)), baseUrl);
    if (resolved) return resolved;
  }

  return null;
}

/**
 * The part of the page that describes the product being viewed.
 *
 * Every heuristic below is a guess, and a guess made against the whole document is a guess
 * about someone else's product: recommendation carousels, "customers also bought" tiles and
 * recently-viewed strips all carry prices, add-to-cart buttons and option controls of their
 * own. On a live Chewy page the first `[data-price]` in document order belonged to an
 * unrelated bag of dog food, and the extractor reported it at full confidence.
 *
 * Anchors are tried in decreasing order of reliability. `null` means no root could be
 * established, and the caller must then search the whole document *and say so* — the answer
 * is still worth having, it is just a materially weaker claim.
 */
export function findProductRoot(document: Document): Element | null {
  const microdata = document.querySelector('[itemtype*="Product" i][itemscope]');
  if (microdata) return microdata;

  const main = document.querySelector('main');

  // The container holding the page's product heading. Climbing a few levels finds the
  // section wrapping the heading and its price without swallowing the whole page.
  //
  // A gallery is frequently a *sibling* of the details column rather than a descendant, so
  // the climb prefers the first ancestor holding the heading, a price, and the gallery, and
  // settles for one holding just a price when no such ancestor is close by. Stopping at the
  // details column would hide the product image from every heuristic below.
  const gallery = document.querySelector('[class*="product-gallery"], [class*="product-image"]');
  const heading = document.querySelector('h1[class*="product"], main h1, h1');

  if (heading) {
    // Climb, scoring each ancestor by how much of a product region it actually contains.
    // Returning the first ancestor holding anything price-ish is too eager: that is usually
    // the price widget's own card, which excludes the add-to-cart control and the gallery
    // and so loses availability entirely. The highest score wins, and ties go to the
    // tightest container, which is the one least likely to reach a neighbouring product.
    let best: Element | null = null;
    let bestScore = 0;
    let node: Element | null = heading.parentElement;

    for (let depth = 0; node && depth < 6; depth += 1) {
      if (node === document.body) break;

      const hasPrice = node.querySelector('[itemprop="price"], [data-price], [class*="price"]');
      const hasCart = node.querySelector(
        'button[name*="add"], button[id*="add-to-cart"], button[class*="add-to-cart"], [data-testid*="add-to-cart"], [data-testid="add-to-bag"], [class*="sold-out"], [class*="out-of-stock"]',
      );
      const hasGallery = gallery !== null && node.contains(gallery);
      const score = (hasPrice ? 1 : 0) + (hasCart ? 1 : 0) + (hasGallery ? 1 : 0);

      if (score > bestScore) {
        best = node;
        bestScore = score;
      }
      node = node.parentElement;
    }

    if (best) return best;
  }

  if (main) return main;

  // Last resort. The gallery selectors are tried one at a time rather than as one
  // comma-separated query, because such a query returns whichever matches first in document
  // order — and a recommendation tile classed `product-image` often precedes the real
  // gallery, which would anchor the root onto the wrong product entirely.
  for (const selector of ['[class*="product-gallery"]', '[class*="product-image"]']) {
    const gallery = document.querySelector(selector);
    if (gallery?.parentElement) return gallery.parentElement;
  }

  return null;
}

/**
 * Extra places a price may sit, searched **only** when structured data can vouch for the
 * value found there.
 *
 * Broadening the selectors above would be a mistake on its own: a retailer's design system
 * uses the same class for its sponsored tiles as for its buy box, so more coverage means more
 * candidates from other products — and ranking those apart has been tried three ways and does
 * not work (docs/STATUS.md). Coverage is safe only with a discriminator attached. On Chewy
 * this selector matches 516 elements and exactly two survive corroboration, both the real
 * price.
 */
const CORROBORATED_ONLY_SELECTORS: ReadonlyArray<readonly [selector: string, confidence: number]> =
  [['[class*="product-price"]', 0.5]];

/**
 * Confidence for a price two layers agree on — the ceiling for this extractor.
 *
 * Agreement between the rendered page and the page's own structured data is the strongest
 * signal the DOM layer can produce, because the two fail in unrelated ways: markup drift does
 * not move a JSON-LD price, and a stale JSON-LD price is not what gets rendered. It stays
 * inside the DOM range so structured data still wins the merge outright — this raises how sure
 * the layer is, not how loud.
 *
 * It also has to clear the review threshold. Asking the user to confirm a value both layers
 * agree on is the noise that teaches people to dismiss warnings.
 */
const CORROBORATED_CONFIDENCE = 0.6;

/** How much a document-wide search discounts every claim made from it. */
const UNSCOPED_PENALTY = 0.8;

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
  root: ParentNode,
  selectors: ReadonlyArray<readonly [string, number]>,
): { element: Element; selector: string; confidence: number } | null {
  for (const [selector, confidence] of selectors) {
    const element = root.querySelector(selector);
    if (element) return { element, selector, confidence };
  }
  return null;
}

/**
 * The first price on the page that the page's own structured data also claims.
 *
 * A sponsored placement's price belongs to a different product, so it is absent from this
 * product's offer set however product-ish its markup looks. That is the discriminator the
 * ranking attempts lacked: Chewy's real 67.97 is one of nine prices in its `AggregateOffer`
 * members, and the sponsored 49.99 is in none of them.
 *
 * Strictly a tiebreaker among values the DOM actually found. It never introduces a price from
 * structured data — that is the JSON-LD layer's job, and on a page like Chewy's it correctly
 * declines, because an offer spanning 10.99 to 145.94 does not say which one you are buying.
 */
function corroboratedPrice(
  root: ParentNode,
  known: ReadonlySet<string>,
): { element: Element; selector: string; confidence: number; amount: string } | null {
  if (known.size === 0) return null;

  for (const [selector] of [...PRICE_SELECTORS, ...CORROBORATED_ONLY_SELECTORS]) {
    for (const element of root.querySelectorAll(selector)) {
      const amount = normalizePrice(readValue(element)).amount;
      if (amount !== null && known.has(amount)) {
        return { element, selector, confidence: CORROBORATED_CONFIDENCE, amount };
      }
    }
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
/** Is this element one option among several, rather than a statement about the product? */
function isVariantOptionControl(element: Element): boolean {
  if (element.matches('label, option, [role="radio"], [role="option"], [role="tab"]')) return true;
  if (element.querySelector('input[type="radio"], input[type="checkbox"]')) return true;
  return element.closest('[role="radiogroup"], [role="listbox"], fieldset, select') !== null;
}

/** Ways a page says "this is the option currently chosen". */
const SELECTED_OPTION =
  '[aria-checked="true"], [aria-selected="true"], [data-selected="true"], option[selected], [class*="selected" i]';

/**
 * Is this option marked unbuyable?
 *
 * Nike carries the whole fact visually — `class="selected disabled"`, a strikethrough, and a
 * disabled Add to Bag — with no text anywhere saying the size is gone. So this reads the
 * markers rather than looking for words.
 */
function isUnavailableOption(element: Element): boolean {
  if (element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true') {
    return true;
  }
  if (/(^|[\s-])(disabled|sold-?out|out-of-stock|unavailable)/i.test(element.className)) {
    return true;
  }
  return element.querySelector('input[disabled], s, del, [class*="strike" i]') !== null;
}

/**
 * Availability of the option the user has actually selected (docs/DECISIONS.md, 2026-07-27).
 *
 * Nobody buys "the product", they buy a size. A sold-out marker on an *unselected* option
 * says nothing about what the user is looking at — that case is already handled below — but
 * the same marker on the selected one is the whole answer, and it is the answer structured
 * data cannot give, because JSON-LD describes the product.
 *
 * Only `out_of_stock` is reported. A selected option carrying no unavailable marker is not
 * evidence that it is buyable; that stays a product-level question.
 */
function selectedOptionAvailability(root: ParentNode) {
  for (const option of root.querySelectorAll(SELECTED_OPTION)) {
    if (!isVariantOptionControl(option)) continue;
    if (!isUnavailableOption(option)) continue;
    return { availability: 'out_of_stock' as const, confidence: 0.5, selector: 'option.selected' };
  }
  return null;
}

function availabilityFromControls(root: ParentNode): {
  availability: ReturnType<typeof normalizeAvailability>;
  confidence: number;
  selector: string;
} | null {
  // A sold-out marker on a *variant option* describes that option, not the product. Gymshark
  // marks L, XL and XXL out of stock while M — the selected size — is buyable; reading the
  // first such marker reported the whole product as unavailable. An option control is a
  // label, a radio/checkbox wrapper, or something in a radiogroup, so this is structural
  // rather than a list of class names to keep chasing.
  const soldOutText = Array.from(
    root.querySelectorAll('[data-testid="sold-out"], [class*="sold-out"], [class*="out-of-stock"]'),
  ).find((element) => !isVariantOptionControl(element));

  if (soldOutText) {
    return { availability: 'out_of_stock', confidence: 0.5, selector: '[class*="sold-out"]' };
  }

  const button = root.querySelector<HTMLButtonElement | HTMLInputElement>(
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

    // Everything below reads the product region, not the page. When no region can be
    // identified the search widens to the document, and every claim made that way is
    // discounted and labelled so the weaker basis travels with the value.
    const productRoot = findProductRoot(document);
    const root: ParentNode = productRoot ?? document;
    const scoped = productRoot !== null;
    const rank = (base: number) => (scoped ? base : base * UNSCOPED_PENALTY);
    const mark = (selector: string) => (scoped ? selector : `document ${selector}`);

    // The document title is worth recording even on a page with no product markup at all;
    // it is what the correction UI shows the user as a starting point.
    const pageTitle = normalizeText(document.title);
    if (pageTitle) {
      source.pageTitle = pageTitle;
      capture.evidence.push(evidence('source.pageTitle', 'dom', 0.6, 'title'));
    }

    // The canonical URL is read here, in the layer that always runs, because it is a fact
    // about the page rather than a claim about the product. `metaExtractor` also reads it but
    // declines pages carrying no product-ish meta — Amazon is one — so the canonical was
    // being lost on exactly those pages. That matters beyond tidiness: the fingerprint is
    // built from the canonical URL (BUILD_PLAN.md §9.1), so falling back to the visited URL
    // hashes whatever tracking parameters it carried, and the same item saved from a search
    // result and from a direct link becomes two items rather than one refresh.
    const canonical = absoluteHttpUrl(
      document.querySelector('link[rel="canonical" i]')?.getAttribute('href'),
      url,
    );
    if (canonical) {
      source.canonicalUrl = canonical;
      capture.evidence.push(evidence('source.canonicalUrl', 'dom', 0.6, 'link[rel=canonical]'));
    }

    const titleMatch = firstMatch(root, TITLE_SELECTORS);
    const title = titleMatch ? normalizeText(readValue(titleMatch.element)) : null;
    if (title && titleMatch) {
      product.title = title;
      capture.evidence.push(
        evidence('product.title', 'dom', rank(titleMatch.confidence), mark(titleMatch.selector)),
      );
    }

    const brandMatch = firstMatch(root, BRAND_SELECTORS);
    const brand = brandMatch ? normalizeText(readValue(brandMatch.element)) : null;
    if (brand && brandMatch) {
      product.brand = brand;
      capture.evidence.push(
        evidence('product.brand', 'dom', rank(brandMatch.confidence), mark(brandMatch.selector)),
      );
    }

    const images = unique(
      IMAGE_SELECTORS.flatMap(([selector]) =>
        Array.from(root.querySelectorAll(selector))
          .map((element) => imageUrlFrom(element, url))
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

    // A corroborated candidate wins outright, whatever its selector's tier: agreement between
    // two layers that fail in unrelated ways is worth more than one layer's markup preference.
    const corroborated = corroboratedPrice(root, offerPriceSet(document));
    const priceMatch = corroborated ?? firstMatch(root, PRICE_SELECTORS);

    if (priceMatch) {
      const parsed = normalizePrice(readValue(priceMatch.element));
      if (parsed.amount) {
        offer.priceAmount = parsed.amount;
        capture.evidence.push(
          evidence(
            'offer.priceAmount',
            'dom',
            rank(priceMatch.confidence),
            mark(corroborated ? `${priceMatch.selector} (corroborated)` : priceMatch.selector),
          ),
        );
      }

      const currency =
        normalizeCurrency(
          root.querySelector('[itemprop="priceCurrency"]')?.getAttribute('content') ?? null,
        ) ?? parsed.currency;
      if (currency) {
        offer.currency = currency;
        capture.evidence.push(evidence('offer.currency', 'dom', priceMatch.confidence));
      }
    }

    const originalMatch = firstMatch(root, ORIGINAL_PRICE_SELECTORS);
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

    // Reported on its own path so it never argues with the product-level claim. The pipeline
    // resolves the two; see docs/DECISIONS.md, 2026-07-27.
    const selectedOption = selectedOptionAvailability(root);
    if (selectedOption) {
      offer.variantAvailability = selectedOption.availability;
      capture.evidence.push(
        evidence(
          'offer.variantAvailability',
          'dom',
          rank(selectedOption.confidence),
          mark(selectedOption.selector),
        ),
      );
    }

    const itempropAvailability = root.querySelector('[itemprop="availability"]');
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
      const inferred = availabilityFromControls(root);
      if (inferred) {
        offer.availability = inferred.availability;
        capture.evidence.push(
          evidence('offer.availability', 'dom', inferred.confidence, inferred.selector),
        );
      }
    }

    const selectedVariant = mergeVariants(
      extractSelectedVariantFromDom(root),
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
