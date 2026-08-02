import { describe, expect, it } from 'vitest';

import { summarizeHistory, type Observation } from './history';
import { buildSparkline, MIN_POINTS, pricedPoints } from './sparkline';

let nextId = 1;
function observation(price: string | null, observedAt: string): Observation {
  return {
    id: nextId++,
    observed_at: observedAt,
    price,
    currency: 'USD',
    availability: 'in_stock',
    source: 'revisit',
  };
}

/** The seeded run, newest first, with a rise in the middle. */
const RUN: Observation[] = [
  observation('79.95', '2026-07-31T22:00:00Z'),
  observation('84.00', '2026-07-31T12:00:00Z'),
  observation('96.00', '2026-07-30T12:00:00Z'),
  observation('92.50', '2026-07-29T12:00:00Z'),
  observation('98.00', '2026-07-28T12:00:00Z'),
];

function sparklineFor(observations: Observation[]) {
  return buildSparkline(summarizeHistory(observations), pricedPoints(observations));
}

describe('pricedPoints', () => {
  it('returns the priced observations oldest first', () => {
    expect(pricedPoints(RUN).map((point) => point.amount)).toEqual([
      '98.00',
      '92.50',
      '96.00',
      '84.00',
      '79.95',
    ]);
  });

  it('drops observations with no price rather than plotting a zero', () => {
    const withGap = [...RUN, observation(null, '2026-07-27T12:00:00Z')];
    expect(pricedPoints(withGap)).toHaveLength(5);
  });
});

describe('buildSparkline', () => {
  it('draws nothing below the minimum number of points', () => {
    const two = [RUN[0]!, RUN[1]!];
    expect(sparklineFor(two)).toBeNull();
    expect(MIN_POINTS).toBe(3);
  });

  it('draws nothing for a single observation', () => {
    expect(sparklineFor([RUN[0]!])).toBeNull();
  });

  it('spans the full width from oldest to newest', () => {
    const line = sparklineFor(RUN)!;
    expect(line.points[0]!.x).toBe(0);
    expect(line.points[line.points.length - 1]!.x).toBe(1);
  });

  it('puts the highest price at the top and the lowest at the bottom', () => {
    const line = sparklineFor(RUN)!;
    const highest = line.points.find((point) => point.amount === '98.00')!;
    const lowest = line.points.find((point) => point.amount === '79.95')!;

    expect(highest.y).toBe(1);
    expect(lowest.y).toBe(0);
  });

  it('keeps the rise in the middle that the list hides', () => {
    // 92.50 then 96.00: the fourth row of the list, invisible as a shape.
    const line = sparklineFor(RUN)!;
    const [, second, third] = line.points;
    expect(third!.y).toBeGreaterThan(second!.y);
  });

  it('flips y in the path so a dearer price is drawn higher', () => {
    const line = sparklineFor(RUN)!;
    // First point is the highest price, so its plotted y is 0 — the top of the box.
    expect(line.path.startsWith('0.0000,0.0000')).toBe(true);
  });

  it('spaces by index, not by elapsed time', () => {
    // Two observations minutes apart and one a week earlier must still be evenly spaced,
    // or every real move is crushed against the right-hand edge.
    const uneven = [
      observation('80.00', '2026-07-31T12:02:00Z'),
      observation('90.00', '2026-07-31T12:00:00Z'),
      observation('100.00', '2026-07-24T12:00:00Z'),
    ];
    const line = sparklineFor(uneven)!;
    expect(line.points.map((point) => point.x)).toEqual([0, 0.5, 1]);
  });

  it('draws a flat run down the middle rather than at an edge', () => {
    const flat = [
      observation('98.00', '2026-07-31T12:00:00Z'),
      observation('98.00', '2026-07-30T12:00:00Z'),
      observation('98.00', '2026-07-29T12:00:00Z'),
    ];
    const line = sparklineFor(flat)!;
    expect(line.points.every((point) => point.y === 0.5)).toBe(true);
  });

  it('reports the low and high it scaled against', () => {
    const line = sparklineFor(RUN)!;
    expect(line.low).toBe('79.95');
    expect(line.high).toBe('98.00');
  });

  it('produces one path coordinate per point', () => {
    const line = sparklineFor(RUN)!;
    expect(line.path.split(' ')).toHaveLength(5);
  });
});
