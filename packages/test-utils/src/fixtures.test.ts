import { describe, expect, it } from 'vitest';

import { readFixture, readJsonFixture, resolveFromModule } from './fixtures';

describe('fixture helpers', () => {
  it('resolves paths relative to the importing module', () => {
    expect(resolveFromModule(import.meta.url, '__fixtures__', 'sample.json')).toMatch(
      /packages\/test-utils\/src\/__fixtures__\/sample\.json$/,
    );
  });

  it('reads a fixture as text', () => {
    expect(readFixture(import.meta.url, '__fixtures__', 'sample.json')).toContain('"ok": true');
  });

  it('reads and parses a JSON fixture', () => {
    expect(
      readJsonFixture<{ ok: boolean }>(import.meta.url, '__fixtures__', 'sample.json'),
    ).toEqual({ ok: true });
  });

  it('throws a useful error for a missing fixture', () => {
    expect(() => readFixture(import.meta.url, '__fixtures__', 'missing.json')).toThrow(/ENOENT/);
  });
});
