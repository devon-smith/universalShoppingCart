# Universal Cart — Codex Instructions

Read `BUILD_PLAN.md` before making architectural or product decisions.

## Product

Universal Cart is a personal, cloud-synced shopping list. A browser extension captures a product from the current page; a web app stores, compares, and shares saved products.

The project is **not** a universal checkout system and must not store retailer credentials, cookies, or payment data.

## Required stack

- pnpm workspace and Turborepo
- TypeScript strict mode
- Next.js App Router web app
- WXT + React Manifest V3 extension
- Supabase Postgres, Auth, RLS, and Realtime
- Vitest and Playwright

Do not replace a required stack choice without recording a short ADR in `docs/DECISIONS.md`.

## Non-negotiable engineering rules

- Implement only the phase or bounded task requested by the user.
- Do not begin the next phase automatically.
- Inspect the repository before editing.
- Keep changes focused and reviewable.
- Add tests with every behavior change.
- Run relevant checks and report their exact results.
- Keep extension permissions minimal.
- Do not use remote executable code, `eval`, or downloaded extraction logic.
- Never put a Supabase service-role key or provider secret in a client bundle.
- Enable and test RLS on every exposed table.
- Retailer refreshes may update observed fields but never overwrite user-authored notes, priority, desired price, quantity, or status.
- Unknown product information must remain unknown; do not fabricate values.
- Store prices as decimal strings in TypeScript and exact numeric values in Postgres, never floating-point money.
- Do not transmit full page HTML, cookies, auth headers, or unrelated browsing data.
- Prefer structured data and evidence-based extraction over brittle selectors.
- Every retailer adapter requires sanitized fixtures and regression tests.
- Do not add microservices, a headless browser farm, AI features, or native-cart automation before the plan calls for them.

## Expected repository commands

Maintain root scripts for:

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

If the actual scripts differ, update this file and `README.md` in the same change.

## Task workflow

1. Read this file, `BUILD_PLAN.md`, and relevant docs.
2. Inspect current code and git status.
3. Give a concise implementation plan.
4. Implement the smallest complete vertical slice.
5. Add or update tests.
6. Run narrow checks, then repository-wide checks.
7. Update `docs/STATUS.md` and any architectural decision record.
8. Report implemented behavior, files changed, database changes, commands, test results, manual checks, and known limitations.
9. Stop.

## Change discipline

- Prefer changes under roughly 500 lines when practical.
- Split large work into coherent stages.
- Do not refactor unrelated files.
- Do not hide failing tests or weaken assertions to make CI pass.
- Do not commit generated secrets, browser profiles, `.env` files, or production data.

## Definition of done for a task

A task is not done until:

- The requested behavior works end to end.
- Tests cover the main success path and important failure path.
- Typecheck and lint pass.
- Documentation and environment examples are current.
- Security and privacy implications are addressed.
- The final report is complete.
