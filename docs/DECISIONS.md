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
