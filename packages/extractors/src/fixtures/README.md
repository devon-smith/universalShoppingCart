# Extraction fixtures

Sanitized HTML pages and the capture each one should produce.

Rules (BUILD_PLAN.md §18.2):

- **No real user data.** No account details, no order history, no cookies, no tokens.
- **Synthetic retailers only** in the generic fixtures. Hosts are `*.example.com`, prices
  and product names are invented.
- **Minimal.** Keep only the DOM the extractor needs. A fixture is a regression test, not
  an archive of a page.
- **Paired.** Every `<name>.html` has a `<name>.expected.json` beside it holding the
  capture the pipeline must produce, minus `extraction.observedAt`, which is injected by
  the test.
- **One per production bug.** When extraction gets something wrong on a real page, add a
  reduced fixture that reproduces it before fixing the extractor.

Retailer-platform adapter fixtures live under `adapters/`, two per adapter.

## Current fixtures

| File                        | What it covers                                                      |
| --------------------------- | ------------------------------------------------------------------- |
| `json-ld-complete.html`     | A well-formed Product with a single Offer and full identifiers      |
| `json-ld-graph-offers.html` | `@graph`, an offer array, a sale price, and a European price format |
| `json-ld-aggregate.html`    | `AggregateOffer` with no member offers, and `@type` as an array     |
| `meta-only.html`            | No structured data; Open Graph and product meta tags only           |
| `dom-only.html`             | No structured data and no meta tags; annotated DOM plus a variant   |
| `sparse.html`               | Almost nothing extractable — the graceful-degradation case          |

## Adapter fixtures (`adapters/`)

Two per adapter: one exercising the case that justifies the adapter existing, one covering
a different shape of the same platform. Hosts are synthetic `.example` retailers and the
markup is the platform's own, reduced to what the adapter reads.

| File                            | What it covers                                                             |
| ------------------------------- | -------------------------------------------------------------------------- |
| `shopify-variant-selected.html` | `?variant=` picks a variant whose price differs from the page's JSON-LD    |
| `shopify-sold-out-default.html` | No variant in the URL and the first one sold out                           |
| `woocommerce-variable.html`     | Variation matrix matched against the attribute selects; heading is a range |
| `woocommerce-simple-sale.html`  | Simple product with `<del>`/`<ins>` sale markup                            |
| `magento-configurable.html`     | Swatches, a European price format, and a non-English stock label           |
| `magento-out-of-stock.html`     | No options, no sale price, and unavailable                                 |
| `bigcommerce-swatch.html`       | A checked swatch (name on the label `title`) and a chosen dropdown         |
| `bigcommerce-unavailable.html`  | Stock only inferable from a disabled add-to-cart button                    |
| `sfcc-variation-selected.html`  | `.selected-value` attributes and the `content` price attribute             |
| `sfcc-size-select.html`         | A size dropdown, on a Demandware pipeline URL                              |

## Staged for M2 — Wayfair and Amazon

These four are committed ahead of the adapters that will read them, because they are the
evidence the adapters get designed against. They are **not yet registered** in
`adapters.test.ts`; register them in the M2 change, alongside the adapter.

Both retailers currently extract no price at all — that is the M2 blocker, and running the
pipeline over these four reproduces it exactly: `price null, original null` on every one, with
no decoy leaking into any field. Whatever the adapters do, keep that last part true.

| File                                  | What it covers                                                                                                                            |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `wayfair-sale-out-of-stock.html`      | Sale price beside a struck former price, out of stock, two option categories, and a sponsored tile with identical price markup            |
| `wayfair-primary-in-stock.html`       | `-PRIMARY` rather than `-SALE`, no former price, in stock, one option category                                                            |
| `amazon-twister-selected.html`        | Price lives only in the colour twister — one selected swatch, two decoys; `#productTitle` duplicated; canonical points at the parent ASIN |
| `amazon-single-price-no-twister.html` | No twister, a different price-widget id, no basis price, unavailable, sponsored `List:` decoy                                             |

Neither retailer ships Product JSON-LD — Wayfair has only `WebSite` and `BreadcrumbList`,
Amazon has none at all — so an adapter is the only tier that can produce a price. Do not add
structured data to these pages; its absence is the case under test.

Unlike the fixtures above, the paired `.expected.json` files are **hand-written ground truth**,
not pipeline snapshots: they hold `source`/`product`/`offer`/`selectedVariant` plus three
annotation keys (`_signals`, `_mustNotExtract`, `_note`). Generate the real snapshots — with
`evidence` and `extraction.overallConfidence` — in the M2 change, drop the underscore keys, and
leave the values alone. Every one was read off the real DOM and cross-checked.

### Two findings these fixtures encode

**Wayfair: scope before you read a price.** `[data-test-id="PriceDisplay"]` is not unique — 36
occurrences on the real capture, 34 of them sponsored or recommended tiles, and
`StandardPricingPrice-SALE`/`-PREVIOUS` repeat the same way. An adapter taking the first match in
document order is right today by accident. Key on `[data-node-id^="ListingPricing::"]`, which is
unique because the node id is generated per listing. `wayfair-sale-out-of-stock.html` ships a
decoy at `$940.00 / $1,610.00` so that mistake fails a test rather than shipping.

**Amazon: the price is the selected swatch's, corroborated by the ASIN.** Every price in the
server HTML lives in the colour twister (28 accessibility labels on the real page) because
`#apex_desktop` renders client-side and is empty. The only selection marker is the class
`a-button-selected` — no `aria-pressed`, no `aria-checked`. Cross-check the swatch price against
`#corePrice_feature_div`, whose `data-csa-c-asin` should equal the `/dp/` segment of the page URL.
That check is what corrected `.live/amazon.truth.json` from `59.46 / 84.95` — the _Listless_
swatch, which is not selected — to **`50.97 / 55.65`**, the _Medium Stonewash_ one that is.
Arithmetic agrees: `50.97 / 55.65 = 0.9159`, and the label states an 8 percent saving.
