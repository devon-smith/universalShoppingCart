#!/usr/bin/env tsx
/**
 * Capture the baseline UI, so the redesign argues from what the product looks like today
 * rather than from memory.
 *
 * Drives both clients through their real flows: the built extension in a persistent Chromium
 * context signing in and capturing fixture product pages, and the web app signed in against a
 * seeded account. Output lands in `.screenshots/`, which is gitignored — these are large, they
 * change with every visual commit, and they come from a throwaway local stack.
 *
 *   pnpm screenshots:baseline            # everything
 *   pnpm screenshots:baseline web        # dashboard only
 *   pnpm screenshots:baseline panel      # side panel only
 *
 * Each state is reached once and then photographed at every width and in both themes, rather
 * than replaying the flow per breakpoint: a side panel is a live page, so resizing re-lays it
 * out without another sign-in.
 *
 * ## What is never captured
 *
 * A throwaway seeded account on a local Supabase, and the same synthetic catalogue the
 * end-to-end suites use. No real address, no real magic link, no retailer order history, no
 * page from a signed-in retailer session. Sign-in screens are photographed empty, before
 * anything is typed. The Chrome profile is destroyed on both sides of the run.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

import { mailbox } from '../apps/web/tests/e2e/mailpit';
import { signInCodeFrom, waitForEmail } from '../apps/extension/tests/e2e/mailpit';
import { capture, ingest, signInBrowser, signedInClient } from '../apps/web/tests/e2e/seed';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(repoRoot, '.screenshots');
/**
 * The end-to-end bundle, not the release one.
 *
 * These two builds differ in exactly one respect: `WXT_E2E=1` grants `http://127.0.0.1/*` as a
 * real host permission, because a script-dispatched click cannot confer `activeTab` — that is
 * Chrome's decision and needs a human pressing the toolbar button (docs/VALIDATION.md, tier 4).
 * Without it `chrome.scripting.executeScript` refuses and no capture state is reachable at all.
 *
 * Nothing visual differs between the builds: same components, same stylesheet, same bundle.
 * The release build's authorization is verified by hand against the manual checklist, which is
 * where that difference belongs — a screenshot cannot prove a permission either way.
 */
const extensionPath = join(repoRoot, 'apps/extension/.output/chrome-mv3');
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://127.0.0.1:3100';
const fixturePort = Number(process.env.FIXTURE_SERVER_PORT ?? 3210);
const fixtureOrigin = `http://127.0.0.1:${fixturePort}`;

/** 320 is the narrowest Chrome allows; 500 a comfortably dragged panel. */
const PANEL_WIDTHS = [320, 360, 420, 500];
/** Phone, tablet, small laptop, desktop. */
const WEB_WIDTHS = [375, 768, 1024, 1440];
const THEMES = ['light', 'dark'];

function stamp(label) {
  return `screenshots: ${label}`;
}

/** Photograph the current state at every width and in both themes. */
async function shootAll(page, name, widths, height = 900) {
  const original = page.viewportSize();

  for (const width of widths) {
    await page.setViewportSize({ width, height });
    for (const theme of THEMES) {
      await page.emulateMedia({ colorScheme: theme });
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      // Let the token switch and the reflow settle before the shutter.
      await page.waitForTimeout(140);
      await page.screenshot({
        path: join(outDir, `${name}--${width}--${theme}.png`),
        fullPage: true,
        // Both clients show the signed-in address once a session exists. These are throwaway
        // `@example.com` seeds, but the rule is no address in any frame, and a rule with an
        // exception for "addresses I believe are fine" is not a rule.
        // The address itself, and the dashboard greeting, which is built from its local part
        // and therefore leaks it even when the address below is covered.
        mask: [page.getByText(/@example\.com/), page.getByRole('heading', { name: /^Hi,/ })],
        maskColor: '#8A847A',
      });
    }
  }

  if (original) await page.setViewportSize(original);
  console.log(stamp(`${name} (${widths.length} widths x ${THEMES.length} themes)`));
}

function uniqueEmail(prefix) {
  return `shots-${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

/* ------------------------------------------------------------------ side panel ----------- */

/** Dispatch rather than click: a real click would pull the panel tab in front of the product
 *  page, and the panel captures whichever tab is active. Same reason the e2e suite does it. */
async function clickWithoutFocus(page, selector) {
  await page.locator(selector).dispatchEvent('click');
}

async function signInPanel(panel, email) {
  await panel.getByLabel('Email address').fill(email);
  await panel.getByRole('button', { name: 'Email me a code' }).click();

  const code = signInCodeFrom(await waitForEmail(email));
  await panel.getByLabel(/6-digit code sent to/).fill(code);
  await panel.getByRole('button', { name: 'Sign in', exact: true }).click();
  await panel.getByRole('heading', { name: 'Save this product' }).waitFor();
}

async function capturePanel() {
  const userDataDir = join(outDir, '.chrome-profile');
  // Fresh either side of the run: a reused profile carries a session, and a session in a
  // screenshot is exactly what must not exist.
  rmSync(userDataDir, { recursive: true, force: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    viewport: { width: PANEL_WIDTHS[0], height: 720 },
  });

  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  // Signed out, before a single keystroke.
  await shootAll(panel, 'panel-signed-out', PANEL_WIDTHS, 720);

  await signInPanel(panel, uniqueEmail('panel'));
  await shootAll(panel, 'panel-idle', PANEL_WIDTHS, 720);

  const product = await context.newPage();

  /** Reach the preview for one fixture, photographing the reading state on the way. */
  async function previewFor(fixture, name, { shootReading = false } = {}) {
    await product.goto(`${fixtureOrigin}/${fixture}`);
    await product.bringToFront();
    await clickWithoutFocus(panel, 'button:has-text("Capture this page")');

    if (shootReading) {
      // Extraction is fast on a local fixture, so this is a genuine race. Photograph
      // immediately and only at the default width — a state that lasts ~100ms cannot be
      // walked through four breakpoints, and pretending otherwise would fake it.
      await panel.screenshot({
        path: join(outDir, 'panel-reading--360--light.png'),
        mask: [panel.getByText(/@example\.com/)],
        maskColor: '#8A847A',
      });
      console.log(stamp('panel-reading (best effort, one frame)'));
    }

    await panel.getByRole('button', { name: 'Save item' }).waitFor({ timeout: 20_000 });
    await shootAll(panel, name, PANEL_WIDTHS, 720);
  }

  // A confident capture: JSON-LD with a complete offer.
  await previewFor('json-ld-complete.html', 'panel-capture-preview', { shootReading: true });
  await clickWithoutFocus(panel, 'button:has-text("Save item")');
  await panel
    .getByRole('status')
    .filter({ hasText: /Saved|Already saved/ })
    .waitFor({ timeout: 20_000 });
  await shootAll(panel, 'panel-saved', PANEL_WIDTHS, 720);

  // The same page again — the duplicate-refresh path, not a second item.
  await previewFor('json-ld-complete.html', 'panel-already-saved-preview');
  await clickWithoutFocus(panel, 'button:has-text("Save item")');
  await panel
    .getByRole('status')
    .filter({ hasText: /Already saved/ })
    .waitFor({ timeout: 20_000 });
  await shootAll(panel, 'panel-already-saved', PANEL_WIDTHS, 720);

  // A genuinely uncertain extraction, not a forced flag: DOM heuristics only, which scores
  // 0.55 and puts `product.title` under the review threshold. The amber treatment has to be
  // judged against a real one of these.
  await previewFor('dom-only.html', 'panel-low-confidence-preview');
  await clickWithoutFocus(panel, 'button:has-text("Save item")');
  await panel
    .getByRole('status')
    .filter({ hasText: /Saved|Already saved/ })
    .waitFor({ timeout: 20_000 });

  // A third product, so "recent items" has more than a pair in it.
  await previewFor('meta-only.html', 'panel-third-preview');
  await clickWithoutFocus(panel, 'button:has-text("Save item")');
  await panel
    .getByRole('status')
    .filter({ hasText: /Saved|Already saved/ })
    .waitFor({ timeout: 20_000 });

  // The already-saved state: reopen the panel on a page that is already in a cart, which is
  // how a user meets it — they come back to a product they saved earlier.
  await product.goto(`${fixtureOrigin}/json-ld-complete.html`);
  await product.bringToFront();
  await panel.reload();
  await panel
    .getByText('Already in your cart', { exact: true })
    .waitFor({ timeout: 20_000 })
    .catch(() => console.log(stamp('panel-known-item SKIPPED — revisit did not recognise it')));
  if (await panel.getByText('Already in your cart', { exact: true }).isVisible().catch(() => false)) {
    await shootAll(panel, 'panel-known-item', PANEL_WIDTHS, 720);
  }

  // Back to a blank tab so the panel shows its recent list rather than a live preview.
  await product.goto('about:blank');
  await product.bringToFront();
  await panel.bringToFront();
  await panel.reload();
  await panel.getByRole('heading', { name: 'Save this product' }).waitFor();
  await shootAll(panel, 'panel-recent-items', PANEL_WIDTHS, 720);

  await context.close();
  rmSync(userDataDir, { recursive: true, force: true });
}

/* ------------------------------------------------------------------ web app -------------- */

/** An ISO timestamp `hours` before now, so "a week ago" is deterministic. */
function hoursAgo(hours) {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

const CATALOGUE = [
  {
    title: 'Meridian Wool Runner',
    url: 'https://shop.northwind.example/p/meridian',
    price: '98.00',
  },
  {
    title: 'Kestrel Rain Shell',
    url: 'https://fieldcraft.example/shop/kestrel',
    price: '189.00',
    retailerName: 'Fieldcraft',
  },
  {
    title: 'Alpenrose Down Jacket',
    url: 'https://bergsport.example/p/alpenrose',
    price: '242.50',
    retailerName: 'Bergsport',
  },
  {
    title: 'Solstice Desk Lamp',
    url: 'https://lumenworks.example/lamps/solstice',
    noPrice: true,
    availability: 'unknown',
    retailerName: 'Lumenworks',
    confidence: 0.55,
  },
];

async function captureWeb() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: WEB_WIDTHS[2], height: 900 },
    // `signInBrowser` navigates with app-relative paths, as the e2e suite's config does.
    baseURL: appUrl,
  });
  const page = await context.newPage();

  // Signed out first, and empty: no address is ever typed into a frame.
  for (const path of [
    ['/login', 'web-login'],
    ['/app', 'web-login-redirect'],
    ['/privacy', 'web-privacy'],
  ]) {
    await page.goto(`${appUrl}${path[0]}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await shootAll(page, path[1], WEB_WIDTHS);
  }

  const email = uniqueEmail('web');
  const inbox = mailbox(email);
  const client = await signedInClient(email, inbox);

  // An empty dashboard, before anything is seeded.
  await signInBrowser(page, client);
  await shootAll(page, 'web-dashboard-empty', WEB_WIDTHS);

  for (const item of CATALOGUE) {
    await ingest(client, capture({ ...item, observedAt: hoursAgo(72) }), {
      note: item.title === 'Meridian Wool Runner' ? 'for the trip in March' : undefined,
      quantity: 1,
    });
  }

  // Several observations on one item, so the history has a shape rather than two points.
  // Each is a genuine change at a distinct time, which is what makes the row insert.
  for (const [hours, price] of [
    [60, '94.00'],
    [48, '92.50'],
    [36, '96.00'],
    [24, '88.00'],
    [12, '84.00'],
    [2, '79.95'],
  ]) {
    await ingest(
      client,
      capture({ title: 'Meridian Wool Runner', price, observedAt: hoursAgo(hours) }),
      {},
      'revisit',
    );
  }

  await page.goto(`${appUrl}/app`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Meridian Wool Runner').first().waitFor();
  await shootAll(page, 'web-dashboard-cards', WEB_WIDTHS);

  // List view, if the dashboard offers the toggle.
  const listToggle = page.getByRole('button', { name: /list/i }).first();
  if (await listToggle.isVisible().catch(() => false)) {
    await listToggle.click();
    await page.waitForTimeout(200);
    await shootAll(page, 'web-dashboard-list', WEB_WIDTHS);
    const cardToggle = page.getByRole('button', { name: /card/i }).first();
    if (await cardToggle.isVisible().catch(() => false)) await cardToggle.click();
  } else {
    console.log(stamp('web-dashboard-list SKIPPED — no view toggle found'));
  }

  // Filters. The dashboard has no disclosure to open — the controls sit permanently in a bar
  // above the grid, which is itself part of what the audit is about. So the state worth
  // photographing is the bar in use: a status filter applied, narrowing the grid.
  const status = page.locator('#filter-status');
  if (await status.isVisible().catch(() => false)) {
    await status.selectOption('saved');
    await page.waitForTimeout(300);
    await shootAll(page, 'web-filters-applied', WEB_WIDTHS);
    await status.selectOption('');
    await page.waitForTimeout(200);
  } else {
    console.log(stamp('web-filters-applied SKIPPED — no status filter found'));
  }

  // A search that matches nothing. The empty result is a different state from an empty cart
  // and the redesign has to tell them apart.
  const search = page
    .getByRole('searchbox')
    .or(page.getByLabel(/search/i))
    .first();
  if (await search.isVisible().catch(() => false)) {
    await search.fill('a product nobody saved');
    await page.waitForTimeout(400);
    await shootAll(page, 'web-search-no-matches', WEB_WIDTHS);
    await search.fill('');
    await page.waitForTimeout(300);
  } else {
    console.log(stamp('web-search-no-matches SKIPPED — no search field found'));
  }

  // Item detail. Opened through the card's own "Details" button rather than by clicking the
  // title, which is not a control — the first attempt at this photographed the dashboard
  // again and reported the drawer as captured.
  const card = page
    .locator('[data-testid="item-card"]')
    .filter({ hasText: 'Meridian Wool Runner' })
    .first();
  await card.getByRole('button', { name: 'Details' }).click();
  await page.locator('#history-heading').waitFor({ timeout: 10_000 });
  await shootAll(page, 'web-item-detail', WEB_WIDTHS);

  // The history section on its own, scrolled to. Seven observations deep, so the shape of the
  // series is visible rather than a pair of points.
  const history = page.locator('#history-heading');
  await history.scrollIntoViewIfNeeded();
  await shootAll(page, 'web-price-history', WEB_WIDTHS);

  await page.goto(`${appUrl}/app/diagnostics`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await shootAll(page, 'web-diagnostics', WEB_WIDTHS);

  await context.close();
  await browser.close();
}

/* ------------------------------------------------------------------ entry ---------------- */

mkdirSync(outDir, { recursive: true });

const target = process.argv[2] ?? 'all';
let fixtureServer;

if (target === 'all' || target === 'panel') {
  // The capture flow needs real `http(s)` pages: `chrome.scripting.executeScript` will not
  // touch `about:blank` or a `data:` URL.
  fixtureServer = spawn('node', [join(repoRoot, 'apps/extension/tests/e2e/fixture-server.mjs')], {
    cwd: repoRoot,
    env: { ...process.env, FIXTURE_SERVER_PORT: String(fixturePort) },
    stdio: 'ignore',
  });
  await new Promise((done) => setTimeout(done, 600));
}

try {
  if (target === 'all' || target === 'web') await captureWeb();
  if (target === 'all' || target === 'panel') await capturePanel();
} finally {
  fixtureServer?.kill();
}

console.log('Screenshots written to .screenshots/ (gitignored).');
