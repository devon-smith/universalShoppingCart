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
