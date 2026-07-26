import { describe, expect, it } from 'vitest';

import { detectCurrency, normalizeCurrency, normalizePrice, normalizePriceAmount } from './price';

describe('normalizePrice — US formats', () => {
  it('parses a plain decimal', () => {
    expect(normalizePrice('19.99').amount).toBe('19.99');
  });

  it('parses a symbol-prefixed price', () => {
    expect(normalizePrice('$19.99').amount).toBe('19.99');
  });

  it('parses thousands separators', () => {
    expect(normalizePrice('$1,299.00').amount).toBe('1299.00');
    expect(normalizePrice('$12,345,678.90').amount).toBe('12345678.90');
  });

  it('adds a fraction to a whole number so the shape is always decimal', () => {
    expect(normalizePrice('$25').amount).toBe('25.00');
  });
});

describe('normalizePrice — European formats', () => {
  it('parses comma as the decimal separator', () => {
    expect(normalizePrice('19,99 €')).toEqual({ amount: '19.99', currency: 'EUR' });
  });

  it('parses dot as a thousands separator with comma decimals', () => {
    expect(normalizePrice('1.299,50 €').amount).toBe('1299.50');
  });

  it('parses a dotted thousands group with no decimals', () => {
    // `1.299` is one thousand two hundred ninety-nine, not one point two nine nine.
    expect(normalizePrice('1.299 €').amount).toBe('1299.00');
    expect(normalizePrice('1.299.000 €').amount).toBe('1299000.00');
  });

  it('parses a comma thousands group with no decimals', () => {
    expect(normalizePrice('$1,299').amount).toBe('1299.00');
  });

  it('parses non-breaking and thin spaces used as group separators', () => {
    expect(normalizePrice('1 299,50 €').amount).toBe('1299.50');
    expect(normalizePrice('1 299,50 €').amount).toBe('1299.50');
  });
});

describe('normalizePrice — precision', () => {
  it('keeps more than two fractional digits', () => {
    expect(normalizePrice('0.000001').amount).toBe('0.000001');
  });

  it('does not round a long decimal', () => {
    expect(normalizePrice('1234.567890').amount).toBe('1234.567890');
  });

  it('strips leading zeros without losing the value', () => {
    expect(normalizePrice('007.50').amount).toBe('7.50');
    expect(normalizePrice('0.50').amount).toBe('0.50');
  });

  it('handles a negative amount', () => {
    expect(normalizePrice('-5.00').amount).toBe('-5.00');
    expect(normalizePrice('−5.00').amount).toBe('-5.00');
  });

  it('accepts a JSON number without exponent notation', () => {
    expect(normalizePrice(98).amount).toBe('98.00');
    expect(normalizePrice(98.5).amount).toBe('98.5');
  });
});

describe('normalizePrice — rejection', () => {
  it('returns null for text with no digits', () => {
    expect(normalizePrice('Out of stock').amount).toBeNull();
    expect(normalizePrice('').amount).toBeNull();
    expect(normalizePrice(null).amount).toBeNull();
    expect(normalizePrice(undefined).amount).toBeNull();
  });

  it('returns null for a non-finite number', () => {
    expect(normalizePrice(Number.NaN).amount).toBeNull();
    expect(normalizePrice(Number.POSITIVE_INFINITY).amount).toBeNull();
  });
});

describe('detectCurrency', () => {
  it('reads an explicit ISO code', () => {
    expect(detectCurrency('USD 19.99')).toBe('USD');
    expect(detectCurrency('19,99 EUR')).toBe('EUR');
  });

  it('reads unambiguous symbols', () => {
    expect(detectCurrency('£19.99')).toBe('GBP');
    expect(detectCurrency('€19,99')).toBe('EUR');
    expect(detectCurrency('₹1,299')).toBe('INR');
    expect(detectCurrency('R$ 99,00')).toBe('BRL');
  });

  it('refuses to guess at an ambiguous symbol', () => {
    // `$` is USD, CAD, AUD, MXN, and more. A wrong currency is worse than no currency.
    expect(detectCurrency('$19.99')).toBeNull();
    expect(detectCurrency('¥1000')).toBeNull();
    expect(detectCurrency('kr 199')).toBeNull();
  });

  it('does not mistake a common word for a currency code', () => {
    expect(detectCurrency('NEW 19.99')).toBeNull();
    expect(detectCurrency('NOW 19.99')).toBeNull();
  });
});

describe('normalizeCurrency', () => {
  it('upper-cases a valid code', () => {
    expect(normalizeCurrency('usd')).toBe('USD');
  });

  it('falls back to symbol detection', () => {
    expect(normalizeCurrency('£')).toBe('GBP');
  });

  it('returns null for nothing usable', () => {
    expect(normalizeCurrency('dollars')).toBeNull();
    expect(normalizeCurrency('')).toBeNull();
    expect(normalizeCurrency(null)).toBeNull();
  });
});

describe('normalizePriceAmount', () => {
  it('returns just the amount', () => {
    expect(normalizePriceAmount('£1,299.00')).toBe('1299.00');
  });
});
