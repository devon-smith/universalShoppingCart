import type { ReactElement } from 'react';

import { cn } from './cn';
import { compareDecimal, discountPercent, formatMoney } from './money';

/**
 * Money on screen.
 *
 * This is the component that must never be wrong. A capture can miss a field and the card
 * still helps; a card showing the wrong number actively misleads, and the user has no way to
 * tell from looking. So the API is built so the three ways we have actually seen prices
 * misrepresented cannot be expressed, rather than merely being discouraged:
 *
 * 1. **A range rendered as a discount.** Chewy publishes an `AggregateOffer` spanning
 *    10.99–145.94. Handed to a naive price component as "was 145.94, now 10.99" that reads as
 *    a 92% saving on something nobody is selling. There is no prop pair here that accepts two
 *    loose amounts: a discount must come through `listPrice`, and a range through `range`,
 *    which has no strikethrough to give.
 * 2. **An instalment rendered as a total.** "Or 4 payments of $32.25" is the most
 *    plausible-looking wrong number on a product page. `cadence` is required to be stated
 *    for anything that is not a single charge, and the marker is rendered from it — an
 *    instalment cannot reach the screen looking like a total.
 * 3. **A subscription price rendered as one-time.** Chewy's autoship price is lower than its
 *    buy-once price and sits in the same visual slot. Same mechanism: it carries a cadence,
 *    and the cadence is always shown.
 *
 * `listPrice` is additionally checked at runtime and dropped unless it is strictly greater
 * than the current price, so a caller who mislabels a lower number gets no strikethrough
 * rather than an invented saving.
 */

export interface PriceAmount {
  /** A decimal string, never a number. */
  amount: string;
  /** ISO 4217 when known, `null` otherwise. Never guessed. */
  currency: string | null;
}

/**
 * How often the amount is charged.
 *
 * There is no default of convenience here — `one_time` has to be chosen, so that a
 * subscription price is never one by omission.
 */
export type PriceCadence = 'one_time' | 'per_month' | 'per_delivery';

const CADENCE_SUFFIX: Record<PriceCadence, string | null> = {
  one_time: null,
  per_month: '/mo',
  per_delivery: '/delivery',
};

const CADENCE_SPOKEN: Record<PriceCadence, string> = {
  one_time: '',
  per_month: ' per month',
  per_delivery: ' per delivery',
};

export interface PriceProps {
  /** The price of the thing being bought, or `null` when the page never said. */
  value: PriceAmount | null;
  cadence: PriceCadence;
  /**
   * The list price this is discounted from. A was-price and nothing else: not the top of a
   * range, not the undiscounted member of an aggregate offer.
   */
  listPrice?: PriceAmount | null;
  /**
   * Used when only a span of prices is known. Renders as a span — it has no discount
   * presentation to borrow, which is the point.
   */
  range?: { from: PriceAmount; to: PriceAmount } | null;
  size?: 'md' | 'lg';
  /** Shown when there is no price. Says what is missing rather than pretending zero. */
  unknownLabel?: string;
  locale?: string;
  className?: string;
}

export function Price({
  value,
  cadence,
  listPrice = null,
  range = null,
  size = 'md',
  unknownLabel = 'No price',
  locale,
  className,
}: PriceProps): ReactElement {
  const amountClass = cn('uc-price__amount', size === 'lg' && 'uc-price__amount--lg');

  if (value === null) {
    if (range) {
      const from = formatMoney(range.from.amount, range.from.currency, locale);
      const to = formatMoney(range.to.amount, range.to.currency, locale);
      return (
        <span className={cn('uc-price', className)}>
          {/* One string, one label, no strikethrough anywhere: a range cannot be mistaken
              for a saving because there is no second styled amount to misread. */}
          <span className={amountClass}>{`${from} – ${to}`}</span>
          <span className="uc-price__note">across sizes</span>
        </span>
      );
    }

    return (
      <span className={cn('uc-price', className)}>
        <span className="uc-price__unknown">{unknownLabel}</span>
      </span>
    );
  }

  const formatted = formatMoney(value.amount, value.currency, locale);
  const suffix = CADENCE_SUFFIX[cadence];

  // Only a strictly higher list price is a discount. Equal is not a saving, and lower means
  // the caller handed over something that is not a list price at all.
  const discount =
    listPrice !== null && compareDecimal(listPrice.amount, value.amount) === 1 ? listPrice : null;

  // Derived from the pair the guard above already accepted, so there is no arrangement of
  // props that yields a percentage without a genuine, strictly-higher list price.
  const saving = discount === null ? null : discountPercent(discount.amount, value.amount);

  const spoken = `${formatted}${CADENCE_SPOKEN[cadence]}${
    discount ? `, reduced from ${formatMoney(discount.amount, discount.currency, locale)}` : ''
  }`;

  return (
    <span className={cn('uc-price', className)}>
      {/* One accessible string for the whole price, so a screen reader says
          "$84.00 per month, reduced from $120.00" rather than reading three fragments whose
          relationship it cannot convey. */}
      <span className="uc-sr-only">{spoken}</span>
      <span aria-hidden="true" className="uc-price__contents">
        <span className={amountClass}>
          {formatted}
          {suffix ? <span className="uc-price__note">{suffix}</span> : null}
        </span>
        {discount ? (
          <>
            <span className="uc-price__original">
              {formatMoney(discount.amount, discount.currency, locale)}
            </span>
            {saving === null ? null : (
              <span className="uc-price__saving">{`\u2212${saving}%`}</span>
            )}
          </>
        ) : null}
      </span>
    </span>
  );
}
