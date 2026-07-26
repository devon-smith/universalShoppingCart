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

## Current state

Phase 2A. Accounts, carts, memberships, and row-level security exist and are tested; the
web app has a protected dashboard listing the user's carts, and the extension side panel
signs in and lists them too. The extraction engine is complete and tested against
fixtures, but nothing saves a capture yet: `items`, `item_observations`, the ingestion
function, the content script, and the side-panel capture UI are Phase 2B. See
[STATUS.md](STATUS.md).
