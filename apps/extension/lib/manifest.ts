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
] as const;

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
