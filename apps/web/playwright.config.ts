import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_WEB_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${port}`;

// Outside CI, refuse to serve a stale `.next` from a direct `playwright test`. In CI everything
// reaches the server through `pnpm test:e2e`, whose turbo graph builds first, so the guard is
// unnecessary there and skipped to avoid a cache-restored build tripping a false positive.
const startCommand = `pnpm exec next start --port ${port}`;
const freshBuildCheck = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'scripts',
  'assert-fresh-web-build.mjs',
);
const webServerCommand = process.env.CI
  ? startCommand
  : `node ${JSON.stringify(freshBuildCheck)} && ${startCommand}`;

/**
 * The suite exercises real sign-in, so it needs a Supabase project. `pnpm test:e2e`
 * injects the local stack's values (see scripts/with-supabase-env.mjs); running
 * `playwright test` directly requires them in the environment. Failing here beats a
 * green suite that quietly tested an unconfigured app.
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Web end-to-end tests need NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. ' +
      'Run `pnpm supabase:start` and then `pnpm test:e2e` from the repository root.',
  );
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: webServerCommand,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_APP_URL: baseURL,
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabaseKey,
    },
  },
});
