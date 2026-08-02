#!/usr/bin/env node
/**
 * Regenerate packages/contracts/src/database.types.ts from the local Supabase schema.
 *
 * The Supabase CLI occasionally writes a telemetry-shutdown JSON blob to stdout after
 * the generated source, which would corrupt the file. Everything after the generated
 * module is dropped, and the result is only written when it looks like the real thing.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(repoRoot, 'packages/contracts/src/database.types.ts');

// The CLI can exit non-zero purely because its telemetry client failed to shut down,
// after having already written perfectly good output. The validation below is the real
// gate; the exit code is not trustworthy enough to be one.
let raw;
try {
  raw = execFileSync('node', ['scripts/supabase.mjs', 'gen', 'types', 'typescript', '--local'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
} catch (error) {
  raw = error.stdout ?? '';
}

const lines = raw
  .split('\n')
  .filter((line) => !line.startsWith('{"_tag":"Error"'))
  .join('\n')
  .trimEnd();

if (!lines.includes('export type Database = {') || !lines.includes('cart_role')) {
  console.error('Generated output does not look like the expected schema. Nothing was written.');
  console.error(lines.slice(0, 400));
  process.exit(1);
}

writeFileSync(target, `${lines}\n`, 'utf8');
console.log(`Wrote ${target}`);
