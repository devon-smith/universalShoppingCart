import { describe, expect, it } from 'vitest';

import type { Observation } from './history';
import { changeDirection, summarizeHistory } from './history';

let nextId = 1;

function observation(price: string | null, observedAt: string, source = 'revisit'): Observation {
  return {
    id: nextId++,
    observed_at: observedAt,
    price,
    currency: 'USD',
    availability: 'in_stock',
    source,
  };
}

/** Newest-first, which is how the drawer reads them from the database. */
const RUN: Observation[] = [
  observation('79.95', '2026-07-31T22:00:00Z'),
  observation('84.00', '2026-07-31T12:00:00Z'),
  observation('96.00', '2026-07-30T12:00:00Z'),
  observation('92.50', '2026-07-29T12:00:00Z'),
  observation('98.00', '2026-07-28T12:00:00Z', 'capture'),
];

describe('summarizeHistory', () => {
  it('reads the newest priced observation as current', () => {
    expect(summarizeHistory(RUN).current).toEqual({
      amount: '79.95',
      observedAt: '2026-07-31T22:00:00Z',
    });
  });

  it('reads the oldest priced observation as the price when saved', () => {
    expect(summarizeHistory(RUN).atSaved?.amount).toBe('98.00');
  });

  it('finds the lowest and highest, with when each was seen', () => {
    const summary = summarizeHistory(RUN);
    expect(summary.lowest).toEqual({ amount: '79.95', observedAt: '2026-07-31T22:00:00Z' });
    expect(summary.highest).toEqual({ amount: '98.00', observedAt: '2026-07-28T12:00:00Z' });
  });

  it('does not assume the newest is the lowest — a price that rose again is caught', () => {
    // 92.50 then 96.00: the peak is not at either end of the run.
    const rising = [
      observation('96.00', '2026-07-30T12:00:00Z'),
      observation('92.50', '2026-07-29T12:00:00Z'),
      observation('94.00', '2026-07-28T12:00:00Z'),
    ];
    const summary = summarizeHistory(rising);
    expect(summary.highest?.amount).toBe('96.00');
    expect(summary.lowest?.amount).toBe('92.50');
  });

  it('computes the change since saved on the decimal strings', () => {
    const summary = summarizeHistory(RUN);
    expect(summary.changeSinceSaved).toBe('-18.05');
    expect(summary.percentSinceSaved).toBe(18);
  });

  it('reports a rise as a positive change', () => {
    const rose = [
      observation('120.00', '2026-07-31T12:00:00Z'),
      observation('98.00', '2026-07-28T12:00:00Z'),
    ];
    expect(summarizeHistory(rose).changeSinceSaved).toBe('22.00');
    expect(changeDirection(summarizeHistory(rose))).toBe('up');
  });

  it('says nothing about change when there is only one observation', () => {
    const single = [observation('98.00', '2026-07-28T12:00:00Z', 'capture')];
    const summary = summarizeHistory(single);

    // A single observation is not a comparison, and "0%" would claim one that never happened.
    expect(summary.changeSinceSaved).toBeNull();
    expect(summary.percentSinceSaved).toBeNull();
    expect(changeDirection(summary)).toBe('none');
    expect(summary.current?.amount).toBe('98.00');
    expect(summary.atSaved?.amount).toBe('98.00');
  });

  it('reports no movement when two observations agree', () => {
    const flat = [
      observation('98.00', '2026-07-31T12:00:00Z'),
      observation('98.00', '2026-07-28T12:00:00Z'),
    ];
    const summary = summarizeHistory(flat);

    expect(summary.changeSinceSaved).toBe('0.00');
    expect(changeDirection(summary)).toBe('none');
    expect(summary.flat).toBe(true);
  });

  it('sorts by time rather than trusting the order it was handed', () => {
    const shuffled = [RUN[2]!, RUN[4]!, RUN[0]!, RUN[1]!, RUN[3]!];
    expect(summarizeHistory(shuffled).current?.amount).toBe('79.95');
    expect(summarizeHistory(shuffled).atSaved?.amount).toBe('98.00');
  });

  it('ignores observations with no price rather than treating them as zero', () => {
    const withGaps = [
      observation(null, '2026-07-31T22:00:00Z'),
      observation('84.00', '2026-07-31T12:00:00Z'),
      observation('98.00', '2026-07-28T12:00:00Z', 'capture'),
    ];
    const summary = summarizeHistory(withGaps);

    expect(summary.pricedCount).toBe(2);
    expect(summary.current?.amount).toBe('84.00');
    expect(summary.lowest?.amount).toBe('84.00');
  });

  it('returns an empty summary when nothing was ever priced', () => {
    const summary = summarizeHistory([observation(null, '2026-07-28T12:00:00Z')]);
    expect(summary.pricedCount).toBe(0);
    expect(summary.current).toBeNull();
  });

  it('returns an empty summary for no observations at all', () => {
    expect(summarizeHistory([]).pricedCount).toBe(0);
  });

  it('does not lose precision through a float', () => {
    const pennies = [
      observation('0.30', '2026-07-31T12:00:00Z'),
      observation('0.10', '2026-07-28T12:00:00Z'),
    ];
    // 0.30 - 0.10 must not be 0.19999999999999998.
    expect(summarizeHistory(pennies).changeSinceSaved).toBe('0.20');
  });

  it('rejects a malformed price rather than ranking it', () => {
    const junk = [
      observation('not-a-price', '2026-07-31T12:00:00Z'),
      observation('98.00', '2026-07-28T12:00:00Z'),
    ];
    expect(summarizeHistory(junk).pricedCount).toBe(1);
    expect(summarizeHistory(junk).current?.amount).toBe('98.00');
  });
});
