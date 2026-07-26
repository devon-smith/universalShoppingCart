import { defineConfig } from 'wxt';

/**
 * Manifest V3 configuration.
 *
 * Permissions stay at the minimum the implemented features need (BUILD_PLAN.md §11.5).
 * Phase 0 ships a side panel and nothing else, so it asks only for `sidePanel` and
 * `storage`. `activeTab` and `scripting` are added in Phase 2B alongside the
 * content script that performs click-to-capture; no host permission is requested
 * at install time, ever.
 */
export default defineConfig({
  srcDir: '.',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Universal Cart',
    description: 'Save the product you are looking at to your cloud-synced shopping list.',
    permissions: ['sidePanel', 'storage', 'identity'],
    action: {
      default_title: 'Open Universal Cart',
    },
    content_security_policy: {
      // No remote code, no eval (BUILD_PLAN.md §17.4).
      extension_pages: "script-src 'self'; object-src 'self';",
    },
  },
});
