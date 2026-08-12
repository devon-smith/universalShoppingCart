# Giving Universal Cart to a friend

You build one artifact, send one file, and your friend is saving products into their own
account in about five minutes. Accounts are self-serve: the first sign-in creates their own
private cart, and nothing of yours is visible to them (or theirs to you) unless one of you
explicitly shares a cart later. No Chrome Web Store listing is involved — that stays
deliberately out of scope for the private beta (docs/DECISIONS.md) — so the extension is
installed unpacked, which Chrome fully supports for exactly this kind of testing.

## What you (the owner) do

### 1. Build the extension against the hosted project

From the repository root:

```bash
WXT_PUBLIC_APP_URL=https://universal-cart-staging.vercel.app \
WXT_PUBLIC_SUPABASE_URL=https://udusjjvhkqogbzejtjkl.supabase.co \
WXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_gCVFsKxoAghO73l3Ldfc7Q_0jLfxmuI \
pnpm --filter extension zip
```

All three values are client-safe (they ship in every installed copy either way; RLS is the
security boundary — BUILD_PLAN.md §17.2). The zip lands in
`apps/extension/.output/universal-cart-<version>-chrome.zip`.

A build made with `pnpm --filter extension build` and no variables points at localhost and
will show "Could not reach Universal Cart" on your friend's machine — if they see that
message, the build was made without the variables above.

### 2. Send your friend the zip

That is the whole delivery: the Supabase address and publishable key are baked into the
build, and their account creates itself on first sign-in. Include the dashboard address
(`https://universal-cart-staging.vercel.app`) so they know where their saved items live in
a full browser tab.

**Only if you want a shared cart:** dashboard → **Share** → **Create invitation link**. The
link is shown once — copy it there and then, and send it yourself; the app does not email
it. Editors can save and edit items; viewers can only look. Skip this entirely for a friend
who is just using the product on their own.

### 3. When they ask, delete on request

There is no self-serve account deletion during the private beta — the privacy page says so
and points deletion requests at you.

## What your friend does

1. **Unzip** the file somewhere it can stay (Chrome loads the folder in place — deleting the
   folder later breaks the extension).
2. Open `chrome://extensions`, switch on **Developer mode** (top right), click **Load
   unpacked**, and pick the unzipped folder.
3. Pin Universal Cart from the puzzle-piece menu, click it, and sign in: enter an email
   address, then type in the code from the email. There is no password.
4. Go to any product page, click the Universal Cart icon, press **Capture this page**,
   check the preview, save. The item appears in their cart on the dashboard without a
   reload — their items, their account, visible to nobody else.
5. _(Only if you sent an invitation link:)_ open it and accept — the shared cart then
   appears on their dashboard alongside their own.

What the extension can and cannot read is listed in the side panel under **"What Universal
Cart can see"**, and at `/privacy` on the dashboard — it reads a page only when asked, and
never cookies, history, or checkout pages.

## Known limits of the private beta

- **Chrome only** (and Chromium browsers that accept unpacked extensions). No Safari or
  Firefox build.
- **Updates are manual**: a new zip means repeating step 2's Load unpacked (or clicking the
  reload icon on the extension card after replacing the folder's contents).
- **Sign-in emails come from a personal Gmail** via SMTP, capped at roughly 500 emails a
  day — far beyond what two people signing in occasionally will use, but worth knowing.
- Developer mode shows a "Disable developer mode extensions?" reminder on some Chrome
  starts; dismissing it is fine and the extension keeps working.
