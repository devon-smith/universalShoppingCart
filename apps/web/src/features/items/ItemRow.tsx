'use client';

import { ProductImage, StatusBadge } from '@universal-cart/ui';
import { useState } from 'react';

import {
  ItemActions,
  ItemAnnotations,
  ItemFreshness,
  ItemPrice,
  ItemPriceChange,
  ItemSource,
  ItemTitle,
  ItemVariant,
  STATUS_LABELS,
} from './ItemFacts';
import type { ItemStatus, PriceSummary, SavedItem } from './query';

export interface ItemRowProps {
  item: SavedItem;
  summary?: PriceSummary | undefined;
  onOpen: (item: SavedItem) => void;
  onStatusChange: (item: SavedItem, status: ItemStatus) => void;
  onArchive: (item: SavedItem) => void;
  busy?: boolean;
}

/**
 * One saved product, as a row.
 *
 * The list is not a squashed card grid. It exists so several products can be read down a
 * column — price under price, availability under availability — which is how you notice that
 * two of the four are out of stock without reading four paragraphs.
 *
 * That alignment only works while there is room for it, so the grid is declared from `md` up
 * and the row is a stacked block below that. Nothing scrolls sideways at any width; the
 * regions reflow into the order they would be read aloud in.
 *
 * The variant sits under the product name rather than in a column of its own. It had one at
 * first, and at 1024px — a laptop, minus the 240px rail — six columns left the retailer
 * truncated to "Northwind · Bergs…" and every chip wrapped three lines deep. Alignment is
 * worth having for the fields you scan *down* to compare: price, availability, status. A size
 * and a colour are read with the product they belong to.
 */
export function ItemRow({ item, summary, onOpen, onStatusChange, onArchive, busy }: ItemRowProps) {
  const [imageUsable, setImageUsable] = useState(true);
  const image = imageUsable ? item.image_url : null;

  return (
    <li
      data-testid="item-card"
      data-item-id={item.id}
      data-status={item.status}
      className={[
        'uc-surface uc-surface--raised grid grid-cols-1 gap-3 p-3 transition-opacity',
        // Five columns: image, product, money, state, actions. The wrapper below is
        // `md:contents`, so it dissolves into the first two rather than occupying one.
        'md:grid-cols-[3.5rem_minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1fr)_auto] md:items-start md:gap-4',
        busy ? 'opacity-60' : '',
      ].join(' ')}
    >
      {/* Product: image and name travel together at every width. */}
      <div className="flex gap-3 md:contents">
        {image ? (
          <ProductImage
            src={image}
            alt=""
            width={64}
            className="shrink-0 md:w-full"
            onUnavailable={() => setImageUsable(false)}
          />
        ) : (
          // The grid column still exists on desktop, so rows stay aligned when one has no
          // photograph. On mobile it collapses to nothing rather than showing an empty box.
          <div className="hidden md:block" aria-hidden="true" />
        )}

        <div className="flex min-w-0 flex-col gap-1">
          <ItemSource item={item} />
          <ItemTitle item={item} className="line-clamp-2 text-sm font-medium" />
          <ItemVariant item={item} />
        </div>
      </div>

      {/* Money. */}
      <div className="flex min-w-0 flex-col gap-1">
        <ItemPrice item={item} />
        <ItemPriceChange item={item} summary={summary} />
        <ItemAnnotations item={item} />
      </div>

      {/* State. */}
      <div className="flex min-w-0 flex-col items-start gap-1.5">
        <StatusBadge tone="neutral">{STATUS_LABELS[item.status]}</StatusBadge>
        <ItemFreshness item={item} />
      </div>

      <div className="md:justify-self-end">
        <ItemActions
          item={item}
          busy={busy}
          onOpen={onOpen}
          onStatusChange={onStatusChange}
          onArchive={onArchive}
        />
      </div>
    </li>
  );
}
