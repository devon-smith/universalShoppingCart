/**
 * How fresh an observation is, and how a price has moved (BUILD_PLAN.md §14.3).
 *
 * The governing rule: never imply a price is current when it has not been re-observed.
 * "Unknown" and "old" are both real answers and both get said out loud.
 */

export type Freshness = 'fresh' | 'aging' | 'stale' | 'never';

/** Below this, an observation is presented without qualification. */
export const FRESH_WITHIN_HOURS = 24;

/** Beyond this, the price is old enough that showing it plainly would mislead. */
export const STALE_AFTER_HOURS = 24 * 7;

export interface FreshnessResult {
  level: Freshness;
  /** Whole hours since the observation, or `null` if there has never been one. */
  hours: number | null;
  label: string;
}

export function freshness(lastObservedAt: string | null, now: Date = new Date()): FreshnessResult {
  if (!lastObservedAt) {
    return { level: 'never', hours: null, label: 'Never checked' };
  }

  const observed = new Date(lastObservedAt);
  if (Number.isNaN(observed.getTime())) {
    return { level: 'never', hours: null, label: 'Never checked' };
  }

  const hours = Math.max(0, (now.getTime() - observed.getTime()) / 3_600_000);

  if (hours <= FRESH_WITHIN_HOURS) {
    return { level: 'fresh', hours: Math.floor(hours), label: 'Checked recently' };
  }

  if (hours <= STALE_AFTER_HOURS) {
    return {
      level: 'aging',
      hours: Math.floor(hours),
      label: `Last checked ${Math.floor(hours / 24)}d ago`,
    };
  }

  return {
    level: 'stale',
    hours: Math.floor(hours),
    label: `Price may be out of date — last checked ${Math.floor(hours / 24)}d ago`,
  };
}

export type PriceDirection = 'down' | 'up' | 'unchanged' | 'unknown';

export interface PriceChange {
  direction: PriceDirection;
  /** Absolute difference as a decimal string, or `null` when there is nothing to compare. */
  amount: string | null;
  /** Whole-percent move, or `null`. */
  percent: number | null;
}

/**
 * Compare the current price to the last different one.
 *
 * The difference is computed on the decimal strings, scaled to integers, so a 0.1 + 0.2
 * problem cannot creep into a price badge. The percentage is display-only and may use
 * floating point.
 */
export function priceChange(
  current: string | number | null,
  previous: string | number | null,
): PriceChange {
  if (current === null || previous === null) {
    return { direction: 'unknown', amount: null, percent: null };
  }

  const currentText = String(current);
  const previousText = String(previous);

  const difference = subtractDecimals(currentText, previousText);
  if (difference === null) {
    return { direction: 'unknown', amount: null, percent: null };
  }

  if (difference.startsWith('-')) {
    return {
      direction: 'down',
      amount: difference.slice(1),
      percent: percentMove(currentText, previousText),
    };
  }

  if (isZero(difference)) {
    return { direction: 'unchanged', amount: null, percent: null };
  }

  return { direction: 'up', amount: difference, percent: percentMove(currentText, previousText) };
}

function isZero(value: string): boolean {
  return /^-?0*(\.0*)?$/.test(value);
}

function percentMove(current: string, previous: string): number | null {
  const currentValue = Number.parseFloat(current);
  const previousValue = Number.parseFloat(previous);
  if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue) || previousValue === 0) {
    return null;
  }
  return Math.round(Math.abs((currentValue - previousValue) / previousValue) * 100);
}

/** Split a decimal string into sign, integer digits, and fraction digits. */
function parseDecimal(value: string): { negative: boolean; digits: string; scale: number } | null {
  const match = /^(-?)(\d+)(?:\.(\d*))?$/.exec(value.trim());
  if (!match) return null;

  const [, sign, whole, fraction = ''] = match;
  return { negative: sign === '-', digits: `${whole}${fraction}`, scale: fraction.length };
}

/** `a - b` as a decimal string, using integer arithmetic on a common scale. */
export function subtractDecimals(a: string, b: string): string | null {
  const left = parseDecimal(a);
  const right = parseDecimal(b);
  if (!left || !right) return null;

  const scale = Math.max(left.scale, right.scale);
  const leftScaled =
    BigInt(left.digits + '0'.repeat(scale - left.scale)) * (left.negative ? -1n : 1n);
  const rightScaled =
    BigInt(right.digits + '0'.repeat(scale - right.scale)) * (right.negative ? -1n : 1n);

  const difference = leftScaled - rightScaled;
  if (scale === 0) return difference.toString();

  const negative = difference < 0n;
  const magnitude = (negative ? -difference : difference).toString().padStart(scale + 1, '0');
  const whole = magnitude.slice(0, magnitude.length - scale);
  const fraction = magnitude.slice(magnitude.length - scale);

  return `${negative ? '-' : ''}${whole}.${fraction}`;
}
