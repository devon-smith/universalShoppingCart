# Runbook

Operational procedures. Deployment and rollback detail is filled in as the phases that
introduce them land; anything not yet implemented says so rather than describing a plan as
if it were a procedure.

## Prerequisites

- Node.js 22 (`.nvmrc`)
- pnpm 10 (`corepack enable`, or install pnpm directly)
- Docker, running — required by the local Supabase stack
- Chrome, for loading the unpacked extension

## First run from a clean clone

```bash
pnpm install                 # also runs `wxt prepare` for the extension
cp apps/web/.env.example apps/web/.env.local
cp apps/extension/.env.example apps/extension/.env

pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Sign-in needs a Supabase project. Start the local stack and copy two values into both
env files:

```bash
pnpm supabase:start
pnpm supabase:status         # API URL -> *_SUPABASE_URL, publishable key -> *_SUPABASE_PUBLISHABLE_KEY
```

The end-to-end suites sign real users in, so they need the stack running. They read the
connection details from it automatically:

```bash
pnpm --filter @universal-cart/web exec playwright install chromium   # once per machine
pnpm test:db                 # pgTAP: schema, triggers, RLS
pnpm test:e2e                # web + extension Playwright suites
```

## Development

```bash
pnpm dev            # Next.js on :3000 and the WXT dev build together
```

Web app: <http://localhost:3000>.

Extension: `pnpm --filter @universal-cart/extension dev` writes an unpacked build to
`apps/extension/.output/chrome-mv3`. Load it at `chrome://extensions` → Developer mode →
**Load unpacked** → select that directory. Click the toolbar icon to open the side panel.

## Local Supabase

```bash
pnpm supabase:start     # first run pulls several container images
pnpm supabase:status    # prints the API URL, anon/publishable key, and Studio URL
pnpm supabase:reset     # re-applies every migration, then supabase/seed.sql
pnpm supabase:stop
```

Copy the printed API URL and publishable key into `apps/web/.env.local` and
`apps/extension/.env`. The service-role key that `supabase status` also prints is
server-only — never put it in either file.

Sign-in email goes to Mailpit at <http://127.0.0.1:54324>; nothing leaves the machine.

Database tests:

```bash
pnpm test:db     # pgTAP files in supabase/tests/, run inside a rolled-back transaction
pnpm db:types    # regenerate packages/contracts/src/database.types.ts after a migration
```

### Google sign-in locally

`[auth.external.google]` is disabled in `supabase/config.toml` because it needs real
credentials. To exercise it, create an OAuth client in the Google console, set
`SUPABASE_AUTH_GOOGLE_CLIENT_ID` and `SUPABASE_AUTH_GOOGLE_SECRET` in your shell, flip
`enabled` to `true`, and restart the stack. Allow-list both redirect URIs: the web app's
`/auth/callback` and the extension's `https://<extension-id>.chromiumapp.org/auth-callback`.

### Hosted project checklist

Local configuration does not travel. A hosted project needs, in its dashboard:

- the site URL and redirect allow-list for the real origins
- the Google provider, with the client secret entered there and nowhere else
- the magic-link email template from `supabase/templates/magic_link.html` — without it the
  emailed link points at the implicit-flow verify endpoint and the server never sees the
  session, and the extension's 6-digit code is missing entirely

Migrations are committed under `supabase/migrations/` and applied in filename order.
Production schema is never edited by hand; a change lands as a migration or it does not
land.

## Live page testing

Extraction against real retailers is not covered by CI and is recorded by hand. See
[LIVE_TESTING.md](LIVE_TESTING.md) for the procedure and the log template.

## Staging deployment

**Not yet configured.** This is the next environment to exist, after live-page extraction
validation — see [DECISIONS.md](DECISIONS.md) for why it comes before Phase 9 rather than
during it. Staging is an integration environment: hosted backend and dashboard, extension
still loaded unpacked, a couple of trusted testers, and data nobody would miss.

What it needs, in order:

1. **A hosted Supabase project** on the free tier, named for development rather than
   production. Push the committed migrations to it — never apply schema by hand:

   ```bash
   pnpm exec supabase link --project-ref <ref>
   pnpm exec supabase db push
   ```

2. **Vercel**, pointed at this repository with the root directory set to `apps/web`.
   Environment variables, all client-safe:

   | Variable                               | Value                   |
   | -------------------------------------- | ----------------------- |
   | `NEXT_PUBLIC_APP_URL`                  | the Vercel staging URL  |
   | `NEXT_PUBLIC_SUPABASE_URL`             | staging project API URL |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | staging publishable key |

   `SUPABASE_SERVICE_ROLE_KEY` is **not** needed — nothing server-side uses it yet, and it
   must never be added with a `NEXT_PUBLIC_` prefix.

3. **Supabase Auth URL configuration** for the staging project: set the Site URL to the
   Vercel URL and add `<vercel-url>/auth/confirm` as a redirect URL. Magic links point at
   whatever is configured here; get it wrong and sign-in silently bounces back to `/login`.

4. **The extension, pointed at staging.** Set `WXT_PUBLIC_SUPABASE_URL`,
   `WXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `WXT_PUBLIC_APP_URL` in
   `apps/extension/.env`, rebuild, and reload the unpacked extension. It stays unpacked —
   no store listing at this stage.

Expect the first hosted sign-in to surface something local development could not: cookie
domain and `SameSite` behaviour, the extension origin against the hosted project, CSP under
a real domain, or Realtime over a hosted socket. That is the point of doing it early.

### Verifying a staging deploy

- Sign in on the web app with a magic link and land on `/app`
- Sign in on the extension with an emailed code, on the same account
- Capture a real product, and see it on the dashboard without a reload
- Edit a note on the web app and see it in the extension's recent items
- Check `/app/diagnostics` reports the domain and adapter

## Google sign-in configuration

Implemented on both surfaces and **not** exercised end to end, because it needs real OAuth
credentials that cannot live in this repository. Email sign-in is the baseline and is
enough for staging — Google is deliberately not a blocker.

No credential belongs in git. The client secret is server-only and goes into the Supabase
dashboard; the extension bundle may contain the publishable key and nothing else.

When it is worth configuring:

1. **Google Cloud console** → APIs & Services → Credentials → OAuth 2.0 Client ID, type
   _Web application_.
   - Authorized JavaScript origins: the Vercel URL, and `http://localhost:3000` for
     development.
   - Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback` —
     Supabase's callback, not the app's.
2. **A second OAuth client**, type _Chrome Extension_, for the extension's own flow. Its
   redirect URL is `https://<extension-id>.chromiumapp.org/`, which
   `chrome.identity.launchWebAuthFlow` provides. The extension id is stable only once the
   extension has a key — before a store listing it changes on every unpacked reload, so
   this is easier to do after the listing exists.
3. **Supabase dashboard** → Authentication → Providers → Google: enable it, paste the web
   client id and client secret. Locally, `[auth.external.google]` in
   `supabase/config.toml` stays disabled.
4. Verify manually: sign in with Google on the web app, then on the extension, and confirm
   both land on the same user id and the same default cart.

## Releases

- **Web** — staging as above. Production Vercel wiring is Phase 9.
- **Extension** — not yet configured. `pnpm --filter @universal-cart/extension zip`
  produces an artifact; the Chrome Web Store testing listing and the release checklist land
  in Phase 9.
- **Database** — migrations are applied through a controlled workflow on merge to `main`;
  that workflow does not exist yet.

## Rollback

Not yet documented. Phase 9 delivers deployment rollback, database restore, and the
backup verification drill.

## Troubleshooting

**`pnpm supabase:start` hangs or fails** — confirm Docker is running (`docker ps`). Ports
54321–54324 must be free.

**Extension typecheck fails with missing globals** — run
`pnpm --filter @universal-cart/extension exec wxt prepare` to regenerate `.wxt/`. It is
gitignored and regenerated by `postinstall`.

**Playwright reports a missing browser executable** — run the `playwright install chromium`
command above. If `PLAYWRIGHT_BROWSERS_PATH` is set in your environment, Turborepo passes
it through (see `globalPassThroughEnv` in `turbo.json`).
