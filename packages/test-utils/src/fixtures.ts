import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Test-only helpers shared by the workspace. Nothing here may be imported by
 * shipped application or extension code.
 */

/** Resolve a path relative to the importing test module's directory. */
export function resolveFromModule(importMetaUrl: string, ...segments: string[]): string {
  return resolve(dirname(fileURLToPath(importMetaUrl)), ...segments);
}

/** Read a fixture file as UTF-8 text, relative to the importing test module. */
export function readFixture(importMetaUrl: string, ...segments: string[]): string {
  return readFileSync(resolveFromModule(importMetaUrl, ...segments), 'utf8');
}

/** Read and parse a JSON fixture, relative to the importing test module. */
export function readJsonFixture<T>(importMetaUrl: string, ...segments: string[]): T {
  return JSON.parse(readFixture(importMetaUrl, ...segments)) as T;
}
