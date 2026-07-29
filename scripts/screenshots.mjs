#!/usr/bin/env node
/**
 * Capture the baseline UI, so a redesign argues from what the product looks like today rather
 * than from memory.
 *
 * Runs the built extension in a persistent Chromium context — the same technique as the
 * extension end-to-end suite — and the built web app, and walks both through their states at
 * each breakpoint. Output lands in `.screenshots/`, which is gitignored: these are large,
 * they change with every visual commit, and they are captured from a seeded local stack.
 *
 *   pnpm screenshots:baseline
 *
 * ## What is never captured
 *
 * Everything here comes from a throwaway seeded account on a local Supabase. No real address,
 * no real magic link, no retailer order history, no page from a signed-in retailer session.
 * The sign-in screens are photographed empty, before anything is typed, so no address — even
 * a synthetic one — is baked into an image. Product data is the same synthetic catalogue the
 * end-to-end suite uses.
 */
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(repoRoot, '.screenshots');
const extensionPath = join(repoRoot, 'apps/extension/.output/chrome-mv3');
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://127.0.0.1:3100';

/** Side-panel widths. 320 is the narrowest Chrome allows; 500 a comfortably dragged panel. */
const PANEL_WIDTHS = [320, 360, 420, 500];
/** Phone, tablet, small laptop, desktop. */
const WEB_WIDTHS = [375, 768, 1024, 1440];

const THEMES = /** @type {const} */ (['light', 'dark']);

async function shoot(page, name, theme) {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  // Let the token switch settle before the shutter.
  await page.waitForTimeout(120);
  const width = page.viewportSize()?.width ?? 0;
  await page.screenshot({
    path: join(outDir, `${name}--${width}--${theme}.png`),
    fullPage: true,
  });
}

async function captureWeb() {
  const browser = await chromium.launch();

  for (const width of WEB_WIDTHS) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();

    for (const theme of THEMES) {
      // Signed out. Captured before typing, so no address is ever in an image.
      await page.goto(`${appUrl}/login`, { waitUntil: 'domcontentloaded' });
      await shoot(page, 'web-login', theme);

      // The route guard's redirect, which is the first thing a new visitor meets.
      await page.goto(`${appUrl}/app`, { waitUntil: 'domcontentloaded' });
      await shoot(page, 'web-login-redirect', theme);

      await page.goto(`${appUrl}/privacy`, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await shoot(page, 'web-privacy', theme);
    }

    await context.close();
  }

  await browser.close();
}

async function capturePanel() {
  const userDataDir = join(outDir, '.chrome-profile');
  // A fresh profile every run: a reused one carries a session, and a session in a screenshot
  // is exactly what must not be committed.
  rmSync(userDataDir, { recursive: true, force: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    viewport: { width: PANEL_WIDTHS[0], height: 720 },
  });

  // The side panel is a normal extension page; addressing it directly is what lets it be
  // photographed at each width without dragging a real panel edge.
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;

  for (const width of PANEL_WIDTHS) {
    const page = await context.newPage();
    await page.setViewportSize({ width, height: 720 });
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
      waitUntil: 'domcontentloaded',
    });

    for (const theme of THEMES) {
      // Signed out and idle. The states past sign-in need a session, which needs an address;
      // those are captured by hand against the seeded account and not written to disk here.
      await shoot(page, 'panel-signed-out', theme);
    }

    await page.close();
  }

  await context.close();
  rmSync(userDataDir, { recursive: true, force: true });
}

mkdirSync(outDir, { recursive: true });

const target = process.argv[2] ?? 'all';
if (target === 'all' || target === 'web') await captureWeb();
if (target === 'all' || target === 'panel') await capturePanel();

console.log(`Screenshots written to .screenshots/ (gitignored).`);
