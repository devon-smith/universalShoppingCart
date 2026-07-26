# Status

Updated after every phase. See [BUILD_PLAN.md §22](../BUILD_PLAN.md) for phase definitions
and acceptance criteria.

| Phase                                  | State       |
| -------------------------------------- | ----------- |
| 0 — Repository foundation              | Complete    |
| 1 — Authentication and authorization   | Complete    |
| 2 — Generic capture vertical slice     | Not started |
| 3 — Cart dashboard and core UX         | Not started |
| 4 — Observations and revisit refresh   | Not started |
| 5 — Real retailer adapters             | Not started |
| 6 — Sharing and comparison             | Not started |
| 7 — Background refresh and alerts      | Not started |
| 8 — Product matching and AI comparison | Not started |
| 9 — Release hardening                  | Not started |

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
