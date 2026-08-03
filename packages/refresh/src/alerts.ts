/**
 * Which alerts a new observation should raise (BUILD_PLAN.md §15).
 *
 * Alerts fire on a **transition**, not on a state — a price that is below the desired price
 * raises one alert when it crosses below, not on every refresh while it stays there, and
 * back-in-stock fires on out→in, not on every in-stock reading. That transition rule is the
 * deduplication: comparing the previous observed state to the current one is what stops a daily
 * refresh from sending a daily email.
 *
 * The logic is pure and lives here so the worker computes it once and the DB only stores the
 * resulting events. Money is compared as exact decimal strings, never floats.
 */

export type AlertType = 'price_below_desired' | 'back_in_stock' | 'became_unavailable';

export type ObservedAvailability =
  'in_stock' | 'out_of_stock' | 'preorder' | 'backorder' | 'unknown';

export interface ObservedState {
  availability: ObservedAvailability;
  /** Current price as a normalized decimal string, or null when unknown. */
  price: string | null;
  /** The user's desired price as a decimal string, or null when unset. */
  desiredPrice: string | null;
}

/**
 * Compare two non-negative decimal strings (the shape `normalizePrice` produces) without going
 * through a float. Returns -1, 0, or 1. Leading zeros and differing fraction lengths are handled,
 * so "9.5", "09.50", and "9.50" all compare equal.
 */
export function compareMoney(a: string, b: string): -1 | 0 | 1 {
  const [aInt = '', aFrac = ''] = a.split('.');
  const [bInt = '', bFrac = ''] = b.split('.');

  const aWhole = aInt.replace(/^0+(?=\d)/, '');
  const bWhole = bInt.replace(/^0+(?=\d)/, '');
  if (aWhole.length !== bWhole.length) return aWhole.length < bWhole.length ? -1 : 1;
  if (aWhole !== bWhole) return aWhole < bWhole ? -1 : 1;

  const width = Math.max(aFrac.length, bFrac.length);
  const aPadded = aFrac.padEnd(width, '0');
  const bPadded = bFrac.padEnd(width, '0');
  if (aPadded !== bPadded) return aPadded < bPadded ? -1 : 1;
  return 0;
}

/** True when a known price is at or below a set desired price. */
export function isPriceBelowDesired(state: ObservedState): boolean {
  if (state.price === null || state.desiredPrice === null) return false;
  return compareMoney(state.price, state.desiredPrice) <= 0;
}

/**
 * The alerts a transition from `previous` to `current` should raise. `previous` is null the first
 * time an item is observed, in which case only a price already below desired can fire — there is
 * no earlier stock state to have transitioned from.
 */
export function evaluateAlerts(
  previous: ObservedState | null,
  current: ObservedState,
): AlertType[] {
  const alerts: AlertType[] = [];

  const nowBelow = isPriceBelowDesired(current);
  const wasBelow = previous !== null && isPriceBelowDesired(previous);
  if (nowBelow && !wasBelow) alerts.push('price_below_desired');

  // Stock transitions need a known earlier state; a first observation has none.
  if (previous !== null) {
    const wasInStock = previous.availability === 'in_stock';
    const nowInStock = current.availability === 'in_stock';
    if (nowInStock && !wasInStock) alerts.push('back_in_stock');
    if (wasInStock && current.availability === 'out_of_stock') alerts.push('became_unavailable');
  }

  return alerts;
}
