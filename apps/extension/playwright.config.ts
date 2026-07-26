import { defineConfig } from '@playwright/test';

/**
 * Extension end-to-end tests run in a persistent Chromium context with the production
 * bundle loaded unpacked (BUILD_PLAN.md §18.5). They need a Supabase project, which
 * `pnpm test:e2e` supplies from the local stack.
 */
if (!process.env.WXT_PUBLIC_SUPABASE_URL || !process.env.WXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
  throw new Error(
    'Extension end-to-end tests need WXT_PUBLIC_SUPABASE_URL and WXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. ' +
      'Run `pnpm supabase:start` and then `pnpm test:e2e` from the repository root.',
  );
}

export default defineConfig({
  testDir: './tests/e2e',
  // A persistent browser profile per worker plus a shared inbox makes parallel runs
  // more trouble than they are worth for a suite this small.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'on-first-retry',
  },
  timeout: 60_000,
});
