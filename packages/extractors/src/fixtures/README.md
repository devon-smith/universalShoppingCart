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

Retailer-specific adapter fixtures arrive in Phase 5 and live under `adapters/`.

## Current fixtures

| File                        | What it covers                                                      |
| --------------------------- | ------------------------------------------------------------------- |
| `json-ld-complete.html`     | A well-formed Product with a single Offer and full identifiers      |
| `json-ld-graph-offers.html` | `@graph`, an offer array, a sale price, and a European price format |
| `json-ld-aggregate.html`    | `AggregateOffer` with no member offers, and `@type` as an array     |
| `meta-only.html`            | No structured data; Open Graph and product meta tags only           |
| `dom-only.html`             | No structured data and no meta tags; annotated DOM plus a variant   |
| `sparse.html`               | Almost nothing extractable — the graceful-degradation case          |
