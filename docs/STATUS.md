# Status

Updated after every phase. See [BUILD_PLAN.md §22](../BUILD_PLAN.md) for phase definitions
and acceptance criteria.

| Phase                                  | State       |
| -------------------------------------- | ----------- |
| 0 — Repository foundation              | Complete    |
| 1 — Authentication and authorization   | Not started |
| 2 — Generic capture vertical slice     | Not started |
| 3 — Cart dashboard and core UX         | Not started |
| 4 — Observations and revisit refresh   | Not started |
| 5 — Real retailer adapters             | Not started |
| 6 — Sharing and comparison             | Not started |
| 7 — Background refresh and alerts      | Not started |
| 8 — Product matching and AI comparison | Not started |
| 9 — Release hardening                  | Not started |

## Phase 0 — Repository foundation

**Complete.**

### What works

- pnpm workspace with Turborepo driving `dev`, `lint`, `typecheck`, `test`, `build`,
  `test:e2e`, and `clean` across seven workspaces.
- `apps/web` — Next.js 16 App Router, Tailwind CSS 4, TypeScript strict. Serves a static
  landing page describing the current scaffold. Builds and starts.
- `apps/extension` — WXT 0.20 + React 19, Manifest V3. Registers a side panel that opens
  from the toolbar icon. Production bundle builds to `.output/chrome-mv3`.
- `packages/contracts` — `schemaVersion` gating helpers with unit tests. Every
  cross-boundary payload will carry and check a version.
- `packages/extractors` — canonical URL normalization (tracking-parameter removal, host
  and path canonicalization, deterministic parameter ordering) with unit tests.
- `packages/ui` — `cn` class-name helper with unit tests.
- `packages/test-utils` — fixture-reading helpers with unit tests.
- `packages/config` — shared ESLint flat configs, Prettier config, TypeScript presets.
- `supabase/` — `config.toml`, empty `migrations/`, `seed.sql`, `tests/`. The local stack
  starts, resets, and stops through the documented root commands.
- `.github/workflows/ci.yml` — lint, typecheck, unit tests, builds, format check, an
  extension-bundle assertion, Playwright end-to-end tests, and a secret scan.
- `.env.example` at the root and per app, classifying every variable client-safe or
  server-only.

### Verification

| Command                                    | Result                                                |
| ------------------------------------------ | ----------------------------------------------------- |
| `pnpm install`                             | Pass — clean clone, `wxt prepare` runs on postinstall |
| `pnpm lint`                                | Pass — 7 workspaces                                   |
| `pnpm typecheck`                           | Pass — 7 workspaces                                   |
| `pnpm test`                                | Pass — 6 files, 35 tests                              |
| `pnpm build`                               | Pass — web and extension production bundles           |
| `pnpm test:e2e`                            | Pass — 2 Playwright tests against the built web app   |
| `pnpm supabase:start` / `:reset` / `:stop` | Pass                                                  |

Manual: the web app serves at <http://localhost:3000>; the extension loads unpacked from
`apps/extension/.output/chrome-mv3` and the side panel opens from the toolbar icon.

### Deliberately not built yet

- Authentication of any kind, in either client.
- Content script, page extraction, capture payloads, and every product database table.
- Dashboard, item cards, search, compare, sharing.
- Popup fallback entrypoint — see [DECISIONS.md](DECISIONS.md).
- Vercel and Chrome Web Store configuration.

### Known limitations

- Extension permissions are `sidePanel` and `storage` only. Later phases add the ones
  their features need and no more.
- `supabase/config.toml` disables the Edge Runtime container because no Edge Function
  exists yet; Phase 7 re-enables it.
- No extension end-to-end test yet. It arrives in Phase 2B alongside the first capture
  flow, which is the first thing worth driving in a persistent browser context.
