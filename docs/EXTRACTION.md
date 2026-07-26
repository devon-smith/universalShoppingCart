# Extraction

How a product page becomes a `ProductCaptureV1`. Reference: [BUILD_PLAN.md](../BUILD_PLAN.md)
§6 and §10.

Everything described here lives in `packages/extractors` and is pure: it takes a
`Document` and a URL, and returns serializable values. No Supabase, no React, no extension
APIs, no network, no `eval`.

## The pipeline

```text
ExtractionContext { document, url }
        │
        ├── retailer adapter    priority 90+   (Phase 5, none yet)
        ├── JSON-LD             priority 70
        ├── Open Graph / meta   priority 50
        └── generic DOM         priority 10
        │
        ▼
merge by source rank, then confidence, then extractor priority
        │
        ▼
fill source fields from the URL · compute overall confidence
        │
        ▼
validate against ProductCaptureV1 → ok | issues
```

Each extractor returns a `PartialCapture`: the fields it found, plus one `Evidence` entry
per field recording where the value came from and how sure it is. **A value without
evidence is discarded during merge.** That is deliberate — the evidence is what lets the
side panel explain an uncertain field and lets a failing test name the extractor at fault.

## Merge rules

Source rank, highest first: `user` > `adapter` > `json_ld` > `meta` > `dom`.

1. Higher source rank wins, regardless of confidence. A confident guess is still a guess.
2. Same rank: higher confidence wins.
3. Still tied: the higher-priority extractor wins (it ran first).
4. `null`, `''`, `[]`, and `{}` never win — a trusted extractor reporting "nothing here"
   must not erase a real value found by a weaker one.

Losing evidence is **kept** in the capture. A disagreement between two extractors is
exactly what a diagnostics view needs to see.

Overall confidence is a weighted mean over the fields that make a saved product useful —
title and price at weight 3, currency, image, and availability at 1 — with missing fields
counting zero. A capture with a perfect description and no price scores low, correctly.

## What each extractor does

### JSON-LD (`generic/json-ld.ts`)

Reads every `<script type="application/ld+json">`. Handles top-level arrays, `@graph`,
`@type` as a string or an array, and fully-qualified type URLs. Recovers from a trailing
semicolon and HTML comment wrappers; anything else malformed is **skipped, not repaired** —
a heuristically fixed block is more likely to produce a wrong price than no price.

Offer selection, in order: the offer whose `sku` matches the product's, then the first
offer carrying a price, then the first offer. Never "the cheapest" — on a multi-variant
page that is a different product than the one on screen. `AggregateOffer` expands to its
members, falling back to `lowPrice` when it has none.

### Open Graph and product meta (`generic/meta.ts`)

`og:*`, `product:*`, `twitter:*`, and `<link rel="canonical">`. Ranked below JSON-LD
because these tags describe the page for sharing rather than the product for buying:
`og:title` routinely carries a `| Retailer` suffix and `product:price:amount` routinely
belongs to the default variant rather than the selected one.

### Generic DOM (`generic/dom.ts`)

The last resort, and the one that must not guess. Every signal is either a machine-readable
annotation (`itemprop`, `data-price`) or a structural landmark (an `<h1>` inside a product
region). **There is no free-text scan for currency symbols**, because on a real page that
finds shipping thresholds, financing plans, and "customers also bought" tiles. There is a
regression test asserting exactly that.

Availability is inferred from the add-to-cart control, asymmetrically: a disabled or
missing button is a strong out-of-stock signal (0.5), an enabled one is a weak in-stock
signal (0.35), because plenty of pages keep the button enabled and fail at checkout.

### Selected variant (`generic/variant.ts`)

Reports **only what is currently selected**, never the option matrix. Signals: a `<select>`
with a chosen option, a checked radio with its label, `aria-checked`/`aria-pressed`/
`aria-selected`, and option-like URL parameters. DOM wins over URL, because a client-side
variant switch updates the DOM before the URL.

## Normalizers

- **Price** (`normalizers/price.ts`) — string arithmetic only; parsing to a JavaScript
  number and formatting back would silently round money. Decides the decimal separator
  from position and repetition, so `1.299,50`, `1,299.50`, and `1.299` (one thousand two
  hundred ninety-nine) all come out right. Output is a decimal string.
- **Currency** — an ISO 4217 code, or an unambiguous symbol. `$`, `¥`, and `kr` are
  deliberately **not** mapped: a bare `$` is USD, CAD, AUD, or MXN, and a wrong currency on
  a saved product is worse than no currency.
- **Availability** (`normalizers/availability.ts`) — schema.org enumerations, Open Graph
  values, and common labels. Anything unrecognized becomes `unknown`.
- **URL** (`normalize-url.ts`) — lowercases the host, drops `www.` and the fragment,
  removes tracking and affiliate parameters, sorts what remains. Feeds fingerprinting
  (Phase 2B) and revisit matching (Phase 4).
- **Text** (`normalizers/text.ts`) — collapses whitespace, caps descriptions, resolves
  relative URLs, and rejects any non-`http(s)` URL, so a capture can never carry an inline
  `data:` blob.

## Failure behaviour

An extractor that throws is caught, and the failure is **recorded** in
`result.extractorFailures` rather than swallowed. A crash that produces an empty capture
looks exactly like an empty page, which is how a silently broken extractor survives for
months. (This was not hypothetical: `CSS.escape` being absent in jsdom silently disabled
the entire DOM extractor until the failures were surfaced.)

A capture that fails schema validation is returned as `{ ok: false, issues, draft }`. It is
never repaired and never saved.

`fieldsNeedingReview()` returns the fields the correction UI should flag: a missing or
low-confidence title or price, or a price with no currency.

## Fingerprinting

`fingerprint.ts` produces a SHA-256 over three normalized inputs: the canonical URL, the
selected variant, and the primary product identifier (GTIN → MPN → SKU → product id, kind
included so two kinds cannot collide). Web Crypto, so the same value comes out in the
extension, the browser, and Node.

What is deliberately **not** an input: price, availability, and image. A price change must
refresh an item, not create one. Tracking parameters are stripped first, so a link shared
with `?utm_campaign=…` matches a direct visit.

Two variants of one product get different fingerprints; the same product at two retailers
also gets different ones, because cross-retailer matching (Phase 8) must be a deliberate
decision rather than an accident of hashing.

## Fixtures

`packages/extractors/src/fixtures/` holds sanitized HTML pages paired with the exact
capture each must produce. See the README there for the rules. Every production extraction
bug gets a reduced fixture reproducing it **before** the fix.

Retailer adapters and their fixtures arrive in Phase 5.
