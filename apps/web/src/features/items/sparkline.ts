/**
 * The shape of a price run, as coordinates.
 *
 * The ADR kept the observation list rather than replacing it with a chart, and that stands —
 * the dates and sources are the information. But a list answers "what happened, and when" one
 * row at a time, and it cannot answer "what shape is this" at all. The seeded run
 * 98 → 94 → 92.50 → **96** → 88 → 84 → 79.95 has a rise in the middle that seven timestamped
 * rows genuinely hide.
 *
 * So: a sparkline *beside* the list, not instead of it, and drawn as an SVG polyline from
 * these points. No charting library — a dependency measured in hundreds of kilobytes for
 * forty lines of arithmetic would be the worst trade in the repository.
 *
 * Below `MIN_POINTS` nothing is drawn. Two observations are a straight line whatever the
 * numbers, and a straight line implies a trend that two points cannot evidence.
 */

import type { HistorySummary } from './history';

/** Fewer than this and the shape is not a shape. */
export const MIN_POINTS = 3;

export interface SparklinePoint {
  /** 0–1 left to right, oldest to newest. */
  x: number;
  /** 0–1 bottom to top, lowest price to highest. */
  y: number;
  amount: string;
  observedAt: string;
}

export interface Sparkline {
  points: SparklinePoint[];
  /** `points` as an SVG `polyline` value in a 0–1 box, y flipped so up means dearer. */
  path: string;
  low: string;
  high: string;
}

/**
 * Normalise a priced run into a unit box.
 *
 * Spacing is by index, not by elapsed time. Observations are recorded when the user happens to
 * revisit, so a time axis would render most of the width as the gap between two visits and
 * compress every actual price move into the right-hand edge. Even spacing answers the question
 * being asked — "how has this moved across the times I looked" — and does not pretend to be a
 * continuous record of a price nobody was watching.
 */
export function buildSparkline(
  summary: HistorySummary,
  priced: readonly SparklineInput[],
): Sparkline | null {
  if (priced.length < MIN_POINTS || summary.lowest === null || summary.highest === null) {
    return null;
  }

  const low = Number(summary.lowest.amount);
  const high = Number(summary.highest.amount);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;

  const span = high - low;
  const lastIndex = priced.length - 1;

  const points = priced.map((point, index) => {
    const value = Number(point.amount);
    return {
      x: index / lastIndex,
      // A flat run has no span to divide by; put it down the middle rather than at an edge,
      // which would read as "at its lowest ever" or "at its peak".
      y: span === 0 ? 0.5 : (value - low) / span,
      amount: point.amount,
      observedAt: point.observedAt,
    };
  });

  const path = points.map((point) => `${point.x.toFixed(4)},${(1 - point.y).toFixed(4)}`).join(' ');

  return { points, path, low: summary.lowest.amount, high: summary.highest.amount };
}

export interface SparklineInput {
  amount: string;
  observedAt: string;
}

/** The priced observations, oldest first — the order the sparkline draws them in. */
export function pricedPoints(
  observations: readonly { price: string | number | null; observed_at: string }[],
): SparklineInput[] {
  return observations
    .filter((observation) => observation.price !== null && observation.price !== undefined)
    .map((observation) => ({
      amount: String(observation.price),
      observedAt: observation.observed_at,
    }))
    .filter((point) => /^\d+(\.\d+)?$/.test(point.amount))
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt));
}
