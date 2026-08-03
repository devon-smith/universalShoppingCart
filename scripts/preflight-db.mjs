#!/usr/bin/env node
/**
 * Preflight for `pnpm test:db`: confirm the local database has the newest migration applied
 * before pg_prove runs.
 *
 * A database that predates a migration makes the pgTAP suite fail deep inside with a cryptic
 * `function public.… does not exist`, which reads exactly like a real regression — it has cost
 * real diagnosis time more than once. This turns that into one line naming the fix.
 *
 * **Fail-open by design.** It short-circuits *only* when it positively confirms the newest
 * object is absent. If it cannot determine the answer for any reason — Docker not installed, the
 * stack not running, an unexpected result — it prints a note and lets the tests run. It may only
 * turn a confusing red into a clear one; it must never block a healthy database.
 */
import { spawnSync } from 'node:child_process';

/**
 * The newest object the migrations create — `create_cart_invitation` (2026-08-03). When a
 * database is missing the latest migrations this is the first thing absent, and it is exactly
 * what the pgTAP suite trips over. `to_regprocedure` returns NULL for a missing function rather
 * than raising, so the probe itself never errors. Update this when a newer migration lands.
 */
const PROBE =
  "select to_regprocedure('public.create_cart_invitation(uuid, public.cart_role, text, interval)') is not null;";

const RESET_HINT =
  'Local database is missing the latest migrations.\n' +
  '  Run `pnpm supabase:reset` to apply them, then re-run `pnpm test:db`.';

/** Give up on checking and let the tests run — the guard never blocks on its own uncertainty. */
function proceed(note) {
  if (note) console.warn(`[test:db preflight] ${note} — skipping the check.`);
  process.exit(0);
}

// Find the running Supabase database container without hard-coding the project id.
const ps = spawnSync('docker', ['ps', '--filter', 'name=supabase_db_', '--format', '{{.Names}}'], {
  encoding: 'utf8',
});
if (ps.error || ps.status !== 0) proceed('could not list Docker containers');

const container = (ps.stdout ?? '')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)[0];
if (!container) proceed('no running Supabase database container found');

const probe = spawnSync(
  'docker',
  ['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-tAc', PROBE],
  { encoding: 'utf8' },
);
if (probe.error || probe.status !== 0) proceed('could not query the local database');

const answer = (probe.stdout ?? '').trim();
if (answer === 't') process.exit(0); // migrations applied — say nothing, run the tests
if (answer === 'f') {
  console.error(`\n✗ ${RESET_HINT}\n`);
  process.exit(1);
}
proceed(`unexpected probe result ${JSON.stringify(answer)}`);
