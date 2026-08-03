# Decision record

Short ADRs. Add an entry before departing from [BUILD_PLAN.md](../BUILD_PLAN.md), before
adding a service or a major dependency, and whenever a choice would otherwise be
rediscovered by reading a config file.

Format: date, decision, context, consequences.

---

## 2026-07-26 — Internal packages are consumed as TypeScript source

**Decision.** `packages/*` expose `./src/index.ts` through their `exports` map rather than
a compiled `dist/`. `apps/web` lists them in `transpilePackages`; WXT/Vite compiles them
for the extension.

**Context.** A build step per package would need watch mode in development, correct
`dependsOn` wiring in Turborepo, and stale-output debugging — for packages that only ever
ship inside two bundles.

**Consequences.** No package emits declarations, so nothing here is publishable as-is. If
a package ever needs to be published or consumed by a non-bundler runtime, it gains its own
build task at that point.

---

## 2026-07-26 — Node LTS + TypeScript 5.9, not TypeScript 7

**Decision.** Pin TypeScript 5.9.3.

**Context.** TypeScript 7 is current on npm, but `typescript-eslint@8` declares
`typescript >=4.8.4 <6.1.0`. Adopting TS 7 today means dropping type-aware linting.

**Consequences.** Revisit when `typescript-eslint` supports TS 7. The pin lives in every
workspace `package.json` and must be bumped together.

---

## 2026-07-26 — Side panel only in Phase 0; popup fallback deferred

**Decision.** Ship the Chrome Side Panel entrypoint alone. Do not add a popup entrypoint yet.

**Context.** BUILD_PLAN.md §4.3 calls for a popup fallback where a side panel is
unavailable. In Chrome, declaring `action.default_popup` overrides
`sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`, so a popup added now would
shadow the primary surface rather than back it up.

**Consequences.** The fallback is added when a browser target without the Side Panel API is
actually supported (Firefox, per BUILD_PLAN.md §3.1), with a runtime capability check
choosing the surface instead of a static manifest key.

---

## 2026-07-26 — Manifest permissions start at `sidePanel` and `storage`

**Decision.** The Phase 0 manifest requests `sidePanel` and `storage` only. No
`activeTab`, no `scripting`, no `contextMenus`, no host permissions.

**Context.** BUILD_PLAN.md §11.5 lists the eventual permission set, but a permission is
only defensible once the feature that needs it exists. Phase 0 reads no page content.

**Consequences.** `activeTab` and `scripting` arrive with the content script in Phase 2B;
`contextMenus` with the "Save to Universal Cart" menu item; `identity` with extension auth
in Phase 1 if the chosen flow requires it. Host permissions remain optional and
requested at the moment a user enables per-domain refresh.

---

## 2026-07-26 — Supabase CLI is a workspace dev dependency

**Decision.** Install `supabase` from npm as a root dev dependency so `pnpm supabase:start`
works from a clean clone.

**Context.** The documented commands must work without a separately installed global CLI,
and the CLI version affects local Postgres and migration behaviour, so it should be pinned
in the lockfile like every other tool.

**Consequences.** Docker is still required. CLI upgrades are a reviewable lockfile change.

---

## 2026-07-26 — The extension signs in with a one-time code, not a magic link

**Decision.** The side panel's email fallback asks Supabase for an OTP and verifies the
6-digit code in the panel. It does not ask the user to click the emailed link.

**Context.** Clicking a link opens a browser tab. That tab's session lands in cookies for
the web app's origin, which is not the extension's session store — the panel would still
be signed out. The same email carries both a link (for the dashboard) and a code (for the
panel), so one email serves both surfaces.

**Consequences.** The magic-link email template is part of the contract between the two
clients: it must contain both `{{ .TokenHash }}` and `{{ .Token }}`. A hosted Supabase
project needs the template from `supabase/templates/magic_link.html` configured in its
dashboard.

---

## 2026-07-26 — RLS predicates are SECURITY DEFINER helpers

**Decision.** `can_read_cart`, `can_edit_cart`, and `owns_cart` are `security definer` SQL
functions, and the policies on `carts` and `cart_members` call them instead of querying
each other's tables directly.

**Context.** A `carts` policy needs to consult `cart_members`, and a `cart_members` policy
needs to consult `carts`. Doing that inline makes each policy re-enter the other table's
RLS, which Postgres rejects as infinite recursion.

**Consequences.** These three functions bypass RLS by design, so they are the highest-value
review target in the schema. Each answers a yes/no question about `auth.uid()` only,
returns no rows, and grants `EXECUTE` to `authenticated` alone. Any future predicate added
here needs the same scrutiny.

---

## 2026-07-26 — Redirect URLs are built from the request Host, not `NextRequest.url`

**Decision.** `apps/web/src/lib/auth/absolute-url.ts` derives the redirect origin from
`x-forwarded-host`/`host`, falling back to `request.url` only when neither is present.

**Context.** Next normalizes `request.url` and `request.nextUrl` to the server's own
origin. A request to `http://127.0.0.1:3100` comes back as `http://localhost:3100`, and
those are different cookie jars — the session established by `/auth/confirm` was dropped
by the very redirect that followed it, and the user landed back on `/login`.

**Consequences.** Anything that builds a redirect must go through these helpers. A
deployment behind a proxy must set `x-forwarded-host` and `x-forwarded-proto` correctly.

---

## 2026-07-26 — End-to-end suites require a real Supabase project

**Decision.** Both Playwright suites fail fast without `NEXT_PUBLIC_SUPABASE_URL` /
`WXT_PUBLIC_SUPABASE_URL`. `pnpm test:e2e` fills them from the running local stack via
`scripts/with-supabase-env.mjs`; CI starts Supabase before the suite.

**Context.** The alternative — skipping auth tests when no project is reachable — produces
a green suite that tested nothing, which is worse than a red one. Next also inlines
`NEXT_PUBLIC_*` at build time, so the values have to be present for the build the suite
serves, not merely at test time.

**Consequences.** `pnpm test:e2e` needs Docker and `pnpm supabase:start`. The extension
suite additionally needs the full Chromium build (`channel: 'chromium'`), because the
headless shell does not load extensions and the MV3 service worker never starts.

---

## 2026-07-26 — The fingerprint is computed by the client, verified by the server

**Decision.** `ingest_product_capture` takes the fingerprint as a parameter and validates
its shape (64 lowercase hex) rather than recomputing it in SQL.

**Context.** The fingerprint depends on URL normalization and variant canonicalization
that live in `packages/extractors`. Reimplementing them in PL/pgSQL would create a second
definition that must be kept byte-identical with the first, and the two drifting apart
would silently produce duplicates.

**Consequences.** A client could send a wrong fingerprint. The blast radius is bounded: the
value is scoped to `(cart_id, fingerprint)`, so the only effect is that the caller's own
cart deduplicates badly. Nothing about another user's data depends on it. If a
server-computed fingerprint becomes necessary — for example when a background worker starts
ingesting in Phase 7 — it will be added as a verification step, not a replacement.

---

## 2026-07-26 — The capture script decides which pages may be read

**Decision.** The "is this page capturable" check runs inside the injected script, using
`window.location.href`, rather than in the side panel using the tab's URL.

**Context.** With `activeTab` and no `tabs` permission, the extension cannot read tab URLs
at all — `chrome.tabs.query` returns entries with `url` undefined. Adding the `tabs`
permission to perform the check would mean acquiring the ability to read every tab's URL in
order to decline to read one of them, which is backwards.

**Consequences.** The refusal for checkout, payment, and account pages arrives as a normal
extraction failure the panel displays. The extension never learns the URL of a page it is
not allowed to read.

---

## 2026-07-26 — `WXT_E2E=1` grants loopback host access to the test build

**Decision.** The extension build reads `WXT_E2E`; when set, the manifest gains
`http://127.0.0.1/*`. Release builds have no host permission.

**Context.** In production `activeTab` is conferred by clicking the toolbar button, which
is what opens the side panel. A headless browser cannot click browser chrome, and
`chrome.permissions.request` needs a confirmation dialog that headless Chrome cannot
accept — so without this the end-to-end suite could not exercise injection at all.

**Consequences.** Two builds exist, and the difference is exactly one loopback origin.
`lib/manifest.test.ts` asserts that the release configuration grants no host permission and
that neither configuration ever grants broad access; the extension end-to-end suite asserts
the manifest Chrome actually loaded. The release workflow in Phase 9 must not set the flag.

---

## 2026-07-26 — Observations are writable only by the ingestion function

**Decision.** `authenticated` holds `select` on `item_observations` and nothing else. There
are no insert, update, or delete policies.

**Context.** Price history is the evidence behind "this dropped 20% since you saved it". A
client that can write it can fabricate it, and the feature stops meaning anything.

**Consequences.** Every write path for observations must go through
`ingest_product_capture` or a future `SECURITY DEFINER` sibling. Manual price corrections,
if they are ever wanted, need an explicit function with `source = 'manual'` rather than a
direct insert.

---

## 2026-07-26 — Observed columns are protected by a trigger, not by convention

**Decision.** `items_protect_observed_fields` restores every retailer-observed column to
its previous value on any `UPDATE` that is not coming from `ingest_product_capture`, which
announces itself with a transaction-local setting.

**Context.** Phase 2B stopped a refresh from overwriting user fields by simply not writing
them. The other direction was unguarded: RLS allows a client to update an item, and
"update" meant every column. A UI bug — or anyone with the publishable key and a REST
client — could have rewritten price history through the items table.

**Consequences.** Client edits silently keep observed values rather than failing, because
the UI sends whole rows and rejecting an unchanged observed column would make every edit an
error. Any future writer of observed columns must go through the ingestion function or set
the same marker, and should get its own pgTAP coverage.

---

## 2026-07-26 — Money is selected as `text`

**Decision.** Every query that reads a money column selects it as `current_price::text`
rather than letting PostgREST serialize the `numeric`.

**Context.** PostgREST reports `numeric` as a JSON number. JSON numbers are IEEE doubles,
so the exact decimal the database holds is approximated on the way out — the same class of
error the schema was designed to avoid by not using `float` in the first place.

**Consequences.** Money arrives in TypeScript as a decimal string, matching the capture
contract. Display code converts to a number only at the last moment for
`Intl.NumberFormat`; nothing does arithmetic on it. Any new query that reads a money column
must remember the cast — the generated types will not catch it, because they describe what
PostgREST _would_ return.

---

## 2026-07-26 — Item mutations do not call `revalidatePath`

**Decision.** The item Server Actions return a result and nothing else. They do not
invalidate the dashboard route.

**Context.** Revalidating after every status toggle or note edit refetches the entire list
and re-renders the page, which races the optimistic state it is supposed to confirm — an
observed source of lost updates when two changes were made in quick succession.

**Consequences.** The client is responsible for its own cache, which it already is:
optimistic apply, rollback on failure, Realtime for anything it missed. A navigation to
`/app` still fetches fresh data, because the route is `force-dynamic`.

---

## 2026-07-26 — Filtering and sorting run in the browser

**Decision.** `/app` fetches the user's items once, including archived ones, and filters
and sorts them client-side.

**Context.** A personal cart is tens to low hundreds of items. Round-tripping every
keystroke would make search feel worse for no benefit, and would put query construction —
the part most likely to leak another user's rows — on the critical path of every control.

**Consequences.** The predicates are pure functions over an array with unit tests, so
moving them into Postgres when a cart outgrows this is mechanical. The threshold to watch
is payload size, not query time.

---

## 2026-07-26 — The previous price comes from a view, not from the client

**Decision.** `item_price_summary` computes each item's latest price, the last price that
_differed_, and an observation count in Postgres. The dashboard reads it alongside the item
list rather than fetching observations per card.

**Context.** A price-change badge needs two numbers, but the second one is not simply "the
observation before this one" — after three revisits at an unchanged price, the comparison a
user wants is still against the price before it moved. Doing that in the client means
fetching every observation for every card on the list.

**Consequences.** One extra round trip for the whole page instead of one per card. The view
is `security_invoker`, so the reader's RLS on `item_observations` still applies — a view is
otherwise a way around row-level security, and `supabase/tests/04_…` asserts it is not one
here. The badge's wording ("since you saved it") is loose for an item whose price has
bounced; a save-time baseline would need a column, and is not worth one yet.

---

## 2026-07-26 — Price history is a list, not a chart

**Decision.** The detail drawer renders observations as a dated list with price,
availability, and source. No sparkline, no charting dependency.

**Context.** Until background refresh exists, every observation comes from a page the user
personally opened. A personal cart accumulates a handful of them per item. A chart over
three points is decoration, and it would hide the field that actually answers the question
being asked — _when_, and _from what_.

**Consequences.** No charting library in the bundle. When Phase 7 starts producing daily
observations the shape of the data changes and this decision should be revisited; the
component boundary (`PriceHistory`) is where that swap happens.

---

## 2026-07-26 — A revisit sends no user fields at all

**Decision.** `refreshFromPage` calls `ingest_product_capture` with an empty `p_user_fields`
object, never a copy of the item's current note, quantity, priority, desired price, or
status.

**Context.** The ingestion function already preserves user-authored columns on refresh, and
a trigger already rejects client writes to observed columns. Sending the user's fields back
would be a third place that could get it wrong — and the one most likely to, because it
would be sending values read a moment earlier from a possibly stale panel.

**Consequences.** A refresh cannot clobber user data even if the function's preservation
logic regressed; there is nothing in the payload to clobber it with. The rule is asserted
from both sides: `refreshFromPage`'s unit tests check what is sent, and
`supabase/tests/04_…` checks all five fields survive a revisit.

---

## 2026-07-26 — The extension does not watch tab changes

**Decision.** The side panel re-observes the current page when it mounts. It does not
listen for tab activation or navigation.

**Context.** Refreshing whenever the user lands on a saved product would need
`chrome.tabs.onUpdated` and the `tabs` permission, which grants the URL of every tab the
user opens. That is browsing history, and the privacy promise is that the extension reads
only the page the user pointed it at.

**Consequences.** With the panel already open, navigating to a saved product does not
re-observe it until the panel is reopened, and there is an explicit "Refresh from this
page" button for that case. The permission list stays at `activeTab`, `scripting`,
`storage`, `sidePanel`, and `identity`, which `lib/manifest.test.ts` asserts.

---

## 2026-07-26 — Adapters target commerce platforms, not retailer brands

**Decision.** The five Phase 5 adapters are Shopify, WooCommerce, Magento/Adobe Commerce,
BigCommerce, and Salesforce Commerce Cloud — the platforms storefronts are built on —
rather than five named retailers.

**Context.** BUILD_PLAN.md §10.7 says to add adapters "based on the actual sites used by
the project's users" and warns against a speculative list. This repository has no usage
notes and no fixture requests, so there is no list of actual sites to work from. Guessing
five brand names would have been exactly the speculation the plan warns about, and worse:
a brand adapter can only be written and fixture-tested against that retailer's live
markup, which the project is not going to fetch.

A platform's markup, by contrast, is identical across every storefront running it and is
publicly documented. One adapter covers thousands of shops, its fixtures can be authored
from the platform's own conventions, and each one earns its place by reading something the
generic pipeline provably cannot — the variant in a Shopify `?variant=`, a WooCommerce
variation's price behind a "from" range, Magento's unformatted `data-price-amount`.

**Consequences.** Coverage is broad but shallow: a large retailer on bespoke infrastructure
gets the generic pipeline, and the extractor-health page is what will surface that. When
real usage names a specific retailer worth an adapter, adding one is a new file in
`adapters/` and two fixtures — the registry does not need to change shape. The naming
convention (`platform`, not `brand.com`) is worth preserving so the two kinds stay
distinguishable.

---

## 2026-07-26 — The extractor-health page is scoped by RLS, not by an admin role

**Decision.** `/app/diagnostics` shows the signed-in user their own extraction quality,
grouped by domain. There is no admin role and no cross-user view.

**Context.** BUILD_PLAN.md §19.2 calls for "a basic admin-only extractor-health page". At
personal-beta scale the developer _is_ a user, so their own carts already surface the
failures worth acting on — and an admin view would mean either a service-role query path
in the web app or a privileged role in the RLS model, both of which are new attack surface
built for one reader.

**Consequences.** The page cannot show aggregate health across the friend group; a domain
nobody else's data reaches is invisible until someone with access saves from it. In
exchange there is nothing here to leak: the query is an ordinary `authenticated` select,
and the same RLS tests that cover the dashboard cover this page. If shared health becomes
necessary, the honest shape is an aggregate view with no per-item rows, not a role that can
read everybody's items.

---

## 2026-07-26 — Diagnostics carry a domain, never a URL

**Decision.** The extractor-health page and its underlying types expose `domain`,
extractor id/version, confidence, and per-field booleans. Titles, notes, and source URLs
are never selected or rendered.

**Context.** BUILD_PLAN.md §19.1 excludes product notes and full URLs from analytics.
A domain and a URL look similar and are not: `shop.example` names a retailer's markup, which
is what needs fixing; `shop.example/p/engagement-ring` names what somebody is buying.

**Consequences.** A failure can be traced to a retailer and an adapter version but not to
the individual page that broke, so reproducing one means opening the retailer and finding
a comparable product. That is the intended trade. An end-to-end test asserts the rendered
page contains neither the product title, the note, nor the URL path of a seeded item.

---

## 2026-07-26 — Deployment splits into an early staging environment and later production hardening

**Decision.** BUILD_PLAN.md §22 puts all deployment in Phase 9. It is split in two instead:
a hosted **staging** environment immediately after live-page extraction validation, and
production hardening plus the Chrome Web Store release at Phase 9 as planned.

Staging is: a hosted development Supabase project, a Vercel preview/staging deployment, a
locally loaded unpacked extension pointed at it, and a small set of trusted testers. It is
an integration environment, not a release — the extension stays unpacked and the listing
does not exist yet.

**Context.** Everything to date runs against local Supabase over `127.0.0.1`. A whole class
of problems only appears once there is a real origin: auth redirect URLs, cookie domains
and `SameSite` behaviour, the extension's origin against a hosted Supabase project's
allowed list, CSP under a real domain, Realtime over a hosted socket, and migrations
applied to a database that was not created by `supabase:reset` a minute earlier. Finding
those at Phase 9, on top of store packaging and privacy disclosures, would mean debugging
several unfamiliar things at once.

The `127.0.0.1`-versus-`localhost` cookie-jar bug already found in Phase 1 is the small
version of this. There will be a hosted version of it.

**Consequences.** One more environment to keep migrations current in, and a second set of
environment variables to manage before it is strictly required. In exchange, Phase 9 gets
to be about hardening rather than about first contact with production. Staging holds no
data anyone would miss and can be reset.

---

## 2026-07-26 — Sharing ships viewer-first

**Decision.** The Phase 6 schema and RLS model support `owner`, `editor`, and `viewer` from
the start, as BUILD_PLAN.md §7.3 and §8.1 describe. The first release **exposes** only
viewer invitations, revocation, read-only shared carts, and the comparison tray. Editor
access follows once viewer sharing is working and tested. No public unauthenticated
sharing in the first implementation.

**Context.** Read-only sharing has one destructive edge case — revocation — and it is
already covered by the existing RLS tests. Editor access opens a set of product questions
that are not about whether sharing works: whether editors may archive or delete, whether
they may invite others, whether they may edit another person's note or desired price,
whether they may move items between carts, who owns observation history on a shared item,
and what an in-flight optimistic update should do when the owner revokes access underneath
it. Each is answerable; none should be bundled into the first proof that sharing works at
all.

Public unauthenticated sharing is excluded separately: a link that works without an account
is a different threat model, needing its own token handling, expiry, and a decision about
what a stranger may see of someone's notes and desired prices.

**Consequences.** A collaborator cannot add to a shared cart in the first release, which is
a real limitation for a shared trip or gift list. The role enum still carries `editor`, so
enabling it later is policy and UI, not a migration. The RLS tests for editor permissions
are written in Phase 6 alongside the viewer ones even though the role is not yet reachable
from the interface — an unreachable permission still needs to be correct before it becomes
reachable.

---

## 2026-07-26 — The primary category is clothing, and the primary value is comparison

**Decision.** Universal Cart is for deciding what to buy, primarily clothing, by putting
candidates side by side. Comparison is the product. Storage and sync exist to serve it.
Sharing is a nice-to-have.

**Context.** The objective in `CLAUDE.md` read "stores, compares, and shares saved
products" — comparison third in a list of three, with no category named at all. Nothing
was wrong in that sentence, and that is the problem: it described a category-agnostic
catalogue tool, and the plan drifted toward one. Phase 3 built search, filters, sorting,
and status management before any comparison view existed, which is the right order for a
catalogue and the wrong order for a decision aid.

The use case has now been stated explicitly: clothing, compared across retailers, in one
place.

**Consequences.** Comparison stops being a Phase 6 deliverable bundled with sharing and
becomes the next thing built. Feature proposals get judged against "does this help someone
choose between three jackets", which most catalogue features do not. Category-specific
attributes — size, colour, fit, material — matter more than a general attribute system.
The existing dashboard work is not wasted; it is how you find the candidates you are about
to compare.

---

## 2026-07-26 — Cross-retailer identifier matching is deprioritised

**Decision.** Do not build the matching machinery in `BUILD_PLAN.md` §9.3 and Phase 8 —
GTIN/UPC/EAN, brand + MPN, retailer identifier mapping, image perceptual hashing,
embedding-assisted candidate scoring — on its current schedule. Comparison ships without it.

**Context.** That machinery answers "is this the same product at two retailers", which is an
electronics question. Identical SKUs are sold by many sellers, so matching them is both
possible and the whole job.

Clothing does not work that way. The same garment is generally not sold by both Zara and
Gymshark; each retailer's line is its own. A clothing shopper is not looking for the same
jacket cheaper elsewhere, they are choosing **between different jackets** for one purchase.
So the expensive half of the plan — deciding whether two records denote one product — is
mostly unnecessary, and the cheap half — showing attributes side by side and highlighting
where they differ — is where the value is.

Garments also lack the identifiers the plan leans on. GTINs are inconsistently published,
MPNs are often absent, and "brand + model" is not how clothing is named.

**Consequences.** Phase 8 is not built on the premise that matching is the hard problem. If
a resale or marketplace use case later makes true cross-seller matching valuable, this is
revisited with evidence — the deterministic identifier path in §9.3 stays a sound design for
the goods it was written for. Comparison must therefore not assume matched pairs: it puts
two to four **independently captured** items beside each other, which is simpler than the
plan assumed. The "never auto-merge uncertain items" rule still stands and matters more, not
less, because a false merge between two different garments would destroy the comparison
rather than merely duplicate a card.

---

## 2026-07-27 — Availability describes the selected variant, not the product

**Decision.** `items.availability` is the availability of the **variant the user selected**.
Product-level availability is kept only as a weaker fallback, used when nothing identifies a
selected option.

**Context.** Nike's Dunk Low Retro is in stock. The size on screen — M 6.5 / W 8 — is not.
The capture said `in_stock`, which is true of the product and false of the only thing the
user cares about. It is the worst shape of wrong value we have found: the price is right and
the title is right, so nothing on the card looks suspicious.

Nobody buys "the product", they buy a size. For a clothing tool a product-level availability
field is close to useless — a garment is almost always in stock in _some_ size, so the field
is nearly always `in_stock` and nearly always uninformative.

It also blocks the feature most worth having. Back-in-stock alerts are scheduled for Phase 7
(BUILD_PLAN.md §15) and, for clothing, "back in stock" means _in my size_. Built on a
product-level field, that alert can only ever fire on the rare occasion an entire style sells
out, and would stay silent in the common case it exists for.

The signal is frequently visual rather than textual: on the page above, the sold-out size is
conveyed by a `selected disabled` class, a strikethrough, and a disabled Add to Bag, with no
text anywhere saying so.

**Consequences.** The first design made the variant-level DOM reading outrank the
product-level JSON-LD claim — an inversion of the usual source ranking, narrowed to
availability alone. That was rejected, and the field is split instead.

Ranking the two against each other is a category error: `availability` was one field carrying
two facts, and "is this product sold" and "is this size available" are not competing answers
to one question. An exception encodes the error rather than removing it.

So the capture carries `offer.variantAvailability` — DOM-only, pre-merge, the selected
option — beside the product-level claim that structured data makes on `offer.availability`.
Each is merged normally among the sources that speak to it, and the pipeline then resolves
`availability = variant ?? product`. No contest, no exception, no inverted ranking. Where the
two disagree the product-level value is preserved as `offer.productAvailability`, so both
facts reach the UI: Nike still sells this shoe, your 6.5 is gone.

`availability` therefore changes MEANING for rows already stored under product-level
semantics. That is dev data only today, which makes this the cheapest moment the change will
ever be. Observation history is not rewritten; series predating this are product-level.

Where no variant is identifiable the product-level value still stands, so pages without
option controls are unaffected — measured across sixteen live pages, exactly one value moved.
`productAvailability` is not yet persisted: the columns on `items` and `item_observations`,
and the UI that shows both, are a follow-on. Until then the capture carries the second fact
and ingestion drops it.

---

## 2026-07-27 — Composition is a real field, deferred, not junk

**Decision.** Material and fabric composition warrant a first-class field on an item, and
will get one at the comparison milestone. Until then the extractors do not collect them.
Specification rows such as `Material: Merino wool` and `Pattern: Ribbed` are removed from
`selectedVariant`, where they are currently landing.

**Context.** This entry exists because of what that removal would otherwise look like later.
Reading the diff alone, dropping `Material` from a capture is indistinguishable from deciding
the data is worthless — and it is close to the opposite. "Is the expensive one actually
merino" is one of the questions a clothing comparison exists to answer. Fibre content
separates two otherwise similar garments more reliably than almost anything else on the page,
and unlike price it barely changes, so it is worth storing once.

The reason to remove it now is the slot, not the value. `selectedVariant` means _the options
the user chose_ — size M, colour Black — and it is part of what the fingerprint is built from
(BUILD_PLAN.md §9.1). Composition is not chosen; it is a property of the garment. Putting it
there makes the fingerprint depend on whether a spec table happened to render, so the same
product could hash two ways and defeat the duplicate-refresh behaviour in §9.2. It also fills
the preview's variant chips with rows the user cannot select.

**Consequences.** The field arrives with comparison, because that is where it pays off — a
composition string on a card nobody is comparing is decoration. It belongs with the
normalized attributes in the compare view (§12.5), not in `selectedVariant`, and not in
`identifiers`, which is for values that denote the product.

Waiting costs little: the data is on the retailer page and is re-read on the next capture.
It avoids storing a free-text blob before knowing what comparison needs from it — "100%
merino wool", "Merino Wool 100%", and "Shell: 100% wool; Lining: 52% polyester" all have to
reduce to something comparable, and that normalization is the actual work. Guessing its shape
now, with no consumer, is how a field ends up wrong in a way that later needs a migration.

Until then the rule in `CLAUDE.md` holds and is the point: never invent missing product
facts. A composition we do not have is shown as missing.

## 2026-07-31 — A retailer's variant id is an identifier, and it outranks a product-level SKU

**Decision.** An opaque `?variant=`/`?variation=` URL token — and Shopify's `variants[].id`
where the adapter reads it — is stored as `identifiers.variantId`, not as a
`selectedVariant` entry. In the fingerprint's `primaryIdentifier` precedence it sits between
GTIN and MPN: `gtin → variantId → mpn → sku → productId`.

**Context.** Live captures put `Variant=47776291946739` in `selectedVariant` on AeroPress
and Everlane — an identifier wearing an option's clothes. In the compare view it is
user-visible garbage; as a variant entry it also enters the fingerprint as text, which works
by accident and only until the retailer renumbers.

The removal could not be a simple drop. On Shopify the `sku` is frequently product-level —
shared by every size of one garment — and the canonical URL drops `?variant=`, so on a page
where the size control also goes undetected, the variant id is the only thing standing
between two sizes and one fingerprint. Removing it from `selectedVariant` without ranking
`variantId` above `sku` would let those saves silently merge: the false merge BUILD_PLAN.md
§9.3 calls worse than duplicates. That coupling is why this shipped as one change — contract,
extraction, fingerprint precedence, and stability tests together.

The routing is deliberately narrow. Only `variant`/`variation` parameters whose value is
opaque (a long digit run, or hex with a digit) are treated as ids; `?variant=harbour-blue`
stays a readable option. Lululemon's `?color=76616` also stays an option even though the
value is opaque — recovering its human label needs `hasVariant` matching, which is deferred,
and moving it out of the variant map now would silently drop the colour from the
fingerprint.

**Consequences.** Items saved while the junk entry existed will not match the new
fingerprint on their next capture and will refresh as a duplicate once, which is the safe
direction. A URL-only variant id is resolved in the pipeline (like the canonical URL) rather
than merged, because identifiers merge whole-object by source rank and a JSON-LD `{sku}`
would otherwise discard it.

## 2026-07-31 — One field name carrying two questions is a pattern, not a coincidence

**Decision.** Recorded, not acted on: when a capture field turns out to hold answers to two
different questions, the fix is to split the field (or route one answer elsewhere), never to
rank the two answers against each other.

**Context.** It has now happened three times. `availability` carried "is this product sold?"
and "is this size available?" — resolved by splitting into variant- and product-level fields,
after a proposed merge-rank exception showed that ranking two different facts against each
other is a category error. `Material: 100% cotton` carried "what is this garment made of?"
inside "what did the user select?" — resolved by removing it from `selectedVariant` with a
composition field decided and deferred. StockX's price carries "what is the lowest ask?"
against "what does Buy Now cost for the selected size?" — both real prices for one product,
currently resolved by the adapter preferring the Buy Now figure and recorded in the
adapter's own documentation.

The shape is always the same: the page answers more questions than the contract has fields
for, and the surplus answer squats in the nearest field with a plausible name. It looks like
a wrong value; it is actually a missing field. The tell is a "wrong" value that is _true_ —
76 really is the lowest ask, the product really is in stock, the shirt really is cotton.

**Consequences.** When a live capture produces a confidently wrong value that turns out to be
true of _something_, ask which question it answers before fixing the extractor. If the
answer is "a question we have no field for", the extractor is not broken — the contract is
narrow, and ranking, suppressing, or "fixing" the value hides real data. No new fields are
added by this entry; it is the diagnostic rule for the next occurrence.
---

## 2026-07-31 — Comparison is side-by-side candidates; cross-retailer matching is cut

**Decision.** Comparison means putting **two to four different saved items** beside each other
for one buying decision. It does not mean recognising the same product at two retailers.
Cross-retailer identifier matching — GTIN/UPC/EAN, brand + MPN, retailer identifier mapping,
image perceptual hashing, embedding-assisted candidate scoring, the whole of the old Phase 8
(BUILD_PLAN.md §9.3) — is **cut**, not deferred.

**Context.** An earlier entry deprioritised that machinery. This one removes it, because
"deferred" keeps inviting the question and something downstream will eventually re-derive it.

Matching answers "is this the same product at another seller". That question has a subject in
electronics, where one SKU is stocked by many sellers. It has almost no subject in clothing.
Zara does not sell Gymshark's shorts; each retailer's line is its own. Garments also lack the
identifiers the plan leans on — GTINs are inconsistently published, MPNs are usually absent,
and "brand + model" is not how clothing is named. Sixteen live captures bear this out: the
identifiers we do extract are retailer-local (`sku`, a Shopify variant id, a style code), and
no two pages describe the same garment.

The question a clothing shopper actually has is "which of these three jackets", where the
three are different products. Nothing needs matching to answer it — they are already distinct
saved items, and the work is showing their attributes side by side and marking where they
differ.

**Consequences.** The comparison tray is the product's core feature, and it is a selection
model plus a side-by-side view. No identifier graph, no `product_groups`, no
`match_candidates`, no embeddings, no confirmation UI for medium-confidence matches — none of
those tables or surfaces get built.

The "never auto-merge uncertain items" rule survives and matters more than before, because
without a matching system the only way two records merge is the fingerprint, which is exact by
construction. Two garments must never collapse into one card; the comparison depends on them
staying separate.

If a resale or marketplace use case later makes true cross-seller matching valuable, this is
reopened with evidence. The design in §9.3 stays a sound design — for the goods it was written
for.

## 2026-07-31 — Which sign-in providers exist is asked of the Auth server, not baked into the build

**Context.** The panel offered "Continue with Google" unconditionally. Local Supabase ships
`[auth.external.google] enabled = false`, so on every developer machine — and on any project
where the provider was never configured — that button opened an OAuth window that could only
fail.

A build-time flag (`WXT_PUBLIC_GOOGLE_ENABLED`) would answer the question without a request.
It was rejected because it is a copy of a fact owned by the Auth server, and the failure mode
of a stale copy is the exact bug being fixed: a button that cannot work. `GET /auth/v1/settings`
returns the provider map for the publishable key, which is authoritative and needs no
maintenance.

**Consequences.** The sign-in screen makes one extra request on mount. Nothing waits for it —
email sign-in is complete and usable throughout, and Google appears afterwards if it exists.
Any failure, including offline, resolves to "google: false, email: true": a failed probe must
never remove the only way in, and must never advertise a method whose availability is unknown.

Adding a provider becomes a Supabase configuration change plus a UI branch, with no build
variable to keep in step.

## 2026-07-31 — Settings and privacy are views that replace capture, not sections below it

**Context.** The account menu previously expanded a section beneath the capture form and the
recent list. At 320px — the narrowest panel Chrome allows — that puts three concerns on one
scrolling column and pushes the primary action off the bottom.

**Consequences.** `SignedInPanel` routes between `capture`, `settings` and `privacy`. Each
subview replaces the shell, so its heading is the document's `h1` and takes focus on arrival;
leaving returns focus to the account button that opened it.

One existing assertion changed shape. `auth.spec.ts` asserted that the address and the empty
recent list were visible _at the same time_ after opening the account menu. Both are still
asserted, in the places they now occur — the recent list on the capture view, the address in
settings — plus the trip back, and that capture is hidden while settings is open. The test
covers more than it did; it no longer encodes a layout the redesign replaced.

## 2026-07-31 — Panel preferences live in extension storage, not in Postgres

**Context.** 2C adds two preferences: appearance, and which cart the panel opens on.

**Consequences.** Both are written to `chrome.storage.local` under one key. Neither is shared
data — a theme belongs to the machine it is read on, and the starting cart is a property of
this browser, not of the account. Putting them in Postgres would mean a migration, a round
trip before first paint, and a row to keep in step with `carts.is_default`.

`carts.is_default` remains the account-wide answer and is untouched by this setting: choosing
a cart here changes only where this panel starts, which is why the control says so. The stored
value is validated on read like any other untrusted input — extension storage is versionless
and writable by any past or future build.

## 2026-07-31 — The navigation owns item status; the filter row does not

**Context.** The dashboard had a Status select in its filter row. Phase 3 adds a left
navigation whose sections are Cart, Recently changed, Purchased and Archived — which is the
same field. Two controls writing one value can disagree: choose "Archived" in the nav and the
select still reads "Any status".

**Consequences.** Status is set only by the navigation. `sections.ts` holds the mapping and is
unit-tested; the filter popover carries retailer, availability, priority, on-sale and
hit-target only.

One subtlety, found by a failing test rather than by reading: `filterItems` re-applies the
status rule, and its default of "no statuses means hide archived" threw away the Archived
section's own items. The section's statuses are now passed into the query so the two stages
cannot disagree.

`Cart` deliberately means "everything except archived" rather than partitioning cleanly
against `Purchased`. Marking something purchased from a card should not make the card vanish
from under the cursor; the item appears in both places, and that is the less surprising of the
two behaviours.

## 2026-07-31 — Page-title trimming is a display rule, not an extraction change

**Context.** Stored titles carry page-title furniture — "Alcott 3-Seater Sofa & Reviews |
Wayfair". The obvious fix is to strip it during extraction.

**Consequences.** It is stripped at render instead, by `displayTitle`. The stored title stays
exactly what the page said, because that is the record of what was observed and the extractor
fixtures pin those strings; changing extraction would mean re-capturing fixtures and would put
a heuristic where the evidence should be.

The rule is conservative in one direction: the first segment is never dropped, whatever it
says, and a title that the rules would empty is returned unchanged. Losing marketing noise is
worth having; losing a product name is not. `sourceLine` follows the same principle for the
"Northwind · Northwind" case — brand and retailer are compared loosely and printed once when
they are the same fact.

## 2026-07-31 — The discount percentage is computed inside `Price`

**Context.** The old card computed `−18%` itself from `current_price` and `original_price`.
`Price` exists precisely so a range or a subscription price cannot be rendered as a discount,
and a percentage derived outside it re-opens that hole in a different place.

**Consequences.** `discountPercent` lives in the primitive and runs only on the pair that
already passed `compareDecimal`, so there is no arrangement of props that produces a
percentage without a genuine, strictly-higher list price. It returns nothing for a rounding
artefact at either end — "−0%" reads as broken and "−100%" as free.

## 2026-07-31 — Overlays are labelled groups, not `role="menu"`

**Context.** The account menu and the card overflow were first built with `role="menu"` and
`role="menuitem"`.

**Consequences.** Both roles were removed. `role="menu"` promises arrow-key navigation and
typeahead that these do not implement, and `role="menuitem"` _replaces_ the implicit button
and link roles — a screen reader stops calling a link a link. The e2e suite noticed before a
user would have: `getByRole('button', { name: 'Sign out' })` stopped matching.

They are now labelled containers of ordinary buttons and links, with Escape, outside-click and
— for the filter popover and the mobile drawer — a focus trap that restores focus to the
control that opened them.

## 2026-08-01 — A sparkline beside the observation list, and no charting library

**Context.** An earlier entry kept the price history as a list rather than a chart, on the
grounds that with three observations a sparkline would be decoration. Phase 4 has seeded data
with real shape — 98 → 94 → 92.50 → **96** → 88 → 84 → 79.95 — and that rise in the middle is
invisible in seven timestamped rows.

**Consequences.** The list stays; a sparkline is added _beside_ it, not instead of it. The
earlier reasoning was right about what a list is for — "the price dropped when I revisited" is
a question only the rows answer — and wrong that shape never matters.

It is drawn from three observations up. Two points are a straight line whatever the numbers,
and a straight line implies a trend two points cannot evidence. Below that threshold nothing
renders.

No charting library: forty lines of arithmetic in `sparkline.ts` against a dependency measured
in hundreds of kilobytes. The SVG is `aria-hidden` — every number it encodes is in the four
figures above it and the list below, so a screen reader gains nothing from the path and would
have to sit through it.

Points are spaced by index, not by elapsed time. Observations happen when the user revisits, so
a time axis would render most of the width as the gap between two visits and crush every real
move against the right edge. Even spacing answers the question actually being asked — how has
this moved across the times I looked — and does not pretend to be a continuous record of a
price nobody was watching.

## 2026-08-01 — Green on a target means an observation recorded it

**Context.** The desired price now has a visual treatment: a bar, a badge, and the distance to
go.

**Consequences.** The badge is green in exactly one case — an observation recorded the price at
or below the target. Not "close to", not "likely to reach". Green is the strongest signal this
product has and it stops meaning anything the first time it appears without that having
happened.

`targetState` describes _now_; `targetEverReached` describes the whole observed run, and they
are deliberately separate functions. "It has been at or below your target before" is a real and
useful fact, and folding it into the current state would let a green badge survive a price
rise.

Everything is arithmetic on two stored numbers. No forecast, no "similar items are cheaper" —
the product has no evidence for either.

## 2026-08-01 — One live region for everything the dashboard says back

**Context.** Confirmations were scattered: an inline `role="alert"` paragraph for a failed
write, two near-identical fixed divs for undo and for delete, and nothing at all for a
successful save.

**Consequences.** One `Announcements` component owns the region. Failures are assertive and
persist until replaced — a message that vanishes on a timer is one the user may never have
seen, and "your change did not save" needs attention now. Confirmations are polite and expire.
An action lives _inside_ the region so "Archived — Undo" is announced as one thing.

`Toast` gains an `announce` flag, the same one `Callout` got in 2B and for the same reason:
the region is mounted once and toasts are swapped inside it, so a toast that is also its own
`status` role makes a screen reader say the message twice and makes `getByRole('status')` match
twice.

## 2026-08-02 — Composition lands, raw, now that comparison has a consumer for it

**Decision.** `product.composition` becomes a real capture field and an `items.composition`
column — a **raw** string, read from where it was being dropped, stored without
normalization. The extractors collect it; the compare view renders it as a descriptive,
non-comparable row.

**Context.** The 2026-07-27 entry deferred this field on two grounds: no consumer yet, and
"guessing its shape now, with no consumer, is how a field ends up wrong in a way that later
needs a migration." The first ground is gone — `compareItems` exists
(`apps/web/src/features/compare/`), and "is the expensive one actually merino" is exactly a
row it can carry. The second is respected rather than overruled: we store the string exactly
as the page published it — "100% cotton", "Shell: 100% wool; Lining: 52% polyester" — and do
**no** normalization. Normalizing "100% merino wool" and "Merino Wool 100%" into a comparable
form is still the deferred work; a raw string needs no schema decision and no later migration
to correct, because it makes no claim beyond what the page said.

Source: schema.org `Product.material` and the `additionalProperty` spec rows the
`isOptionName` filter currently discards — Zara's `Material` and `OUTER SHELL`, H&M's
`Material`. Labelled parts keep their labels ("Outer shell: 100% cotton") so a two-part
composition stays legible; a bare `material` label contributes just its value.

**Consequences.** Composition is a **retailer-observed** field — it describes the garment,
not a user choice — so the `reject_observed_field_writes` trigger protects it and a client
cannot write it, exactly like price or availability. It is emphatically **not** in
`selectedVariant` (it would corrupt the fingerprint, the whole point of the 07-27 entry) and
not in `identifiers`. In the compare structure it is `comparable: false`: two garments being
"100% cotton" is a genuine shared fact, but until the strings are normalized the tool cannot
assert that "100% cotton" and "Cotton 100%" agree, and asserting it on raw strings would
fabricate a match. Non-comparable is the honest setting until normalization lands.

## 2026-08-02 — A former price farther than adjacency, gated on a cue word, not on distance

**Decision.** `struckOriginalForValue` gains a third path, `struckCueOriginalNear`: a struck
former price up to four wrappers above the current price is admitted, but only when a
former-price cue word ("was", "original", "regular", "list", "rrp", "before", "reduced")
stands immediately before it in the enclosing text. `STRUCK_PRICE_HOPS` stays at two; the
wider reach lives only in the cue-gated path.

**Context.** The D1 re-run confirmed Nike but found Wayfair still returning no former price
against a real current price of 672.96. The page renders "$672.96 was $993.97" with the
struck $993.97 three parent hops above the current price — one hop past `struckPriceNear`'s
two-hop margin, so bare adjacency never reaches it. The obvious fix, raising
`STRUCK_PRICE_HOPS` to three, was rejected on the local host's evidence: a third hop on a
deeply nested price block reaches the container that also holds a sponsored tile with its own
strikethrough, which is exactly the leak the two-hop margin was chosen to prevent. Distance
alone cannot tell Wayfair's real former price from a neighbour's.

**Consequences.** The discriminator at this range is the cue word, not proximity — a genuine
"$672.96 was $993.97" carries it and a sponsored tile beside it does not. So the extended
path requires three signals together: the candidate must be rendered struck, a cue word must
immediately precede it, and it must be strictly greater than the current price. That triple
gate is deliberately narrow; missing a distant, uncued former price under-reports, which is
the project's stated safe direction, while attaching a neighbour's does not. The tight
two-hop path keeps working with no cue requirement, because adjacency is its own
discriminator there. This is the sixth instance of a green suite proving less than it
appeared — the rule that "matched the right markup and was never called" was reachable on
Nike but not on Wayfair, one page deeper — and closing it needed a live re-run, not a unit
pass, to surface. Reachability on the real Wayfair page still needs a live capture to
confirm; the offline scorer sees the semantic strike but not the class-based one.

## 2026-08-03 — A comparison is a URL, and it renders as a table

**Decision.** The compare view is a route, `/app/compare?items=a,b,c`, and the selected ids
live in that query string rather than in component state. It renders as an HTML `<table>`.

**Context.** BUILD_PLAN.md §12.1 already listed the route; this records why it is the right
shape rather than a modal over the dashboard. A comparison is a thing you send someone, come
back to after a refresh, and expect the back button to undo. All three fall out of the URL
for free and none of them survive `useState`. The ids are therefore untrusted input:
`parseSelection` validates uuid shape, collapses duplicates and caps the list before a query
is built, and RLS is the second gate — a well-formed id belonging to another account returns
no row, which the page reports as "no longer available to you" rather than an empty table.

A `<table>` because the content is genuinely tabular: every cell means "this item's value for
this attribute". The element gives row and column header association, so a screen reader
announces "Price, Meridian Wool Runner, $79.95" without any ARIA at all. Rebuilding that over
a grid of divs would be more code doing the same job worse. Four columns cannot fit a phone,
so the table scrolls inside its own box with the label column sticky; the page itself never
scrolls sideways, which the e2e asserts at four widths.

**Consequences.** The scroll container is `position: relative`, and that is load-bearing:
`overflow` only clips an absolutely positioned descendant when the scroll box is also its
containing block, and `.uc-sr-only` is absolutely positioned. Without it every
screen-reader-only span in the off-screen part of the table resolved against the viewport,
escaped the clip, and stretched the document to 856px at a 375px viewport — a page that
scrolled sideways because of text nobody can see.

---

## 2026-08-03 — Selecting items to compare is a checkbox, not an action

**Decision.** The control that adds a product to a comparison is a checkbox at the start of
the row and card, not a button in the action cluster beside "Details" and "Move to cart".

**Context.** It was a button first, and the dashboard measurably regressed: at 1024px — a
laptop minus the 240px rail — a fifth control in the actions cluster took enough width from
the grid to wrap product titles onto two lines and collide the price column with the
freshness line. That is the same squeeze the 2026-07-31 entry fixed by moving the variant out
of its own column, reintroduced from the other end.

The deeper reason is that selection is not an action. An action is a thing you do to one item
now; a selection is a state you set on several items before doing one thing with all of them,
and a leading checkbox is where people already look for it.

**Consequences.** The list's leading column is 3.5rem, which fits a checkbox but not the word
"Compare", so the label is visually hidden there and shown on cards, where there is room. The
accessible name always carries the product title — "Compare" repeated four times down a list
tells a screen-reader user nothing about which row they are on. The dashboard gains bottom
padding while the tray is open, so the last product is not permanently underneath the control
being used to choose products.

## 2026-08-03 — Shared-cart invitations are hashed bearer tokens, not email-bound

**Decision.** An invitation is a **bearer token**: `create_cart_invitation` mints 256 bits of
randomness, stores only its SHA-256 hash, and returns the raw token once; `accept_cart_invitation`
hashes a presented token and redeems it. `email` on the row is informational, never an access
check — whoever holds the link can accept. Single-use (`accepted_at` under a row lock) and
expiry are the controls that make that safe.

**Context.** The obvious alternative is email-bound acceptance: the accepter's `auth.email()`
must equal the invitation's email. It was rejected for the friends-scale MVP. The inviter would
have to know the exact address the friend signs in with — Google and magic-link can differ — and
a mismatch is a dead end with no security gain over a single-use, expiring, 256-bit token. A
bearer link is also what "share a cart with a friend" actually means to the user.

**Consequences.** Because the link is a bearer capability, the token is never stored in a
replayable form (hash only), redemption is single-use and expiry-checked, and the invitee needs
no direct read on `cart_invitations` — acceptance is a SECURITY DEFINER RPC, and the table has no
update grant so a client cannot forge `accepted_*` or un-expire a row. The membership grant is
**escalate-only**: `cart_role` is declared `owner < editor < viewer`, so `least(existing, invited)`
keeps the more-privileged role — an owner testing their own link stays owner, an editor is not
demoted by a viewer invite. `owner` is unrepresentable as an invited role in three places (a
CHECK constraint, the create RPC, and the Zod contract), because ownership is `carts.owner_id`
and immutable. Email-bound acceptance and a `security_events` audit table (§17.5) are recorded as
deferred, not built — the audit table waits for a second reason to exist rather than being added
speculatively here.

## 2026-08-03 — Wayfair and Amazon get brand adapters, and win their price back

**Decision.** Add `wayfair` and `amazon` as brand adapters (priority 96, beside `stockx`), each
scoped to its US `.com` storefront. Both retailers were the standing "extracts no price at all"
blockers (docs/STATUS.md): they publish **no Product JSON-LD**, so the structured-data tier has
nothing to read, and the generic DOM heuristics do not recognise their markup.

**Context.** The live-capture pass left Amazon and Wayfair missing a price, and the D1 re-run
confirmed the Wayfair cue-gated former-price fix was correct but unreachable — no tier handed it
a current price. A brand adapter is the sanctioned answer (§10.6, §10.7) when a site runs its own
front end with stable hooks, and the local host's fixtures pinned the two traps that make a naive
adapter wrong:

- **Wayfair's `[data-test-id="PriceDisplay"]` is not unique** — ~36 per page, most sponsored. The
  adapter scopes every read to `[data-node-id^="ListingPricing::"]` (1 per listing) and reads
  SALE/PRIMARY/PREVIOUS inside it; a sponsored decoy at $940/$1,610 in the fixture fails any
  regression to the broad selector.
- **Amazon's price is the selected swatch's**, not the first — every price lives in the colour
  twister and the buy box is empty. The adapter reads `.a-button-selected`, corroborated by a
  core-price widget whose `data-csa-c-asin` matches the URL's `/dp/` child ASIN, and keeps that
  child ASIN as `productId` so the parent canonical cannot collapse colours into one item.

**Consequences.** Each adapter asserts **USD** on its US storefront — a bare `$` is ambiguous and
`normalizePrice` rightly refuses to resolve it, but the adapter knows the retailer — and both
decline non-`.com` TLDs rather than mis-price them. The committed fixture captures carry the
pipeline's `www`-stripped `domain`/`canonicalUrl`: `www.` stripping is established normalization
for cross-visit dedup (`normalize-url.ts`, `normalizers/text.ts`), and the hand-written truth's
`www.` prefix was corrected to match it — the one place the pipeline is authoritative over the
truth sidecar, because URL normalization is the pipeline's policy, not an adapter-produced fact.
Reachability on the real pages still wants a live re-run; the offline fixtures prove the selectors
and the traps, not the client-side rendering.

**Follow-up (2026-08-03, live re-run).** Both adapters landed their price on the real pages, and
the run caught one regression the fixtures had missed: **Wayfair's image**. `img[data-hb-id=
"FixedImage"]` is non-unique the same way `PriceDisplay` is — ~62 per page — and the first in
document order is a 36×36 "Wayfair Verified" trust badge (`default_name.jpg`). A `querySelector`
returns that badge; it is non-null, so the `?? og:image` fallback never ran and the wrong image
won silently. `score:live` only checks the image is non-null, so it read green. The fix reads the
image from `og:image` — Wayfair's declared primary listing image, which is the hero and is what
the generic pipeline already produces without the adapter — and both fixtures now ship the badge
ahead of the hero, so a regression to the DOM selector fails. The lesson generalises the price
trap: **a non-unique selector whose first match is wrong needs a fixture decoy for every field it
touches, not only the one that first bit.** The image is now the one field this adapter sources
from a meta tag rather than a DOM hook, because the DOM hook has no unique form.

## 2026-08-03 — SSRF-safe fetch uses `ipaddr.js`, and a new `@universal-cart/refresh` package

**Decision.** Phase 7's background refresh needs a server-side fetcher that cannot be turned into
an SSRF primitive (BUILD_PLAN.md §17.3). The IP-range classification at its core uses the
`ipaddr.js` library (a small, zero-dependency, widely-used package) rather than hand-rolled range
checks, and the refresh logic lives in a new pure package, `@universal-cart/refresh`.

**Context.** The one genuinely dangerous line in an SSRF filter is "is this address private?" —
and IPv6, IPv4-mapped IPv6 (`::ffff:169.254.169.254`), unique-local (`fc00::/7`), and link-local
(`fe80::/10`) are exactly where a hand-written check grows a hole that a live test may not probe.
`ipaddr.js` classifies all of these correctly (`.range()` → `unicast` is the only category we
allow out) and unwraps IPv4-mapped addresses via `.toIPv4Address()`. It is the responsible choice
for security-critical parsing, and per §23.2 a new dependency gets this ADR. The `packages/refresh`
home keeps the classifier (7a) and the fetcher (7b) as pure, framework-free logic that both the
web app and a future Edge Function import, consistent with the `contracts`/`extractors` boundary.

**Consequences.** `safeFetch` allows only http/https; requires the host to resolve to a public
unicast address; follows redirects manually and re-validates every hop (a redirect to the metadata
IP is refused exactly like a direct request); caps response size, redirect count, and time; and
never sends cookie or authorization headers. The DNS resolver and fetch implementation are
injectable so the redirect/size/timeout orchestration is unit-tested deterministically without a
network — 18 unit tests. The remaining residual risk is DNS rebinding (resolve-public-then-connect
races the address it validated); the fetcher resolves-and-checks rather than pinning the resolved
IP into the connection, which is documented in the module and left for the live-network hardening
the local host owns. Real-network behaviour against the private ranges is that live check.

## 2026-08-03 — The background-refresh worker is a Vercel Node route, driven by Supabase Cron

**Decision.** Phase 7's worker (7e) runs as a Next.js Route Handler on the Node runtime
(`apps/web/src/app/api/refresh`), invoked by Supabase Cron via `pg_net`. It is **not** a Supabase
Edge (Deno) Function.

**Context.** The worker fetches a page and runs the extractor pipeline over its HTML. Both
`safeFetch` and the extractors are written and tested for Node: `safeFetch` resolves DNS through
`node:dns` to reject private addresses, and the pipeline expects a DOM. A Deno Edge Function would
introduce `node:dns` compatibility gaps and a different DOM — neither of which the code was
verified against — whereas a Node route reuses exactly the tested runtime, and the service-role
key already lives in the web app's Vercel environment. The server DOM is `linkedom` (a small, fast
HTML parser); a new dependency, hence this ADR.

**Consequences.** The worker is authorised only by the `CRON_SECRET` bearer and touches the
database only through the service-role RPCs (`select_due_refresh_jobs`,
`record_background_observation`, `record_notification`, `record_refresh_result`). The schedule is
per-environment config — a worker URL and a secret — so it lives in Supabase Vault plus a
`cron.schedule` call documented in the RunBook, not in a migration (a URL and a secret do not
belong in version control). `linkedom`'s fidelity to the extractors' DOM expectations is the local
host's live check; the orchestration is unit-tested with injected I/O. Enrolling items into
`refresh_jobs` (`enqueue_refresh_job` from the save path) is a deliberate follow-up.
