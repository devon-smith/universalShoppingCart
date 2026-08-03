import type { PartialCapture } from '@universal-cart/contracts';

import type { ExtractionContext, ProductExtractor } from '../core/types';
import { evidence } from '../core/types';
import { normalizePrice } from '../normalizers/price';
import { absoluteHttpUrl, normalizeText } from '../normalizers/text';

import { isRecord, readJsonAttribute } from './shared';

/**
 * Wayfair.
 *
 * A brand adapter, and it earns the same exception StockX did: Wayfair ships **no Product
 * JSON-LD** — only `WebSite` and `BreadcrumbList` — so the structured-data tier has no offer
 * to read, and the generic DOM heuristics do not recognise its `data-test-id="PriceDisplay"`
 * markup. Without an adapter the page yields no price at all (docs/STATUS.md, the Wayfair
 * blocker). Its `data-test-id` / `data-node-id` hooks are its own front-end contract, a far
 * better stability bet than the hashed `_6o3atz*` class names beside them.
 *
 * ## The scoping selector is the whole adapter
 *
 * `[data-test-id="PriceDisplay"]` is **not** unique — on a real page it appears ~36 times,
 * two for this product and the rest inside sponsored and recommendation tiles carrying their
 * own SALE/PREVIOUS/PriceDisplay trios. Taking the first match in document order is right by
 * accident and one layout change from reporting a sponsored sofa's price. The selector that
 * holds is `[data-node-id^="ListingPricing::"]`: the node id is generated per listing, so it
 * is unique (1 of 1), and every price read here is scoped inside it. The fixture ships a
 * sponsored decoy at $940 / $1,610 precisely so a regression to the broad selector fails.
 *
 * ## The image has the same trap, and is read from og:image
 *
 * `img[data-hb-id="FixedImage"]` is non-unique the same way — ~62 on a real page, and the first
 * in document order is a 36×36 "Wayfair Verified" trust badge (`default_name.jpg`), not the
 * hero. A `querySelector` for it returns that badge, which is non-null, so a DOM-first read
 * silently wins with the wrong image and never reaches a fallback. So the image is taken from
 * `og:image` — Wayfair's declared primary listing image, which is the hero — not from the DOM
 * gallery. The fixtures ship the badge ahead of the hero so a regression to the DOM selector
 * fails, exactly as the sponsored decoy guards the price.
 */

export const WAYFAIR_ADAPTER_ID = 'wayfair';
export const WAYFAIR_ADAPTER_VERSION = '1.0.0';

/** The per-listing pricing node — unique, and the scope every price read stays inside. */
const LISTING_PRICING = '[data-node-id^="ListingPricing::"]';

/** Wayfair's US storefront. Other TLDs (.co.uk, .ca, .de) price in other currencies and are
 * left to the generic pipeline rather than claimed and mis-priced as USD. */
function isWayfairUs(hostname: string): boolean {
  return hostname === 'wayfair.com' || hostname === 'www.wayfair.com';
}

/** Wayfair's `inventoryStatus` codes, mapped to the capture's availability enum. */
function availabilityFromStatus(status: string): 'in_stock' | 'out_of_stock' | null {
  if (status === 'IN_STOCK') return 'in_stock';
  if (status === 'OUT_OF_STOCK') return 'out_of_stock';
  return null;
}

export const wayfairAdapter: ProductExtractor = {
  id: WAYFAIR_ADAPTER_ID,
  version: WAYFAIR_ADAPTER_VERSION,
  priority: 96,

  supports(context: ExtractionContext): boolean {
    let hostname: string;
    try {
      hostname = new URL(context.url).hostname.toLowerCase();
    } catch {
      return false;
    }
    if (!isWayfairUs(hostname)) return false;

    // Claim the page only when the listing pricing node is present — the signature of a real
    // PDP, and the anchor everything below reads from. A match with no such node is a search
    // or category page the adapter should decline.
    return context.document.querySelector(LISTING_PRICING) !== null;
  },

  extract(context: ExtractionContext): PartialCapture {
    const { document, url } = context;

    const capture: PartialCapture = { evidence: [] };
    const product: NonNullable<PartialCapture['product']> = {};
    const offer: NonNullable<PartialCapture['offer']> = {};

    const title = normalizeText(
      document.querySelector('h1[data-rtl-id="listingHeaderNameHeading"]')?.textContent,
    );
    if (title) {
      product.title = title;
      capture.evidence.push(
        evidence('product.title', 'adapter', 0.95, 'h1[data-rtl-id="listingHeaderNameHeading"]'),
      );
    }

    // Brand has no element of its own: og:title reads "<brand> <product name> & Reviews |
    // Wayfair", so the brand is the prefix before the product title. Conservative — only when
    // the title is found verbatim inside og:title and leaves a non-empty prefix.
    const ogTitle = normalizeText(
      document.querySelector('meta[property="og:title"]')?.getAttribute('content'),
    );
    if (ogTitle && title) {
      const cut = ogTitle.indexOf(title);
      const brand = cut > 0 ? normalizeText(ogTitle.slice(0, cut)) : null;
      if (brand) {
        product.brand = brand;
        capture.evidence.push(evidence('product.brand', 'adapter', 0.7, 'og:title prefix'));
      }
    }

    // og:image, not the DOM gallery — see the class docstring: the first FixedImage is a trust
    // badge, and a non-null wrong match never falls through.
    const image = absoluteHttpUrl(
      document.querySelector('meta[property="og:image"]')?.getAttribute('content'),
      url,
    );
    if (image) {
      product.imageUrls = [image];
      product.selectedImageUrl = image;
      capture.evidence.push(
        evidence('product.imageUrls', 'adapter', 0.9, 'meta[property="og:image"]'),
      );
      capture.evidence.push(
        evidence('product.selectedImageUrl', 'adapter', 0.9, 'meta[property="og:image"]'),
      );
    }

    // Price — read only inside the listing pricing node, never from the document. SALE is the
    // discounted current price; PRIMARY is the current price when there is no promotion; both
    // must be tried. PREVIOUS is the struck former price, present only on a sale.
    const pricing = document.querySelector(LISTING_PRICING);
    if (pricing) {
      const currentEl =
        pricing.querySelector(
          '[data-test-id="StandardPricingPrice-SALE"] [data-test-id="PriceDisplay"]',
        ) ??
        pricing.querySelector(
          '[data-test-id="StandardPricingPrice-PRIMARY"] [data-test-id="PriceDisplay"]',
        );
      const current = normalizePrice(normalizeText(currentEl?.textContent));
      if (current.amount) {
        offer.priceAmount = current.amount;
        capture.evidence.push(
          evidence(
            'offer.priceAmount',
            'adapter',
            0.95,
            `${LISTING_PRICING} [data-test-id="PriceDisplay"]`,
          ),
        );
        // wayfair.com is a US storefront and the page states no ISO code; the price glyph is a
        // bare `$`, which normalizePrice refuses to resolve on its own (it could be CAD/AUD).
        // The adapter knows the retailer, so it asserts USD — at a confidence that says so.
        offer.currency = 'USD';
        capture.evidence.push(evidence('offer.currency', 'adapter', 0.6, 'US storefront'));
      }

      const originalEl = pricing.querySelector(
        '[data-test-id="StandardPricingPrice-PREVIOUS"] [data-test-id="PriceDisplay"]',
      );
      const original = normalizePrice(normalizeText(originalEl?.textContent));
      if (original.amount && original.amount !== offer.priceAmount) {
        offer.originalPriceAmount = original.amount;
        capture.evidence.push(
          evidence(
            'offer.originalPriceAmount',
            'adapter',
            0.9,
            '[data-test-id="StandardPricingPrice-PREVIOUS"]',
          ),
        );
      }
    }

    // Availability: the machine-readable inventoryStatus in the widget's tracking metadata,
    // which the badge text a shopper reads agrees with. A product-level claim.
    const inventory = readJsonAttribute(
      document.querySelector('[data-test-id="detailedInventoryWidget"]'),
      'data-tracking-metadata',
    );
    const metadata = isRecord(inventory) ? inventory.metadata : null;
    const status =
      isRecord(metadata) && typeof metadata.inventoryStatus === 'string'
        ? metadata.inventoryStatus
        : null;
    const availability = status ? availabilityFromStatus(status) : null;
    if (availability) {
      offer.availability = availability;
      capture.evidence.push(
        evidence('offer.availability', 'adapter', 0.85, 'detailedInventoryWidget inventoryStatus'),
      );
    }

    // Selected options. Each category's first <p> is the label and its second <p> is the
    // CURRENTLY SELECTED value. The swatch buttons that follow describe the *other* choices —
    // reading their data-clio-context would record a colour the shopper did not pick.
    const variant: Record<string, string> = {};
    for (const category of Array.from(
      document.querySelectorAll('[data-test-id="pdp-ch-categoryComponent"]'),
    )) {
      const paragraphs = category.querySelectorAll('p');
      const label = normalizeText(paragraphs[0]?.textContent)?.replace(/\s*:\s*$/, '');
      const value = normalizeText(paragraphs[1]?.textContent);
      if (label && value) variant[label] = value;
    }
    if (Object.keys(variant).length > 0) {
      capture.selectedVariant = variant;
      capture.evidence.push(
        evidence('selectedVariant', 'adapter', 0.9, '[data-test-id="pdp-ch-categoryComponent"]'),
      );
    }

    if (Object.keys(product).length > 0) capture.product = product;
    if (Object.keys(offer).length > 0) capture.offer = offer;

    return capture;
  },
};
