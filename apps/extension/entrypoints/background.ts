import { captureFromInvocation } from '@/lib/capture/invoke';
import { CAPTURE_COMMAND_ID, CAPTURE_MENU_ID } from '@/lib/manifest';

export default defineBackground(() => {
  /**
   * MV3 service workers are stopped and restarted freely, so nothing important may
   * live in module scope (BUILD_PLAN.md §11.2). Everything here is idempotent
   * configuration that is safe to re-apply on every wake.
   */
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => console.error('[universal-cart] side panel behavior', error));

  /**
   * The context menu is how capture is authorized.
   *
   * Choosing it is an action invocation, so Chrome grants `activeTab` for that tab at that
   * moment. A button inside the side panel is not, and the grant from opening the panel is
   * already gone by the time the user has browsed to a product page — see lib/manifest.ts,
   * CAPTURE_INVOCATIONS.
   */
  const installMenu = () => {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: CAPTURE_MENU_ID,
        title: 'Save to Universal Cart',
        // Deliberately not `selection`: this saves the page's product, not selected text.
        contexts: ['page', 'image', 'link'],
      });
    });
  };

  // Registered on every wake, not only on `onInstalled`. A service worker is stopped and
  // restarted freely, and `onInstalled` fires once in the extension's lifetime — hanging
  // the only path to capture off a one-shot event is how the menu ends up missing. Both
  // calls are idempotent because `removeAll` runs first.
  installMenu();
  chrome.runtime.onInstalled.addListener(installMenu);
  chrome.runtime.onStartup.addListener(installMenu);

  const run = (tabId: number | undefined) =>
    void captureFromInvocation(tabId, {
      scripting: chrome.scripting,
      tabs: chrome.tabs,
      store: chrome.storage.session,
      // Before any await: `chrome.sidePanel.open()` is only valid while the user gesture
      // is live, and awaiting the capture first would spend it.
      openPanel: (id) => {
        chrome.sidePanel
          .open({ tabId: id })
          .catch((error: unknown) => console.error('[universal-cart] open side panel', error));
      },
      // The panel may not be listening yet; it also collects on mount, so a failure to
      // deliver here is not a failure to capture.
      notify: (message) => {
        chrome.runtime.sendMessage(message).catch(() => undefined);
      },
    });

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === CAPTURE_MENU_ID) run(tab?.id);
  });

  chrome.commands.onCommand.addListener((command, tab) => {
    if (command === CAPTURE_COMMAND_ID) run(tab?.id);
  });
});
