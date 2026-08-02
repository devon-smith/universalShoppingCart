/**
 * What a run of observations adds up to.
 *
 * The drawer used to print the observations and leave the reader to do the arithmetic. The
 * questions a person actually has — is this the cheapest it has been, is it going up, what did
 * I pay attention to it at — are all answerable from the same rows, and answering them is the
 * difference between a log and a price history.
 *
 * Every figure here is read from a recorded observation. Nothing is interpolated, nothing is
 * projected forward, and an absent value stays absent: with one observation there is no
 * "change since saved", and saying "0%" would claim a comparison that was never made
 * (BUILD_PLAN.md §14.3).
 */

import { subtractDecimals } from './freshness';

export interface Observation {
  id: number;
  observed_at: string;
  price: string | number | null;
  currency: string | null;
  availability: string;
  source: string;
}

/** One end of the observed range, kept with when it was seen. */
export interface PricePoint {
  amount: string;
  observedAt: string;
}

export interface HistorySummary {
  /** The most recent observation carrying a price. */
  current: PricePoint | null;
  lowest: PricePoint | null;
  highest: PricePoint | null;
  /** The first observation carrying a price — what it cost when it entered the cart. */
  atSaved: PricePoint | null;
  /** Signed decimal string: negative means it has fallen since it was saved. */
  changeSinceSaved: string | null;
  /** Whole percent, unsigned. `null` when there is nothing to compare or the base is zero. */
  percentSinceSaved: number | null;
  /** How many observations carried a price. The list may be longer. */
  pricedCount: number;
  /** True when every priced observation is the same amount. */
  flat: boolean;
}

export const EMPTY_SUMMARY: HistorySummary = {
  current: null,
  lowest: null,
  highest: null,
  atSaved: null,
  changeSinceSaved: null,
  percentSinceSaved: null,
  pricedCount: 0,
  flat: false,
};

/** Compare two decimal strings exactly, without going through a float. */
function isBelow(candidate: string, incumbent: string): boolean {
  const difference = subtractDecimals(candidate, incumbent);
  return difference !== null && difference.startsWith('-');
}

function isAbove(candidate: string, incumbent: string): boolean {
  const difference = subtractDecimals(candidate, incumbent);
  return difference !== null && !difference.startsWith('-') && !/^0*(\.0*)?$/.test(difference);
}

/**
 * Summarise a run of observations.
 *
 * Accepts them in any order — the caller reads newest-first from the database, and sorting
 * here rather than trusting that keeps the summary correct if the query ever changes.
 */
export function summarizeHistory(observations: readonly Observation[]): HistorySummary {
  const priced = observations
    .filter((observation) => observation.price !== null && observation.price !== undefined)
    .map((observation) => ({
      amount: String(observation.price),
      observedAt: observation.observed_at,
    }))
    .filter((point) => /^\d+(\.\d+)?$/.test(point.amount))
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt));

  if (priced.length === 0) return EMPTY_SUMMARY;

  const atSaved = priced[0]!;
  const current = priced[priced.length - 1]!;

  let lowest = atSaved;
  let highest = atSaved;
  for (const point of priced) {
    if (isBelow(point.amount, lowest.amount)) lowest = point;
    if (isAbove(point.amount, highest.amount)) highest = point;
  }

  // One observation is not a comparison. Two at the same price is a comparison whose answer
  // is "no change", which is worth saying — but only the delta says it, not a percentage.
  const changeSinceSaved =
    priced.length > 1 ? subtractDecimals(current.amount, atSaved.amount) : null;

  const base = Number(atSaved.amount);
  const percentSinceSaved =
    changeSinceSaved === null || !Number.isFinite(base) || base === 0
      ? null
      : Math.round(Math.abs((Number(current.amount) - base) / base) * 100);

  return {
    current,
    lowest,
    highest,
    atSaved,
    changeSinceSaved,
    percentSinceSaved,
    pricedCount: priced.length,
    flat: lowest.amount === highest.amount,
  };
}

/** The direction of `changeSinceSaved`, for callers that need a word rather than a sign. */
export function changeDirection(summary: HistorySummary): 'down' | 'up' | 'none' {
  if (summary.changeSinceSaved === null) return 'none';
  if (summary.changeSinceSaved.startsWith('-')) return 'down';
  return /^0*(\.0*)?$/.test(summary.changeSinceSaved) ? 'none' : 'up';
}
