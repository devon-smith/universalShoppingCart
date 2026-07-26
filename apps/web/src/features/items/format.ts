/**
 * Display formatting for saved items.
 *
 * Money arrives from Postgres as a `numeric` string. It is converted to a number only at
 * the last moment, for `Intl.NumberFormat`, and never used for arithmetic — comparisons
 * and differences are computed on the decimal strings.
 */

export function formatMoney(
  amount: string | number | null,
  currency: string | null,
): string | null {
  if (amount === null) return null;

  const value = typeof amount === 'number' ? amount : Number.parseFloat(amount);
  if (!Number.isFinite(value)) return null;

  if (!currency) {
    return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  }

  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
}

export const AVAILABILITY_LABELS: Record<string, string> = {
  in_stock: 'In stock',
  out_of_stock: 'Out of stock',
  preorder: 'Pre-order',
  backorder: 'Backorder',
  unknown: 'Availability unknown',
};

export function availabilityLabel(availability: string): string {
  return AVAILABILITY_LABELS[availability] ?? AVAILABILITY_LABELS.unknown!;
}

/**
 * A discount, as a whole-percent integer, or `null`.
 *
 * Returns `null` unless the original is genuinely higher — a "sale" where the original
 * equals the current price is marketing, not information.
 */
export function discountPercent(
  current: string | number | null,
  original: string | number | null,
): number | null {
  if (current === null || original === null) return null;

  const currentValue = typeof current === 'number' ? current : Number.parseFloat(current);
  const originalValue = typeof original === 'number' ? original : Number.parseFloat(original);

  if (!Number.isFinite(currentValue) || !Number.isFinite(originalValue)) return null;
  if (originalValue <= 0 || currentValue >= originalValue) return null;

  return Math.round(((originalValue - currentValue) / originalValue) * 100);
}

/** How long ago an observation was, in words. */
export function relativeTime(iso: string | null, now: Date = new Date()): string {
  if (!iso) return 'never checked';

  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'never checked';

  const seconds = Math.round((now.getTime() - then.getTime()) / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;

  return then.toLocaleDateString();
}
