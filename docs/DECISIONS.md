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
