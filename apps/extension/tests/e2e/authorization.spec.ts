import { expect, test } from './fixtures';

/**
 * The authorization path a released build actually uses.
 *
 * Every other extension end-to-end test reaches its fixture page through the loopback host
 * permission that `WXT_E2E=1` adds. That is a deliberate crutch — a headless browser cannot
 * click a toolbar button or a context-menu item, which is what confers `activeTab` in a
 * real session — but it means the mechanism a real install depends on was never exercised
 * at all. Capture was broken in the release build while fifteen tests stayed green.
 *
 * These tests assert the parts of that path a browser *can* check: that the invocation
 * points exist in the running extension, and that no build quietly acquires broad host
 * access instead. Whether Chrome then grants `activeTab` is the browser's own behaviour and
 * is verified by hand before release — see docs/RUNBOOK.md.
 */

const CAPTURE_MENU_ID = 'universal-cart/capture';
const CAPTURE_COMMAND_ID = 'capture-product';

test.describe('release authorization path', () => {
  test('registers the context menu that confers activeTab', async ({ context, extensionId }) => {
    expect(extensionId).toBeTruthy();

    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent('serviceworker');

    // `chrome.contextMenus` has no listing API, but updating a menu that does not exist
    // sets `lastError` — so a successful update is proof the item was registered.
    // Polled because registration goes through an async `removeAll` first.
    await expect
      .poll(
        () =>
          worker.evaluate(
            (id) =>
              new Promise<string | null>((resolve) => {
                chrome.contextMenus.update(id, { title: 'Save to Universal Cart' }, () => {
                  resolve(chrome.runtime.lastError?.message ?? null);
                });
              }),
            CAPTURE_MENU_ID,
          ),
        { timeout: 10_000 },
      )
      .toBeNull();
  });

  test('declares the keyboard command and the permission the menu needs', async ({ context }) => {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent('serviceworker');

    const manifest = await worker.evaluate(() => chrome.runtime.getManifest());

    expect(manifest.permissions).toContain('contextMenus');
    expect(manifest.permissions).toContain('activeTab');
    expect(manifest.commands?.[CAPTURE_COMMAND_ID]).toBeTruthy();
  });

  test('never holds broad host access, even in this instrumented build', async ({ context }) => {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent('serviceworker');

    const hosts = await worker.evaluate(() => chrome.runtime.getManifest().host_permissions ?? []);

    // The e2e build grants loopback and nothing else; a release build grants nothing.
    for (const pattern of ['<all_urls>', '*://*/*', 'https://*/*', 'http://*/*']) {
      expect(hosts).not.toContain(pattern);
    }
  });
});
