# Validation

What must be true before building resumes, and which tier of testing can
actually prove each thing.

## Why this document exists

At commit `1b06557` the repository had 486 unit tests, 90 pgTAP assertions, and
51 Playwright tests, all green, with all four CI checks passing. Capture did not
work at all in the release build.

The cause was structural, not careless. The end-to-end build sets `WXT_E2E=1`,
which grants `http://127.0.0.1/*` as a real host permission, because a headless
browser cannot click the toolbar control that confers `activeTab`. The release
build has no host permissions and depends entirely on `activeTab`. **The tested
artifact and the shipped artifact authorized page access by different
mechanisms, and only one of them was ever exercised.**

The first real retailer page then produced three extraction failures — no price,
no currency, and specification rows reported as the selected variant — on a page
whose price is displayed in large type with a strike-through and a discount
badge.

The rule that follows: **a test proves what it exercises, not what it
resembles.** Wherever the tested artifact differs from the shipped one, that
difference is a blind spot and must be named and covered manually.

## The tiers

| Tier            | Command             | Runs against                                                              | Proves                                                                                | Cannot prove                                                                                              |
| --------------- | ------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1 Unit          | `pnpm test`         | Pure functions, jsdom, injected fakes                                     | Extraction logic, merge rules, money arithmetic, the permission list, component state | That anything crosses a process boundary                                                                  |
| 2 Database      | `pnpm test:db`      | Real local Postgres, real RLS, in rolled-back transactions                | Policies, triggers, the ingestion function, field ownership                           | That any client sends the right thing                                                                     |
| 3 Web e2e       | `pnpm test:e2e`     | Built Next app, real Supabase, real email through Mailpit, real Chromium  | Sign-in, dashboard, optimistic updates, price history, diagnostics                    | Anything about the extension                                                                              |
| 4 Extension e2e | `pnpm test:e2e`     | Built MV3 extension in a persistent Chromium context, local fixture pages | Messaging, the capture pipeline, save, duplicate refresh                              | **Authorization** — it runs the `WXT_E2E` build, which holds a host permission the release build does not |
| 5 Manual        | The checklist below | The release build, a real browser, real pages                             | Everything the tiers above structurally cannot reach                                  | Nothing — but it does not scale, so it must shrink                                                        |

Tier 5 is expensive and unrepeatable. Every finding it produces should end up as
a tier 1–4 test, so the same thing is never checked by hand twice. **A manual
checklist that never gets shorter is a sign the loop below is not being run.**

## What only manual testing can reach

These are not gaps to be fixed by writing more Playwright. They are properties of
the environment.

- **Chrome's `activeTab` granting behaviour.** Whether a given invocation confers
  the grant, and when it is revoked, is Chrome's decision. A headless context
  cannot click a toolbar control or a context-menu item the way a person does.
- **The release permission set actually working.** Tier 4 runs a different build.
- **Real retailer markup.** Fixtures are written from what we already understand.
  A page fails in the way nobody anticipated, which is precisely the way a
  fixture cannot be written in advance.
- **Google OAuth.** Needs real credentials that cannot live in the repository.
- **Session survival across a browser restart.**
- **Two devices at once.** Realtime is tested as cache-patching in one client.
- **A hosted origin.** Cookie domains, `SameSite`, CSP, extension origin against a
  hosted Supabase project, Realtime over a hosted socket.

## The manual checklist

Run **A** after any change to `lib/manifest.ts`, `wxt.config.ts`,
`entrypoints/background.ts`, or anything under `lib/capture/`. Run all of it
before a staging deploy or a store submission.

### A. Release-build authorization

| #   | Check                                                                                        | Pass                                                                                                                              |
| --- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Load `.output/chrome-mv3` unpacked. Inspect the built `manifest.json`.                       | `host_permissions` is `[]`. Permissions are exactly `sidePanel`, `storage`, `identity`, `activeTab`, `scripting`, `contextMenus`. |
| A2  | Right-click a product page → "Save to Universal Cart".                                       | Panel opens with a populated preview.                                                                                             |
| A3  | Press the keyboard shortcut on a product page.                                               | Same.                                                                                                                             |
| A4  | Open the panel, navigate to a **different** product page, use right-click.                   | Works. This is the case that was broken.                                                                                          |
| A5  | Go to `chrome://extensions`, click the service worker, let it stop, then right-click a page. | Menu still present and capture still works. A one-shot registration fails here.                                                   |
| A6  | Right-click on a `chrome://` page and on a `/checkout` URL.                                  | Refused, with an explanation rather than a raw Chrome error.                                                                      |

### B. Session and identity

| #   | Check                                                     | Pass                                                          |
| --- | --------------------------------------------------------- | ------------------------------------------------------------- |
| B1  | Sign in on the web app by emailed link.                   | Lands on `/app`.                                              |
| B2  | Sign in on the panel with the emailed code, same address. | Same account, same default cart.                              |
| B3  | Quit and reopen Chrome.                                   | Both surfaces still signed in.                                |
| B4  | Sign out in the panel.                                    | `chrome.storage.local` no longer holds the session.           |
| B5  | Google sign-in, both surfaces.                            | Blocked — no credentials. Record as not run, never as passed. |

### C. Sync across devices

| #   | Check                                                              | Pass                                        |
| --- | ------------------------------------------------------------------ | ------------------------------------------- |
| C1  | Save in the panel with the dashboard open in another window.       | Appears without a reload.                   |
| C2  | Edit a note on the dashboard.                                      | Panel's recent items reflect it.            |
| C3  | Sign in on a second browser or device and change an item's status. | The first client updates without a refetch. |

### D. Live extraction

The ten-product protocol in [LIVE_TESTING.md](LIVE_TESTING.md). D is the largest
and most valuable part of this document, and it has its own file because its
output is a dataset, not a checkbox.

| #   | Check                                                                                                                             | Pass                                                                                                                                                                                                                                                                           |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | Capture a page whose former price is struck through by a CSS class (Zalando and Nike both are) through the panel, in real Chrome. | The preview shows the struck figure as the original price. The offline scorer CANNOT verify this: it reads saved HTML whose striking CSS lives in external files it never loads, so its `original` column under-reports on exactly these pages. Only a live capture proves it. |

#### D1 — re-run 2026-08-03 after `9067454`, **PASSES**

The first run (2026-08-02) failed and is kept below, because the reason it failed is
the whole value of the check.

Re-run against `.live/oos.html` (Nike Dunk Low Retro), served to a real Chromium at
its own canonical URL so adapter selection and URL-variant logic behave normally,
with the built extension loaded unpacked, capturing **through the side panel**:

|                             |                                |
| --------------------------- | ------------------------------ |
| Panel preview, spoken       | `$94.97, reduced from $120.00` |
| Panel preview, visible      | `$94.97` · `$120.00` · `−21%`  |
| `offer.originalPriceAmount` | `120.00`                       |

**The strikethrough path was verified in isolation, not just the outcome.** Nike ships
both signals — an `aria-label="current price $94.97, original price $120"` and a
class-struck `$120` — and `struckOriginalForValue` tries the label first, so a passing
capture alone would not have shown that the class-based strike works. Stripping all 17
price-bearing `aria-label`s from the live document and re-running the helper returns
`{ amount: "120.00", selector: "strikethrough near current price" }`. Both paths resolve
it independently, which is what D1 was written to establish.

##### The other three pages, and what is actually blocking them

D1 names Zalando and Nike. Nike passes. The remaining pages were probed the same way
and each fails for a different, now-precise reason — none of them the rule this check
was about:

| page    | current price extracted | struck figure present in the saved DOM  | blocker                                                           |
| ------- | ----------------------- | --------------------------------------- | ----------------------------------------------------------------- |
| wayfair | **no**                  | yes — real `<s>$993.97</s>`, "was"      | no price anchor at all (see below)                                |
| zalando | yes (35.95)             | **no** — strike CSS is external         | measurement boundary; only a live capture can load the stylesheet |
| amazon  | **no**                  | **no** — `data-a-strike` + external CSS | no price anchor, and the strike is invisible to `isStruck`        |

**Wayfair's hop-distance blocker is fixed; its remaining one is older and separate.**
`e0e7d88` added the cue-gated path, and it works on the real page: given Wayfair's
actual current price, `struckOriginalForValue("672.96")` now returns
`{ amount: "993.97", selector: "was-labelled strikethrough above price" }` — the
figure three hops up that adjacency alone could not reach.

End to end the page is unchanged, and that is not a failure of the fix. The resolver
runs post-merge _only when a current price is already known_, and on Wayfair no tier
finds one: JSON-LD carries no offer, and the DOM heuristics do not recognise
`data-test-id="PriceDisplay"`. No anchor, nothing to resolve from. Captured through the
panel, Wayfair correctly shows an empty, flagged, editable Price field with "1 field
needs checking" — graceful partial extraction, nothing invented.

So the sequence for Wayfair is: adjacency reach — fixed; price anchor — still open, and
pre-existing since the corpus was first scored. Amazon is in the same position for the
same reason.

Zalando and Amazon additionally cannot be settled from a saved page: probing every
ancestor up to twelve hops finds no struck element anywhere near their prices, because
the CSS that would strike them was never fetched. That is the measurement boundary this
document already names, not an extraction defect.

None of the three is a silently-wrong value. `pnpm score:live` reports each as
`missing`, and the gate's `SILENTLY WRONG` count is **0** across all four sidecars
(8 ok, 7 missing).

<details>
<summary>The original failing run, 2026-08-02 — kept because the failure is the finding</summary>

Same page, same method, before `9067454`:

|                                                     |                                                               |
| --------------------------------------------------- | ------------------------------------------------------------- |
| Struck element, per Chrome's own `getComputedStyle` | `$120` — class `css-1i6dsa8`, `text-decoration: line-through` |
| The page's own accessibility label                  | `aria-label="current price $94.97, original price $120"`      |
| Panel preview                                       | `$94.97`, **no former price**                                 |
| `offer.originalPriceAmount`                         | `null`                                                        |

Detection was not the problem; reachability was. `1969a15` made `isStruck()` read
computed style and it worked — Chrome resolved the class, the probe saw the strike, the
unit test passed. But `struckPriceNear()` anchored to a **current-price element found by
the DOM tier**, and on this page the DOM tier finds no price at all: its entire offer is
`{ variantAvailability: 'out_of_stock' }`, the price arriving from JSON-LD. No anchor,
no scan.

That made it the fifth instance of the green-proved-less shape in `STATUS.md`, one level
deeper than the fourth: the rule no longer matched the wrong markup — it matched the
right markup and was never invoked. The unit test built `<span data-price="50.97">`,
precisely the DOM-price anchor the real pages do not provide, so it passed by
construction.

`9067454` moved resolution post-merge and anchored it on the current-price **value**,
which is why the re-run above passes.

</details>

## The gate

Building resumes — Phase 6 or anything else — when all of these are true.

- [ ] A1–A6 pass on the current release build.
- [ ] B1–B4 pass. B5 recorded as not run.
- [ ] C1–C3 pass.
- [ ] Ten products logged in `LIVE_TESTING.md` with the Findings section filled in.
- [ ] Every reproducible live failure has a sanitized fixture and a test that
      failed before its fix and passes after.
- [ ] `pnpm format:check`, `lint`, `typecheck`, `test`, `build`, `test:db`,
      `test:e2e` all pass, and CI is green on the PR.
- [ ] No test was weakened and no security control relaxed to get there. An
      expected-capture file corrected because it encoded a bug is fine, and is
      called out explicitly in its commit message.
- [ ] Anything still unsupported is written down in `STATUS.md` under known
      limitations rather than left implicit.
- [ ] **No silently wrong value.** See the distinction below — flagged is not silent.
      `pnpm score:live` now counts this directly: give each `.live/` page a
      `<name>.truth.json` sidecar of the values a human read off it (a field set to
      `null` asserts it must be absent, which catches a fabricated discount), and the
      correctness section reports `SILENTLY WRONG` — a present value that disagrees with
      truth, or one invented where truth says none. The gate is that number reaching zero.
- [ ] **At most three flagged-and-present fields across the sixteen live pages.**
      Flagged-and-absent is tracked but uncapped.

Failing the gate does not mean fixing everything. It means the remaining gaps are
**named**, so the decision to proceed is a decision rather than an oversight.

### Flagged is not the same as wrong

A value the preview marks for review before saving is materially different from one
saved silently. The user sees the warning and corrects it, which is the graceful
partial extraction BUILD_PLAN.md §1.2 and §10.8 ask for: "make partial extraction
graceful rather than pretending all data is reliable", and "mark uncertain fields with
a subtle warning rather than blocking the user".

So:

- **Silently wrong blocks the gate.** A confident, incorrect value is the worst
  failure this product has. The price is plausible, the title is right, and nothing on
  the card looks suspicious — there is no moment at which the user could have caught it.
- **Flagged does not block.** It is still a defect and still goes on the list; it just
  does not stop Phase 6.
- **Missing does not block**, and is not a defect where the page genuinely does not say.

A flagged value is a defect that has been made visible, not a defect that has been fixed.
Nothing here permits closing one by adding a warning to it.

### Two kinds of flag, counted separately

`fieldsNeedingReview` raises a flag for two unrelated reasons, and they are different
objects:

- **Flagged-and-present.** A value was extracted and something doubts it — most often
  two independent layers claiming different things. The user has to read it, compare it
  against the page, and decide. **This is what the ceiling governs.**
- **Flagged-and-absent.** No value was found, and the panel is asking the user to supply
  one. There is nothing to adjudicate and nothing to dismiss: the field is visibly empty
  whether or not it carries a warning. **Tracked, never capped.**

Conflating them makes the gate arbitrary. A page with no structured data raises several
absent-flags at once and would eat a ceiling meant for a different problem — while the
fix for an absent-flag is to find the value, which the ceiling does nothing to encourage.

### How many flags before the flag is noise

**Three flagged-and-present fields across the sixteen live pages.** Above that, stop and
fix the cause rather than raising the ceiling.

The reasoning matters more than the number. A warning that appears on one capture in five
stops being read, and a dismissed warning is worse than no warning, because it converts a
visible defect back into a silent one and charges the user a click to do it. That argument
is about a warning the user must _act on_ — which is exactly the flagged-and-present kind,
and not the absent kind, where the warning is a restatement of an empty field.

Three across sixteen is roughly one page in five carrying something to adjudicate: enough
that a real disagreement gets through, few enough that most captures are clean and a
warning still reads as unusual.

The disagreement rule was restricted to exact-valued fields for the same reason. Titles
differ between layers by punctuation on nearly every page, so flagging them would have
spent the entire budget on noise the first day.

If a change would push the count past three, the question to ask is not "is three too
strict" but "why did a second layer stop agreeing".

## The loop, for each live failure

1. **Reproduce** it, and confirm it is not one of the known non-bugs below.
2. **Reduce** the page to a minimal sanitized fixture — only the DOM or structured
   data needed. Never full retailer HTML. No account details, order history,
   cookies, tokens, or anything identifying.
3. **Write the failing test first**, with its expected capture.
4. **Fix it.** Prefer a generic-pipeline fix. A new retailer adapter needs live
   evidence that the page holds data the generic layers cannot reach, plus an ADR.
5. **Run the narrow test**, then the full suite.
6. **Re-check the one manual item** the failure came from.
7. **Move the check down a tier** if the fix made that possible. This is the step
   that keeps the manual list from growing without bound.

### Known non-bugs — do not log these

- Automatic revisit on panel open does nothing. It runs on mount with no
  invocation, so it cannot hold `activeTab`. Refresh by capturing again.
- The panel's own capture button fails on a page navigated to after the panel
  opened. Only right-click and the keyboard shortcut are authorized paths.
- Google sign-in errors. No credentials exist.
- The landing page's phase copy is stale.

## Regression triggers

After touching this, re-run that:

| Changed                                                               | Re-run                                                         |
| --------------------------------------------------------------------- | -------------------------------------------------------------- |
| `lib/manifest.ts`, `wxt.config.ts`, `background.ts`, `lib/capture/**` | A1–A6, plus tier 4                                             |
| Anything in `packages/extractors`                                     | Tier 1, the fixture suites, and a spot-check of two live pages |
| `supabase/migrations/**`                                              | Tier 2 in full, plus `pnpm db:types`                           |
| Auth, middleware, redirect handling                                   | B1–B4, plus tier 3                                             |
| Realtime, optimistic updates, Server Actions                          | C1–C3, plus tier 3                                             |

## Not validated yet, and which phase owns it

| Area                                                                 | Owner                            |
| -------------------------------------------------------------------- | -------------------------------- |
| Hosted staging: cookies, CSP, origins, Realtime over a hosted socket | Staging, after live validation   |
| Google OAuth end to end                                              | Optional, does not block staging |
| Chrome Web Store packaging and install                               | Phase 9                          |
| Sharing, invitations, roles in the UI                                | Phase 6                          |
| Background refresh, SSRF protections, alerts                         | Phase 7                          |
| Product matching, AI comparison                                      | Phase 8                          |
| Account deletion, data export, privacy page                          | Phase 9                          |

## A note on A5

A5 — service-worker eviction — is the one check worth resisting the urge to
automate, even when it looks possible. It caught a real bug in the fix for a real
bug: the context menu was registered only from `onInstalled`, so any restart left
the extension with no way to capture. Eviction timing is Chrome's decision, and an
automated version would test our simulation of eviction rather than eviction
itself. Keep it manual.
