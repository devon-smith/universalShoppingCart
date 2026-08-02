import { describe, expect, it } from 'vitest';

import { availabilitySplit } from './availability';

describe('availabilitySplit', () => {
  it('says nothing extra when the page made no separate product claim', () => {
    const split = availabilitySplit('in_stock', null);

    expect(split.variant).toBe('In stock');
    expect(split.product).toBeNull();
    expect(split.sentence).toBeNull();
  });

  it('states the useful case: your size is gone, the product is not', () => {
    const split = availabilitySplit('out_of_stock', 'in_stock');

    expect(split.sentence).toBe('The size you chose is sold out — the product is still sold.');
    expect(split.variant).toBe('Out of stock');
    expect(split.product).toBe('In stock');
  });

  it('states the reverse, which is a different decision', () => {
    const split = availabilitySplit('in_stock', 'out_of_stock');
    expect(split.sentence).toBe('The size you chose is available — the product is no longer sold.');
  });

  it('says nothing extra when the two agree, which the column should never store', () => {
    // Defensive: the migration only writes the column when the claims differ, but a sentence
    // contrasting a fact with itself would be nonsense if that ever changed.
    expect(availabilitySplit('in_stock', 'in_stock').sentence).toBeNull();
  });

  it('handles an unknown variant availability without inventing a claim', () => {
    const split = availabilitySplit('unknown', 'in_stock');
    expect(split.sentence).toBe(
      'The page did not say whether your size is available — the product is still sold.',
    );
  });

  it('covers pre-order and backorder rather than falling through to unknown', () => {
    expect(availabilitySplit('preorder', 'in_stock').sentence).toContain('on pre-order');
    expect(availabilitySplit('in_stock', 'backorder').sentence).toContain('on backorder');
  });

  it('falls back safely on a value it does not recognise', () => {
    const split = availabilitySplit('teleported', 'in_stock');
    expect(split.variant).toBe('Availability unknown');
    expect(split.sentence).toContain('the product is still sold');
  });
});
