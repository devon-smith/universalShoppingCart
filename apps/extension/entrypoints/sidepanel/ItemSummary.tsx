import type { Tables } from '@universal-cart/contracts';
import { Price, ProductImage, StatusBadge } from '@universal-cart/ui';
import { useState } from 'react';

import { relativeTime } from '@/lib/format/time';

export type SavedItem = Tables<'items'>;

/**
 * The newest observation and the last one before it at a different price.
 *
 * Read from `item_price_summary`, which runs as the querying user so RLS applies exactly as
 * it would to a direct select on the observations.
 */
export interface PriceSummary {
  latest_price: string | null;
  latest_observed_at: string | null;
  previous_price: string | null;
  previous_observed_at: string | null;
}

/**
 * A saved product, summarised.
 *
 * Shared by the post-save success state and the already-saved state, so a product looks the
 * same whichever way the panel arrived at it.
 *
 * On honesty: every time-related word here describes something that **happened**. An
 * observation is recorded when the user captures a page or revisits it, and nothing runs in
 * the background yet (BUILD_PLAN.md §14.2). So this says "last checked" and "when you last
 * looked", never "we've been watching" — and a price difference is only ever shown when two
 * observations actually exist to compare.
 */
export function ItemSummary({
  item,
  summary,
  cartName,
}: {
  item: SavedItem;
  summary?: PriceSummary | null;
  cartName?: string;
}) {
  const [imageUsable, setImageUsable] = useState(true);
  const image = imageUsable ? item.image_url : null;

  const currency = item.currency;
  const current = item.current_price === null ? null : String(item.current_price);

  // Only a genuine earlier observation at a different price counts. Absent that, the panel
  // says nothing about movement rather than implying it watched and saw none.
  const previous = summary?.previous_price ?? null;
  // Carried as one object so the two amounts stay narrowed together: a movement only exists
  // when both numbers do, and the renderer should not have to re-check that.
  const movement =
    current !== null && previous !== null && current !== previous
      ? { direction: Number(current) < Number(previous) ? 'down' : 'up', current, previous }
      : null;

  return (
    <div className={image ? 'item-summary' : 'item-summary item-summary--no-image'}>
      {image ? (
        <ProductImage
          src={image}
          alt=""
          className="item-summary__image"
          onUnavailable={() => setImageUsable(false)}
        />
      ) : null}

      <div className="item-summary__body">
        <p className="item-summary__retailer">{item.retailer_name}</p>
        <h3 className="item-summary__title">{item.title}</h3>

        <Price
          size="lg"
          cadence="one_time"
          value={current === null ? null : { amount: current, currency }}
          listPrice={
            item.original_price === null ? null : { amount: String(item.original_price), currency }
          }
          unknownLabel="Price not stated"
        />

        {movement ? (
          /* Green means an observed fall and nothing else. The sentence names both numbers and
             when the earlier one was seen, so the claim is checkable rather than atmospheric. */
          <p className="item-summary__movement" data-direction={movement.direction}>
            <StatusBadge tone={movement.direction === 'down' ? 'success' : 'neutral'}>
              {movement.direction === 'down' ? '▼' : '▲'}{' '}
              {formatDelta(movement.current, movement.previous, currency)}
            </StatusBadge>
            <span className="item-summary__since">
              since it was {relativeTime(summary?.previous_observed_at ?? null)}
            </span>
          </p>
        ) : null}

        <p className="item-summary__meta">
          {cartName ? <span>In {cartName}</span> : null}
          {item.availability && item.availability !== 'unknown' ? (
            <span>{item.availability === 'in_stock' ? 'In stock' : 'Out of stock'}</span>
          ) : null}
          <span>Last checked {relativeTime(item.last_observed_at)}</span>
        </p>
      </div>
    </div>
  );
}

/** The size of the move, as money. Decimal strings in, one formatted amount out. */
function formatDelta(current: string, previous: string, currency: string | null): string {
  const delta = Math.abs(Number(previous) - Number(current));
  if (!Number.isFinite(delta)) return '';

  const amount = delta.toFixed(2);
  try {
    return currency
      ? new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(amount))
      : amount;
  } catch {
    return amount;
  }
}
