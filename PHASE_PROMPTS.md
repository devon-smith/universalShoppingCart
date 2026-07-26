# Universal Cart — Phase Prompts for Claude Code or Codex

Use one prompt at a time. Start a new branch or clean working state for each phase. Do not paste all prompts into one long-running goal.

---

## Prompt 0 — Repository foundation

```text
Read AGENTS.md or CLAUDE.md and BUILD_PLAN.md. Implement Phase 0 only.

Create a clean pnpm/Turborepo monorepo with:
- apps/web: Next.js App Router + TypeScript + Tailwind
- apps/extension: WXT + React + Manifest V3 with a working side panel
- packages/contracts, packages/extractors, packages/ui, packages/config, packages/test-utils
- local Supabase configuration and migration directory
- root lint, typecheck, test, build, and Supabase scripts
- GitHub Actions CI
- .env.example files
- docs/ARCHITECTURE.md, docs/DECISIONS.md, docs/STATUS.md, and docs/RUNBOOK.md

Do not implement authentication, product capture, database product tables, or dashboard features yet.

Before editing, inspect the environment and state a concise plan. After implementation, run all root checks, verify the web app launches, verify the extension production build succeeds, update docs/STATUS.md, and stop. Report exact commands and results.
```

---

## Prompt 1 — Authentication and RLS

```text
Read the project instructions and BUILD_PLAN.md. Implement Phase 1 only.

Add:
- Supabase Google sign-in and email magic-link fallback in the web app
- a tested Supabase authentication flow for the WXT extension using extension-local session storage
- profiles, carts, and cart_members migrations
- automatic creation of exactly one default cart per user
- owner/editor/viewer authorization model
- RLS policies and tests
- protected web app routes
- sign-out and session recovery

Do not implement product extraction or item storage yet.

Security requirements:
- no service-role key in any client
- no provider secret in the extension
- anonymous users read no private data
- User A cannot access User B's cart

Run database tests, unit tests, lint, typecheck, and builds. Update docs and stop after Phase 1.
```

---

## Prompt 2A — Capture contract and extraction engine

```text
Implement only the first half of Phase 2: shared capture contracts and deterministic extraction.

Create:
- ProductCaptureV1 Zod schema and TypeScript types
- price, currency, URL, retailer-domain, and variant normalizers
- JSON-LD Product/Offer parser supporting arrays and @graph
- Open Graph/product-meta fallback
- conservative generic DOM extractor
- field-level evidence and confidence merging
- sanitized local HTML fixtures and expected capture JSON
- Vitest coverage for success, missing data, multiple offers, sale pricing, and variants

Do not add Supabase item tables, side-panel save UI, or real retailer adapters yet.

All extractor outputs must be serializable. Do not use remote code or live retailer pages in tests. Run checks, update docs/EXTRACTION.md and docs/STATUS.md, then stop.
```

---

## Prompt 2B — Capture save vertical slice

```text
Complete the second half of Phase 2 only.

Add:
- items and item_observations migrations
- exact numeric price storage
- fingerprint generation and duplicate behavior
- RLS policies
- an atomic authenticated ingest_product_capture database function
- extension message flow from user action to content-script extraction
- side-panel preview/edit/save UI
- destination cart selection
- dashboard page showing saved items
- end-to-end test using a deterministic local product fixture

A duplicate save must refresh the existing item without overwriting user-authored fields.

Do not add search/filter dashboards, real retailer adapters, sharing, background refresh, alerts, or AI.

Run all relevant database, unit, extension, web, and build checks. Update docs and stop.
```

---

## Prompt 3 — Cart UX

```text
Implement Phase 3 only.

Build the useful daily dashboard and extension cart UI:
- list and card views
- item detail drawer/page
- search, sorting, and filters
- quantity, note, priority, desired price, and status
- optimistic mutations and undo for archive/delete
- recent items in the extension side panel
- polished empty, loading, partial-data, and error states
- Supabase Realtime cache updates

Do not implement price-history refresh, sharing, scheduled jobs, alerts, retailer adapters, or AI.

Ensure retailer-observed updates cannot overwrite user-authored fields. Add tests, run all checks, update docs, and stop.
```

---

## Prompt 4 — Observations and revisit refresh

```text
Implement Phase 4 only.

Add:
- matching the current page to a saved item by normalized URL/fingerprint
- explicit and automatic-on-side-panel revisit refresh
- observation deduplication
- price and availability history
- price-change badges
- last-checked and stale-data states
- tests proving notes, quantity, priority, desired price, and status survive refresh

Do not implement a scheduled server crawler or notifications yet.

Use deterministic fixtures for automated tests. Run checks, update docs, and stop.
```

---

## Prompt 5 — Retailer adapters

```text
Implement Phase 5 only.

First inspect any project usage notes or fixture requests and select only five retailer patterns that are actually needed. Add a versioned adapter registry and one adapter at a time.

Each adapter must include:
- supports() logic
- field-level evidence
- selected-variant handling
- at least two sanitized fixtures
- expected-output tests
- generic fallback when the adapter fails

Add an internal diagnostics view showing domain, adapter ID/version, field presence, confidence, and failure class without logging user notes or sensitive URLs.

Do not add browser automation, background crawling, or remote adapter code. Run checks and stop.
```

---

## Prompt 6 — Sharing and comparison

```text
Implement Phase 6 only.

Add:
- secure, expiring, single-use cart invitations
- owner/editor/viewer roles enforced by RLS
- membership management
- real-time collaborator updates
- compare tray for two to four items
- compare view that highlights only known differences
- open-all grouped by retailer
- activity attribution with updated_by where useful

Do not add AI-generated summaries yet. Missing fields must remain visibly unknown.

Add authorization and end-to-end tests, run all checks, update docs, and stop.
```

---

## Prompt 7 — Background refresh and alerts

```text
Implement Phase 7 only.

Before coding, write a short ADR choosing the smallest suitable job mechanism for this repository. Prefer Supabase Cron/Queues or one small worker; do not create multiple services.

Add:
- refresh_strategy classification
- due-item selection
- public-fetch refresh path only
- SSRF protections, response limits, timeouts, redirect checks, domain rate limits, and exponential backoff
- observation updates
- desired-price and back-in-stock rules
- deduplicated in-app notifications

Browser-required and disabled items must not be force-fetched.

Do not add a headless browser farm. Add security tests, run checks, update runbook, and stop.
```

---

## Prompt 8 — Matching and AI assistance

```text
Implement Phase 8 only after all deterministic phases are green.

Start with deterministic matching:
- GTIN/UPC/EAN
- brand + MPN/model
- normalized title and identifiers
- explicit match confidence and reasons

Then add a provider-abstracted, server-only optional AI path for:
- attribute normalization
- candidate scoring
- fact-grounded comparison summaries

Requirements:
- no provider key in clients
- no full page HTML sent to AI
- record prompt/model version and provenance
- medium-confidence matches require user confirmation
- AI cannot overwrite source facts automatically
- summaries distinguish known facts from missing data

Add tests with a fake provider. Run all checks, update docs, and stop.
```

---

## Prompt 9 — Release hardening

```text
Implement Phase 9 only.

Add and verify:
- privacy page describing exact extension data access
- data export and account deletion
- production logging and error monitoring with sensitive-field scrubbing
- deployment and rollback runbook
- Chrome Web Store testing release assets and checklist
- versioned WXT zip artifact workflow
- secret inventory and rotation notes
- backup/restore verification
- final clean-clone setup test

Do not claim completion until a nondeveloper friend can install the testing build, sign in, save an item, and see it sync in the web app.

Run the full test and build suite, document manual verification, and stop.
```

---

## Generic bug-fix prompt

```text
Read the project instructions. Investigate this single bug: [describe bug].

First reproduce it with the smallest deterministic test or fixture. Identify the root cause. Make the smallest focused fix, add a regression test, run relevant checks, update docs/STATUS.md if user-visible behavior changed, and stop. Do not refactor unrelated modules or begin roadmap work.
```
