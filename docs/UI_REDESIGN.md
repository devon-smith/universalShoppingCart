# UI redesign

Universal Cart should feel like a personal shopping workspace. Today it looks like a database
with a form in front of it. This records what is wrong, what the design system does about it,
and what is deliberately not being built yet.

Phase 1 — this change — establishes tokens and primitives and migrates the two shells.
No feature layout moves, so the token migration is reviewable on its own.

Baseline screenshots live in `.screenshots/` (gitignored, `pnpm screenshots:baseline`). They
carry most of the argument below; this document is the short version. **21 states, 161 images**
— every panel state and every populated dashboard state, at four widths each, in light and
dark. Both clients are driven through their real flows: the panel signs in and captures fixture
product pages, the dashboard runs against a seeded account.

Two notes on how they are produced. The panel is photographed from the **end-to-end** bundle,
which differs from the release bundle in exactly one respect — `WXT_E2E=1` grants
`http://127.0.0.1/*`, because a script-dispatched click cannot confer `activeTab`, which is
Chrome's decision and needs a human pressing the toolbar button (VALIDATION.md, tier 4).
Nothing visual differs; the release build's authorization is verified by hand, which is where
that belongs. And every frame masks the signed-in address **and the dashboard greeting**, which
is built from its local part and leaks it even when the address below is covered.

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

### What the capture preview actually is

Phase 2's brief — turn the long form into a product-first confirmation view — is justified by
one screenshot. `panel-capture-preview` is a stack of seven labelled form controls: Title,
Price, Currency, variant chips, Quantity, Note, destination, button. **There is no product
image anywhere in it.** The thing being confirmed is represented by a text input containing
its name.

That inverts what the moment is for. The user has just looked at a product page; what they
need is "is this the right thing, and is the price right", answerable in a glance from a
photograph and a number. Instead they get a form to audit, in which the title — the field
least likely to be wrong — is given the most prominent control, and the price sits third in a
column of identical boxes.

The low-confidence variant is the one part that already works. `panel-low-confidence-preview`,
captured from a genuinely uncertain extraction rather than a forced flag — `dom-only.html`
scores 0.55 with `product.title` under the review threshold — puts an amber callout above the
form and a `⚠` against the field itself. Tone and placement are right; the redesign should keep
both and inherit them into the new layout rather than reinvent them.

### What the populated dashboard reveals

- **The image placeholder dominates the card.** Seed captures carry no image, and a card is
  then a large grey rectangle with four lines of text beneath it. Real captures often have no
  image either. The placeholder currently occupies more of the card than the price does.
- **Retailer and brand are both rendered, and are usually the same string.** Cards read
  "Northwind · Northwind". Two fields, one fact, twice the space.
- **Price change uses green correctly.** "▼ $4.05 (5%) since you saved it" — an observed fall,
  which is the one thing green is allowed to mean. Worth preserving exactly.
- **The detail drawer's split is right and should be kept.** "What the retailer says" against
  "Yours", with the observed fields explicitly not editable and a sentence explaining why.
  That distinction is the product's central idea and the drawer is the only place it is
  currently stated.
- **Price history is a list, not a chart** — by decision (DECISIONS.md). Seven observations
  render as seven rows of `$79.95 · In stock · 7/29/2026, 6:49:20 PM · revisited`. The rows are
  legible but the series has no shape: the reader cannot see the trend without reading every
  row, and the full timestamp dominates the price. A sparkline beside the list, not instead of
  it, is the phase 4 question.
- **Filters are a permanent bar, not a disclosure**, and at 375px the search field and three
  selects wrap into a block as tall as the first card — so the narrow-width dashboard opens on
  its controls rather than on its contents.
- **A stray value leaks into the panel's recent list.** `panel-low-confidence-preview` shows
  `0 · $98.00 · Saved`. The leading `0` appears to be a quantity or price-delta rendering
  through an empty branch. Logged here because the screenshots found it; it is a defect for the
  queue, not a redesign decision.

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

**This phase:** tokens, thirteen primitives with tests, both shells migrated, the full baseline
capture (21 states, 161 images), this document.

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

## Phase 2C — authentication and settings

The last of the extension's own surfaces. Three things changed and one long-standing question
was settled.

**Sign-in became onboarding.** It was a heading reading "Sign in" above two controls, which
asks for an address before saying what it buys. Now: what the product is, three things it does,
then the form — mechanism unchanged, still a six-digit code verified inside the panel, because
the panel cannot follow an emailed link into a browser tab whose cookies are not its session
storage. Each benefit is a claim about shipped behaviour; none of them says the price is
watched, because nothing watches it yet (BUILD_PLAN.md §14.2).

**Failures say what to do.** "Token has expired or is invalid" is one string for two different
situations, and Supabase returns it for both deliberately — telling them apart would tell an
attacker which codes had once been real. So the panel offers both readings and the single
action that resolves either, and never asserts "your code expired" as though it knew. Rate
limiting is distinguished, because there the useful advice is the opposite: wait, do not resend.
Our own validation messages pass through untouched — "Enter a valid email address" needs no
"Sign-in failed" wrapped around it.

**The permission copy found its home.** What 2A took out of the header is now `PrivacyContent`,
reachable from settings and from a disclosure on the sign-in screen — the person deciding
whether to trust a freshly installed extension is exactly the one who wants it. It is written
for a person rather than transcribed from the manifest: what is read and when, the seven
captured fields in full, and what is never touched. The field list is `ProductCaptureV1`; if
that type gains a field, this list is wrong and must change with it.

**Settings is a destination, not a drawer.** At 320px an expanding section under capture and
the recent list pushes the primary action off the bottom. Both subviews replace the shell, so
each takes the `h1` and focus on arrival, and returns focus to the account button on the way
out. Contents are deliberately few: account, appearance, starting cart, the real keyboard
shortcut, privacy, dashboard links, sign out. No notification or export rows — a settings
screen full of controls for unbuilt features is a list of promises.

**Two honesty fixes fell out of it.** The shortcut was printed as `⌘⇧U`, which is the macOS
suggestion and nothing else — wrong on Windows, and wrong for anyone who rebound it. It now
comes from `chrome.commands`, including the case where Chrome assigned no binding at all. And
the "not configured" screen printed environment-variable names to whoever opened it; that is
useful in `wxt dev` and reads as broken software to someone who installed from the Web Store,
so the release path now says what happened in English.

### The `panel-known-item` image frame, settled

2B flagged that this state kept an image frame where the other states collapsed to the no-image
layout, and guessed the error event was landing just after the shutter. The guess was wrong in
its mechanism. Measured, `cdn.example.com` fails in 1–65ms, and instrumenting the real flow
showed both states behaving identically: frame at +0ms, collapsed by +140ms, in the saved state
and the known-item state alike. There is no `onUnavailable` gap — the wiring fires in both.

What differed was elapsed time before the shutter. `shootAll` waited a fixed 140ms, and the
known-item path reaches it with less slack because `panel.reload()` destroys everything and the
recognition text and the image element appear in the same tick. A race landing on the boundary,
not a layout bug. The harness now waits for every image to have resolved rather than for a
clock, so the shot describes the component instead of the machine it ran on.
