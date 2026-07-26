# Universal Cart — Implementation and Deployment Plan

## 0. Executive decision

Build **Universal Cart** as a cloud-synced shopping list with a browser extension, not as a system that attempts to control or mirror every retailer's native cart.

The first useful product is:

1. A Chrome extension that extracts the product currently being viewed.
2. A persistent side panel where the user can preview, edit, and save that product.
3. A web app that syncs the saved products across devices and lets users compare them.
4. A price and availability observation system that updates items when they are revisited and, later, refreshes public pages in the background where that is reliable.
5. Shared carts for a small group of friends.

The project should **not** begin with universal checkout, retailer account automation, bulk scraping, or AI-generated shopping recommendations. Those features add brittleness before the core data pipeline is trustworthy.

---

## 1. Product contract

### 1.1 Product promise

A user can browse almost any product page, click one button, and save a clean, editable record containing:

- Product title
- Current price and currency
- Original/list price when available
- Main image
- Retailer and source URL
- Availability
- Selected variant, such as size, color, storage, material, or style
- Quantity, notes, priority, and desired price

That record appears immediately in the extension and web app. The user can compare it with products saved from other websites and see whether the price or stock status changed since it was saved.

### 1.2 What “universal” means

“Universal” means the product can ingest items from many sites through a layered extraction engine:

1. Retailer-specific adapter
2. Schema.org Product/Offer structured data
3. Open Graph and product meta tags
4. Generic DOM heuristics
5. User correction when extraction is uncertain

It does **not** mean every website will expose every field automatically. The interface must make partial extraction graceful rather than pretending all data is reliable.

### 1.3 What “synced” means

For the first version, sync has three levels:

- **Cloud sync:** saved items, edits, notes, and status changes are synchronized between the extension and web app.
- **Passive retailer sync:** when the user revisits a saved product, the extension re-observes its price, stock status, and selected variant.
- **Background refresh:** later, public product pages that can be fetched reliably are checked on a schedule. Sites requiring an authenticated browser session or JavaScript rendering remain “browser refresh required.”

### 1.4 Product states

Each item has one of these states:

- `saved`: interested, but not actively buying
- `cart`: actively considering or planning to purchase
- `purchased`: bought
- `archived`: intentionally hidden without deleting history

The default state after capture is `saved`. Moving an item to `cart` should be a deliberate action.

---

## 2. MVP scope

The MVP is complete when the following end-to-end flow works reliably:

1. User signs in on the web app and extension.
2. User visits a product page.
3. User opens the extension side panel or invokes a keyboard shortcut.
4. The extension extracts product metadata.
5. The user sees a preview and can correct any field.
6. The user saves the product to a cart.
7. The item appears in both the extension and web app without a manual reload.
8. Re-saving the same URL and variant updates the existing item instead of silently creating a duplicate.
9. Revisiting the page records a new observation if price or availability changed.
10. A user can compare two to four saved items and open the retailer pages to purchase them.

### 2.1 MVP features

- Google sign-in and email magic link fallback
- One default personal cart
- Chrome extension using Manifest V3
- Side-panel UI with popup fallback
- Generic product extraction
- JSON-LD Product/Offer parser
- Open Graph and product meta parser
- Manual field correction
- Product image, title, price, currency, retailer, URL, availability, selected variant
- List and card views in the web app
- Search, sort, and filters
- Quantity, notes, priority, desired price, and item status
- Optimistic updates and undo for destructive actions
- Real-time cloud sync
- Price and availability history
- Stale-data indicator
- “Open at retailer” and “Open all by retailer” actions
- Basic sharing with invited friends after the single-user flow is stable

### 2.2 Explicit non-goals for the MVP

- Universal payment or checkout
- Automatically placing items in native retailer carts
- Storing retailer passwords, cookies, or sessions
- Reading the user’s full browsing history
- Automatic purchase execution
- Browser automation against checkout pages
- Coupon discovery or affiliate monetization
- Scraping reviews at scale
- Native mobile apps
- Safari extension
- Recommendation feeds
- AI chat before deterministic extraction works
- Microservices
- Kubernetes

---

## 3. Recommended architecture

```text
┌──────────────────────────────┐
│ Retailer product page        │
│ DOM + JSON-LD + metadata     │
└──────────────┬───────────────┘
               │ explicit user action
               ▼
┌──────────────────────────────┐
│ Browser extension            │
│ WXT + React + MV3            │
│                              │
│ Content script               │
│  - extract                   │
│  - score confidence          │
│  - collect evidence          │
│                              │
│ Side panel                   │
│  - preview/edit              │
│  - save                      │
│  - recent cart items         │
│                              │
│ Service worker               │
│  - auth/session              │
│  - messaging                 │
│  - retries                   │
└──────────────┬───────────────┘
               │ authenticated Supabase client / RPC
               ▼
┌──────────────────────────────┐
│ Supabase                     │
│ Postgres + Auth + RLS        │
│ Realtime + Cron later        │
│                              │
│ ingest_capture RPC           │
│ tables and observations      │
└──────────────┬───────────────┘
               │ realtime changes
               ▼
┌──────────────────────────────┐
│ Next.js web app              │
│ dashboard + compare + share  │
└──────────────────────────────┘

Later:
Supabase Cron -> refresh queue -> worker/Edge Function -> public page fetch
```

### 3.1 Why this architecture

- The extension observes the rendered page in the user’s browser, which is more reliable than trying to render every commerce site on a server.
- The user explicitly invokes extraction, allowing minimal browser permissions.
- Supabase provides one small-project platform for authentication, Postgres, row-level authorization, and real-time updates.
- Next.js on Vercel minimizes deployment work for the dashboard.
- WXT keeps extension build and publishing logic manageable and provides a path to Firefox later.
- A monorepo lets the extension and web app share types, validation, extraction logic, and UI primitives without publishing internal packages.

### 3.2 No microservices initially

Use one repository containing:

- One web app
- One extension
- Shared packages
- One Supabase project
- Optional background worker added only when scheduled refresh becomes necessary

Do not create separate services for auth, notifications, extraction, or matching during the MVP.

---

## 4. Technology choices

### 4.1 Repository and package management

- `pnpm` workspaces
- Turborepo for task orchestration and caching
- TypeScript in strict mode
- Node.js LTS version pinned in `.nvmrc` or `.tool-versions`
- Lock all dependency versions through `pnpm-lock.yaml`

### 4.2 Web app

- Next.js App Router
- React
- Tailwind CSS
- shadcn/ui-style local components, not a runtime dependency on a hosted component system
- Supabase SSR helpers for the web session
- React Server Components for read-heavy dashboard pages
- Client components only for interactions, real-time subscriptions, comparison tray, and optimistic updates
- Zod for request and payload validation
- `Intl.NumberFormat` for currency display

### 4.3 Browser extension

- WXT
- React
- Manifest V3
- Chrome Side Panel API as the main interface
- Popup fallback where a side panel is unavailable
- `activeTab`, `scripting`, `storage`, `sidePanel`, `contextMenus`, and optionally `alarms`
- No `<all_urls>` permission in the first release
- Optional host permissions only when the user explicitly enables automatic refresh for a retailer
- Supabase client with a custom storage adapter backed by extension storage

### 4.4 Backend and database

- Supabase Postgres
- Supabase Auth
- Row Level Security on every user-facing table
- Supabase Realtime for item changes
- Supabase SQL migrations committed to the repository
- Database functions for atomic capture ingestion
- Supabase Cron and Queues only when scheduled refresh is implemented

### 4.5 Testing

- Vitest for unit tests
- Playwright for web end-to-end tests
- Playwright persistent Chromium context for extension end-to-end tests
- HTML fixtures for extractor tests
- SQL tests or migration verification for RLS and database functions

### 4.6 Deployment

- GitHub repository
- Vercel for the web app
- Hosted Supabase for production
- Chrome Web Store private/unlisted testing release for friends
- WXT zip and submit commands for extension releases
- GitHub Actions for checks and release packaging

---

## 5. Monorepo layout

```text
universal-cart/
├── AGENTS.md
├── CLAUDE.md
├── README.md
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── .env.example
├── .gitignore
├── .nvmrc
│
├── apps/
│   ├── web/
│   │   ├── src/app/
│   │   ├── src/components/
│   │   ├── src/features/
│   │   ├── src/lib/supabase/
│   │   ├── src/lib/auth/
│   │   └── tests/
│   │
│   └── extension/
│       ├── entrypoints/
│       │   ├── background.ts
│       │   ├── content.ts
│       │   ├── sidepanel/
│       │   └── popup/
│       ├── components/
│       ├── lib/auth/
│       ├── lib/messaging/
│       └── tests/
│
├── packages/
│   ├── contracts/
│   │   ├── capture.ts
│   │   ├── item.ts
│   │   ├── auth.ts
│   │   └── database.ts
│   │
│   ├── extractors/
│   │   ├── core/
│   │   ├── generic/
│   │   ├── adapters/
│   │   ├── normalizers/
│   │   └── fixtures/
│   │
│   ├── ui/
│   ├── config/
│   └── test-utils/
│
├── supabase/
│   ├── config.toml
│   ├── migrations/
│   ├── seed.sql
│   ├── functions/
│   └── tests/
│
├── docs/
│   ├── BUILD_PLAN.md
│   ├── ARCHITECTURE.md
│   ├── DATA_MODEL.md
│   ├── EXTRACTION.md
│   ├── SECURITY.md
│   ├── DECISIONS.md
│   ├── STATUS.md
│   └── RUNBOOK.md
│
└── .github/
    └── workflows/
        ├── ci.yml
        ├── extension-release.yml
        └── database-check.yml
```

### 5.1 Package boundaries

`packages/contracts`
- Serializable types only
- Zod schemas
- No framework imports
- Version every network/storage payload with `schemaVersion`

`packages/extractors`
- Pure extraction and normalization logic
- No Supabase calls
- No React
- No extension storage
- DOM-facing functions may accept a `Document`, but their outputs must be serializable

`packages/ui`
- Shared presentational components only
- No direct data fetching
- Avoid sharing entire page-level components between extension and web app

---

## 6. Core data contract

### 6.1 Capture payload

The extension produces a `ProductCaptureV1` object.

```ts
export type ProductCaptureV1 = {
  schemaVersion: 1;
  source: {
    url: string;
    canonicalUrl: string | null;
    domain: string;
    retailerName: string;
    pageTitle: string | null;
  };
  product: {
    title: string | null;
    brand: string | null;
    description: string | null;
    imageUrls: string[];
    selectedImageUrl: string | null;
    identifiers: {
      sku?: string;
      gtin?: string;
      mpn?: string;
      productId?: string;
    };
  };
  offer: {
    priceAmount: string | null;
    originalPriceAmount: string | null;
    currency: string | null;
    availability: 'in_stock' | 'out_of_stock' | 'preorder' | 'backorder' | 'unknown';
  };
  selectedVariant: Record<string, string>;
  evidence: Array<{
    field: string;
    source: 'adapter' | 'json_ld' | 'meta' | 'dom' | 'user';
    selector?: string;
    confidence: number;
  }>;
  extraction: {
    extractorId: string;
    extractorVersion: string;
    overallConfidence: number;
    observedAt: string;
  };
};
```

### 6.2 Design rules for captures

- Prices are decimal strings, never JavaScript floating-point numbers.
- Currency is an ISO 4217 code when known.
- Preserve both `source.url` and `canonicalUrl`.
- Do not put cookies, HTML, access tokens, or page-local personal data in the payload.
- Do not store a full DOM snapshot in production.
- Evidence is field-level so the UI can explain uncertainty and tests can diagnose regressions.
- `selectedVariant` stores only currently selected options, not every variant on the page.
- Unknown values are `null` or explicit `unknown`, not invented defaults.

---

## 7. Initial database model

Keep the MVP schema small. Add catalog-wide canonical products only after real product data demonstrates the need.

### 7.1 `profiles`

- `id uuid primary key references auth.users`
- `display_name text`
- `avatar_url text`
- `default_currency text`
- timestamps

### 7.2 `carts`

- `id uuid primary key`
- `owner_id uuid not null`
- `name text not null`
- `description text`
- `default_currency text`
- `is_default boolean`
- timestamps

### 7.3 `cart_members`

- `cart_id uuid`
- `user_id uuid`
- `role enum('owner','editor','viewer')`
- timestamps
- unique `(cart_id, user_id)`

### 7.4 `items`

- `id uuid primary key`
- `cart_id uuid not null`
- `created_by uuid not null`
- `status enum('saved','cart','purchased','archived')`
- `source_url text not null`
- `canonical_url text`
- `domain text not null`
- `retailer_name text not null`
- `title text not null`
- `brand text`
- `description text`
- `image_url text`
- `currency text`
- `current_price numeric(20,6)`
- `original_price numeric(20,6)`
- `availability enum(...)`
- `selected_variant jsonb not null default '{}'`
- `identifiers jsonb not null default '{}'`
- `quantity integer not null default 1`
- `note text`
- `priority enum('low','normal','high')`
- `desired_price numeric(20,6)`
- `fingerprint text not null`
- `extractor_id text`
- `extractor_version text`
- `extraction_confidence real`
- `last_observed_at timestamptz`
- timestamps

Indexes:

- `(cart_id, status, updated_at desc)`
- `(cart_id, fingerprint)`
- `(domain)`
- `(created_by)`
- GIN on `selected_variant` only if queries need it

Uniqueness:

- Partial unique index on `(cart_id, fingerprint)` for non-archived items, unless product behavior indicates that users need deliberate duplicates.

### 7.5 `item_observations`

- `id bigint generated always as identity`
- `item_id uuid not null`
- `observed_at timestamptz not null`
- `price numeric(20,6)`
- `original_price numeric(20,6)`
- `currency text`
- `availability enum(...)`
- `source enum('capture','revisit','manual','background')`
- `extractor_id text`
- `extractor_version text`
- `confidence real`

Indexes:

- `(item_id, observed_at desc)`

Do not insert an observation if all tracked fields are unchanged and the previous observation is recent. Update `last_observed_at` instead.

### 7.6 `cart_invitations`

Add only during the sharing phase.

- `id uuid`
- `cart_id uuid`
- `email text`
- `role`
- `token_hash text`
- `expires_at`
- `accepted_at`
- timestamps

### 7.7 Later tables

Only add these after the MVP:

- `product_groups`
- `product_group_members`
- `match_candidates`
- `refresh_jobs`
- `notification_rules`
- `notification_events`
- `extractor_health`

---

## 8. Row Level Security model

All exposed tables must have RLS enabled.

### 8.1 Authorization rules

A user may read a cart if:

- They own it, or
- They have a `cart_members` row for it

A user may edit an item if:

- They are the owner, or
- Their membership role is `editor`

A viewer can read but not write.

A user can only create an item in a cart they can edit.

A user cannot change `created_by` to another user.

### 8.2 Required RLS tests

- Anonymous user cannot read any cart or item.
- User A cannot read User B’s private cart.
- User A cannot insert an item into User B’s cart.
- Editor can insert and update but cannot delete the cart.
- Viewer cannot modify items.
- Removing membership immediately removes access.
- Service-role credentials never appear in client bundles.

### 8.3 Atomic ingestion function

Implement a database function such as `ingest_product_capture(payload jsonb, cart_id uuid, user_fields jsonb)` that:

1. Validates the authenticated user.
2. Confirms edit access to the cart.
3. Validates and normalizes required fields.
4. Computes or verifies the fingerprint.
5. Finds an existing active item with the same fingerprint.
6. Inserts or updates the item.
7. Inserts an observation only when tracked values changed or enough time passed.
8. Returns the canonical saved item and whether it was created or updated.

Prefer a transaction inside Postgres rather than several client-side writes.

---

## 9. Product fingerprinting and duplicate behavior

### 9.1 MVP fingerprint

Create a deterministic SHA-256 hash from:

```text
normalized canonical URL
+ normalized selected variant key/value pairs
+ normalized primary product identifier when available
```

URL normalization should:

- Lowercase the hostname
- Remove fragments
- Remove common tracking parameters such as `utm_*`, `gclid`, and affiliate ref parameters
- Preserve parameters that identify a variant or product
- Sort query parameters
- Preserve the original source URL separately

### 9.2 Duplicate behavior

When a duplicate is detected:

- Update price, image, availability, and observation time.
- Preserve the user’s note, priority, desired price, and status.
- Show “Already saved — details refreshed.”
- Offer “Increase quantity” as a separate action rather than doing it silently.

### 9.3 Cross-retailer matching later

Use this order:

1. Exact GTIN/UPC/EAN
2. Brand + MPN/model number
3. Retailer product identifier mapping
4. Normalized brand/title/model similarity
5. Image perceptual hash
6. Embedding or LLM-assisted candidate scoring
7. User confirmation for medium-confidence matches

Never auto-merge uncertain items. False merges are more harmful than duplicate cards.

---

## 10. Extraction engine

### 10.1 Adapter interface

```ts
export interface ProductExtractor {
  id: string;
  version: string;
  priority: number;
  supports(context: ExtractionContext): boolean;
  extract(context: ExtractionContext): Promise<PartialCapture>;
}
```

An extractor returns field values with evidence and confidence, not a fully trusted item.

### 10.2 Extraction pipeline

1. Build page context.
2. Run a matching retailer adapter when available.
3. Parse JSON-LD.
4. Parse product meta and Open Graph tags.
5. Run generic DOM heuristics.
6. Merge candidate fields using source priority and confidence.
7. Normalize values.
8. Validate the final capture.
9. Show a correction UI if required fields are missing or low confidence.

### 10.3 JSON-LD parser requirements

- Parse every `script[type="application/ld+json"]` block.
- Handle invalid whitespace and recoverable trailing characters safely.
- Handle objects, arrays, and `@graph`.
- Locate nodes whose `@type` includes `Product`.
- Handle `Offer`, arrays of offers, and `AggregateOffer`.
- Prefer the offer matching the selected SKU/variant when evidence exists.
- Parse brand as a string or object.
- Parse image as a string, object, or array.
- Parse availability URLs into an internal enum.
- Treat structured data as evidence, not absolute truth.

### 10.4 Meta fallback

Read, where available:

- `og:title`
- `og:image`
- `og:url`
- `product:price:amount`
- `product:price:currency`
- `product:availability`
- `twitter:title`
- `twitter:image`
- canonical link

### 10.5 Generic DOM heuristics

Use conservative heuristics. Avoid selecting the first number that resembles a price.

Signals include:

- `itemprop="price"`
- `data-price`
- visible currency symbols near “price” labels
- selected variation controls
- disabled or active add-to-cart buttons
- headings near product image galleries
- accessibility labels for size/color selectors

Every heuristic must provide evidence and confidence.

### 10.6 Selected variant extraction

Look for:

- Selected `<option>` elements
- Elements with `aria-checked="true"`
- Pressed or selected buttons
- Inputs with checked state
- Labels adjacent to “Color,” “Size,” “Style,” “Storage,” “Material,” and similar option names
- URL variant parameters
- Retailer-specific page state in an adapter

Present the detected variant to the user before saving.

### 10.7 Retailer adapters

Do not start with a long speculative list. Add adapters based on the actual sites used by the project’s users.

For each adapter:

- Store it in source control.
- Give it an explicit version.
- Add at least two sanitized HTML fixtures.
- Add tests for title, price, image, availability, and selected variant.
- Record field-level evidence.
- Fall back to the generic pipeline when selectors stop matching.

Extension logic must be bundled. Do not download executable extraction code or evaluate remote strings.

### 10.8 Extraction preview UI

Before save, display:

- Image
- Editable title
- Price and currency
- Availability
- Variant chips
- Destination cart
- Quantity
- Optional note

Mark uncertain fields with a subtle warning rather than blocking the user.

---

## 11. Extension architecture

### 11.1 Content script responsibilities

- Inspect the current page only after an explicit user action.
- Run extractors.
- Return a serializable capture.
- Never read or transmit cookies.
- Never record unrelated page text.
- Avoid permanent DOM mutation.

### 11.2 Service worker responsibilities

- Coordinate messages between the content script and side panel.
- Hold no critical in-memory state because MV3 workers can stop.
- Persist retryable actions in extension storage.
- Manage Supabase session refresh.
- Handle context-menu and keyboard shortcut events.
- Open the side panel after an explicit user gesture.

### 11.3 Side panel responsibilities

- Show extraction state.
- Allow corrections.
- Save through the ingestion function.
- Show recent cart items.
- Show success, duplicate-refresh, and error states.
- Remain useful while navigating between tabs.

### 11.4 Authentication

Use Supabase authentication in the extension with a storage adapter backed by extension local storage.

Recommended Google flow:

1. Generate a PKCE OAuth URL without automatically redirecting the extension page.
2. Use the browser identity authorization flow.
3. Use the extension redirect URL.
4. Exchange the returned authorization code for a Supabase session.
5. Store only the Supabase session in extension-local storage.
6. Support sign-out and session recovery.

The extension bundle may contain the Supabase project URL and publishable key. It must never contain a service-role key or provider client secret.

### 11.5 Permission strategy

Initial manifest permissions:

- `activeTab`
- `scripting`
- `storage`
- `sidePanel`
- `contextMenus`
- `identity` when required by the auth implementation

Add `alarms` only when the extension needs local scheduled maintenance.

Do not request broad host access at install. If a future feature needs domain-level refresh, request optional host access at the moment the user enables that feature.

### 11.6 Offline and retry behavior

If save fails because the network is unavailable:

- Store a pending mutation in extension local storage.
- Show “Saved locally — will sync when online.”
- Retry with exponential backoff.
- Include an idempotency key so retries cannot create duplicates.
- Let the user discard a pending mutation.

---

## 12. Web app experience

### 12.1 Primary routes

- `/` landing or redirect
- `/login`
- `/app`
- `/app/cart/[cartId]`
- `/app/compare?items=...`
- `/app/settings`
- `/invite/[token]`
- `/privacy`

### 12.2 Dashboard

The dashboard should prioritize saved products, not analytics.

Required components:

- Cart switcher
- Search
- Filters for status, retailer, availability, priority, and price change
- Sort by recently added, last updated, current price, price change, and priority
- Card/list view toggle
- Comparison selection
- Empty-state instructions for installing the extension

### 12.3 Item card

Show:

- Image
- Title
- Retailer
- Current price
- Price-change indicator
- Availability
- Selected variant
- Last checked time
- Note preview
- Priority
- Open-retailer action
- Quick status change
- Compare checkbox

### 12.4 Item detail drawer or page

Show:

- Full metadata
- Editable user fields
- Source and canonical URLs
- Price history
- Observation history
- Extraction confidence and last extractor version in a diagnostics section
- Archive/delete controls

### 12.5 Compare experience

Allow two to four items.

Rows should include:

- Price
- Shipping only when known
- Availability
- Retailer
- Variant
- Brand/model identifiers
- User notes
- Normalized attributes added later

Highlight differences. Do not fabricate missing specifications.

### 12.6 Delightful behaviors

- One-click save with a clear preview
- Optimistic UI
- Undo toast after archive/delete
- “Already saved — refreshed” instead of a duplicate error
- Keyboard shortcut for save
- Context menu: “Save to Universal Cart”
- Smooth transition from extension save to dashboard
- Stale-data badge instead of silently showing old prices
- Friendly partial-extraction state
- Quick compare tray that stays visible while browsing the dashboard
- “Open all” grouped by retailer to reduce tab chaos
- Per-item desired-price threshold
- Activity log for shared carts

---

## 13. Real-time synchronization

### 13.1 Realtime subscriptions

Subscribe to item insert/update/delete events for the active cart.

On an event:

- Update the local query cache.
- Do not refetch the entire application unless reconciliation fails.
- Show a subtle collaborator indicator when another user changes an item.

### 13.2 Conflict policy

Separate system-observed fields from user-authored fields.

System-observed fields:

- Price
- Availability
- Image
- Retailer title
- Last observed time

User-authored fields:

- Note
- Quantity
- Priority
- Desired price
- Status

A retailer refresh must never overwrite user-authored fields.

For user-authored conflicts, use last-write-wins for the MVP and record `updated_at` and `updated_by`. Add richer conflict resolution only if real usage requires it.

---

## 14. Price and availability refresh strategy

### 14.1 Phase-one refresh

- Refresh on explicit capture.
- Refresh when the user opens the side panel on a URL matching a saved item.
- Provide a manual “Refresh from current page” action.

### 14.2 Scheduled refresh later

Classify each domain/item with a refresh strategy:

- `public_fetch`: public HTML contains usable metadata
- `api`: an authorized official API exists
- `browser_required`: user browser/session or rendered DOM required
- `disabled`: terms, technical behavior, or reliability makes refresh inappropriate

A scheduled job should:

1. Select due `public_fetch` items.
2. Deduplicate URLs so one page is fetched once.
3. Rate-limit per domain.
4. Use conditional requests when supported.
5. Apply a conservative timeout.
6. Parse only product metadata.
7. Insert an observation when values change.
8. Back off after failures.
9. Disable a domain automatically after repeated parsing failures.

Do not add a headless browser farm during the MVP.

### 14.3 Staleness

Show the user how fresh each item is:

- Fresh: observed recently
- Aging: last observation older than the preferred interval
- Stale: refresh failed or requires a browser visit

Never imply a price is current when it has not been re-observed.

---

## 15. Notifications

Implement only after observations are trustworthy.

Initial notification rules:

- Price falls below desired price
- Item returns in stock
- Item becomes unavailable

Delivery order:

1. In-app notification
2. Browser notification when the extension is installed and permission is granted
3. Email later

Deduplicate repeated notifications and record the observed value that triggered them.

---

## 16. AI features — intentionally later

AI is useful after the deterministic foundation is working.

### 16.1 Good first AI features

- Normalize messy product titles into brand, model, and key attributes
- Suggest cross-retailer duplicate matches
- Generate a concise comparison using only stored facts
- Turn a user note into structured preferences
- Explain the most important differences among selected products

### 16.2 Guardrails

- AI runs server-side only.
- Provider keys never enter the extension or browser bundle.
- Send the smallest necessary product metadata, not full page HTML.
- Store model name, prompt version, and output provenance.
- Treat AI output as a suggestion.
- Never overwrite deterministic fields without user confirmation.
- Comparison prose must distinguish known facts from missing information.

### 16.3 Features to defer

- Review summarization from scraped retailer reviews
- Autonomous product search across the web
- Purchase recommendations based on sensitive profiles
- Automatic checkout decisions

---

## 17. Security and privacy requirements

### 17.1 Extension privacy principles

- Extract only after explicit user action.
- Do not collect browsing history.
- Do not read or upload cookies.
- Do not transmit full page HTML in production.
- Do not inspect checkout, account, payment, or health-information pages.
- Provide a clear list of captured fields in the privacy page.
- Allow users to delete all data.

### 17.2 Secrets

Client-safe:

- Supabase project URL
- Supabase publishable key
- Public web app URL

Server-only:

- Supabase service-role key
- AI provider keys
- Email provider keys
- Cron secrets
- Error-monitoring auth tokens

### 17.3 URL and network safety

For any server-side fetch:

- Allow only `http` and `https`.
- Resolve and reject localhost, private, link-local, and metadata-service IP ranges.
- Re-check redirects.
- Limit response size.
- Limit redirects.
- Use timeouts.
- Do not forward user cookies or authorization headers.
- Rate-limit by domain and user.

### 17.4 Content security

- No `eval`.
- No remote executable code in the extension.
- Strict extension CSP.
- Sanitize user-entered rich text or use plain text.
- Escape retailer-provided content before rendering.
- Avoid a generic image proxy until SSRF protections are complete.

### 17.5 Auditability

Record security-relevant events:

- Sign-in and sign-out
- Invite creation and acceptance
- Membership changes
- Token/session revocation
- Data export and account deletion

Do not log access tokens or complete capture payloads containing user notes.

---

## 18. Testing strategy

### 18.1 Unit tests

`packages/extractors`

- JSON-LD arrays and `@graph`
- Product with single Offer
- Product with multiple Offers
- AggregateOffer
- Missing currency
- European and US price formats
- Sale and original price
- Variant extraction
- Canonical URL normalization
- Tracking parameter removal
- Fingerprint stability
- Confidence merge rules

`packages/contracts`

- Valid capture
- Missing required fields
- Future schema version rejection
- Decimal-string validation
- URL validation

### 18.2 Fixture tests

Every retailer adapter must have sanitized fixtures.

Rules:

- No user account data
- No cookies or tokens
- Minimize fixture size while preserving required DOM
- Store expected capture JSON beside fixture
- Add a regression fixture for every production extraction bug

### 18.3 Database tests

- RLS tests listed above
- Atomic ingestion creates an item
- Duplicate ingestion updates rather than duplicates
- User fields survive retailer refresh
- Observation insertion rules
- Cart membership enforcement

### 18.4 Web end-to-end tests

- Sign in with a test user
- Empty dashboard
- Item list loads
- Search/filter/sort
- Edit note and desired price
- Compare items
- Archive and undo
- Invite and accept

### 18.5 Extension end-to-end tests

Use a persistent Playwright Chromium context with the built extension loaded.

Test pages should be local deterministic fixtures, not live retailer sites in CI.

Required flows:

- Load a fixture product page
- Trigger extraction
- Open side panel
- Edit capture
- Save to mocked/local Supabase
- Duplicate save refreshes existing item
- Offline save queues mutation
- Service worker restart does not lose durable state

### 18.6 Manual compatibility matrix

Before each extension release, manually test:

- Current stable Chrome on macOS
- Current stable Chrome on Windows when available
- Side panel navigation across tabs
- Google sign-in
- Session persistence after browser restart
- At least five real retailer pages used by the group

---

## 19. Observability

### 19.1 Structured events

Capture events such as:

- `extraction_started`
- `extraction_succeeded`
- `extraction_low_confidence`
- `extraction_failed`
- `capture_saved`
- `capture_duplicate_refreshed`
- `sync_failed`
- `background_refresh_failed`

Include:

- Domain
- Extractor ID/version
- Field-presence flags
- Confidence bucket
- Error class
- Client version

Do not include product notes, auth tokens, or full URLs with sensitive query parameters in analytics.

### 19.2 Initial monitoring

Start with:

- Vercel logs
- Supabase logs
- GitHub Actions status
- A basic admin-only extractor-health page

Add Sentry or similar error monitoring when multiple friends are using the extension and diagnosing local failures becomes difficult.

---

## 20. CI/CD

### 20.1 Pull-request checks

Run:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Also:

- Build extension production bundle
- Run Playwright smoke tests
- Verify generated Supabase types are current
- Validate migrations from a clean local database
- Scan for accidentally committed secrets

### 20.2 Main-branch deployment

On merge to `main`:

- Vercel automatically deploys the web app.
- Apply production database migrations through a controlled workflow.
- Do not automatically publish the extension for every merge.
- Produce a versioned extension artifact for tagged releases.

### 20.3 Extension release

Release steps:

1. Update extension version.
2. Update changelog.
3. Run the full extension test suite.
4. Build and zip with WXT.
5. Upload or submit to the testing channel.
6. Verify installation and auth.
7. Promote after testing.

Use a separate testing listing from production if necessary and clearly label it as a development/testing build.

---

## 21. Deployment from scratch

### 21.1 Local prerequisites

- Git
- Node.js LTS
- pnpm
- Docker Desktop or compatible Docker runtime
- Supabase CLI
- Chrome
- GitHub account
- Vercel account
- Supabase account

### 21.2 Repository bootstrap

The coding agent should:

1. Create the pnpm workspace and Turborepo configuration.
2. Scaffold `apps/web`.
3. Scaffold `apps/extension` with WXT and React.
4. Create shared packages.
5. Initialize Supabase local development.
6. Add root lint, typecheck, test, and build scripts.
7. Add `.env.example` files.
8. Add CI.
9. Verify a clean clone can run all checks.

### 21.3 Supabase environments

For the personal project:

- Use local Supabase for development.
- Use one hosted production project initially.
- Add a hosted staging project only when migrations or shared testing make it valuable.

Commit migrations. Never make production-only schema changes manually without backfilling the migration file.

### 21.4 Vercel setup

- Connect the GitHub repository.
- Point Vercel at `apps/web` or configure the monorepo root correctly.
- Add production and preview environment variables.
- Configure the production site URL in Supabase Auth redirect settings.
- Use preview deployments for pull requests.

### 21.5 Chrome distribution

Development:

- Load the WXT output as an unpacked extension.

Friends:

- Publish a private, unlisted, or trusted-tester Chrome Web Store build.
- Do not expect nontechnical macOS or Windows users to install a self-hosted CRX.
- Start extension-store automation only after the first listing is configured manually.

### 21.6 Environment variables

Root `.env.example` should document ownership, not contain secrets.

Web public:

```text
NEXT_PUBLIC_APP_URL=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

Web server:

```text
SUPABASE_SERVICE_ROLE_KEY=
CRON_SECRET=
AI_PROVIDER_API_KEY=
```

Extension build-time public configuration:

```text
WXT_PUBLIC_APP_URL=
WXT_PUBLIC_SUPABASE_URL=
WXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

Never prefix a secret with a public environment-variable prefix.

---

## 22. Phased implementation plan

Do not give a coding agent the entire project as one unbounded goal. Execute one phase at a time and require green tests before the next phase.

### Phase 0 — Repository foundation

Deliverables:

- Monorepo scaffold
- Web hello page
- Extension side panel hello page
- Shared contracts package
- Local Supabase initialized
- Root scripts
- CI
- Documentation skeleton

Acceptance criteria:

- `pnpm install` succeeds from a clean clone.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass.
- Web app runs locally.
- Extension loads unpacked in Chrome.
- Local Supabase starts and stops through documented commands.

Stop after Phase 0. Review the structure before adding product code.

### Phase 1 — Authentication and authorization

Deliverables:

- Supabase Google auth and magic-link fallback in web app
- Extension auth flow
- Session persistence
- Initial profile, cart, and membership schema
- Default cart creation
- RLS policies and tests

Acceptance criteria:

- A user can sign in independently from web and extension and sees the same account.
- A default cart is created exactly once.
- User A cannot access User B’s data.
- Signing out clears local session state.
- No service-role key appears in client output.

### Phase 2 — Generic capture vertical slice

Deliverables:

- Capture contract
- JSON-LD parser
- Open Graph/meta parser
- Generic DOM fallback
- Side-panel preview/edit UI
- `items` and `item_observations` schema
- Atomic ingestion function
- Save from a deterministic fixture page

Acceptance criteria:

- A fixture product can be extracted and saved end to end.
- Capture displays in the web dashboard.
- Duplicate capture updates the existing item.
- Low-confidence fields can be edited before save.
- Extractor unit and fixture tests pass.

### Phase 3 — Cart dashboard and delightful core UX

Deliverables:

- Cart list/card views
- Item detail drawer/page
- Search, filters, and sorting
- Status, quantity, note, priority, desired price
- Optimistic updates and undo
- Recent items in extension

Acceptance criteria:

- All user-authored fields can be changed from web and extension where appropriate.
- Updates appear across clients without reload.
- Archive/delete has an undo path.
- Empty and error states are polished.

### Phase 4 — Observations, revisit refresh, and price history

Deliverables:

- URL/fingerprint matching on current page
- Refresh on revisit
- Observation history
- Price chart/list
- Stale-data status
- Price-change badges

Acceptance criteria:

- Revisiting a saved product updates observed fields without overwriting notes.
- Unchanged observations do not create noisy history.
- Price changes display correctly.
- Stale items are visibly identified.

### Phase 5 — Real retailer adapters

Deliverables:

- Adapter registry
- Adapters for the five most-used retailer patterns
- Fixture suite
- Adapter diagnostics
- Generic fallback after adapter failure

Acceptance criteria:

- Each adapter has fixtures and tests.
- An adapter failure does not prevent manual capture.
- The UI identifies missing fields rather than inventing them.
- Extractor version is recorded with each observation.

### Phase 6 — Sharing and comparison

Deliverables:

- Invitations
- Owner/editor/viewer roles
- Shared activity indicators
- Compare tray and compare view
- “Open all by retailer”

Acceptance criteria:

- Invitation can be accepted once and expires correctly.
- Role permissions match RLS tests.
- Two to four items compare without fabricated fields.
- Collaborator updates appear in real time.

### Phase 7 — Background refresh and alerts

Deliverables:

- Refresh-strategy classification
- Due-item selector
- Supabase Cron/Queue or small worker
- Domain rate limits and backoff
- Desired-price and back-in-stock alerts

Acceptance criteria:

- Only eligible public pages are fetched.
- SSRF protections are tested.
- Repeated failures back off.
- Alerts are deduplicated.
- Browser-required items remain clearly labeled.

### Phase 8 — Product matching and AI-assisted comparison

Deliverables:

- Deterministic identifier matching
- Candidate matching system
- Optional embeddings/LLM normalization
- User confirmation UI
- Fact-grounded comparison summary

Acceptance criteria:

- Exact matches are deterministic.
- Medium-confidence matches require confirmation.
- AI cannot overwrite source fields automatically.
- Comparison summaries identify missing data.

### Phase 9 — Release hardening

Deliverables:

- Privacy page
- Data export and deletion
- Error monitoring
- Release runbook
- Chrome Web Store testing listing
- Automated artifact build
- Backup/restore drill

Acceptance criteria:

- A friend can install, sign in, capture, compare, and sync without developer intervention.
- Account deletion removes or anonymizes user data as documented.
- Production secrets are inventoried and rotatable.
- Rollback procedures are documented.

---

## 23. Agent execution protocol

### 23.1 One phase per session or branch

For every phase:

1. Read `AGENTS.md` or `CLAUDE.md` and this plan.
2. Inspect the repository before editing.
3. State the files and systems likely to change.
4. Implement only the requested phase or slice.
5. Add tests in the same change.
6. Run the narrowest relevant checks, then the full repository checks.
7. Update `docs/STATUS.md` and `docs/DECISIONS.md`.
8. Summarize changed files, commands run, test results, and remaining risks.
9. Stop. Do not begin the next phase automatically.

### 23.2 Change-size discipline

- Prefer a vertical slice over a broad scaffold with placeholders.
- Avoid changes larger than roughly 500–800 lines unless mechanical.
- Split schema, UI, extraction, and deployment work into reviewable commits.
- Do not refactor unrelated code while implementing a feature.
- Do not introduce a new service or major dependency without a short ADR in `docs/DECISIONS.md`.

### 23.3 Required final report from the coding agent

```text
Implemented:
- ...

Files changed:
- ...

Database changes:
- ...

Commands run:
- ...

Tests:
- PASS/FAIL ...

Manual verification:
- ...

Known limitations:
- ...

Next recommended task:
- one bounded task only
```

---

## 24. Key risks and mitigations

### Risk: product pages vary wildly

Mitigation:
- Layered extraction
- Field confidence
- Manual correction
- Adapter fixtures
- Generic fallback

### Risk: selectors break frequently

Mitigation:
- Prefer structured data
- Version adapters
- Add telemetry by domain and extractor version
- Never make one adapter failure block saving

### Risk: “current” prices become stale

Mitigation:
- Always store `observed_at`
- Show staleness
- Refresh on revisit
- Background-refresh only eligible pages

### Risk: native-cart synchronization becomes a time sink

Mitigation:
- Keep the product’s source of truth in Universal Cart
- Use retailer deep links for purchase
- Evaluate native cart adapters only as isolated optional integrations later

### Risk: extension permissions damage trust

Mitigation:
- Explicit click-to-capture
- `activeTab` instead of broad access
- Optional permissions at point of use
- Clear privacy page

### Risk: auth differs between web and extension

Mitigation:
- One Supabase identity system
- Dedicated extension OAuth tests
- Durable session storage adapter
- Explicit sign-out and token refresh tests

### Risk: coding agents overbuild the system

Mitigation:
- One phase at a time
- Strong non-goals
- No new service without ADR
- Acceptance criteria and stop conditions
- Small reviewable changes

### Risk: server-side fetching becomes legally or technically problematic

Mitigation:
- Browser capture is primary
- Use official APIs where authorized
- Respect site restrictions and rate limits
- Store only product metadata needed by the user
- Disable unsupported domains instead of bypassing controls

---

## 25. Definition of done for the personal beta

The personal beta is ready when:

- Three or more users can install through an appropriate Chrome Web Store testing channel.
- Sign-in works without manual database intervention.
- A user can save products from at least five commonly used retailers and from a generic structured-data fixture.
- Missing fields can be corrected quickly.
- Items sync between two browsers or devices.
- Duplicate saves refresh rather than clutter.
- Notes and desired prices survive retailer refreshes.
- Price history shows real observations and timestamps.
- Shared cart permissions are enforced in the database.
- CI is green from a clean checkout.
- Production deployment and rollback are documented.
- The extension requests no broader permissions than the implemented feature requires.

---

## 26. Immediate recommended starting point

Start with **Phase 0 only**. The first coding-agent task should produce a working monorepo, a locally running web app, a loadable extension side panel, local Supabase configuration, and green CI. Do not ask the agent to build capture, auth, dashboard, and deployment in the same run.

After Phase 0 is reviewed, execute Phase 1, then create the smallest Phase 2 vertical slice using a local deterministic product-page fixture. A real retailer adapter should not be the first proof of concept.
