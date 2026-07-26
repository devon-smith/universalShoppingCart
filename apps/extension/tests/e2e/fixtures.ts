import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { BrowserContext } from '@playwright/test';
import { chromium, test as base } from '@playwright/test';

const extensionPath = resolve(import.meta.dirname, '../../.output/chrome-mv3');

/**
 * A persistent Chromium context with the production extension bundle loaded unpacked,
 * plus the extension's own id so tests can open its pages directly.
 *
 * Each test gets a fresh browser profile, so `chrome.storage.local` starts empty and a
 * session recovered in one test cannot leak into the next.
 */
export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
}>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'universal-cart-ext-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      // The `chromium` channel runs the full browser in new-headless mode. The default
      // headless shell does not load extensions, so the MV3 service worker never starts.
      channel: 'chromium',
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });

    await use(context);

    await context.close();
    rmSync(userDataDir, { recursive: true, force: true });
  },

  extensionId: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent('serviceworker');
    await use(new URL(worker.url()).host);
  },
});

export const expect = test.expect;
