# Universal Cart

A personal, cloud-synced shopping list. A Manifest V3 browser extension captures the product on the page you're viewing; a Next.js web app stores, compares, and shares saved products across devices.

This is **not** a universal checkout system. It never stores retailer credentials, cookies, or payment data.

## Status

**Phase 0 complete** — monorepo scaffold, running web app, loadable extension side panel, local Supabase configuration, and CI. No authentication, capture, or dashboard yet. See [docs/STATUS.md](docs/STATUS.md).

## Stack

- pnpm workspaces + Turborepo, TypeScript strict mode
- `apps/web` — Next.js App Router + Tailwind
- `apps/extension` — WXT + React, Manifest V3, Chrome Side Panel
- Supabase Postgres, Auth, Row Level Security, Realtime
- Vitest (unit) + Playwright (web and extension e2e)

See [BUILD_PLAN.md](BUILD_PLAN.md) for the full architecture, data model, security requirements, and phase acceptance criteria.

## Getting started

Requires Node.js 22, pnpm 10, Docker, and Chrome.

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local
cp apps/extension/.env.example apps/extension/.env
pnpm dev
```

The web app runs at <http://localhost:3000>. Load the extension at `chrome://extensions` → Developer mode → **Load unpacked** → `apps/extension/.output/chrome-mv3`.

Full setup, local Supabase, and troubleshooting: [docs/RUNBOOK.md](docs/RUNBOOK.md).

## Documents

| File                                         | Purpose                                                                                            |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [BUILD_PLAN.md](BUILD_PLAN.md)               | Product contract, architecture, data model, deployment, security, tests, phase acceptance criteria |
| [AGENTS.md](AGENTS.md)                       | Persistent instructions for Codex                                                                  |
| [CLAUDE.md](CLAUDE.md)                       | Persistent instructions for Claude Code                                                            |
| [PHASE_PROMPTS.md](PHASE_PROMPTS.md)         | Bounded prompts — run one at a time                                                                |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | What exists today and the boundaries later phases must respect                                     |
| [docs/STATUS.md](docs/STATUS.md)             | Per-phase state and verification results                                                           |
| [docs/DECISIONS.md](docs/DECISIONS.md)       | Short ADRs                                                                                         |
| [docs/RUNBOOK.md](docs/RUNBOOK.md)           | Setup, local Supabase, releases, troubleshooting                                                   |

## How to work on this repo

Work happens **one bounded phase at a time**. Do not hand an agent the whole build plan as a single goal — the phase boundaries exist to keep runs reviewable and prevent overbuilding.

1. Start from a clean working state on a new branch.
2. Paste the next prompt from [PHASE_PROMPTS.md](PHASE_PROMPTS.md).
3. Review the diff and the reported test results.
4. Commit, merge, and only then move to the next phase.

## Commands

These root scripts must keep working from a clean clone:

```bash
pnpm dev             # Next.js dev server + WXT dev build
pnpm lint
pnpm typecheck
pnpm test            # Vitest, every workspace
pnpm build           # web + extension production bundles
pnpm test:e2e        # Playwright against the built web app
pnpm format          # Prettier write
pnpm format:check    # Prettier check (CI runs this)
pnpm supabase:start
pnpm supabase:status
pnpm supabase:stop
pnpm supabase:reset
```
