import { defineConfig } from 'wxt';

import { buildHostPermissions, buildPermissions } from './lib/manifest';

/**
 * Manifest V3 configuration.
 *
 * The permission set lives in `lib/manifest.ts` so it can be unit tested — see
 * `lib/manifest.test.ts`, which pins the exact list and asserts that no build grants
 * broad host access (BUILD_PLAN.md §11.5).
 *
 * `WXT_E2E=1` produces the end-to-end build, which additionally grants loopback host
 * access, because a headless browser cannot click the toolbar button that confers
 * `activeTab` in a real session. `pnpm test:e2e` sets it; a release build must not.
 */
const e2e = process.env.WXT_E2E === '1';

export default defineConfig({
  srcDir: '.',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Universal Cart',
    description: 'Save the product you are looking at to your cloud-synced shopping list.',
    permissions: buildPermissions(),
    host_permissions: buildHostPermissions({ e2e }),
    action: {
      default_title: 'Open Universal Cart',
    },
    content_security_policy: {
      // No remote code, no eval (BUILD_PLAN.md §17.4).
      extension_pages: "script-src 'self'; object-src 'self';",
    },
  },
});
