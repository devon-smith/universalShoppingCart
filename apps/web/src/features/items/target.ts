/**
 * How the current price stands against the price the user said they would pay.
 *
 * The desired price is the one number on an item that is purely the user's. It deserves to be
 * legible at a glance, and the honest way to do that is arithmetic on two stored numbers —
 * never a prediction, never a "likely to drop soon".
 *
 * The green state means one thing: **an observation recorded the price at or below the
 * target.** Not "close", not "nearly". Green is the strongest signal this product has, and if
 * it can appear without that having happened it stops meaning anything.
 */

import { subtractDecimals } from './freshness';
import type { HistorySummary } from './history';

export type TargetState =
  /** No desired price set. */
  | { kind: 'none' }
  /** A target exists but no price has ever been observed, so there is nothing to compare. */
  | { kind: 'no-price'; target: string }
  /** An observation recorded the price at or below the target. */
  | { kind: 'reached'; target: string; current: string; under: string }
  /** The observed price is above the target, by this much. */
  | { kind: 'above'; target: string; current: string; gap: string; percentOver: number | null };

/** True when `current` is at or below `target`, compared exactly. */
function atOrBelow(current: string, target: string): boolean {
  const difference = subtractDecimals(current, target);
  return difference !== null && (difference.startsWith('-') || /^0*(\.0*)?$/.test(difference));
}

export function targetState(
  desiredPrice: string | number | null,
  currentPrice: string | number | null,
): TargetState {
  if (desiredPrice === null || desiredPrice === undefined) return { kind: 'none' };

  const target = String(desiredPrice);
  if (!/^\d+(\.\d+)?$/.test(target)) return { kind: 'none' };

  if (currentPrice === null || currentPrice === undefined) return { kind: 'no-price', target };
  const current = String(currentPrice);
  if (!/^\d+(\.\d+)?$/.test(current)) return { kind: 'no-price', target };

  if (atOrBelow(current, target)) {
    const under = subtractDecimals(target, current) ?? '0';
    return { kind: 'reached', target, current, under };
  }

  const gap = subtractDecimals(current, target) ?? '0';
  const targetValue = Number(target);
  const percentOver =
    Number.isFinite(targetValue) && targetValue > 0
      ? Math.round(((Number(current) - targetValue) / targetValue) * 100)
      : null;

  return { kind: 'above', target, current, gap, percentOver };
}

/**
 * Whether the target has ever been met, across the whole observed run.
 *
 * Separate from `targetState`, which describes *now*. "It was £70 last Tuesday" is a different
 * and useful fact, and conflating the two would let a green badge survive a price rise.
 */
export function targetEverReached(
  desiredPrice: string | number | null,
  summary: HistorySummary,
): boolean {
  if (desiredPrice === null || desiredPrice === undefined || summary.lowest === null) return false;

  const target = String(desiredPrice);
  if (!/^\d+(\.\d+)?$/.test(target)) return false;

  return atOrBelow(summary.lowest.amount, target);
}

/**
 * How far along the current price is between the target and the highest observed price, 0–1.
 *
 * Drives a progress bar. Returns `null` where the arithmetic would be meaningless — no target,
 * no price, or a range of zero — rather than a misleading 0 or 1.
 */
export function targetProgress(
  desiredPrice: string | number | null,
  currentPrice: string | number | null,
  summary: HistorySummary,
): number | null {
  const state = targetState(desiredPrice, currentPrice);
  if (state.kind === 'none' || state.kind === 'no-price') return null;
  if (state.kind === 'reached') return 1;

  const ceiling = Number(summary.highest?.amount ?? state.current);
  const target = Number(state.target);
  const current = Number(state.current);

  if (!Number.isFinite(ceiling) || !Number.isFinite(target) || ceiling <= target) return null;

  const progress = (ceiling - current) / (ceiling - target);
  return Math.min(1, Math.max(0, progress));
}
