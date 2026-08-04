'use client';

import { ProductImage, StatusBadge } from '@universal-cart/ui';

import { displayTitle } from './display';
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
 * One saved product, as a card in the visual grid.
 *
 * The photograph *is* the card: edge to edge, portrait like garment photography, and pressable
 * — it opens the details drawer, because the picture is what you recognise a jacket by and
 * therefore what you reach for. Selection and status float over the image as chips instead of
 * spending rows beneath it; the text under the photo is only what changes a decision: who
 * sells it, what it is, what it costs now, and how fresh that observation is.
 *
 * The frame renders even without a usable image. The earlier card dropped it, which read fine
 * in a list but breaks a grid: a card that is suddenly all text sits like a hole among the
 * photographs, and the neutral fallback frame keeps the rhythm instead. `ProductImage` handles
 * the failed-load case internally, so a 404'd CDN URL costs a placeholder, not a layout shift.
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
  const name = displayTitle(item.title, item.retailer_name, item.domain);

  return (
    <li
      data-testid="item-card"
      data-item-id={item.id}
      data-status={item.status}
      data-comparing={comparing}
      className={[
        'uc-surface uc-surface--raised uc-surface--media uc-card flex flex-col overflow-hidden',
        busy ? 'opacity-60' : '',
      ].join(' ')}
    >
      <div className="relative">
        <button
          type="button"
          className="uc-card-media"
          // "View", not "Details" — the caption's Details button is the accessible route with
          // a visible name, and two buttons answering to "Details" would be ambiguous to
          // anything (or anyone) addressing them by name.
          aria-label={`View ${name}`}
          onClick={() => onOpen(item)}
        >
          <ProductImage
            src={item.image_url}
            alt=""
            className="uc-product-image--portrait rounded-none"
          />
        </button>

        <div className="uc-card-chip top-2 left-2">
          <CompareCheckbox
            item={item}
            comparing={comparing}
            onToggleCompare={onToggleCompare}
            comparisonFull={comparisonFull}
            showLabel
          />
        </div>

        {/* "Saved" is the resting state of everything here; a chip saying so on every card
            would be noise. Only a state the user chose gets announced on the photograph. */}
        {item.status !== 'saved' ? (
          <div className="uc-card-chip top-2 right-2">
            <StatusBadge tone="neutral">{STATUS_LABELS[item.status]}</StatusBadge>
          </div>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <ItemSource item={item} />
          <ItemTitle item={item} className="line-clamp-2 text-sm font-medium" />
        </div>

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
