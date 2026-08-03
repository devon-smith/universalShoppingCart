#!/usr/bin/env node
/**
 * Assert the built web app is newer than its source before Playwright serves it.
 *
 * `next start` serves whatever is in `.next`. Running `playwright test` directly — instead of
 * `pnpm test:e2e`, which builds through turbo first — can quietly serve a stale bundle, so a run
 * passes or fails against code that is not what you edited. That has already cost a diagnosis
 * once. This is the build-tier analogue of `scripts/preflight-db.mjs`.
 *
 * It runs only outside CI (the config chains it in front of `next start` only when `!CI`),
 * because CI always reaches the server through `pnpm test:e2e`, whose turbo graph builds first —
 * so `.next` cannot be stale there, and a cache-restored build's mtimes could otherwise trip a
 * false positive.
 *
 * Fails **closed** on a definite problem (no build, or source newer than the build) with a
 * one-line fix. Fails **open** on any inability to decide, so it never blocks a legitimate run.
 */
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web');
const srcDir = join(webRoot, 'src');
const buildId = join(webRoot, '.next', 'BUILD_ID');

let buildMs;
try {
  buildMs = statSync(buildId).mtimeMs;
} catch {
  console.error(
    '\n✗ No web build found (apps/web/.next/BUILD_ID is missing).\n' +
      '  Run `pnpm build` before `playwright test`, or use `pnpm test:e2e`.\n',
  );
  process.exit(1);
}

/** Newest mtime under a directory tree; a scan error bubbles up to the fail-open handler. */
function newestMtimeMs(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtimeMs(full) : statSync(full).mtimeMs);
  }
  return newest;
}

let srcMs;
try {
  srcMs = newestMtimeMs(srcDir);
} catch (error) {
  console.warn(`[e2e build check] could not scan apps/web/src (${error.message}) — skipping.`);
  process.exit(0);
}

if (srcMs > buildMs) {
  console.error(
    '\n✗ Stale web build: apps/web/.next is older than apps/web/src.\n' +
      '  Run `pnpm build` (or use `pnpm test:e2e`, which builds first) before `playwright test`.\n' +
      '  If `pnpm build` no-ops (turbo cache hit after a content-neutral change — a checkout, a\n' +
      '  format with no net change, an editor save), the build id never moves. Force it with\n' +
      '  `pnpm turbo build --filter=@universal-cart/web --force`, or `touch apps/web/.next/BUILD_ID`.\n',
  );
  process.exit(1);
}

process.exit(0);
