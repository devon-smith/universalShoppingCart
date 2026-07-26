# Status

Updated after every phase. See [BUILD_PLAN.md §22](../BUILD_PLAN.md) for phase definitions
and acceptance criteria.

| Phase                                  | State       |
| -------------------------------------- | ----------- |
| 0 — Repository foundation              | Complete    |
| 1 — Authentication and authorization   | Complete    |
| 2 — Generic capture vertical slice     | Complete    |
| 3 — Cart dashboard and core UX         | Complete    |
| 4 — Observations and revisit refresh   | Complete    |
| 5 — Real retailer adapters             | Complete    |
| 6 — Sharing and comparison             | Not started |
| 7 — Background refresh and alerts      | Not started |
| 8 — Product matching and AI comparison | Not started |
| 9 — Release hardening                  | Not started |

## Roadmap from here

Two departures from BUILD_PLAN.md §22, both recorded in [DECISIONS.md](DECISIONS.md):
deployment splits into an early staging environment and later production hardening, and
sharing ships viewer-first.

```text
Open draft PR                          ← done
    ↓
Ten live captures against real retailers    ← next, see LIVE_TESTING.md
    ↓
Fix extraction · add sanitized regression fixtures
    ↓
CI and security tests green
    ↓
Staging: hosted dev Supabase + Vercel, unpacked extension pointed at it
    ↓
One or two trusted testers
    ↓
Merge the stable baseline
    ↓
Phase 6, viewer-first
```

Nothing between the draft PR and staging adds a feature. The live-capture pass measures
extraction against the pages that matter and the fixes are driven by what it finds — no
speculative retailer adapters before then.

## Phase 5 — Retailer adapters

**Complete.** Five platform adapters, a versioned registry, ten sanitized fixtures, and an
extractor-health page.

### What works

- **Adapters target platforms, not brands** — Shopify, WooCommerce, Magento/Adobe
  Commerce, BigCommerce, and Salesforce Commerce Cloud. See
  [DECISIONS.md](DECISIONS.md) for why: the repository has no usage notes naming real
  retailers, and BUILD_PLAN.md §10.7 explicitly warns against a speculative brand list.
  A platform's markup is the same across every storefront running it, so one adapter
  covers thousands of shops and can be fixture-tested without ever fetching a live page.
- **Each one reads something the generic pipeline cannot.** The Shopify adapter resolves
  `?variant=` to that variant's own price, stock, and options — the fixture's JSON-LD says
  98.00 while the selected variant costs 108.00, and an end-to-end test proves 108.00 is
  what reaches the panel. WooCommerce matches the attribute selects against the variation
  matrix instead of reporting the "from" range. Magento reads `data-price-amount` rather
  than parsing "279,00 €", and reads stock from the `available` class rather than from a
  word that might be "Auf Lager".
- **Versioned registry** with unique ids, priorities above every generic extractor, and
  `adapterDescriptors()` exposing it as plain data. Tests assert no adapter claims another
  platform's fixture, and that none claims any of the generic fixtures.
- **Generic fallback is proven, not assumed.** An adapter that throws in `supports()` or
  `extract()` is recorded in `extractorFailures` and the capture still completes from
  structured data. An adapter that matches but contributes nothing leaves
  `extraction.extractorId` as `generic` while appearing in `matchedAdapters` — which is
  exactly the signature of rotted selectors.
- **The adapter's version is recorded with the capture**, and therefore with every
  observation: `extraction.extractorId`/`extractorVersion` name the highest-priority
  adapter that actually contributed a field.
- **Extractor health at `/app/diagnostics`** — domains sorted worst-first, each with the
  extractor id/version pairs seen there, per-field presence rates, mean confidence, and a
  failure class (`no_price`, `no_currency`, `low_confidence`, `generic_fallback`, `ok`).
  Domains only: no titles, no notes, no URLs, asserted end to end.
- **Price scale is normalized** without changing any amount, so `279.0000`, `279.00`, and
  a Shopify integer `27900` all become the same string. Integer minor units have the
  decimal point moved rather than being divided by 100 through a double.

### Database changes

None. Adapter id, version, and confidence were already stored on `items` from Phase 2B,
which is what made the health page possible without new telemetry.

### Verification

| Command          | Result                                        |
| ---------------- | --------------------------------------------- |
| `pnpm lint`      | Pass — 7 workspaces                           |
| `pnpm typecheck` | Pass — 7 workspaces                           |
| `pnpm test`      | Pass — 41 files, 477 tests                    |
| `pnpm build`     | Pass                                          |
| `pnpm test:db`   | Pass — 5 files, 90 pgTAP assertions           |
| `pnpm test:e2e`  | Pass — 36 web + 15 extension Playwright tests |

### Deliberately not built yet

- **Brand-specific adapters.** None, on purpose — see above. Adding one when real usage
  calls for it is a file in `adapters/` and two fixtures; the registry does not change.
- **Aggregate health across users.** The page is scoped by RLS to the reader's own items.
- **Extractor telemetry as events.** `extraction_failed` and friends (BUILD_PLAN.md §19.1)
  are not emitted anywhere; the health page is derived from stored item columns.

### Known limitations

- A large retailer on bespoke infrastructure gets the generic pipeline. That is the
  expected majority case and the health page is how it becomes visible.
- Adapter detection is structural. A storefront that has themed away every platform marker
  falls back to generic extraction rather than being detected some other way.
- The health page counts items, not capture attempts: a page that failed extraction badly
  enough never to be saved leaves no trace in it.
- BigCommerce and Salesforce Commerce Cloud fixtures price in `$`, which is deliberately
  not mapped to a currency — the captures carry a price with `currency: null`, which is the
  honest result and not an adapter bug.

## Phase 4 — Observations, revisit refresh, and price history

**Complete.** A saved product is re-observed when the user is standing in front of it
again, the series of observations is visible, and the app says how old a price is rather
than implying it is current.

### What works

- **Revisit matching.** Opening the side panel fingerprints the current page and looks for
  a non-archived item with that fingerprint. The match is by canonical URL _and_ variant,
  so a different size of a saved shoe is a different item, not a refresh of one.
- **Refresh on revisit, automatically.** A match is re-observed through
  `ingest_product_capture` with `p_source = 'revisit'` and **no user fields at all**, so
  the note, quantity, priority, desired price, and status cannot be overwritten even in
  principle. `supabase/tests/04_…` asserts all five survive.
- **Nothing leaves the machine on an unsaved page.** Extraction is local and the
  fingerprint lookup is a read; the ingest call only happens once something has matched.
- **A manual "Refresh from this page"** once a page is recognised, for a price that moves
  while the panel is open.
- **Observation de-duplication.** An identical revisit records nothing and only moves
  `last_observed_at`. A change in availability alone _is_ worth recording, and is.
- **Price history** in the item detail drawer: every observation with its price,
  availability, timestamp, and source (saved / revisited / edited / background). A list,
  not a chart — with the handful of points a personal cart accumulates, the dates and
  sources are the information.
- **Price-change badges** on the card, comparing the current price against the last
  observation that _differed_, so a run of identical revisits does not erase the move. The
  difference is computed on the decimal strings with integer arithmetic; only the
  percentage uses floating point, and only for display.
- **Staleness.** Fresh (≤24h), aging, and stale (>7d) are distinguished on the card and in
  the drawer, with the drawer explaining how to re-check. An item with no observation says
  "never checked" rather than showing a bare timestamp.
- **`item_price_summary`**, a `security_invoker` view giving each item its latest price,
  the last different price, and an observation count in one round trip — RLS still applies,
  and `supabase/tests/04_…` proves a stranger sees nothing and an anonymous request is
  refused outright.

### Database changes

- `supabase/migrations/20260726180000_price_summary.sql` — the `item_price_summary` view.
  No table changes: `item_observations` and the ingestion function already recorded
  everything this phase needed.

### Verification

| Command          | Result                                        |
| ---------------- | --------------------------------------------- |
| `pnpm lint`      | Pass — 7 workspaces                           |
| `pnpm typecheck` | Pass — 7 workspaces                           |
| `pnpm test`      | Pass — 37 files, 407 tests                    |
| `pnpm build`     | Pass                                          |
| `pnpm test:db`   | Pass — 5 files, 90 pgTAP assertions           |
| `pnpm test:e2e`  | Pass — 31 web + 12 extension Playwright tests |

The extension end-to-end tests drive the real flow: save a fixture product, reopen the
panel on the same page and get "already saved — nothing has changed", change the served
price and get "price and availability updated" with one card at the new price, and get
silence on a different product page. The fixture server serves the same product at a
different price on request; because the fixtures declare an absolute `rel=canonical`, the
query string does not change the fingerprint, which is the case worth testing.

### Deliberately not built yet

- **Scheduled background refresh** — Phase 7. Nothing fetches a retailer page on a timer;
  every observation in the system came from a page the user was looking at.
- **Notifications** for a desired-price hit or a return to stock — also Phase 7. The
  desired-price badge on a card is the whole of it for now.
- **Refresh-strategy classification** per domain (`public_fetch` / `api` /
  `browser_required` / `disabled`). Every item is browser-required today, which is why the
  stale copy says to open the page with the side panel.

### Known limitations

- The revisit runs when the panel mounts. In Chrome the side panel persists across tab
  switches, so navigating to a saved product with the panel already open does not
  re-observe it until the panel is reopened. Tab-change-driven refresh needs the `tabs`
  permission, which the extension deliberately does not request.
- The price-change badge compares against the last _different_ observation, not against the
  price at save time. For an item that has bounced, "since you saved it" is loose wording
  for "since it last changed".
- The detail drawer loads at most 50 observations, newest first, and does not paginate.
- Staleness thresholds are fixed at 24 hours and 7 days rather than per-user or per-domain.

## Phase 3 — Cart dashboard and daily UX

**Complete.** The dashboard is usable as a daily tool: find something, change it, undo a
mistake, and see another device's change arrive without a reload.

### What works

- **The observed/authored boundary is now enforced in both directions.** Phase 2B stopped
  a refresh from touching user fields; `items_protect_observed_fields` now stops a client
  from touching retailer fields. A client update that includes `current_price` silently
  keeps the stored value — asserted from SQL in `supabase/tests/03_…`.
- **Search** across title, brand, retailer, note, and variant values, all terms required.
- **Filters**: status (archived hidden unless asked for), retailer, availability, on sale,
  and "hit my target".
- **Sorting** by recently updated, recently added, price either way, priority, or title.
  Items with no price sort last in both price directions — unknown is not free.
- **List and card views.**
- **Item detail drawer** splitting "what the retailer says" (read-only, with last-checked
  time and identifiers) from "yours" (status, quantity, priority, desired price, note).
- **Optimistic mutations** with rollback on failure, and an **undo** for archive that
  restores the previous status rather than defaulting to `saved`.
- **Permanent delete** behind a confirmation, offered only from the detail drawer, because
  it takes the price history with it.
- **Realtime**: `items` changes patch the local cache; rows for carts this view is not
  showing are ignored.
- **Extension panel** shows recent items with their status and a one-tap next step.
- **Money leaves Postgres as text.** `current_price::text` and friends: PostgREST returns
  `numeric` as a JSON number otherwise, and a JSON number is a double.

### Verification

| Command          | Result                                       |
| ---------------- | -------------------------------------------- |
| `pnpm lint`      | Pass — 7 workspaces                          |
| `pnpm typecheck` | Pass — 7 workspaces                          |
| `pnpm test`      | Pass — 30 files, 381 tests                   |
| `pnpm build`     | Pass                                         |
| `pnpm test:db`   | Pass — 4 files, 70 pgTAP assertions          |
| `pnpm test:e2e`  | Pass — 26 web + 8 extension Playwright tests |

The Phase 3 end-to-end tests drive the dashboard the way a person would: search by several
terms, filter by retailer and availability and sale, sort and check that an unknown price
sorts last, switch views, edit the user fields and confirm the observed ones did not move,
reject an invalid quantity before it reaches the database, change status from a card,
archive and undo back to the _previous_ status, show archived only when asked, and delete
permanently only after confirming.

### Deliberately not built yet

- Price history and revisit refresh — Phase 4. The detail drawer shows the last observation
  time but not the series.
- Sharing, invitations, and the compare tray — Phase 6.
- Multi-cart switching. Items from every cart the user can read appear in one list; the
  cart switcher lands with sharing, when a second cart first becomes possible.

### Known limitations

- Filtering and sorting happen in the browser over the full list. That is right at
  personal-cart scale and the predicates are pure functions, so moving them into Postgres
  later is mechanical rather than a rewrite.
- The undo lives for ten seconds and is not restored on reload.
- Realtime updates arrive for the list, not for an open detail drawer's form fields; a
  concurrent edit would be overwritten by whichever save lands last (BUILD_PLAN.md §13.2
  specifies last-write-wins for the MVP).

## Phase 2B — Capture save vertical slice

**Complete.** A product page can be captured in the extension and appears in the web
dashboard; saving it twice refreshes it instead of duplicating.

### What works

- **Schema.** `items` and `item_observations`, with the user-authored / retailer-observed
  split enforced by the ingestion function rather than by convention. Money is
  `numeric(20,6)`; a partial unique index on `(cart_id, fingerprint)` over non-archived
  rows makes a duplicate save impossible. Observations are select-only for clients — they
  are written exclusively by the ingestion function, because price history a browser can
  rewrite is not history.
- **Fingerprinting.** SHA-256 over the normalized canonical URL, the selected variant, and
  the primary identifier. Price is deliberately not an input.
- **`ingest_product_capture`.** One transaction: authenticate, check edit access, reject an
  unsupported schema version or a malformed fingerprint or a locale-formatted price, find
  by fingerprint, insert or refresh observed columns only, and append an observation only
  when something changed or the last one is over 12 hours old.
- **Capture flow.** An unlisted script injected under `activeTab` — no `content_scripts`
  entry, no host permission — reads the DOM, decides for itself whether the page may be
  read at all, and returns a capture over a versioned, request-correlated message.
- **Side panel.** Preview with the extracted image, editable title/price/currency, variant
  chips, quantity, note, destination cart, and a recent-items list. Uncertain fields are
  marked rather than blocking the save.
- **Dashboard.** Saved products with price, discount, variant, note, quantity,
  availability, and last-checked time. Missing values say "unknown" instead of showing a
  blank.

### Verification

| Command                                    | Result                                       |
| ------------------------------------------ | -------------------------------------------- |
| `pnpm lint`                                | Pass — 7 workspaces                          |
| `pnpm typecheck`                           | Pass — 7 workspaces                          |
| `pnpm test`                                | Pass — 27 files, 330 tests                   |
| `pnpm build`                               | Pass — web and extension production bundles  |
| `pnpm test:db`                             | Pass — 3 files, 56 pgTAP assertions          |
| `pnpm test:e2e`                            | Pass — 16 web + 8 extension Playwright tests |
| `pnpm supabase:start` / `:reset` / `:stop` | Pass                                         |

The extension suite drives a real Chromium with the built extension loaded, against a
local fixture server:

- captures `json-ld-complete.html`, showing the extracted title, price, currency, and
  variant in the preview
- edits the title, adds a note and a quantity, saves, and sees the item in the panel
- captures the same page again and gets "Already saved — refreshed", with one item
- captures a page whose price exists only in the DOM
- fills in a page that states nothing, after being told which fields to check
- refuses to read a checkout URL

The web suite ingests a capture through the real RPC as a second client and then checks the
dashboard in the browser:

- price, sale price, discount, retailer, variant, note, quantity, and availability render
- a duplicate save shows as one refreshed item with the note and quantity intact
- a capture with no price says "Price unknown", not a blank
- another user's products are not visible

### Deliberately not built yet

- Search, filters, sorting, and the item detail drawer — Phase 3.
- Editing a saved item from the dashboard; today user fields are set at capture time.
- Realtime subscriptions: the dashboard reflects saves on load, not live.
- Revisit refresh and price history views — Phase 4.
- Retailer adapters — Phase 5.

### Known limitations

- **The end-to-end build grants `http://127.0.0.1/*`.** A headless browser cannot click
  the toolbar button that confers `activeTab`, so `WXT_E2E=1` adds loopback host access.
  A release build has no host permission at all; `lib/manifest.test.ts` asserts it.
- The dashboard is a list, not yet a working cart UI. That is Phase 3.
- Fingerprints are computed client-side. The server verifies the shape and scopes them to
  the cart, so a wrong value only affects the caller's own deduplication — but a client
  that computes them differently would create duplicates for itself.

## Phase 2A — Capture contract and extraction engine

**Complete.**

### What works

- **`ProductCaptureV1`** in `packages/contracts`: a Zod schema that enforces the design
  rules rather than merely documenting them. Money is a decimal string (a number is
  rejected outright), currency is ISO 4217 or `null`, URLs must be `http(s)`, unknown
  values stay `null` or the explicit `unknown` availability, and evidence is per field.
- **Normalizers**: price (string arithmetic, US and European formats, no rounding),
  currency (unambiguous symbols only — a bare `$` stays `null`), availability, text, and
  canonical URLs.
- **JSON-LD extractor**: multiple script blocks, top-level arrays, `@graph`, `@type` as a
  string or array, single offers, offer arrays, `AggregateOffer`, `priceSpecification`,
  brand and image in every shape schema.org allows, and offer selection by SKU.
- **Open Graph / product meta extractor** with a canonical-link reader.
- **Generic DOM extractor**: annotation- and landmark-driven only. It does not scan text
  for currency symbols, and there is a test asserting it ignores "free shipping over
  $75.00" and "4 payments of $32.25" on the same page as the real price.
- **Selected-variant detection** from selects, radios, ARIA state, and URL parameters —
  only what is selected, never the option matrix.
- **Merge engine** with source ranking, confidence tie-breaks, and empty-value guards; it
  keeps losing evidence so extractor disagreements stay visible.
- **Pipeline** that assembles, validates, and reports. A crashing extractor cannot prevent
  a capture, and its crash is recorded in `extractorFailures` instead of vanishing.
- **Six sanitized fixtures** with expected-capture JSON, covering structured data, meta
  only, DOM only, and the nothing-extractable case.

### Verification

| Command          | Result                                                 |
| ---------------- | ------------------------------------------------------ |
| `pnpm lint`      | Pass — 7 workspaces                                    |
| `pnpm typecheck` | Pass — 7 workspaces                                    |
| `pnpm test`      | Pass — 21 files, 266 tests (at the time of that phase) |
| `pnpm build`     | Pass                                                   |

`packages/extractors` alone contributes 172 tests across 11 files.

### Deliberately not built yet

- `items` and `item_observations` tables, fingerprinting, and the ingestion function.
- The side-panel capture UI and the content script — no `activeTab` or `scripting`
  permission has been added.
- Retailer adapters. The registry slot exists (`priority` above 70) and is empty.

### Known limitations

- No adapter has been written, so extraction quality on a real retailer page is whatever
  its structured data allows. That is the intended Phase 2A boundary.
- `retailerName` is derived from the domain and is a display fallback, not an identity.
- Fixtures use reserved `.example` hosts and invented products; the first real-page
  regression fixtures arrive with the adapters.

## Phase 1 — Authentication and authorization

**Complete.**

### What works

- **Schema.** `profiles`, `carts`, `cart_members`, the `cart_role` enum, and the
  `auth.users` trigger that creates a profile, one default cart, and an owner membership
  on signup. A partial unique index makes a second default cart impossible; a trigger makes
  `carts.owner_id` immutable. See [DATA_MODEL.md](DATA_MODEL.md).
- **RLS.** Enabled on all three tables, with `anon` holding no grants at all. Read, edit,
  delete, and membership-management rules follow the owner/editor/viewer model.
- **Web sign-in.** Google OAuth and an email magic link, both landing on server-side routes
  that put the session in cookies. `/app` is protected by middleware and re-checked in the
  page itself. Sign-out clears the session.
- **Extension sign-in.** Google through `chrome.identity.launchWebAuthFlow` — no extension
  page is ever redirected — plus an emailed 6-digit code for when Google is unavailable. A
  link cannot serve the side panel, because a browser tab is a different session store. The
  session lives in `chrome.storage.local` and is recovered when the panel reopens.
- **Same account either way.** Signing in from either surface produces the same user, the
  same profile, and the same single default cart.

### Verification

| Command                                    | Result                                       |
| ------------------------------------------ | -------------------------------------------- |
| `pnpm lint`                                | Pass — 7 workspaces                          |
| `pnpm typecheck`                           | Pass — 7 workspaces                          |
| `pnpm test`                                | Pass — 9 files, 91 tests                     |
| `pnpm build`                               | Pass — web and extension production bundles  |
| `pnpm test:db`                             | Pass — 2 files, 27 pgTAP assertions          |
| `pnpm test:e2e`                            | Pass — 11 web + 4 extension Playwright tests |
| `pnpm supabase:start` / `:reset` / `:stop` | Pass                                         |

The end-to-end suites exercise the real flows against the local Supabase stack, reading the
actual sign-in email out of Mailpit rather than minting tokens through an admin API:

- anonymous `/app` redirects to `/login` and remembers the destination
- a new user signs in by magic link, lands on `/app`, and sees exactly one default cart
- signing in a second time reuses the same account and the same cart
- sign-out really clears the session — `/app` bounces again afterwards
- an off-origin `next` parameter is discarded
- an invalid confirmation link reports an error instead of signing anyone in
- the extension side panel signs in with the emailed code, stores the session under
  `universal-cart-auth` in `chrome.storage.local`, recovers it across a reload, and clears
  it on sign-out
- the loaded manifest requests exactly `identity`, `sidePanel`, `storage`, and no host
  permissions

### Deliberately not built yet

- Any product data: capture, `items`, `item_observations`, the dashboard.
- Invitations and membership management UI — the RLS model is in place, the surface is
  Phase 6.
- Profile editing.

### Known limitations

- **Google sign-in is not covered end to end.** Both implementations are complete and the
  Supabase-facing half is unit tested with injected fakes, but exercising the real flow
  needs Google OAuth credentials, so `[auth.external.google]` is disabled in the local
  config and CI does not test it. It is on the manual pre-release checklist.
- `supabase/config.toml` raises `auth.rate_limit.email_sent` to 200/hour for local
  development; a hosted project should keep a conservative production value.
- The magic-link email template is configured in `supabase/config.toml` for local use. A
  hosted project needs the same template in the dashboard, or its links point at the
  implicit-flow verify endpoint and the server never sees the session.

## Phase 0 — Repository foundation

**Complete.**

### What works

- pnpm workspace with Turborepo driving `dev`, `lint`, `typecheck`, `test`, `build`,
  `test:e2e`, and `clean` across seven workspaces.
- `apps/web` — Next.js 16 App Router, Tailwind CSS 4, TypeScript strict.
- `apps/extension` — WXT 0.20 + React 19, Manifest V3, side panel.
- `packages/contracts` — `schemaVersion` gating helpers and generated database types.
- `packages/extractors` — canonical URL normalization.
- `packages/ui` — `cn` class-name helper.
- `packages/test-utils` — fixture-reading helpers.
- `packages/config` — shared ESLint flat configs, Prettier config, TypeScript presets.
- `supabase/` — `config.toml`, `migrations/`, `seed.sql`, `tests/`.
- `.github/workflows/ci.yml` — lint, typecheck, unit tests, builds, format check, an
  extension-bundle assertion, Playwright, and a secret scan.
- `.env.example` at the root and per app, classifying every variable client-safe or
  server-only.

Manual: the web app serves at <http://localhost:3000>; the extension loads unpacked from
`apps/extension/.output/chrome-mv3` and the side panel opens from the toolbar icon.
