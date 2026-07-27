# Live page testing

A record of extraction against **real retailer pages**, which nothing in CI touches.

Every automated test in this repository runs against sanitized fixtures — deliberately, so
CI is deterministic and does not hammer live sites. The cost of that is a blind spot:
extraction quality on the pages actually used is unmeasured until someone measures it here.

This log is what turns the Phase 5 adapter selection from a judgment call into evidence.
See [DECISIONS.md](DECISIONS.md) — the five adapters target commerce _platforms_ because
the repository had no record of which retailers matter. These results are that record.

## How to run a session

```bash
pnpm supabase:start
pnpm dev
```

Load the extension at `chrome://extensions` → Developer mode → **Load unpacked** →
`apps/extension/.output/chrome-mv3`. Sign in on both surfaces with the same address.

For each product: open the page, **select a variant** where one exists, open the side
panel, capture, check the preview against the page, save, then confirm it on
<http://localhost:3000/app>. Afterwards open <http://localhost:3000/app/diagnostics> and
copy the adapter and confidence for each domain.

## Keeping a page for later

Extraction changes are easier to judge across all ten pages at once than one recapture at a
time, so keep each page you test in `.live/` — working files, never committed, never
fixtures.

With the variant selected, open DevTools and run in the Console:

```js
copy(document.documentElement.outerHTML);
```

Paste that into `.live/<name>.html`, and add `.live/<name>.json` holding
`{"url": "<the page URL, with its variant parameters>"}`. The URL is not optional: the
canonical URL and variant parameters both feed extraction, and the scorer refuses to guess
one.

**Capture the hydrated DOM, not the saved page.** Ctrl/Cmd+S → _Webpage, HTML only_ writes
the HTML the server sent, which is not what the extension reads. On StockX the server
response has the title and colourway but no size-dependent price — that arrives
client-side.

Then:

```bash
pnpm score:live --save .live/baseline.json   # record where extraction stands
pnpm score:live --baseline .live/baseline.json   # after a change, see what moved
```

The scorer reports whether a field is **present**, not whether it is **right**. A confidently
wrong price scores as a win. Read it against the ground-truth column above, never on its own.

## What to include

A pass over ten easy pages proves less than a pass over five awkward ones. Try to cover:

- [ ] A discounted product showing both a list and a sale price
- [ ] A product with two option dimensions (size **and** colour)
- [ ] A product where the selected variant is unavailable but the product is not
- [ ] A marketplace listing with several sellers
- [ ] A page that shows no price until a variant is chosen
- [ ] A product offering both a subscription and a one-time price
- [ ] A page whose server HTML differs from the hydrated DOM
- [ ] A non-USD page, ideally one using `1.299,00` formatting
- [ ] A page on a platform an adapter claims to support
- [ ] A page on none of the five supported platforms

## Summary

Fill in as you go. `Adapter` is what `/app/diagnostics` reports, not what you expected.

| #   | Domain | Category | Adapter | Confidence | Result | Failed on | Notes |
| --- | ------ | -------- | ------- | ---------- | ------ | --------- | ----- |
| 1   |        |          |         |            |        |           |       |
| 2   |        |          |         |            |        |           |       |
| 3   |        |          |         |            |        |           |       |
| 4   |        |          |         |            |        |           |       |
| 5   |        |          |         |            |        |           |       |
| 6   |        |          |         |            |        |           |       |
| 7   |        |          |         |            |        |           |       |
| 8   |        |          |         |            |        |           |       |
| 9   |        |          |         |            |        |           |       |
| 10  |        |          |         |            |        |           |       |

`Result`: ✅ everything correct · ⚠️ saved but something wrong · ❌ could not capture or save

`Failed on`: leave blank when ✅. Otherwise use one or more of `price`, `original-price`,
`currency`, `title`, `image`, `variant`, `availability`, `canonical`, `duplicate`, `sync`,
`observation`. These are the codes the Findings section groups by, so writing them here
means the summary falls out of the table rather than having to be reconstructed.

---

## Test 1

**URL**
**Domain**
**Category** — what kind of thing it is (clothing, electronics, grocery, furniture). Failure
patterns cluster by category more than by retailer.
**Date**
**Tester** — matters once more than one person is testing, so a surprising result can be
asked about rather than guessed at.

### What the page says

Fill this in from the page itself, _before_ looking at the panel. Comparing two columns
you wrote at different times is the only way to catch a plausible-looking wrong value.

| Field          | On the page |
| -------------- | ----------- |
| Title          |             |
| Current price  |             |
| Original price |             |
| Currency       |             |
| Availability   |             |
| Variant        |             |

### What was extracted

| Field           | Extracted | Correct? |
| --------------- | --------- | -------- |
| Title           |           |          |
| Current price   |           |          |
| Original price  |           |          |
| Currency        |           |          |
| Image           |           |          |
| Availability    |           |          |
| Selected colour |           |          |
| Selected size   |           |          |
| Other options   |           |          |
| Canonical URL   |           |          |

Colour and size get their own rows because they fail independently: a page will often read
the colour correctly from the URL and miss the size entirely, and a single "variant" row
hides that.

**Adapter / fallback status** — from `/app/diagnostics`: adapter id and version, or
`generic`. Note the failure class if one is shown.

**Overall confidence**

**Fields the panel flagged for review** — the ⚠ markers before saving.

**Corrections you had to make** — which fields you edited by hand before saving, and to
what. This is the number that decides whether capture is actually usable day to day: a
save that needs three corrections every time is a worse experience than no capture at all.

### Behaviour

| Check                                                               | Result |
| ------------------------------------------------------------------- | ------ |
| Saved without error                                                 |        |
| Appeared on the dashboard without a reload                          |        |
| Re-saving the same URL and variant refreshed instead of duplicating |        |
| A different variant saved as a **separate** item                    |        |
| Reopening the panel on the page recognised it as already saved      |        |
| A changed price recorded a new observation                          |        |
| An unchanged revisit recorded **nothing**                           |        |
| Editing a note, then revisiting, left the note intact               |        |

### What was wrong

Be specific about the _value_, not just the field: "original price picked up the 4×
instalment amount (£47.25) instead of the list price (£189)" is actionable; "price wrong"
is not.

### Should this become a fixture?

If extraction was wrong, yes — but capture the **hydrated DOM**, not the saved page.

Select the variant you are testing, open DevTools, and in the Console run:

```js
copy(document.documentElement.outerHTML);
```

Paste that into the file. **Do not use Ctrl/Cmd+S → _Webpage, HTML only_.** That saves the
HTML as the server sent it, which is not what the extension reads: the extension runs
against the DOM after the page has hydrated. StockX proved the difference — the server
response carries the title and colourway but not the size-dependent price, which arrives
client-side. A fixture built from the raw response reproduces a bug that does not exist and
misses the one that does.

Then strip it to the DOM the extractor reads and drop it in
`packages/extractors/src/fixtures/adapters/`. **Sanitize first** — no account details, no
order history, no cookies or tokens, nothing identifying. See the README there.

---

## Test 2

_Copy the Test 1 block._

---

## Findings

Filled in after the session. This section is the deliverable — the rest is working notes.

### Adapters that worked

Domains where `/app/diagnostics` named a platform adapter **and** the fields were right.
This is the answer to whether the platform-adapter bet paid off.

### Domains that fell back to generic extraction

Falling back is not itself a failure — say whether the generic pipeline got the fields
right anyway. A domain only earns an adapter when it fell back _and_ got something wrong.

### Failure counts by class

Straight from the `Failed on` column, so the next piece of work is chosen by frequency
rather than by whichever failure was most annoying to hit.

| Class                           | Count | Domains |
| ------------------------------- | ----- | ------- |
| Missing or wrong price          |       |         |
| Wrong original price            |       |         |
| Missing or wrong variant        |       |         |
| Incorrect availability          |       |         |
| Wrong or missing image          |       |         |
| Canonical URL dropped a variant |       |         |
| Duplicate not detected          |       |         |
| Extension/dashboard out of sync |       |         |
| Observation not recorded        |       |         |

### Domains needing a retailer-specific adapter

Name the domain and what the generic pipeline got wrong on it. An adapter is justified when
a page holds data the generic layers cannot reach, not merely when a site is popular.

### Extraction bugs to fix

### Pages to turn into regression fixtures

### Anything about the flow itself

Capture speed, the preview, the correction UI, whether the panel opened where expected.
Extraction can be perfect and the feature still be annoying to use.
