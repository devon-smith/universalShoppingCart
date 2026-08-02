# Architecture

Reference: [BUILD_PLAN.md](../BUILD_PLAN.md) §3–§5. This document records what exists in
the repository today and the boundaries that later phases must respect.

## Shape

```text
retailer product page
        │  explicit user action only
        ▼
apps/extension  (WXT + React, Manifest V3)
        │  authenticated Supabase client / RPC
        ▼
supabase        (Postgres + Auth + RLS + Realtime)
        │  realtime changes
        ▼
apps/web        (Next.js App Router)
```

One repository, one web app, one extension, one Supabase project. No microservices, no
headless-browser infrastructure, no background worker until Phase 7 justifies one in an ADR.

## Workspace layout

| Path                  | Role                                                                        |
| --------------------- | --------------------------------------------------------------------------- |
| `apps/web`            | Next.js App Router dashboard. React Server Components for reads.            |
| `apps/extension`      | WXT + React MV3 extension. Side panel is the primary surface.               |
| `packages/contracts`  | Serializable types and Zod schemas. No framework imports.                   |
| `packages/extractors` | Pure extraction/normalization. No Supabase, no React, no extension storage. |
| `packages/ui`         | Shared presentational primitives. No data fetching.                         |
| `packages/config`     | ESLint, Prettier, and TypeScript presets consumed by every workspace.       |
| `packages/test-utils` | Test-only helpers. Never imported by shipped code.                          |
| `supabase/`           | `config.toml`, committed SQL migrations, seed data, database tests.         |

Internal packages are consumed as TypeScript source through their `exports` map; the app
bundlers compile them (`transpilePackages` in Next, Vite in WXT). There is no separate
library build step to keep in sync.

## Task graph

Turborepo drives every root script. `pnpm build` runs each app's build after its
dependencies build; `pnpm test:e2e` depends on the same package's `build` so Playwright
always exercises a production bundle.

| Root command     | What it runs                                                         |
| ---------------- | -------------------------------------------------------------------- |
| `pnpm dev`       | Next dev server and `wxt` dev in parallel                            |
| `pnpm lint`      | ESLint flat config per workspace                                     |
| `pnpm typecheck` | `tsc --noEmit` per workspace (`next typegen` first for the web app)  |
| `pnpm test`      | Vitest per workspace                                                 |
| `pnpm build`     | `next build` and `wxt build`                                         |
| `pnpm test:e2e`  | Playwright: built web app, and the extension in a persistent context |
| `pnpm test:db`   | pgTAP against the local Supabase database                            |

## Boundaries that must hold

- `packages/extractors` may accept a `Document` but must return only serializable values.
  It must never import Supabase, React, or extension APIs.
- `packages/contracts` is the only place a cross-boundary payload shape is defined, and
  every such payload carries a `schemaVersion`.
- The extension bundle may contain the Supabase project URL and publishable key. A
  service-role key or OAuth client secret in a client bundle is a security incident.
- Retailer-observed fields and user-authored fields are stored separately and a refresh
  may never overwrite the user-authored ones.

## Authentication

One Supabase identity system, two session stores:

- **Web** — cookies, via `@supabase/ssr`. `src/middleware.ts` refreshes the session on
  every navigation and gates `/app`; server code identifies the user with
  `supabase.auth.getUser()`, which validates against the Auth server rather than trusting
  a cookie.
- **Extension** — `chrome.storage.local`, via a storage adapter passed to the Supabase
  client. PKCE, `detectSessionInUrl` disabled, Google routed through
  `chrome.identity.launchWebAuthFlow` so no extension page is ever a redirect target.

Signing in on either surface yields the same user, profile, and default cart. Details and
the threat-model reasoning are in [SECURITY.md](SECURITY.md); the schema and RLS matrix are
in [DATA_MODEL.md](DATA_MODEL.md).

## Extraction

`packages/extractors` turns a `Document` into a validated `ProductCaptureV1`. Layered
extractors (retailer adapter → JSON-LD → meta → DOM heuristics) each report field values
with evidence, and a merge engine resolves them by source rank and confidence. Details in
[EXTRACTION.md](EXTRACTION.md).

## Capture

```text
side panel                      product tab
    │  click "Capture this page"
    ├── chrome.scripting.executeScript (activeTab, unlisted capture.js)
    │                                    │
    │   versioned, id-correlated message │
    ├───────────────────────────────────►│ extract → ProductCaptureV1
    │◄───────────────────────────────────┤
    │
    ├── user edits the uncertain fields
    │
    └── ingest_product_capture(capture, cartId, fingerprint, userFields)
              │  one Postgres transaction
              └── insert or refresh + observation when changed
```

The fingerprint is computed client-side so URL and variant normalization stay in one
place; the function verifies its shape and scopes it to the cart. A refresh rewrites only
retailer-observed columns — note, quantity, priority, desired price, and status are the
user's.

## Revisit

Opening the side panel extracts the page the same way a capture does, but locally and
without sending anything. The fingerprint is looked up against non-archived items; only if
one matches does an ingest happen, with `source = 'revisit'` and **no user fields**, so a
refresh has nothing to overwrite them with. An unsaved page produces one indexed read and
no write.

Observations are recorded only when a tracked value changed or the previous observation is
older than `observation_refresh_interval()`; otherwise `last_observed_at` moves and the
history stays quiet. That is what keeps a series of visits from becoming a series of
identical rows.

Nothing fetches a retailer page on a timer — every observation came from a page the user
was looking at. Scheduled refresh is Phase 7.

## The dashboard

`/app` is a Server Component that fetches the user's items once and hands them to a client
component. Search, filtering, and sorting are pure functions over that array
(`features/items/query.ts`), so the controls respond without a round trip. Mutations are
Server Actions that write user-authored columns only; the client applies each change
optimistically and rolls it back if the server refuses. Realtime patches the same local
cache, so a change made on another device appears without a refetch.

Money is selected as `text`. PostgREST reports `numeric` as a JSON number, and a JSON
number is an IEEE double — the exact decimal would be approximated on the way out.

## Current state

Phase 5. Accounts, carts, memberships, and row-level security exist and are tested; the
web app has a protected dashboard listing the user's carts, and the extension side panel
signs in too. A product page can be captured from the side panel and shows up in the
dashboard, where it can be searched, filtered, sorted, edited, archived with undo, and
deleted. A duplicate save refreshes rather than duplicating. Revisiting a saved page
re-observes it without touching the user's own fields, the observation series is visible in
the detail drawer, and cards show how the price has moved and how old the last check is.
Five commerce-platform adapters run above the generic pipeline and record their version
with each capture, and `/app/diagnostics` reports extraction health per retailer domain.
Sharing and comparison are Phase 6; scheduled background refresh and alerts are Phase 7.
See [STATUS.md](STATUS.md).
