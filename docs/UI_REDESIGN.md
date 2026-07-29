# UI redesign

Universal Cart should feel like a personal shopping workspace. Today it looks like a database
with a form in front of it. This records what is wrong, what the design system does about it,
and what is deliberately not being built yet.

Phase 1 — this change — establishes tokens and primitives and migrates the two shells.
No feature layout moves, so the token migration is reviewable on its own.

Baseline screenshots live in `.screenshots/` (gitignored, `pnpm screenshots:baseline`). They
carry most of the argument below; this document is the short version.

## What is wrong now

**Everything is the same weight.** Surface white, page white, card white. Titles, prices,
retailer names and timestamps sit within a step or two of each other, so nothing is findable
by shape — only by reading. On a dashboard whose job is "which of these three jackets", that
is the central failure.

**No elevation vocabulary.** Cards are separated by 1px borders. A bordered card inside a
bordered list reads as a table cell, which is why the dashboard feels like a spreadsheet even
though its content is photographs and prices.

**Two colour systems.** The extension has `--panel-*` (`#10141a` ink, `#2f6df6` accent), the
web app has `--color-*` (`#10141a`, `#2f6df6` again, but a different muted grey and a
different line). They were kept in step by hand, which is not a mechanism.

**Money is styled ad hoc.** Price rendering is duplicated per surface. Nothing structurally
prevents a range, an instalment or a subscription price from being drawn as a plain total —
and all three exist in the live captures.

**Missing data is rendered as absence rather than as a state.** Original price is present on
2 of 16 live pages and availability is unknown on 7, so "thin" is the normal case, not the
edge. Blank cells read as a broken interface rather than an honest one.

**Accessibility gaps.** No consistent focus treatment; the browser default outline disappears
against several backgrounds. Icon-only controls rely on each call site remembering a label.
Contrast was never measured — and when measured, two of the intended semantic colours failed
(see below).

**Responsive gaps.** The side panel is usable at its default width and cramped at 320px, where
Chrome actually opens it for many users. Long retailer titles push prices out of view rather
than wrapping.

## The design system

**One semantic token set** (`packages/ui/src/tokens.css`) consumed by both clients. Light and
dark are the same design at two luminances, driven from the same names; `data-theme` overrides
the system preference in either direction.

**Warm neutral ground.** `#FAF9F7` page, white cards. The page is no longer the same colour as
the things on it, which is what lets elevation do any work at all.

**Elevation is shadow.** Two shadows, `raised` and `overlay`. Borders return to being
separators.

**Radius, spacing, motion.** 14px surfaces, 9px controls, pill. An 8 grid with 4 for tight
pairs. 160ms standard, 220ms enter, both zero under `prefers-reduced-motion`.

**System sans for interface text; a bundled serif for the wordmark only.** No font is fetched
by either client — mandatory for the extension (BUILD_PLAN.md §17.4), and a dashboard that
does not block on a font is a faster dashboard.

### Colour discipline

Green, amber and red are **semantic only**. Green means an observed price fell or an action
succeeded. Amber means a field needs review. Red means destructive or error. There is no
`good`, no `deal`, no `great price` — the data cannot support that claim, and colour that
implies it is the interface inventing an opinion. With original price on 2 of 16 pages, the
temptation to dress a thin capture in reassuring colour is exactly what has to be designed out.

### Contrast, measured

Every pair was computed rather than assumed, and two intended values moved:

| Pair                                | Intended | Measured | Now     | Measured |
| ----------------------------------- | -------- | -------- | ------- | -------- |
| `success` on `surfaceMuted` (light) | #15803D  | **4.37** | #166534 | 6.22     |
| `warning` on `surfaceMuted` (light) | #B45309  | **4.38** | #92400E | 6.18     |

Both were under the 4.5 normal-size text needs, and a status badge on a muted surface is
exactly normal-size text on a muted surface.

Separately, `border` measures 1.27 against white. That is correct for a decorative separator
and insufficient for the outline of a control, which WCAG 1.4.11 puts at 3:1. A
`borderStrong` token (3.71 light, 3.99 dark) exists for anything a user clicks or types into,
and `TextInput` uses it.

Everything else in the intended palette passed, including all of dark mode.

## Primitives

Thirteen, in `packages/ui`: `Button`, `IconButton`, `TextInput`, `Badge`, `StatusBadge`,
`Price`, `ProductImage`, `Surface`, `Skeleton`, `Spinner`, `EmptyState`, `Callout`, `Toast`.

They are plain CSS on `uc-` classes, not Tailwind utilities, because they render in the web
app _and_ in the side panel, which has no Tailwind. A primitive written in utilities would
work in one client and get duplicated for the other.

Two deserve their reasoning stated here.

**`Price` is built so the three ways we have actually seen money misrepresented cannot be
expressed.** Not discouraged — unrepresentable:

- A **range** goes through `range`, which has no strikethrough to lend it. Chewy's
  10.99–145.94 aggregate cannot become "was 145.94, now 10.99".
- An **instalment** or **subscription** price must state its `cadence`, and the marker is
  rendered from it, so "4 payments of $32.25" cannot reach the screen looking like a total and
  an autoship price cannot look like a buy-once price.
- `listPrice` is additionally dropped at runtime unless strictly greater than the current
  price, using exact decimal comparison — so a mislabelled lower number produces no
  strikethrough rather than an invented saving.

**`ProductImage` owns its box.** Fixed aspect ratio, `object-fit: contain`, a drawn fallback
rather than the browser's broken-image glyph, and an `onError` path to it. Four of five live
pages serve deliberately downscaled files, some serve tracking pixels, and listings rotate and
404 — so nothing about incoming dimensions is assumed and a missing image costs zero layout
shift.

## Proposed information architecture

Not built in this phase; recorded so the primitives are shaped for it.

- **Extension** optimises for speed and confidence: what was found, how sure we are, what is
  missing, one obvious save. Uncertainty is surfaced inline (`Callout` amber) rather than
  blocking.
- **Dashboard** optimises for browsing, organising and deciding: a warm ground with cards on
  it, price and image dominant, retailer and timestamp recessive, filters that do not compete
  with content.

## Scope

**This phase:** tokens, thirteen primitives with tests, both shells migrated, baseline
screenshots, this document.

**Phases 2 to 4:** side panel states, dashboard cards and list, item detail, price history,
filters, empty and error states.

## Non-goals

- **Comparison tray and comparison view.** Cut deliberately. Its rows are original price
  (2 of 16 pages), variant (opaque tokens such as `Color=76616`), and composition — a field
  that does not exist yet and currently has only an ADR. Building the surface before the data
  exists means designing around gaps and rebuilding once they fill. It ships after the
  deferred defect queue, on top of this system.
- **A large primitive library.** The original brief listed 28. Thirteen is what phases 2 to 4
  consume; an unused primitive is a maintenance cost with no user.
- **No change to extraction, RLS, the security model, extension permissions, or the Supabase
  architecture.** None of those are UI problems and none are touched.
