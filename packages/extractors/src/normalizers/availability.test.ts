import { describe, expect, it } from 'vitest';

import { normalizeAvailability } from './availability';

describe('normalizeAvailability — schema.org', () => {
  it('reads full enumeration URLs', () => {
    expect(normalizeAvailability('https://schema.org/InStock')).toBe('in_stock');
    expect(normalizeAvailability('http://schema.org/OutOfStock')).toBe('out_of_stock');
    expect(normalizeAvailability('https://schema.org/PreOrder')).toBe('preorder');
    expect(normalizeAvailability('https://schema.org/BackOrder')).toBe('backorder');
  });

  it('reads bare enumeration members', () => {
    expect(normalizeAvailability('InStock')).toBe('in_stock');
    expect(normalizeAvailability('SoldOut')).toBe('out_of_stock');
  });

  it('treats store-limited availability as in stock', () => {
    expect(normalizeAvailability('https://schema.org/LimitedAvailability')).toBe('in_stock');
    expect(normalizeAvailability('https://schema.org/InStoreOnly')).toBe('in_stock');
  });

  it('treats discontinued as out of stock', () => {
    expect(normalizeAvailability('https://schema.org/Discontinued')).toBe('out_of_stock');
  });
});

describe('normalizeAvailability — Open Graph and text', () => {
  it('reads Open Graph values', () => {
    expect(normalizeAvailability('instock')).toBe('in_stock');
    expect(normalizeAvailability('oos')).toBe('out_of_stock');
    expect(normalizeAvailability('preorder')).toBe('preorder');
  });

  it('reads human-readable labels', () => {
    expect(normalizeAvailability('In Stock')).toBe('in_stock');
    expect(normalizeAvailability('Sold out')).toBe('out_of_stock');
    expect(normalizeAvailability('Pre-order')).toBe('preorder');
    expect(normalizeAvailability('On backorder')).toBe('backorder');
  });

  it('ignores surrounding whitespace and casing', () => {
    expect(normalizeAvailability('  OUT OF STOCK  ')).toBe('out_of_stock');
  });
});

describe('normalizeAvailability — unknown', () => {
  it('does not guess', () => {
    expect(normalizeAvailability('ships in 2-4 weeks')).toBe('unknown');
    expect(normalizeAvailability('https://schema.org/SomethingNew')).toBe('unknown');
    expect(normalizeAvailability('')).toBe('unknown');
    expect(normalizeAvailability('   ')).toBe('unknown');
    expect(normalizeAvailability(null)).toBe('unknown');
    expect(normalizeAvailability(undefined)).toBe('unknown');
  });
});
