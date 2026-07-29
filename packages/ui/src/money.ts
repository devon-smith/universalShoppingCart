/**
 * Exact decimal comparison and formatting for money.
 *
 * Prices arrive as decimal strings and stay that way until the moment they are shown
 * (BUILD_PLAN.md §6.2). Nothing here parses one into a `number`: `0.1 + 0.2` is not a price,
 * and a comparison that decides whether to draw a strikethrough must not be approximate.
 */

/** Split a decimal string into sign, integer and fraction without losing precision. */
function parts(value: string): { negative: boolean; integer: string; fraction: string } | null {
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return null;
  return { negative: match[1] === '-', integer: match[2]!, fraction: match[3] ?? '' };
}

/**
 * Compare two decimal strings: negative, zero or positive, or `null` if either is not a
 * decimal. Scales both to the same number of places and compares as integers, so
 * `"9.90"` and `"9.9"` are equal and `"10.00"` beats `"9.90"`.
 */
export function compareDecimal(left: string, right: string): number | null {
  const a = parts(left);
  const b = parts(right);
  if (!a || !b) return null;

  const places = Math.max(a.fraction.length, b.fraction.length);
  const scale = (p: NonNullable<ReturnType<typeof parts>>): bigint => {
    const digits = `${p.integer}${p.fraction.padEnd(places, '0')}`;
    const magnitude = BigInt(digits);
    return p.negative ? -magnitude : magnitude;
  };

  const difference = scale(a) - scale(b);
  return difference === 0n ? 0 : difference > 0n ? 1 : -1;
}

/**
 * Format a decimal string as money.
 *
 * With a currency, `Intl.NumberFormat` places the symbol where the locale puts it. Without
 * one the digits are shown alone — never with a guessed `$`, because a wrong currency on a
 * saved product is worse than a missing one, and `$` is at least four different currencies.
 */
export function formatMoney(amount: string, currency: string | null, locale?: string): string {
  if (parts(amount) === null) return amount;

  if (currency === null) {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(amount));
  }

  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(Number(amount));
  } catch {
    // An unknown or malformed code must not take the render down.
    return `${amount} ${currency}`;
  }
}
