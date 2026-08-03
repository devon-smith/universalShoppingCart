import { describe, expect, it } from 'vitest';

import { compareMoney, evaluateAlerts, isPriceBelowDesired, type ObservedState } from './alerts';

describe('compareMoney', () => {
  it('compares without a float, ignoring leading zeros and fraction width', () => {
    expect(compareMoney('9.50', '9.5')).toBe(0);
    expect(compareMoney('09.50', '9.50')).toBe(0);
    expect(compareMoney('10.00', '9.99')).toBe(1);
    expect(compareMoney('9.99', '10.00')).toBe(-1);
    expect(compareMoney('100', '99.99')).toBe(1);
    expect(compareMoney('0.10', '0.10')).toBe(0);
  });

  it('does not lose precision the way a float would', () => {
    // 0.1 + 0.2 !== 0.3 in a double; string compare is exact.
    expect(compareMoney('0.30', '0.30')).toBe(0);
    expect(compareMoney('1000000.01', '1000000.00')).toBe(1);
  });
});

describe('isPriceBelowDesired', () => {
  const base: ObservedState = { availability: 'in_stock', price: null, desiredPrice: null };

  it('is true only when a known price is at or below a set desired price', () => {
    expect(isPriceBelowDesired({ ...base, price: '80.00', desiredPrice: '80.00' })).toBe(true);
    expect(isPriceBelowDesired({ ...base, price: '79.99', desiredPrice: '80.00' })).toBe(true);
    expect(isPriceBelowDesired({ ...base, price: '80.01', desiredPrice: '80.00' })).toBe(false);
  });

  it('is false when either price is unknown', () => {
    expect(isPriceBelowDesired({ ...base, price: null, desiredPrice: '80.00' })).toBe(false);
    expect(isPriceBelowDesired({ ...base, price: '80.00', desiredPrice: null })).toBe(false);
  });
});

describe('evaluateAlerts', () => {
  const state = (over: Partial<ObservedState>): ObservedState => ({
    availability: 'in_stock',
    price: null,
    desiredPrice: null,
    ...over,
  });

  it('fires price_below_desired only on the crossing, not while it stays below', () => {
    const above = state({ price: '90.00', desiredPrice: '80.00' });
    const below = state({ price: '75.00', desiredPrice: '80.00' });
    expect(evaluateAlerts(above, below)).toContain('price_below_desired');
    // Still below on the next observation — no second alert.
    expect(evaluateAlerts(below, state({ price: '74.00', desiredPrice: '80.00' }))).not.toContain(
      'price_below_desired',
    );
  });

  it('fires back_in_stock on out→in, and became_unavailable on in→out', () => {
    const inStock = state({ availability: 'in_stock' });
    const outStock = state({ availability: 'out_of_stock' });
    expect(evaluateAlerts(outStock, inStock)).toEqual(['back_in_stock']);
    expect(evaluateAlerts(inStock, outStock)).toEqual(['became_unavailable']);
  });

  it('does not fire a stock alert while the state is unchanged', () => {
    const inStock = state({ availability: 'in_stock' });
    expect(evaluateAlerts(inStock, inStock)).toEqual([]);
  });

  it('on a first observation (no previous), only an already-below price can fire', () => {
    expect(evaluateAlerts(null, state({ price: '70.00', desiredPrice: '80.00' }))).toEqual([
      'price_below_desired',
    ]);
    // No previous stock state, so back_in_stock cannot fire on a first in-stock reading.
    expect(evaluateAlerts(null, state({ availability: 'in_stock' }))).toEqual([]);
  });

  it('can raise a price and a stock alert from one observation', () => {
    const before = state({ availability: 'out_of_stock', price: '90.00', desiredPrice: '80.00' });
    const after = state({ availability: 'in_stock', price: '75.00', desiredPrice: '80.00' });
    expect(evaluateAlerts(before, after).sort()).toEqual(['back_in_stock', 'price_below_desired']);
  });
});
