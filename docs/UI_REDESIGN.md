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

## Phase 3 — the dashboard shell and cart browsing

**The front door was lying.** The landing page opened with "Phase 1 — accounts and access
control" and closed with "product capture, the dashboard, and sharing arrive in later phases".
Both were true when written and had been false for several phases. A first visitor was reading
a changelog written for the person building it, describing a product less capable than the one
they were about to use. It now says what the thing does, in three steps, with every claim
mapped to shipped behaviour — "re-checked when you revisit", not "tracked", because nothing
runs in the background yet. `/login` keeps its mechanism exactly and gains the same framing.

**The dashboard opened on its own controls.** Five bare selects and two checkboxes sat in a row
above the results; at 375px that row wrapped to a block taller than the first product card. The
secondary filters now live in a popover, what is active shows as a chip beside the results, and
search stays visible in the content column where it acts on what you can see. The header says
which cart, how many items, when it last changed, and how to add one — which is the extension,
stated rather than assumed.

**Navigation, and one control per fact.** Cart, Recently changed, Purchased, Archived: a rail
from `lg` up, a drawer below it, counts beside each label. The nav _is_ the status control, so
the Status select is gone — two controls writing one field could disagree. Diagnostics left the
header for the account menu, labelled as the developer tool it is; it names DOM markup and
extractor versions and is not a shopping destination.

**Cards and rows.** Cards are image-forward, because somebody choosing between three jackets
recognises them by sight before they read a title. The list is not a squashed card grid — it
exists so price sits under price and availability under availability, which is how you notice
two of four are out of stock without reading four paragraphs. Both go through `ProductImage`
and `Price`, and a card with no usable image drops the frame rather than reserving a grey
rectangle.

Two audit findings closed at the display layer. "Northwind · Northwind" was brand and retailer
printed twice; `sourceLine` compares them loosely and says it once. Titles carrying "…& Reviews
| Wayfair" are trimmed by `displayTitle`, which never drops the first segment and returns the
original if its rules would empty it. Neither touches the extractor — the stored title stays
the record of what the page said.

**Five empty states, not two.** A search miss, a filter miss, an empty cart, an empty section
and a new account are five different situations that shared two messages, one of which told a
person who had typed a search term to go and look at their filters. Each now names what
happened and offers the control that fixes it.

**No comparison UI.** Not a checkbox, not a tray, not a nav entry. It is built as its own work
after the redesign, per the ADR — and a control that leads nowhere is worse than its absence.

### What the tests caught

Three defects surfaced from the e2e suite rather than from looking at screenshots, which is
the argument for having driven it through the real flows:

- `role="menuitem"` **replaces** the implicit button and link roles. `getByRole('button', {
name: 'Sign out' })` stopped matching, and a screen reader would have stopped calling the
  diagnostics link a link. Both overlays are now labelled groups of ordinary controls.
- The Archived section rendered nothing. `sectionItems` included the archived items and
  `applyQuery` then re-applied the status rule, whose "no statuses means hide archived"
  default discarded them. The section's statuses are now handed to the query.
- The whole suite ran green against a **stale** `next start` from an earlier session,
  reporting thirteen failures that were all the old UI. Worth remembering: `reuseExistingServer`
  is not free.

A fourth came from the screenshots: at 1024px the row's six columns truncated the retailer to
"Northwind · Bergs…" and wrapped every chip three lines deep. The variant moved under the
product name it belongs to, leaving five columns and the alignment that actually matters.

## Phase 4 — item decisions

**The drawer states the product's central idea outright.** "What the retailer says" and
"Yours" are now two surfaces with their own headings, each carrying a sentence explaining what
it is and why it behaves as it does: observed values are not editable because a correction
would erase what was actually seen, and user fields are never touched by a refresh. The audit
called this the product's central idea and the only place it is stated; it is louder now, not
quieter.

**Both URLs, labelled.** `Page you saved from` and `Canonical address`, under the provenance
disclosure with the product codes. The canonical address is what the fingerprint is built
from, so seeing it beside the source is the only way a tester can report the `canonical`
failure code in LIVE_TESTING.md — a variant parameter silently dropped. Lululemon's product id
is a whole URL carrying `?color=76616`; whether that colour survives is exactly this, and it
was unobservable while the row did not exist.

**Both availability facts, when they differ.** `items.product_availability` exists as of
ee3f8eb and is written only when the page's product-level claim disagrees with the variant's —
so a non-null value is, by construction, the interesting case. The drawer says it as a
sentence: _the size you chose is sold out — the product is still sold_. That is the difference
between "stop looking" and "try another size".

**Price history answers questions instead of logging.** Four figures above the list — now,
lowest seen, highest seen, what it cost when you saved it — then the change since saved, then
the rows. The old list gave the price a small font and handed the rest of each row to a full
`toLocaleString()` timestamp, making the least interesting value the widest thing on the line.
That is inverted. A sparkline sits beside the figures; see the ADR for why it earns the space,
why it starts at three points, and why there is no charting library.

**The target price has a treatment.** A bar, the distance to go, and a badge that is green in
exactly one case: an observation recorded the price at or below the target. "It has been at or
below before" is tracked separately, so a green badge cannot survive a price rise.

**One live region.** Save, archive-with-undo, delete-confirmed, and rollback-after-failure all
go through `Announcements`. Failures are assertive and persist; confirmations are polite and
expire. Saving used to confirm nothing at all.

### What the environment caught, again

Three stale-environment traps in two sessions, and this phase supplied the third: the e2e suite
failed twelve tests because the local database predated `ee3f8eb`'s migration, so the new
`product_availability` column broke the dashboard query. The earlier two were a `next start`
left running from a previous session and a `.live/baseline.json` older than the branch it was
being diffed against.

The pattern is the same each time — a cached artifact that looks like a result. It is worth
checking what a green or red run is actually running against before believing either.

## Phase 5 — accessibility hardening

No new features. Six defects, one of them the most consequential thing this redesign has
touched.

### The focus ring failed contrast, in both themes

`--uc-focus-ring` was `primary` at 40% alpha. The token measures 7.51 against the light
background and 5.89 against the dark one, which is what made it look settled. What a browser
actually paints is the token composited onto the surface behind it: `#b1ace5` and `#434771`,
measuring **2.02 and 1.99** against the gap inside the ring — against the 3:1 that WCAG
1.4.11 asks of anything carrying state.

It is the one affordance a keyboard user cannot work without, and the phase that exists to
make the product keyboard-operable found it first.

The ring is now drawn at full `primary`, and declared **once** instead of four times: both
`var()`s inside it resolve when an element computes its `box-shadow`, so the theme blocks
inherit the right ring without repeating it. Three hand-maintained copies of a colour went
away with it.

The wider fix is `contrast.test.ts`, which reads `tokens.css` and re-derives every ratio the
file's header comment claims — 73 assertions covering each text colour on each surface it
appears on, each non-text mark against what sits behind it, and the two hand-duplicated dark
palettes against each other. The comment had said "every pair below was measured rather than
assumed", which was true when written and cannot stay true on its own. Verified by reverting
the ring to its old value and watching the suite go red.

Every pair Phase 4 added passes unchanged: sparkline stroke 5.89/4.81, target bar 6.89/4.81
above and 6.22/8.24 reached, change-since-saved text 6.78/10.08.

### Reduced motion had a hole the tokens could not reach

`tokens.css` zeroes `--uc-duration-*`, which covers every transition written against a token.
The dashboard's rows carry Tailwind's `transition-opacity`, whose duration comes from
Tailwind's own variable — measured at 0.15s with the preference set. One rule in
`components.css` now neutralises transitions and animations globally, at `1ms` rather than
`0s` so `transitionend` still fires and nothing waiting on it hangs.

The test measures `getComputedStyle` across every element in the page, and asserts the
emulation took effect first — an emulation that silently fails would have made it pass by
measuring a browser that was never asked to reduce anything. `test.use({ reducedMotion })` did
silently fail here; `page.emulateMedia` does not.

### Five keyboard traps

- **No way past the navigation.** Eight identical tab stops before the first product, on every
  visit (WCAG 2.4.1). A skip link now precedes them, hidden until focused.
- **Dismissing a popover dropped focus onto `<body>`.** The account menu and each card's
  overflow are deliberately not focus-trapped — they do not cover the page. But they still
  unmount, taking anything focused inside them. `useReturnFocus` gives the keyboard back to
  the trigger, and only when the popover had it: if the user clicked another control, that
  choice is respected.
- **The delete confirmation replaced the button that opened it**, so answering "are you sure?"
  lost the keyboard. Focus now follows the decision, and the confirm button is described by
  the question so a screen reader reads the prompt rather than four words.
- **Editing a value in the capture preview.** Flagged fields already took focus; the affordance
  for correcting a value the extractor _was_ confident about swapped a heading for an input and
  left focus nowhere.
- **Leaving the privacy view** landed on the Settings heading rather than the link that led
  there. Arriving is a navigation and should announce; returning is a return.

### Two live-region defects

`aria-haspopup="menu"` survived on both disclosures whose own comments explain at length why
they are _not_ menus — and every value of that attribute names a widget, with `true` a synonym
for `menu`, so there is no honest one to use. Removed; `aria-expanded` with `aria-controls` is
the disclosure pattern, which is what these are. The panels also gained `role="group"`, without
which their `aria-label` attaches to nothing and is dropped — the account menu had been
reaching screen readers unnamed.

The genuine double-announcement was in the panel: entering the preview mounted an amber
`role="status"` callout at the same instant the panel's own `aria-live` region announced the
same event, so a screen reader queued both. The callout is no longer a live region and the
panel's message carries the whole outcome, including what to do about it. `capture.spec.ts`
asserted on the callout's `status` role; that assertion was rewritten rather than deleted, and
now checks both halves more precisely — the instruction is visible, and it is announced
exactly once.

The dashboard's "Add a product" help was also `role="status"`: static text, revealed by a
button, announced on open and left live afterwards.

### Bundle

Side panel, release build:

|     | raw     | gzip    |
| --- | ------- | ------- |
| js  | 542,897 | 150,573 |
| css | 24,369  | 4,463   |

Phase 5 alone: **js +684, css +16** — the reduced-motion rule almost exactly offset by the
three focus-ring declarations it became possible to delete.

Across 2A–5, from the pre-redesign baseline:

|     | before  | after   | delta           |
| --- | ------- | ------- | --------------- |
| js  | 513,341 | 542,897 | +29,556 (+5.8%) |
| css | 11,727  | 24,369  | +12,642 (+108%) |

The CSS doubling is the design system itself — two themes plus two forced-theme blocks, and
every primitive's styles, shared by both clients. 4.5 kB gzipped for that is not something to
optimise. The JS growth is three views the panel did not have (onboarding, settings, privacy),
the preferences and shortcut modules, and the primitives; ~29 kB raw across four phases is
proportionate, and nothing in it is a dependency — no charting library, no font, no
component runtime.

### D1 — failed, then passed

The manual check this phase was meant to close failed on first run, and the reason was worth
more than the pass would have been: the strikethrough rule read a class-based strike
correctly and was never invoked on the pages that motivated it, because it anchored to a
current price the DOM tier does not find. The fifth green-proved-less instance — and this
time the environment did not supply the trap, the test did, by building the `data-price`
anchor the real pages lack.

`9067454` moved resolution post-merge and anchored it on the current-price **value**. The
re-run passes: the panel previews `$94.97, reduced from $120.00` on Nike, captured through
the side panel in real Chrome.

Worth recording how it was confirmed, because the obvious check would have been too weak.
Nike ships two signals — an `aria-label` naming the original price, and a class-struck
`$120` — and the label is tried first, so a green capture proves only that _something_
worked. Stripping all seventeen price-bearing `aria-label`s from the live document and
re-running the helper still returns
`{ amount: "120.00", selector: "strikethrough near current price" }`. The class-based path
works on its own, which is the thing D1 exists to establish.

Full write-up, including the three pages that still fail and precisely what blocks each, is
in VALIDATION.md — it is extraction work, not UI. The actionable one: Wayfair's struck
`$993.97` sits three parent hops from its price element while the scan reaches two.
