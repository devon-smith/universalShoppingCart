export default defineBackground(() => {
  /**
   * MV3 service workers are stopped and restarted freely, so nothing important may
   * live in module scope (BUILD_PLAN.md §11.2). Everything here is idempotent
   * configuration that is safe to re-apply on every wake.
   */
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => console.error('[universal-cart] side panel behavior', error));
});
