#!/usr/bin/env node
/**
 * Preflight for `pnpm test:db`: confirm the local database has every committed migration applied
 * before pg_prove runs.
 *
 * A database that predates a migration makes the pgTAP suite fail deep inside with a cryptic
 * `… does not exist`, which reads like a real regression and has cost diagnosis time more than
 * once. This turns that into one line naming the fix.
 *
 * It compares the newest migration FILE version against the newest version applied in the local
 * database (`supabase_migrations.schema_migrations`). That is self-maintaining: it never needs
 * updating when a migration lands — which the previous single-object probe did, and didn't, so it
 * went blind to exactly the drift it existed to catch.
 *
 * Fail-open: it short-circuits only when it positively confirms the database is behind. Docker
 * absent, the stack not running, an unreadable table — it prints a note and lets the tests run.
 * It may only turn a confusing red into a clear one, never block a healthy database.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'supabase',
  'migrations',
);

function proceed(note) {
  if (note) console.warn(`[test:db preflight] ${note} — skipping the check.`);
  process.exit(0);
}

// Newest migration on disk: the timestamp prefix of the highest-sorting `<version>_*.sql` file.
let latestFileVersion = '';
try {
  for (const name of readdirSync(migrationsDir)) {
    const match = /^(\d+)_.*\.sql$/.exec(name);
    if (match && match[1] > latestFileVersion) latestFileVersion = match[1];
  }
} catch (error) {
  proceed(`could not read ${migrationsDir} (${error.message})`);
}
if (latestFileVersion === '') proceed('no migrations found on disk');

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

// Newest migration the local database has applied. A missing table (fresh stack) errors here and
// falls through to fail-open rather than a false alarm.
const probe = spawnSync(
  'docker',
  [
    'exec',
    container,
    'psql',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '-tAc',
    "select coalesce(max(version), '') from supabase_migrations.schema_migrations",
  ],
  { encoding: 'utf8' },
);
if (probe.error || probe.status !== 0) proceed('could not read applied migrations');

// Timestamp prefixes are fixed-width, so a string comparison is a chronological one.
const appliedVersion = (probe.stdout ?? '').trim();
if (appliedVersion !== '' && appliedVersion >= latestFileVersion) process.exit(0);

console.error(
  '\n✗ Local database is behind the migrations on disk' +
    ` (applied ${appliedVersion || 'none'}, latest on disk ${latestFileVersion}).\n` +
    '  Run `pnpm supabase:reset` to apply them, then re-run `pnpm test:db`.\n',
);
process.exit(1);
