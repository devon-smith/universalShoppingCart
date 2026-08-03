import { describe, expect, it } from 'vitest';

import type { HistorySummary } from './history';
import { EMPTY_SUMMARY } from './history';
import { targetEverReached, targetProgress, targetState } from './target';

function summary(overrides: Partial<HistorySummary>): HistorySummary {
  return { ...EMPTY_SUMMARY, ...overrides };
}

const point = (amount: string) => ({ amount, observedAt: '2026-07-28T12:00:00Z' });

describe('targetState', () => {
  it('says nothing when no target is set', () => {
    expect(targetState(null, '98.00')).toEqual({ kind: 'none' });
  });

  it('reports a target with nothing to compare it to', () => {
    expect(targetState('80.00', null)).toEqual({ kind: 'no-price', target: '80.00' });
  });

  it('reports the gap when the price is above the target', () => {
    const state = targetState('80.00', '98.00');
    expect(state).toMatchObject({ kind: 'above', gap: '18.00', percentOver: 23 });
  });

  it('reports reached when an observation recorded the price below the target', () => {
    expect(targetState('80.00', '79.95')).toMatchObject({ kind: 'reached', under: '0.05' });
  });

  it('counts exactly at the target as reached', () => {
    expect(targetState('80.00', '80.00')).toMatchObject({ kind: 'reached', under: '0.00' });
  });

  it('compares exactly, so trailing zeros do not change the answer', () => {
    expect(targetState('80.0', '80.000').kind).toBe('reached');
  });

  it('does not lose a penny to a float', () => {
    expect(targetState('0.10', '0.30')).toMatchObject({ kind: 'above', gap: '0.20' });
  });

  it('ignores a malformed target rather than guessing', () => {
    expect(targetState('about eighty', '98.00')).toEqual({ kind: 'none' });
  });

  it('treats a malformed current price as no price', () => {
    expect(targetState('80.00', 'n/a')).toEqual({ kind: 'no-price', target: '80.00' });
  });
});

describe('targetEverReached', () => {
  it('is true when the lowest observation met the target, even if the price has risen', () => {
    // £70 last Tuesday is a real fact, and a different one from today's price.
    expect(targetEverReached('80.00', summary({ lowest: point('75.00') }))).toBe(true);
  });

  it('is false when the lowest observation never met it', () => {
    expect(targetEverReached('80.00', summary({ lowest: point('85.00') }))).toBe(false);
  });

  it('is false with no observations', () => {
    expect(targetEverReached('80.00', EMPTY_SUMMARY)).toBe(false);
  });

  it('is false with no target', () => {
    expect(targetEverReached(null, summary({ lowest: point('10.00') }))).toBe(false);
  });
});

describe('targetProgress', () => {
  it('is 1 once the target is met', () => {
    expect(targetProgress('80.00', '79.00', summary({ highest: point('100.00') }))).toBe(1);
  });

  it('measures the current price between the highest seen and the target', () => {
    // 100 → 80 is the span; 90 is halfway.
    expect(targetProgress('80.00', '90.00', summary({ highest: point('100.00') }))).toBeCloseTo(
      0.5,
    );
  });

  it('is 0 at the highest price ever seen', () => {
    expect(targetProgress('80.00', '100.00', summary({ highest: point('100.00') }))).toBe(0);
  });

  it('returns null rather than a misleading number when there is no target', () => {
    expect(targetProgress(null, '90.00', summary({ highest: point('100.00') }))).toBeNull();
  });

  it('is complete when the target sits above the current price', () => {
    // A target of 120 on a price of 100 is already met — there is no gap to show progress
    // towards. `ceiling <= target` in the implementation is therefore a defensive guard
    // rather than a reachable branch: highest >= current > target holds whenever the state
    // is `above`.
    expect(targetProgress('120.00', '100.00', summary({ highest: point('100.00') }))).toBe(1);
  });

  it('returns null when there is no price to place on the bar', () => {
    expect(targetProgress('80.00', null, summary({ highest: point('100.00') }))).toBeNull();
  });

  it('stays within 0 and 1 if a later price exceeds the recorded high', () => {
    const progress = targetProgress('80.00', '150.00', summary({ highest: point('100.00') }));
    expect(progress).toBe(0);
  });
});
