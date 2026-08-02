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
nvm use                      # or otherwise select Node 22; pnpm 10 refuses to run on Node 20
                             # with an error that does not mention the Node version
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

## Staging

The staging Supabase project exists and its schema is applied.

|         |                                            |
| ------- | ------------------------------------------ |
| Project | `universal-cart-staging`                   |
| Ref     | `udusjjvhkqogbzejtjkl`                     |
| URL     | `https://udusjjvhkqogbzejtjkl.supabase.co` |
| Region  | us-west-2, free tier                       |

### Applying migrations

Schema reaches staging one way only: the committed migrations, pushed against the linked
project. Never by hand in the dashboard — a hand-applied change exists in no migration file,
so the next `db push` does not know about it and local, staging and production drift apart
silently.

```bash
node scripts/supabase.mjs link --project-ref udusjjvhkqogbzejtjkl
node scripts/supabase.mjs db push
```

`link` prompts for the database password. It is not stored in this repository, in
`.env`, or anywhere else in the working tree — type it at the prompt. On a project with no
migration history table, `push` creates one.

### The check to repeat after every migration

A staging database with tables and RLS switched off is worse than no staging at all: it looks
finished while being wide open, and the way you find out is somebody else's data. So this is
not a one-time verification — run it after **any** future `db push`.

```sql
-- Every table in public, and whether row security is actually on.
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;

-- The policies behind those tables. An empty result with rowsecurity = true means the
-- table is locked to everyone, which is its own kind of broken.
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- Views must run as the caller, not the owner. `item_price_summary` reads
-- `item_observations`; without security_invoker it would return every user's price history.
select relname, reloptions
from pg_class
where relname = 'item_price_summary';
```

Expected: `cart_members`, `carts`, `item_observations`, `items`, `profiles` — five tables,
`rowsecurity = true` on all five, each with policies, and `item_price_summary` carrying
`security_invoker=on`. Anything showing `rowsecurity = false` is a stop-and-fix, not a note
for later.

Worth confirming once per environment as well: a first sign-in creates exactly one profile
and exactly one default cart. Two carts means the bootstrap trigger fired twice.

### The service-role key

`SUPABASE_SERVICE_ROLE_KEY` lives **only in Vercel**, on Production and Preview, marked
Sensitive. It is not in this repository, not in `.env`, not in `.env.example` beyond its
name, and not on any developer machine. It bypasses Row Level Security completely, so a copy
of it in a local file is a copy of every user's data.

Nothing server-side uses it yet. It must never be given a `NEXT_PUBLIC_` or `WXT_PUBLIC_`
prefix, which would inline it into a browser bundle.

### Generated types are built from local, not from staging

`pnpm db:types` regenerates `packages/contracts/src/database.types.ts` from the **local**
stack, and CI checks the committed file against local. Generating against the hosted project
produces one extra block that local does not emit:

```ts
__InternalSupabase: {
  PostgrestVersion: '14.5';
}
```

That is the hosted platform's PostgREST version, not schema. Committing the hosted output
would make the CI check fail on every run. Compare the two if you want to confirm staging
matches the migrations — the rest of the file should be byte-identical — but commit only what
`pnpm db:types` produces.

### The rest of staging

Still to configure:

1. **Vercel**, pointed at this repository with the root directory set to `apps/web`.

   Environment variables, all client-safe:

   | Variable                               | Value                   |
   | -------------------------------------- | ----------------------- |
   | `NEXT_PUBLIC_APP_URL`                  | the Vercel staging URL  |
   | `NEXT_PUBLIC_SUPABASE_URL`             | staging project API URL |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | staging publishable key |

   `SUPABASE_SERVICE_ROLE_KEY` is **not** needed — nothing server-side uses it yet, and it
   must never be added with a `NEXT_PUBLIC_` prefix.

2. **Supabase Auth URL configuration** for the staging project: set the Site URL to the
   Vercel URL and add `<vercel-url>/auth/confirm` as a redirect URL. Magic links point at
   whatever is configured here; get it wrong and sign-in silently bounces back to `/login`.

3. **The extension, pointed at staging.** Set `WXT_PUBLIC_SUPABASE_URL`,
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

## Manual pre-release checks

These cannot run in CI, and the reason is worth stating plainly rather than leaving as a
silent gap.

**How capture is authorized.** `activeTab` is granted when the user _invokes_ the
extension — the toolbar icon, the context menu, or the keyboard shortcut — and it is
revoked the moment that tab navigates. The side panel does not share that lifecycle: it
stays open across navigations, so a button inside it is not an invocation and holds no
grant by the time somebody has browsed to a product page. That is why "Save to Universal
Cart" and ⌘⇧U exist; they are the authorization mechanism, not conveniences.

A headless browser cannot click a toolbar button or a real context-menu item, so the
end-to-end build grants `http://127.0.0.1/*` instead. **The tested build and the shipped
build therefore authorize page access by different mechanisms.** `tests/e2e/authorization.spec.ts`
covers everything a browser can check — that the menu is registered, the command declared,
and no build holds broad host access — but the grant itself is Chrome's behaviour and has
to be seen by hand:

- [ ] Load the release build unpacked (`pnpm --filter @universal-cart/extension build`, no
      `WXT_E2E`). Confirm `chrome://extensions` shows no host permissions.
- [ ] Open the side panel from the toolbar, then browse to a product page on another site.
- [ ] Right-click the page → **Save to Universal Cart**. A preview must appear in the panel.
- [ ] Repeat with ⌘⇧U (Ctrl+Shift+U on Windows).
- [ ] Press the panel's own capture button on a page you navigated to after opening the
      panel. It is expected to fail — confirm it explains the right-click route rather than
      leaking Chrome's "Cannot access contents of the page".

**Known inert feature.** Automatic revisit-refresh runs when the panel mounts, with no
invocation on that tab, so it can never hold `activeTab` and reads nothing in a release
build. It fails silently by design. Making it work needs an optional host permission
granted per origin at the user's request; until then, refresh a saved item by capturing it
again.

## Merging the baseline and the stacked redesign

Two pull requests are open, and one is stacked on the other, which makes the **merge
strategy for the first one load-bearing** — the wrong choice turns the second into a
self-conflicting mess.

- **PR #1** — the baseline (`claude/phase-prompts-build-plan-lcnf4u`) → `main`.
- **PR #2** — the UI redesign (`claude/ui-redesign-v1`), whose base is the **baseline
  branch, not `main`**. It contains every baseline commit plus the redesign delta on top.

### Why the strategy matters

`main` is a strict ancestor of the baseline branch, so PR #1 has no conflicts and could
even fast-forward. But PR #2 references the baseline commits **by their original hashes**.
Squash-merge and rebase-merge both rewrite those commits into new hashes on `main`; the
redesign branch would then still carry the originals, and retargeting PR #2 to `main`
would replay all ~44 baseline changes as conflicts against their rewritten twins.

**So merge PR #1 with a merge commit** ("Create a merge commit" in the GitHub UI), or
fast-forward it. Do **not** squash and do **not** rebase-merge. A merge commit keeps
`136ce1d` (and every commit under it) an ancestor of the new `main`, which is exactly what
keeps the stack clean.

### The sequence

1. **Take PR #1 out of draft, review, and merge it into `main` with a merge commit.**
   All five checks are green and `main` is a strict ancestor, so this is conflict-free.
2. **Point Vercel's production branch back to `main`** (it currently builds the baseline
   branch for staging — see the Staging section). The next deploy then comes from `main`.
3. **Rebase the redesign onto the new `main` and retarget PR #2:**
   ```bash
   git fetch origin
   git checkout claude/ui-redesign-v1
   git rebase origin/main            # baseline commits are now in main by hash, so
                                     # this replays ONLY the redesign delta
   git push --force-with-lease origin claude/ui-redesign-v1
   ```
   Then change PR #2's base to `main` in the GitHub UI. Its diff should collapse to the
   redesign commits alone. If the rebase surfaces conflicts, the merge strategy in step 1
   was wrong — stop and check it was a merge commit, not a squash.
4. **Re-run the full suite on the merged `main`** — `lint`, `typecheck`, `test`,
   `build`, `test:db`, `test:e2e` — plus a `pnpm score:live` correctness pass over the
   `.live/` corpus. The two branches have only ever been tested stacked; this is the first
   run on the unified tree, and the `SILENTLY WRONG` count must still be zero.
5. **Review and merge PR #2 into `main`**, merge commit again for consistency, and the two
   tracks are one.

Only after this does comparison (the next milestone) build on a single branch rather than
forking across two.

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
