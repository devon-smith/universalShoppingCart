# Security and privacy

Reference: [BUILD_PLAN.md](../BUILD_PLAN.md) §17. This document records what is enforced
today and where each control lives, so a reviewer can check the claim against the code.

## Secret classification

| Value                                  | Class       | Where it may appear                      |
| -------------------------------------- | ----------- | ---------------------------------------- |
| `NEXT_PUBLIC_APP_URL`                  | client-safe | web bundle                               |
| `NEXT_PUBLIC_SUPABASE_URL`             | client-safe | web bundle                               |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | client-safe | web bundle                               |
| `WXT_PUBLIC_APP_URL`                   | client-safe | extension bundle                         |
| `WXT_PUBLIC_SUPABASE_URL`              | client-safe | extension bundle                         |
| `WXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`  | client-safe | extension bundle                         |
| `SUPABASE_SERVICE_ROLE_KEY`            | server-only | Next.js server runtime / job runner only |
| `SUPABASE_AUTH_GOOGLE_SECRET`          | server-only | Supabase project configuration only      |
| `CRON_SECRET`, `AI_PROVIDER_API_KEY`   | server-only | not yet used                             |

The publishable key carries no authority beyond what Row Level Security allows the
calling user, which is why it is safe in a bundle anyone can read. The service-role key
bypasses RLS entirely and must never leave a server.

**Enforcement.** The `secrets` job in `.github/workflows/ci.yml` fails the build on a
tracked `.env` file, on a `service_role` JWT claim in tracked source, and on any
`NEXT_PUBLIC_`/`WXT_PUBLIC_` variable whose name contains `SERVICE_ROLE` or `SECRET`.
`apps/extension/lib/supabase/config.ts` additionally refuses at runtime to build a client
from a key that looks like a service-role token.

## Authentication

- One Supabase identity system for both clients. Signing in on either surface produces
  the same user, the same profile, and the same default cart.
- **Web:** session in cookies via `@supabase/ssr`, refreshed by `src/middleware.ts` on
  every navigation. Server code identifies the user with `supabase.auth.getUser()`, which
  validates against the Auth server, never by trusting a decoded cookie.
- **Extension:** session in `chrome.storage.local` through a small storage adapter
  (`lib/supabase/storage.ts`). PKCE flow, `detectSessionInUrl` disabled — an extension
  page is never an OAuth redirect target. Google sign-in runs through
  `chrome.identity.launchWebAuthFlow`, so no extension page is ever redirected.
- Sign-out clears the stored session on both surfaces; the extension case is asserted
  directly against `chrome.storage.local` in `apps/extension/tests/e2e/auth.spec.ts`.

### Open redirect

`next` is attacker-controlled. `apps/web/src/lib/auth/redirect.ts` accepts only
same-origin absolute paths and rejects protocol-relative URLs, backslashes, and control
characters. Redirect targets are built from the client-visible `Host` rather than from
`NextRequest.url` (`src/lib/auth/absolute-url.ts`) — otherwise a session established on
`127.0.0.1` would be dropped by a redirect to `localhost`.

## Authorization

Every exposed table has RLS enabled and `anon` holds no grants. The policy matrix and its
test coverage are documented in [DATA_MODEL.md](DATA_MODEL.md). `pnpm test:db` runs 107
pgTAP assertions across seven files, covering the cases listed in BUILD_PLAN.md §8.2: user
bootstrap (9), cart and membership RLS (18), atomic ingestion (29), item field ownership
(14), revisit refresh (20), the two-fact availability pair (11), and composition (6).

The dashboard checks the user a second time in the page itself, so a middleware
misconfiguration alone cannot expose it.

## Extension permissions

Requested today: `sidePanel`, `storage`, `identity`, `activeTab`, `scripting`,
`contextMenus`. No `host_permissions` and no `<all_urls>` in a release build.

`activeTab` is the whole design. It grants access to one tab, at the moment the user
invokes the extension, and expires on navigation — so the extension can read the product
page in front of the user and nothing else. The capture script is **unlisted**: it appears
in no `content_scripts` entry, matches no host, and is injected on demand with
`chrome.scripting.executeScript`.

`contextMenus` is not a convenience: a context-menu click is an _action invocation_,
which is one of the three gestures that actually confer `activeTab` on the tab the user
is looking at (toolbar click, context menu, keyboard command). See
`apps/extension/lib/manifest.ts`.

Two tests guard this. `apps/extension/lib/manifest.test.ts` pins the exact permission list
and asserts that no build grants broad host access; the extension end-to-end suite reads
the manifest back out of the _running_ extension, so a permission cannot be added quietly.

The end-to-end build (`WXT_E2E=1`) additionally grants `http://127.0.0.1/*`, because a
headless browser cannot click the toolbar button that confers `activeTab` in a real
session. A release build must never set that flag.

### What the capture script may read

The "may this page be read at all" decision lives inside the injected script, not in the
panel — only code running on the page can see its URL. Asking for the `tabs` permission to
make that check in the panel would mean reading every tab's URL in order to decline to
read one of them.

Refused outright, regardless of what the user clicks: `/checkout`, `/payment`, `/billing`,
`/account`, `/signin`, `/login`, `/order`, and anything that is not `http(s)`. The script
reads the DOM, runs extraction, and returns a `ProductCaptureV1` — a fixed set of named
scalars. It cannot carry page HTML, cookies, tokens, or unrelated page text, because
there is no field in the contract that would hold them.

The manifest sets `script-src 'self'; object-src 'self'`. There is no `eval`, no remote
code, and no downloaded extraction logic; `no-eval`, `no-implied-eval`, and `no-new-func`
are errors in the shared ESLint config.

### Retailer adapters

Every adapter is bundled and versioned in `packages/extractors/src/adapters/`. None is
fetched, and none is evaluated from a string: the JSON blobs commerce platforms embed in
their pages are read with `JSON.parse`, which cannot execute anything. An adapter reads the
same DOM the generic pipeline reads, under the same refusal rules, and returns the same
fixed set of named scalars.

## Diagnostics

`/app/diagnostics` reports extraction health from the reader's own items, scoped by the
same row-level security as the dashboard — there is no admin role and no cross-user query
path, so there is nothing there to escalate to.

What it may show is deliberately narrow: a retailer **domain**, an extractor id and
version, a confidence, and per-field present/absent counts. Never a product title, a note,
or a page URL. A domain names markup that needs fixing; a URL names what somebody is
buying (BUILD_PLAN.md §19.1). An end-to-end test asserts the rendered page contains none of
the three for a seeded item.

## Privacy

Not collected, at all: browsing history, cookies, page HTML, retailer credentials, payment
details. Extraction runs only after an explicit click, only on the tab in front of the
user, and only on pages the script agrees to read.

Still to come: the privacy page, data export, and account deletion land in Phase 9.

## Known gaps

- Google sign-in is implemented on both surfaces but is not exercised end to end in CI,
  because that needs real OAuth credentials. The Supabase-facing half of the flow is unit
  tested with injected fakes; the browser half is manual.
- No audit log yet (BUILD_PLAN.md §17.5). Sign-in, invite, and membership events get one
  when sharing lands in Phase 6.
- No rate limiting of our own; the project relies on Supabase Auth's limits.

## Dependency advisories

`pnpm audit` reports 11 advisories (1 critical, 7 high, 2 moderate, 1 low) as of
2026-07-26. Every one of them is in build or development tooling, and none is reachable
from code we ship:

| Package                                 | Path                     | Why it is not reachable                                                                                                                                                         |
| --------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shell-quote`, `tmp`, `adm-zip`, `uuid` | `wxt > web-ext-run > …`  | WXT's Firefox-runner tooling. Used by `wxt dev` to launch a browser; never bundled into the extension.                                                                          |
| `sharp`                                 | `next > sharp`           | Only invoked by `next/image`, which the app deliberately does not use — item images are plain `<img>` tags so that retailer CDN images are never proxied (BUILD_PLAN.md §17.4). |
| `postcss`                               | `next > postcss`         | Build-time CSS processing. Not shipped.                                                                                                                                         |
| `brace-expansion`                       | `eslint > minimatch > …` | Lint-time only.                                                                                                                                                                 |
| `esbuild`                               | `vite > esbuild`         | Dev server only, and the advisory is Windows-specific.                                                                                                                          |

None can be fixed without bumping `next` or `wxt` themselves, and forcing transitive
overrides on a pre-staging repository buys less than it risks. Re-check this table when
either dependency is upgraded, and before any production release — an advisory that is
unreachable today becomes reachable the moment the app starts using `next/image`.

Confirmed by inspection of the built bundles rather than by assertion: neither
`apps/web/.next/static` nor `apps/extension/.output` contains a service-role key or any
`sb_secret_` value. The only matches for those strings are a key-shape guard inside
`@supabase/supabase-js` and the extension's own check that refuses a publishable key that
looks like a service-role key.
