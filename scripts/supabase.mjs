#!/usr/bin/env node
/**
 * Run the Supabase CLI with telemetry disabled.
 *
 * The CLI's analytics client sometimes fails to shut down and takes the process exit code
 * down with it — `supabase test db` reports `Result: PASS` and then exits 1. Opting out
 * removes the failure mode entirely, and nothing about local development needs it on.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const result = spawnSync('pnpm', ['exec', 'supabase', ...process.argv.slice(2)], {
  cwd: repoRoot,
  env: { ...process.env, DO_NOT_TRACK: '1' },
  stdio: 'inherit',
  shell: false,
});

process.exit(result.status ?? 1);
