import { describe, expect, it } from 'vitest';

import {
  availabilityLabel,
  decimalForInput,
  discountPercent,
  formatMoney,
  relativeTime,
} from './format';

describe('formatMoney', () => {
  it('formats with a currency', () => {
    expect(formatMoney('98.00', 'USD')).toBe('$98.00');
  });

  it('accepts the numeric string Postgres returns', () => {
    expect(formatMoney('1299.000000', 'USD')).toBe('$1,299.00');
  });

  it('formats without a currency rather than inventing one', () => {
    expect(formatMoney('98.00', null)).toBe('98.00');
  });

  it('keeps sub-cent precision when there is no currency', () => {
    expect(formatMoney('0.000001', null)).toBe('0.000001');
  });

  it('returns null for a missing or unusable price', () => {
    expect(formatMoney(null, 'USD')).toBeNull();
    expect(formatMoney('not a number', 'USD')).toBeNull();
  });
});

describe('availabilityLabel', () => {
  it('labels every known state', () => {
    expect(availabilityLabel('in_stock')).toBe('In stock');
    expect(availabilityLabel('out_of_stock')).toBe('Out of stock');
    expect(availabilityLabel('preorder')).toBe('Pre-order');
    expect(availabilityLabel('backorder')).toBe('Backorder');
  });

  it('says unknown rather than implying availability', () => {
    expect(availabilityLabel('unknown')).toBe('Availability unknown');
    expect(availabilityLabel('something-new')).toBe('Availability unknown');
  });
});

describe('discountPercent', () => {
  it('computes a whole-percent discount', () => {
    expect(discountPercent('80.00', '100.00')).toBe(20);
    expect(discountPercent('88.00', '98.00')).toBe(10);
  });

  it('reports nothing when there is no real discount', () => {
    expect(discountPercent('100.00', '100.00')).toBeNull();
    expect(discountPercent('120.00', '100.00')).toBeNull();
    expect(discountPercent('80.00', null)).toBeNull();
    expect(discountPercent(null, '100.00')).toBeNull();
    expect(discountPercent('80.00', '0.00')).toBeNull();
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-07-26T12:00:00.000Z');

  it('describes recent observations', () => {
    expect(relativeTime('2026-07-26T11:59:30.000Z', now)).toBe('just now');
    expect(relativeTime('2026-07-26T11:30:00.000Z', now)).toBe('30m ago');
    expect(relativeTime('2026-07-26T06:00:00.000Z', now)).toBe('6h ago');
    expect(relativeTime('2026-07-24T12:00:00.000Z', now)).toBe('2d ago');
  });

  it('falls back to a date for old observations', () => {
    expect(relativeTime('2026-01-01T12:00:00.000Z', now)).toMatch(/2026/);
  });

  it('is explicit about never having checked', () => {
    expect(relativeTime(null, now)).toBe('never checked');
    expect(relativeTime('not a date', now)).toBe('never checked');
  });
});

describe('decimalForInput', () => {
  it('drops the trailing zeros Postgres numeric(20,6) brings with it', () => {
    // What the desired-price field was showing somebody about to edit it.
    expect(decimalForInput('85.000000')).toBe('85');
  });

  it('keeps two places when there is a real fraction', () => {
    expect(decimalForInput('85.500000')).toBe('85.50');
  });

  it('preserves precision beyond two places rather than rounding it away', () => {
    expect(decimalForInput('85.123456')).toBe('85.123456');
  });

  it('leaves an integer alone', () => {
    expect(decimalForInput('85')).toBe('85');
  });

  it('is empty for no value, so the placeholder shows', () => {
    expect(decimalForInput(null)).toBe('');
  });

  it('accepts a number as well as a string', () => {
    expect(decimalForInput(85.5)).toBe('85.50');
  });

  it('passes anything unrecognised through rather than mangling it', () => {
    expect(decimalForInput('n/a')).toBe('n/a');
  });

  it('produces a value the edit schema still accepts', () => {
    for (const stored of ['85.000000', '85.500000', '85.123456', '0.010000']) {
      expect(decimalForInput(stored)).toMatch(/^\d+(\.\d{1,6})?$/);
    }
  });
});
