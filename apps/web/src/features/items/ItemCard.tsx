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

export { STATUS_LABELS };

export interface ItemCardProps {
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
 * One saved product, as a card.
 *
 * Image-forward: the photograph is the largest thing, because a person choosing between three
 * jackets recognises them by sight long before they read a title. Price is the second-largest.
 * Everything the retailer said sits above the divider; the actions below it.
 *
 * When there is no usable image the card drops the frame entirely rather than reserving a grey
 * rectangle. `ProductImage` reports that through `onUnavailable`, including the case where a
 * URL was stored and then 404'd, which is common once a listing rotates.
 */
export function ItemCard({
  item,
  summary,
  onOpen,
  onStatusChange,
  onArchive,
  busy,
  comparing,
  onToggleCompare,
  comparisonFull,
}: ItemCardProps) {
  const [imageUsable, setImageUsable] = useState(true);
  const image = imageUsable ? item.image_url : null;

  return (
    <li
      data-testid="item-card"
      data-item-id={item.id}
      data-status={item.status}
      data-comparing={comparing}
      className={[
        'uc-surface uc-surface--raised flex flex-col overflow-hidden transition-opacity',
        busy ? 'opacity-60' : '',
      ].join(' ')}
    >
      {image ? (
        <ProductImage
          src={image}
          alt=""
          className="w-full rounded-none border-0 border-b border-[var(--uc-border)]"
          onUnavailable={() => setImageUsable(false)}
        />
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <ItemSource item={item} />
            <ItemTitle item={item} className="line-clamp-2 font-medium" />
          </div>
          <StatusBadge tone="neutral">{STATUS_LABELS[item.status]}</StatusBadge>
        </div>

        <CompareCheckbox
          item={item}
          comparing={comparing}
          onToggleCompare={onToggleCompare}
          comparisonFull={comparisonFull}
          showLabel
        />

        <ItemPrice item={item} size="lg" />
        <ItemPriceChange item={item} summary={summary} />
        <ItemVariant item={item} />
        <ItemAnnotations item={item} />
        <ItemFreshness item={item} />

        <div className="mt-auto pt-2">
          <ItemActions
            item={item}
            busy={busy}
            onOpen={onOpen}
            onStatusChange={onStatusChange}
            onArchive={onArchive}
          />
        </div>
      </div>
    </li>
  );
}
