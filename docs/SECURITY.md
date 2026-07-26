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
test coverage are documented in [DATA_MODEL.md](DATA_MODEL.md). `pnpm test:db` runs 27
pgTAP assertions covering the cases listed in BUILD_PLAN.md §8.2.

The dashboard checks the user a second time in the page itself, so a middleware
misconfiguration alone cannot expose it.

## Extension permissions

Requested today: `sidePanel`, `storage`, `identity`. No `host_permissions`, no
`<all_urls>`, no `activeTab`, no `scripting` — the extension reads no page content yet.
`apps/extension/tests/e2e/auth.spec.ts` asserts the manifest against exactly this list, so
a permission cannot be added quietly.

The manifest sets `script-src 'self'; object-src 'self'`. There is no `eval`, no remote
code, and no downloaded extraction logic; `no-eval`, `no-implied-eval`, and `no-new-func`
are errors in the shared ESLint config.

## Privacy

Not collected, at all: browsing history, cookies, page HTML, retailer credentials,
payment details. The extension has no way to read a page in this build.

Still to come: the privacy page, data export, and account deletion land in Phase 9.

## Known gaps

- Google sign-in is implemented on both surfaces but is not exercised end to end in CI,
  because that needs real OAuth credentials. The Supabase-facing half of the flow is unit
  tested with injected fakes; the browser half is manual.
- No audit log yet (BUILD_PLAN.md §17.5). Sign-in, invite, and membership events get one
  when sharing lands in Phase 6.
- No rate limiting of our own; the project relies on Supabase Auth's limits.
