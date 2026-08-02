import { z } from 'zod';

/**
 * Every payload that crosses a process boundary — extension messages, capture
 * payloads written to Postgres, values persisted in extension storage — carries
 * a `schemaVersion`. Readers must reject versions they were not built to parse
 * rather than guessing at an unfamiliar shape.
 *
 * See BUILD_PLAN.md §5.1 and §6.
 */

export class UnsupportedSchemaVersionError extends Error {
  readonly received: unknown;
  readonly supported: readonly number[];

  constructor(received: unknown, supported: readonly number[]) {
    super(
      `Unsupported schemaVersion ${JSON.stringify(received)}; this build understands ${supported.join(', ')}.`,
    );
    this.name = 'UnsupportedSchemaVersionError';
    this.received = received;
    this.supported = supported;
  }
}

/** A Zod schema matching exactly one supported `schemaVersion` literal. */
export function schemaVersion<const V extends number>(version: V): z.ZodLiteral<V> {
  return z.literal(version);
}

/**
 * Narrow an unknown payload to "has a schemaVersion this build supports".
 *
 * This deliberately does not validate the rest of the payload; it is the cheap
 * gate that runs before a full schema parse so that version mismatches produce a
 * precise, actionable error instead of a wall of field-level Zod issues.
 */
export function assertSupportedSchemaVersion<const V extends number>(
  payload: unknown,
  supported: readonly V[],
): asserts payload is { schemaVersion: V } {
  const received =
    typeof payload === 'object' && payload !== null && 'schemaVersion' in payload
      ? (payload as { schemaVersion: unknown }).schemaVersion
      : undefined;

  if (typeof received !== 'number' || !supported.includes(received as V)) {
    throw new UnsupportedSchemaVersionError(received, supported);
  }
}

/** True when `payload` carries a `schemaVersion` in `supported`. */
export function isSupportedSchemaVersion<const V extends number>(
  payload: unknown,
  supported: readonly V[],
): payload is { schemaVersion: V } {
  try {
    assertSupportedSchemaVersion(payload, supported);
    return true;
  } catch {
    return false;
  }
}
