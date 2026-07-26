import { describe, expect, it } from 'vitest';

import { freshness, priceChange, subtractDecimals } from './freshness';

const NOW = new Date('2026-07-26T12:00:00.000Z');

function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * 3_600_000).toISOString();
}

describe('freshness', () => {
  it('calls a recent observation fresh', () => {
    expect(freshness(hoursAgo(1), NOW).level).toBe('fresh');
    expect(freshness(hoursAgo(23), NOW).level).toBe('fresh');
  });

  it('calls a day-to-a-week-old observation aging', () => {
    expect(freshness(hoursAgo(25), NOW).level).toBe('aging');
    expect(freshness(hoursAgo(24 * 6), NOW).level).toBe('aging');
  });

  it('calls anything older than a week stale', () => {
    expect(freshness(hoursAgo(24 * 8), NOW).level).toBe('stale');
    expect(freshness(hoursAgo(24 * 90), NOW).level).toBe('stale');
  });

  it('says so when a price was never observed', () => {
    // Silence would read as "current".
    expect(freshness(null, NOW)).toEqual({
      level: 'never',
      hours: null,
      label: 'Never checked',
    });
    expect(freshness('not a date', NOW).level).toBe('never');
  });

  it('warns explicitly once a price is stale', () => {
    expect(freshness(hoursAgo(24 * 10), NOW).label).toMatch(/may be out of date/);
  });

  it('never reports negative age for a clock skew', () => {
    expect(freshness(new Date(NOW.getTime() + 60_000).toISOString(), NOW).hours).toBe(0);
  });
});

describe('subtractDecimals', () => {
  it('subtracts without floating point error', () => {
    // The canonical example: 0.3 - 0.1 is not 0.19999999999999998 here.
    expect(subtractDecimals('0.3', '0.1')).toBe('0.2');
    expect(subtractDecimals('98.00', '120.00')).toBe('-22.00');
    expect(subtractDecimals('1299.99', '1300.00')).toBe('-0.01');
  });

  it('aligns different scales', () => {
    expect(subtractDecimals('10.5', '10.25')).toBe('0.25');
    expect(subtractDecimals('10', '9.999999')).toBe('0.000001');
  });

  it('handles whole numbers', () => {
    expect(subtractDecimals('10', '3')).toBe('7');
  });

  it('returns null for anything that is not a decimal', () => {
    expect(subtractDecimals('$10', '3')).toBeNull();
    expect(subtractDecimals('10', 'free')).toBeNull();
  });
});

describe('priceChange', () => {
  it('reports a drop', () => {
    expect(priceChange('88.00', '98.00')).toEqual({
      direction: 'down',
      amount: '10.00',
      percent: 10,
    });
  });

  it('reports a rise', () => {
    expect(priceChange('110.00', '100.00')).toEqual({
      direction: 'up',
      amount: '10.00',
      percent: 10,
    });
  });

  it('reports no change when the price is the same', () => {
    expect(priceChange('98.00', '98.00').direction).toBe('unchanged');
    expect(priceChange('98.00', '98.000').direction).toBe('unchanged');
  });

  it('reports unknown rather than guessing when either side is missing', () => {
    expect(priceChange(null, '98.00').direction).toBe('unknown');
    expect(priceChange('98.00', null).direction).toBe('unknown');
    expect(priceChange(null, null).direction).toBe('unknown');
  });

  it('keeps sub-cent precision', () => {
    expect(priceChange('9.999998', '9.999999').amount).toBe('0.000001');
  });

  it('leaves the percentage out when the previous price was zero', () => {
    expect(priceChange('5.00', '0.00').percent).toBeNull();
  });

  it('accepts the numeric strings Postgres returns', () => {
    expect(priceChange('88.000000', '98.000000').amount).toBe('10.000000');
  });
});
