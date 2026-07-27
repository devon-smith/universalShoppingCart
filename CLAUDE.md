# Universal Cart — Claude Code Instructions

@BUILD_PLAN.md

## Project objective

Help one person decide what to buy — primarily **clothing** — by putting candidates from
different retailers side by side in one place.

A Manifest V3 browser extension captures the garment on the current page; a Next.js
dashboard **compares** those candidates, and stores them so the comparison survives across
devices and sessions. Comparison is the point. Storage and sync serve it. Sharing is a
nice-to-have.

The primary category is clothing, and that shapes what is worth building. Shoppers compare
**different candidates for one purchase** — three jackets, two pairs of running shoes —
rather than the same item at competing sellers. The same garment is generally not sold by
both Zara and Gymshark. So side-by-side attributes, price, and variant are the whole value,
while cross-retailer identifier matching (GTIN, MPN, brand+model) is an electronics problem
and is deprioritised accordingly — see `docs/DECISIONS.md`.

This is not a universal checkout system. Never store retailer credentials, cookies, payment data, or unrelated browsing history.

## Required architecture

- pnpm workspace + Turborepo
- TypeScript strict mode
- Next.js App Router
- WXT + React extension
- Supabase Postgres, Auth, Row Level Security, and Realtime
- Vitest + Playwright

Record any proposed departure in `docs/DECISIONS.md` before implementation.

## Hard rules

- Work on only the requested phase or bounded task.
- Stop after that task; do not move to the next phase automatically.
- Inspect the repository and existing patterns before editing.
- Keep changes small, focused, and testable.
- Add tests for every behavior change.
- Run the relevant checks and provide exact results.
- Use minimal extension permissions.
- No remote executable code, `eval`, or remotely downloaded adapter logic.
- Never expose service-role keys or provider secrets to web or extension clients.
- Enable and test RLS on every exposed table.
- Keep user-authored fields separate from retailer-observed fields.
- Never invent missing product facts.
- Use exact money representations.
- Do not send full page HTML, cookies, tokens, or unrelated browsing data.
- Every retailer adapter needs sanitized fixtures and regression tests.
- Do not introduce microservices, headless-browser infrastructure, AI, or native-cart automation before the build plan calls for them.

## Standard commands

Keep these root commands working and documented:

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

## Per-task process

1. Read this file, the build plan, and relevant project docs.
2. Inspect git status and the affected code.
3. Present a concise plan.
4. Implement the smallest complete vertical slice.
5. Add tests.
6. Run narrow checks followed by the full required checks.
7. Update `docs/STATUS.md` and `docs/DECISIONS.md` when applicable.
8. Summarize behavior, files, database changes, commands, test results, manual verification, limitations, and one next bounded task.
9. Stop.

## Completion standard

Do not claim completion when tests are failing, setup is undocumented, security rules are missing, or only a scaffold exists without the requested end-to-end behavior.
