import { describe, expect, it } from 'vitest';

import {
  assertSupportedSchemaVersion,
  isSupportedSchemaVersion,
  schemaVersion,
  UnsupportedSchemaVersionError,
} from './schema-version';

describe('schemaVersion', () => {
  it('accepts the exact supported literal', () => {
    expect(schemaVersion(1).parse(1)).toBe(1);
  });

  it('rejects any other version', () => {
    expect(schemaVersion(1).safeParse(2).success).toBe(false);
    expect(schemaVersion(1).safeParse('1').success).toBe(false);
  });
});

describe('assertSupportedSchemaVersion', () => {
  it('passes through a supported payload', () => {
    expect(() => assertSupportedSchemaVersion({ schemaVersion: 1 }, [1])).not.toThrow();
  });

  it('rejects a future version rather than guessing at its shape', () => {
    expect(() => assertSupportedSchemaVersion({ schemaVersion: 2 }, [1])).toThrow(
      UnsupportedSchemaVersionError,
    );
  });

  it('rejects a missing or non-numeric version', () => {
    expect(() => assertSupportedSchemaVersion({}, [1])).toThrow(UnsupportedSchemaVersionError);
    expect(() => assertSupportedSchemaVersion({ schemaVersion: '1' }, [1])).toThrow(
      UnsupportedSchemaVersionError,
    );
    expect(() => assertSupportedSchemaVersion(null, [1])).toThrow(UnsupportedSchemaVersionError);
  });

  it('reports what it received and what it supports', () => {
    try {
      assertSupportedSchemaVersion({ schemaVersion: 9 }, [1, 2]);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(UnsupportedSchemaVersionError);
      const typed = error as UnsupportedSchemaVersionError;
      expect(typed.received).toBe(9);
      expect(typed.supported).toEqual([1, 2]);
    }
  });
});

describe('isSupportedSchemaVersion', () => {
  it('reports support without throwing', () => {
    expect(isSupportedSchemaVersion({ schemaVersion: 1 }, [1])).toBe(true);
    expect(isSupportedSchemaVersion({ schemaVersion: 3 }, [1])).toBe(false);
  });
});
