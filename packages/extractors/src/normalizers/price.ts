/**
 * Price normalization.
 *
 * Product pages write prices in every format a locale allows, and the difference between
 * `1.299` meaning one thousand two hundred ninety-nine and meaning one point two nine nine
 * is a factor of a thousand. Everything here is string arithmetic: parsing to a
 * JavaScript number and formatting it back would silently round money.
 *
 * The output is a decimal string with at least one fractional digit, matching
 * `decimalStringSchema` in `@universal-cart/contracts`.
 */

export interface NormalizePriceResult {
  /** Decimal string, e.g. `"1299.00"`. `null` when the input is not a price. */
  amount: string | null;
  /** ISO 4217 code if the input carried an unambiguous currency, else `null`. */
  currency: string | null;
}

/**
 * Symbols that map to exactly one currency. Deliberately excludes `$`, `kr`, and `¥`:
 * a bare `$` could be USD, CAD, AUD, MXN, or several others, and guessing would put a
 * wrong currency on a saved product. When the symbol is ambiguous the currency stays
 * `null` and the extraction pipeline looks for an explicit code elsewhere.
 */
const UNAMBIGUOUS_CURRENCY_SYMBOLS: ReadonlyArray<readonly [string, string]> = [
  ['€', 'EUR'],
  ['£', 'GBP'],
  ['₹', 'INR'],
  ['₪', 'ILS'],
  ['₩', 'KRW'],
  ['₫', 'VND'],
  ['₴', 'UAH'],
  ['₺', 'TRY'],
  ['₦', 'NGN'],
  ['฿', 'THB'],
  ['zł', 'PLN'],
  ['R$', 'BRL'],
];

const ISO_CODE = /\b([A-Z]{3})\b/;

/** Extract an ISO 4217 code or an unambiguous symbol from arbitrary price text. */
export function detectCurrency(text: string): string | null {
  const iso = ISO_CODE.exec(text.toUpperCase());
  if (iso?.[1] && isPlausibleCurrencyCode(iso[1])) {
    return iso[1];
  }

  for (const [symbol, code] of UNAMBIGUOUS_CURRENCY_SYMBOLS) {
    if (text.includes(symbol)) return code;
  }

  return null;
}

/**
 * ISO 4217 codes are three letters, but so are plenty of words that appear near prices.
 * Rejecting the common ones is cheap insurance against labelling a price "NEW".
 */
const THREE_LETTER_NON_CURRENCIES = new Set([
  'NEW',
  'OFF',
  'ADD',
  'BUY',
  'SET',
  'ONE',
  'TWO',
  'THE',
  'FOR',
  'AND',
  'PER',
  'WAS',
  'NOW',
  'SALE',
]);

function isPlausibleCurrencyCode(code: string): boolean {
  return !THREE_LETTER_NON_CURRENCIES.has(code);
}

/** Strip every character that cannot be part of a number. */
function digitsAndSeparators(text: string): string {
  return text.replace(/[^\d.,\-−]/g, '').replace(/−/g, '-');
}

/**
 * Decide which of `.` and `,` is the decimal separator.
 *
 * The rules, in order:
 * 1. Both present — the rightmost one is the decimal separator (`1.299,50` / `1,299.50`).
 * 2. One present, appearing more than once — it is a thousands separator (`1.299.000`).
 * 3. One present, followed by exactly three digits, with digits before it — ambiguous
 *    (`1.299`); treated as a thousands separator, which is how retailers write it.
 * 4. Otherwise it is the decimal separator.
 */
function splitNumber(raw: string): { integer: string; fraction: string } | null {
  const negative = raw.startsWith('-');
  const body = negative ? raw.slice(1) : raw;

  if (!/^[\d.,]+$/.test(body) || !/\d/.test(body)) return null;

  const lastDot = body.lastIndexOf('.');
  const lastComma = body.lastIndexOf(',');

  let decimalIndex = -1;

  if (lastDot >= 0 && lastComma >= 0) {
    decimalIndex = Math.max(lastDot, lastComma);
  } else if (lastDot >= 0 || lastComma >= 0) {
    const index = Math.max(lastDot, lastComma);
    const separator = body[index]!;
    const occurrences = body.split(separator).length - 1;
    const trailing = body.length - index - 1;

    if (occurrences > 1) {
      decimalIndex = -1;
    } else if (trailing === 3 && index > 0) {
      decimalIndex = -1;
    } else {
      decimalIndex = index;
    }
  }

  const integerPart = decimalIndex >= 0 ? body.slice(0, decimalIndex) : body;
  const fractionPart = decimalIndex >= 0 ? body.slice(decimalIndex + 1) : '';

  const integer = integerPart.replace(/[.,]/g, '');
  const fraction = fractionPart.replace(/[.,]/g, '');

  if (!/^\d*$/.test(integer) || !/^\d*$/.test(fraction)) return null;
  if (integer.length === 0 && fraction.length === 0) return null;

  const normalizedInteger = integer.replace(/^0+(?=\d)/, '') || '0';

  return {
    integer: negative ? `-${normalizedInteger}` : normalizedInteger,
    fraction,
  };
}

/**
 * Render a fraction at a consistent scale, without changing the amount.
 *
 * Platforms serialize money at their storage scale: Magento writes `279.0000` into
 * `data-price-amount`, and a page that says `£18.5` means £18.50. Padding to two digits and
 * dropping zeros beyond them makes an unchanged price compare equal as a string, which is
 * what the duplicate-detection and price-change paths do. Significant digits are never
 * removed — `1.2345` keeps all four.
 */
function normalizeFraction(fraction: string): string {
  return fraction.replace(/0+$/, '').padEnd(2, '0');
}

/**
 * Normalize a price found on a page into an exact decimal string.
 *
 * Returns `{ amount: null }` for anything that is not a price, rather than a best guess.
 */
export function normalizePrice(input: string | number | null | undefined): NormalizePriceResult {
  if (input === null || input === undefined) return { amount: null, currency: null };

  // A number reaching here has already lost precision, but structured data legitimately
  // encodes prices as JSON numbers, so it is accepted and rendered without exponent form.
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return { amount: null, currency: null };
    const fixed = Number.isInteger(input) ? `${input}.00` : String(input);
    return { amount: fixed.includes('.') ? fixed : `${fixed}.00`, currency: null };
  }

  const text = input.trim();
  if (text.length === 0) return { amount: null, currency: null };

  const currency = detectCurrency(text);
  const parts = splitNumber(digitsAndSeparators(text));
  if (!parts) return { amount: null, currency };

  return { amount: `${parts.integer}.${normalizeFraction(parts.fraction)}`, currency };
}

/** Convenience wrapper for callers that only want the amount. */
export function normalizePriceAmount(input: string | number | null | undefined): string | null {
  return normalizePrice(input).amount;
}

/** Normalize a currency value that is claimed to be a code. */
export function normalizeCurrency(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(trimmed) && isPlausibleCurrencyCode(trimmed)) return trimmed;
  return detectCurrency(input);
}
