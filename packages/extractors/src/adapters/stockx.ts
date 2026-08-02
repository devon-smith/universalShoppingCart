import type { PartialCapture } from '@universal-cart/contracts';

import type { ExtractionContext, ProductExtractor } from '../core/types';
import { evidence } from '../core/types';
import { normalizePrice } from '../normalizers/price';
import { absoluteHttpUrl, normalizeText } from '../normalizers/text';

import { textOf } from './shared';

/**
 * StockX.
 *
 * The one brand adapter in a registry of platform adapters, and it needs justifying. Every
 * other adapter here targets a commerce platform because one platform's markup covers
 * thousands of storefronts (BUILD_PLAN.md §10.7). StockX runs its own front end, so this
 * covers exactly one site — but it is the only way to read that site at all: prices sit in
 * `<h2 class="chakra-heading css-1o2jc4i">`, a hashed CSS-module class carrying no
 * price-ish token, so no generic selector reaches it and the DOM layer produces nothing.
 *
 * What makes it viable rather than a workaround is the hook. `data-testid` attributes are
 * StockX's own test infrastructure: `trade-box-buy-amount`, `pdp-hero-title`,
 * `product-traits`. Those names are load-bearing for their engineers, which is a far better
 * stability bet than a class name their build tool regenerates on every deploy. Reading
 * retailer-specific page state is precisely what §10.6 and §10.7 sanction adapters for.
 *
 * ## The two prices, and why 76 was never a bug
 *
 * StockX's JSON-LD publishes `76` and the page renders `78`. Unlike Chewy's 49.99 — which
 * belonged to a *different product* in a sponsored tile — both of these are real prices for
 * this product:
 *
 * - **76** is the lowest ask: the cheapest anyone is selling, in any size.
 * - **78** is Buy Now for the size the user has selected.
 *
 * The shopper is buying a size, so 78 is the number that belongs on the card, for the same
 * reason the availability of a sold-out size beats "the style is in stock".
 *
 * This is the third time one field name has turned out to be carrying two different
 * questions — after `availability` (product versus selected variant, resolved in
 * docs/DECISIONS.md 2026-07-27) and `Material` in `selectedVariant` (a characteristic
 * filed as a choice). Three instances is a pattern rather than a coincidence, and it is
 * written down here so whoever meets the fourth recognises it. **Not acted on now**: naming
 * the pattern is cheap, and a general fix for it is not.
 */

export const STOCKX_ADAPTER_ID = 'stockx';
export const STOCKX_ADAPTER_VERSION = '1.0.0';

/** The product detail page's own markers. Absent on search, feed, and account pages. */
const PDP_SIGNALS = ['[data-testid="pdp-hero-title"]', '[data-testid="pdp-hero-buysell"]'];

/**
 * The hero region: the product being viewed.
 *
 * Everything is read from inside it, never from the document. StockX renders sponsored
 * tiles further down carrying `product-tile-lowest-ask-amount` — on the captured page one
 * says `$77`, a plausible-looking price for a different shoe entirely.
 */
function heroOf(document: Document): ParentNode {
  return document.querySelector('[data-testid="pdp-hero"]') ?? document;
}

/**
 * The full product name.
 *
 * StockX splits it across two nested elements — "Nike Dunk Low" and "White Midnight Navy" —
 * and nesting them means `textContent` runs the two together as "Nike Dunk LowWhite Midnight
 * Navy". Reading them separately and joining is the difference between a title and a typo.
 */
function productTitle(hero: ParentNode): string | null {
  const primaryNode = hero.querySelector('[data-component="primary-product-title"]');
  const secondary = normalizeText(
    hero.querySelector('[data-component="secondary-product-title"]')?.textContent,
  );

  if (!primaryNode) return null;

  // The secondary title is a child of the primary, so subtract it rather than trusting
  // textContent, which would repeat it.
  const whole = normalizeText(primaryNode.textContent);
  if (!whole) return null;

  const primary =
    secondary && whole.endsWith(secondary) ? whole.slice(0, -secondary.length) : whole;
  const parts = [normalizeText(primary), secondary].filter(
    (part): part is string => part !== null && part.length > 0,
  );

  return parts.length > 0 ? parts.join(' ') : null;
}

/**
 * The `Style`, `Colorway`, `Retail Price` rows beneath the buy box.
 *
 * Each is a label element followed by a value element inside one `product-trait` block, so
 * the pairing is structural rather than positional.
 */
function traits(hero: ParentNode): Record<string, string> {
  const found: Record<string, string> = {};

  for (const block of Array.from(hero.querySelectorAll('[data-component="product-trait"]'))) {
    const [label, value] = Array.from(block.children).map((child) =>
      normalizeText(child.textContent),
    );
    if (label && value) found[label.toLowerCase()] = value;
  }

  return found;
}

/**
 * The selected size.
 *
 * The size picker is a menu button whose text is "Size:" followed by the value, in hashed
 * classes with no test id of their own. Anchoring on the visible label is what is available,
 * and inside the hero region it is unambiguous.
 */
function selectedSize(hero: ParentNode): string | null {
  for (const button of Array.from(hero.querySelectorAll('button'))) {
    const text = normalizeText(button.textContent);
    const match = text?.match(/^Size:\s*(.+)$/i);
    if (match?.[1]) return normalizeText(match[1]);
  }
  return null;
}

export const stockxAdapter: ProductExtractor = {
  id: STOCKX_ADAPTER_ID,
  version: STOCKX_ADAPTER_VERSION,
  priority: 96,

  supports(context: ExtractionContext): boolean {
    let hostname: string;
    try {
      hostname = new URL(context.url).hostname.toLowerCase();
    } catch {
      return false;
    }

    if (hostname !== 'stockx.com' && !hostname.endsWith('.stockx.com')) return false;

    // Claim the page only when its data is actually there. An adapter that matches and then
    // contributes nothing is the signature of rotted selectors, and it costs the diagnostics
    // page its most useful signal.
    return context.document.querySelector(PDP_SIGNALS.join(', ')) !== null;
  },

  extract(context: ExtractionContext): PartialCapture {
    const { document, url } = context;
    const hero = heroOf(document);

    const capture: PartialCapture = { evidence: [] };
    const product: NonNullable<PartialCapture['product']> = {};
    const offer: NonNullable<PartialCapture['offer']> = {};
    const identifiers: Record<string, string> = {};

    const title = productTitle(hero);
    if (title) {
      product.title = title;
      capture.evidence.push(
        evidence('product.title', 'adapter', 0.95, '[data-component="primary-product-title"]'),
      );
    }

    const image = absoluteHttpUrl(
      hero.querySelector('[data-testid="pdp-hero-media"] img')?.getAttribute('src'),
      url,
    );
    if (image) {
      product.imageUrls = [image];
      product.selectedImageUrl = image;
      capture.evidence.push(evidence('product.imageUrls', 'adapter', 0.9));
      capture.evidence.push(evidence('product.selectedImageUrl', 'adapter', 0.9));
    }

    // Buy Now for the selected size — see the note above on why this beats the lowest ask.
    const buyNow = normalizePrice(textOf(hero, '[data-testid="trade-box-buy-amount"]') ?? '');
    if (buyNow.amount) {
      offer.priceAmount = buyNow.amount;
      capture.evidence.push(
        evidence('offer.priceAmount', 'adapter', 0.95, '[data-testid="trade-box-buy-amount"]'),
      );

      // A Buy Now price exists only while someone is selling this size, so its presence is
      // evidence about the *selected variant*, not about the style. Its absence is not the
      // opposite: it could equally mean the markup moved, so nothing is claimed from that.
      offer.variantAvailability = 'in_stock';
      capture.evidence.push(
        evidence(
          'offer.variantAvailability',
          'adapter',
          0.8,
          '[data-testid="trade-box-buy-amount"]',
        ),
      );
    }
    if (buyNow.currency) {
      offer.currency = buyNow.currency;
      capture.evidence.push(evidence('offer.currency', 'adapter', 0.85));
    }

    const rows = traits(hero);

    // The manufacturer's style code — Nike's HF5441-107 — which is an MPN in everything but
    // name, and the most durable identifier a resale listing carries.
    const style = rows.style;
    if (style) identifiers.mpn = style;

    const retail = normalizePrice(rows['retail price'] ?? '');
    if (retail.amount && retail.amount !== buyNow.amount) {
      // Retail is the manufacturer's list price, which is what `originalPriceAmount` means
      // everywhere else in the capture: the number the current price is a discount from.
      offer.originalPriceAmount = retail.amount;
      capture.evidence.push(evidence('offer.originalPriceAmount', 'adapter', 0.85, 'Retail Price'));
    }

    const variant: Record<string, string> = {};
    const size = selectedSize(hero);
    if (size) variant.Size = size;

    const colorway = rows.colorway;
    if (colorway) variant.Color = colorway;

    if (Object.keys(variant).length > 0) {
      capture.selectedVariant = variant;
      capture.evidence.push(evidence('selectedVariant', 'adapter', 0.9, 'Size: / Colorway'));
    }

    if (Object.keys(identifiers).length > 0) {
      product.identifiers = identifiers;
      capture.evidence.push(evidence('product.identifiers', 'adapter', 0.9));
    }

    if (Object.keys(product).length > 0) capture.product = product;
    if (Object.keys(offer).length > 0) capture.offer = offer;

    return capture;
  },
};
