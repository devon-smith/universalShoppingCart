# Universal Cart

A personal, cloud-synced shopping list. A Manifest V3 browser extension captures the product on the page you're viewing; a Next.js web app stores, compares, and shares saved products across devices.

This is **not** a universal checkout system. It never stores retailer credentials, cookies, or payment data.

## Status

Pre-Phase 0. The repository currently contains the plan and agent instructions only — no application code yet.

## Planned stack

- pnpm workspaces + Turborepo, TypeScript strict mode
- `apps/web` — Next.js App Router + Tailwind
- `apps/extension` — WXT + React, Manifest V3, Chrome Side Panel
- Supabase Postgres, Auth, Row Level Security, Realtime
- Vitest (unit) + Playwright (web and extension e2e)

See [BUILD_PLAN.md](BUILD_PLAN.md) for the full architecture, data model, security requirements, and phase acceptance criteria.

## Documents

| File | Purpose |
| --- | --- |
| [BUILD_PLAN.md](BUILD_PLAN.md) | Product contract, architecture, data model, deployment, security, tests, phase acceptance criteria |
| [AGENTS.md](AGENTS.md) | Persistent instructions for Codex |
| [CLAUDE.md](CLAUDE.md) | Persistent instructions for Claude Code |
| [PHASE_PROMPTS.md](PHASE_PROMPTS.md) | Bounded prompts — run one at a time |

## How to work on this repo

Work happens **one bounded phase at a time**. Do not hand an agent the whole build plan as a single goal — the phase boundaries exist to keep runs reviewable and prevent overbuilding.

1. Start from a clean working state on a new branch.
2. Paste the next prompt from [PHASE_PROMPTS.md](PHASE_PROMPTS.md) (start with Prompt 0).
3. Review the diff and the reported test results.
4. Commit, merge, and only then move to the next phase.

Phase 0 produces the monorepo scaffold, a running web app, a loadable extension side panel, local Supabase config, and green CI.

## Commands

These root scripts land in Phase 0 and must keep working from a clean clone:

```bash
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm supabase:start
pnpm supabase:stop
pnpm supabase:reset
```
