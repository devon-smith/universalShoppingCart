'use client';

import { ProductImage, StatusBadge } from '@universal-cart/ui';
import { useState } from 'react';

import {
  CompareCheckbox,
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
  comparing: boolean;
  onToggleCompare: (item: SavedItem) => void;
  comparisonFull: boolean;
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
export function ItemRow({
  item,
  summary,
  onOpen,
  onStatusChange,
  onArchive,
  busy,
  comparing,
  onToggleCompare,
  comparisonFull,
}: ItemRowProps) {
  const [imageUsable, setImageUsable] = useState(true);
  const image = imageUsable ? item.image_url : null;

  return (
    <li
      data-testid="item-card"
      data-item-id={item.id}
      data-status={item.status}
      data-comparing={comparing}
      className={[
        'uc-surface uc-surface--raised grid grid-cols-1 gap-3 p-3 transition-opacity',
        // Five columns: image, product, money, state, actions. The wrapper below is
        // `md:contents`, so it dissolves into the first two rather than occupying one.
        'md:grid-cols-[3.5rem_minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1fr)_auto] md:items-start md:gap-4',
        busy ? 'opacity-60' : '',
      ].join(' ')}
    >
      {/* Product: selection, image and name travel together at every width. */}
      <div className="flex gap-3 md:contents">
        {/* The first grid column: the checkbox above the thumbnail. Keeping selection here
            rather than in the action cluster is what stops a fifth control squeezing the
            columns at 1024 — see `CompareCheckbox`. */}
        <div className="flex shrink-0 flex-col items-start gap-2 md:w-full">
          <CompareCheckbox
            item={item}
            comparing={comparing}
            onToggleCompare={onToggleCompare}
            comparisonFull={comparisonFull}
          />
          {image ? (
            <ProductImage
              src={image}
              alt=""
              width={64}
              className="md:w-full"
              onUnavailable={() => setImageUsable(false)}
            />
          ) : null}
        </div>

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
