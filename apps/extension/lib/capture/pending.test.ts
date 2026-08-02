import type { ExtractionResult } from '@universal-cart/extractors';
import { describe, expect, it } from 'vitest';

import type { PendingStore } from './pending';
import {
  PENDING_CAPTURE_KEY,
  PENDING_CAPTURE_MAX_AGE_MS,
  isPendingCapture,
  pendingCapture,
  putPendingCapture,
  takePendingCapture,
} from './pending';

function store(initial: Record<string, unknown> = {}): PendingStore & { data: typeof initial } {
  const data = { ...initial };
  return {
    data,
    get: (key: string) => Promise.resolve(key in data ? { [key]: data[key] } : {}),
    set: (items: Record<string, unknown>) => {
      Object.assign(data, items);
      return Promise.resolve();
    },
    remove: (key: string) => {
      delete data[key];
      return Promise.resolve();
    },
  };
}

const result = { ok: true, capture: { schemaVersion: 1 } } as unknown as ExtractionResult;

describe('takePendingCapture', () => {
  it('returns what was put there', async () => {
    const s = store();
    await putPendingCapture(s, pendingCapture(result, 7, new Date('2026-07-26T12:00:00Z')));

    const taken = await takePendingCapture(s, new Date('2026-07-26T12:00:10Z'));

    expect(taken?.tabId).toBe(7);
    expect(taken?.result).toEqual(result);
  });

  it('is one-shot, so a remount does not re-show an old capture', async () => {
    const s = store();
    await putPendingCapture(s, pendingCapture(result, 7, new Date('2026-07-26T12:00:00Z')));

    await takePendingCapture(s, new Date('2026-07-26T12:00:10Z'));

    expect(await takePendingCapture(s, new Date('2026-07-26T12:00:11Z'))).toBeNull();
  });

  it('returns null when there is nothing waiting', async () => {
    expect(await takePendingCapture(store())).toBeNull();
  });

  it('discards a capture older than the handoff window', async () => {
    const s = store();
    await putPendingCapture(s, pendingCapture(result, 7, new Date('2026-07-26T12:00:00Z')));

    const later = new Date(Date.parse('2026-07-26T12:00:00Z') + PENDING_CAPTURE_MAX_AGE_MS + 1000);

    expect(await takePendingCapture(s, later)).toBeNull();
  });

  it('discards a handoff written by an incompatible build, and clears it', async () => {
    const s = store({ [PENDING_CAPTURE_KEY]: { schemaVersion: 99, result, tabId: 7 } });

    expect(await takePendingCapture(s)).toBeNull();
    expect(s.data[PENDING_CAPTURE_KEY]).toBeUndefined();
  });

  it('survives junk in storage rather than throwing', async () => {
    const s = store({ [PENDING_CAPTURE_KEY]: 'not an object' });
    expect(await takePendingCapture(s)).toBeNull();
  });
});

describe('isPendingCapture', () => {
  it('rejects anything missing the fields the panel reads', () => {
    expect(isPendingCapture(null)).toBe(false);
    expect(isPendingCapture({})).toBe(false);
    expect(isPendingCapture({ schemaVersion: 1, tabId: 1, capturedAt: 'x' })).toBe(false);
  });

  it('accepts a well-formed handoff', () => {
    expect(isPendingCapture(pendingCapture(result, 1))).toBe(true);
  });
});
