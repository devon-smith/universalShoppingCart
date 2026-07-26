/**
 * The Manifest V3 permission set.
 *
 * Kept out of `wxt.config.ts` so it can be unit tested: a permission added by accident is
 * the kind of change that costs user trust and is easy to miss in review
 * (BUILD_PLAN.md §11.5).
 */

export interface ManifestOptions {
  /**
   * End-to-end build. Adds loopback host access, because a headless browser cannot click
   * the toolbar button that confers `activeTab` in a real session. Never set for a
   * release build.
   */
  e2e?: boolean;
}

/** The loopback origin the end-to-end fixture server runs on. */
export const E2E_HOST_PERMISSION = 'http://127.0.0.1/*';

export const REQUIRED_PERMISSIONS = [
  // The primary surface.
  'sidePanel',
  // The Supabase session.
  'storage',
  // The Google OAuth window.
  'identity',
  // Read the tab the user just invoked the extension on, and only that tab.
  'activeTab',
  // Inject the capture script into it.
  'scripting',
  // "Save to Universal Cart" on the page. This is not a convenience: a context-menu click
  // is an *action invocation*, which is what actually confers `activeTab` on the tab the
  // user is looking at. See CAPTURE_INVOCATIONS below.
  'contextMenus',
] as const;

/** The context-menu entry, and the command id for the keyboard shortcut. */
export const CAPTURE_MENU_ID = 'universal-cart/capture';
export const CAPTURE_COMMAND_ID = 'capture-product';

/**
 * How capture is authorized, and why the panel button alone is not enough.
 *
 * `activeTab` is granted when the user *invokes the extension* — clicking the toolbar
 * icon, choosing a context-menu item, or pressing the keyboard shortcut — and it is
 * **revoked as soon as that tab navigates**.
 *
 * The side panel does not follow that lifecycle. It stays open across navigations and tab
 * switches, so by the time somebody browses to a product page and presses a button inside
 * the panel, the grant from opening the panel is long gone: a click inside an extension
 * page is not an action invocation. `chrome.scripting.executeScript` then fails with
 * "Cannot access contents of the page".
 *
 * So every path that must read a page begins with one of these, on the tab in question.
 * Broad host access at install would also solve it and is refused — it discards the whole
 * click-to-capture design (BUILD_PLAN.md §11.5, CLAUDE.md).
 */
export const CAPTURE_INVOCATIONS = ['action', 'context_menu', 'keyboard_command'] as const;

export function buildPermissions(): string[] {
  return [...REQUIRED_PERMISSIONS];
}

/**
 * Host permissions granted at install.
 *
 * Empty for every real build. Broad host access is the single biggest trust cost an
 * extension can impose, and click-to-capture does not need it: `activeTab` grants access
 * to one tab, at the moment the user asks for it, and nothing else.
 */
export function buildHostPermissions(options: ManifestOptions = {}): string[] {
  return options.e2e ? [E2E_HOST_PERMISSION] : [];
}
