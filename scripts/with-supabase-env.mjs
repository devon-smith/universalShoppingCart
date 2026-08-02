#!/usr/bin/env node
/**
 * Run a command with the local Supabase connection details in its environment.
 *
 * Next.js inlines `NEXT_PUBLIC_*` at build time, so the end-to-end suite has to build
 * and serve the app with the same values it will test against. This wrapper reads them
 * from the running local stack once and passes them to the whole command, build included.
 *
 * Values already present in the environment win, so CI or a preview deployment can point
 * the suite somewhere else without changing this script.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [command, ...args] = process.argv.slice(2);

if (!command) {
  console.error('Usage: node scripts/with-supabase-env.mjs <command> [args...]');
  process.exit(2);
}

function localSupabaseStatus() {
  let raw;
  try {
    raw = execFileSync('node', ['scripts/supabase.mjs', 'status', '-o', 'json'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    console.error(
      'Could not reach a local Supabase stack. Run `pnpm supabase:start`, or set\n' +
        'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY yourself.',
    );
    process.exit(1);
  }

  // The JSON starts at the first line that is exactly `{`, not at the first `{` anywhere.
  // On a Node version other than the pinned one, pnpm prints its engine warning to *stdout*:
  //
  //   WARN  Unsupported engine: wanted: {"node":">=22"} (current: {"node":"v20.20.2", ...})
  //   {
  //     "API_URL": ...
  //
  // Slicing from the first `{` then starts inside `{"node":">=22"}` and the parse fails with
  // a message about Supabase that sends the reader to the wrong place entirely.
  const lines = raw.split('\n');
  const start = lines.findIndex((line) => line.trim() === '{');
  const body = start === -1 ? raw : lines.slice(start).join('\n');

  try {
    return JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1));
  } catch {
    console.error('`supabase status -o json` did not return parseable JSON.');
    process.exit(1);
  }
}

const env = { ...process.env };

if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
  const status = localSupabaseStatus();
  env.NEXT_PUBLIC_SUPABASE_URL = status.API_URL;
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = status.PUBLISHABLE_KEY;
  env.SUPABASE_MAILPIT_URL ??= status.MAILPIT_URL ?? 'http://127.0.0.1:54324';
}

// The extension bundle inlines its own copy at build time, and its end-to-end suite
// signs in against the same project as the web app's.
env.WXT_PUBLIC_SUPABASE_URL ??= env.NEXT_PUBLIC_SUPABASE_URL;
env.WXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
env.WXT_PUBLIC_APP_URL ??= env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

// The extension end-to-end suite needs the build that can reach the loopback fixture
// server; see apps/extension/lib/manifest.ts.
env.WXT_E2E ??= '1';

const result = spawnSync(command, args, { cwd: repoRoot, env, stdio: 'inherit', shell: false });
process.exit(result.status ?? 1);
