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
